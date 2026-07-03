const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const https = require('https');
const { authenticate, authorizeRoles } = require('../middleware/auth');
const { depositLimiter } = require('../middleware/security');
const { assertImageMagicBytes } = require('../middleware/upload');
const { DepositProof, User, Transaction, PaymentSetting, sequelize } = require('../models');
const logger = require('../utils/logger');
const emailService = require('../utils/emailService');
const notificationService = require('../utils/notificationService');
const ps = require('../utils/platformSettings');
const { getNslPerUsdt, usdtToNsl, syncUsdtBalanceFromNsl } = require('../utils/currencyConversion');
const { storeSanitizedReceiptImage } = require('../utils/receiptImageStorage');
const { notifyDepositReviewers } = require('../utils/depositReviewNotifications');
const { recordAdminAudit } = require('../utils/adminAudit');
const {
  sanitizeReceiptSubmission,
  validateDepositReceipt,
  providerLabel,
} = require('../utils/depositReceiptParser');
const isVercel = process.env.VERCEL === '1';

const router = express.Router();

// Cache Binance address for 1 hour to avoid hammering the API
let walletCache = { address: null, fetchedAt: 0 };

async function getBinanceUSDTAddress() {
  const ONE_HOUR = 60 * 60 * 1000;
  if (walletCache.address && Date.now() - walletCache.fetchedAt < ONE_HOUR) {
    return walletCache.address;
  }

  const apiKey    = process.env.BINANCE_API_KEY;
  const secretKey = process.env.BINANCE_SECRET_KEY;
  if (!apiKey || !secretKey) return null;

  const ts     = Date.now();
  const params = `coin=USDT&network=TRX&timestamp=${ts}`;
  const sig    = crypto.createHmac('sha256', secretKey).update(params).digest('hex');
  const url    = `https://api.binance.com/sapi/v1/capital/deposit/address?${params}&signature=${sig}`;

  return new Promise((resolve) => {
    const req = https.get(url, { headers: { 'X-MBX-APIKEY': apiKey } }, (res) => {
      let body = '';
      res.on('data', chunk => { body += chunk; });
      res.on('end', () => {
        try {
          const data = JSON.parse(body);
          if (data.address) {
            walletCache = { address: data.address, fetchedAt: Date.now() };
            resolve(data.address);
          } else {
            logger.error('Binance deposit address error:', body);
            resolve(null);
          }
        } catch { resolve(null); }
      });
    });
    req.on('error', (e) => { logger.error('Binance API request failed:', e.message); resolve(null); });
    req.setTimeout(8000, () => { req.destroy(); resolve(null); });
  });
}

// Multer storage: memory on Vercel (no persistent disk), disk locally
const depositStorage = isVercel
  ? multer.memoryStorage()
  : multer.diskStorage({
      destination: (req, file, cb) => {
        const dir = 'uploads/deposits';
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        cb(null, dir);
      },
      filename: (req, file, cb) => {
        const ext = path.extname(file.originalname);
        cb(null, `deposit_${req.user.id}_${Date.now()}${ext}`);
      }
    });

const upload = multer({
  storage: depositStorage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowedExts = ['.jpg', '.jpeg', '.png', '.gif', '.webp'];
    const ext = path.extname(file.originalname).toLowerCase();
    if (!file.mimetype.startsWith('image/') || !allowedExts.includes(ext)) {
      return cb(new Error('Only image files (jpg, jpeg, png, gif, webp) are allowed'));
    }
    cb(null, true);
  }
});

function purgeLocalUpload(file) {
  if (file?.path) fs.unlink(file.path, () => {});
}

async function getPaymentSettings() {
  try {
    const rows = await PaymentSetting.findAll();
    const s = {};
    rows.forEach(r => { s[r.key] = r.value; });
    return s;
  } catch { return {}; }
}

// GET /api/deposit/wallet-info — returns Binance USDT TRC20 deposit address
router.get('/wallet-info', authenticate, async (req, res) => {
  try {
    const settings = await getPaymentSettings();
    let address = await getBinanceUSDTAddress();
    if (!address) address = settings.binance_wallet_address || process.env.DEPOSIT_WALLET_ADDRESS || '';
    const network = settings.binance_network || 'TRC20 (USDT)';
    res.json({
      success: true,
      data: {
        wallet_address: address,
        network,
        qr_code: process.env.DEPOSIT_QR_URL || null,
        instructions: 'Send USDT to the address above, then upload your transaction proof below.'
      }
    });
  } catch (error) {
    logger.error('Wallet info error:', error);
    res.status(500).json({ message: 'Error fetching wallet info' });
  }
});

// GET /api/deposit/payment-methods — returns all configured payment numbers/addresses
router.get('/payment-methods', authenticate, async (req, res) => {
  try {
    const settings = await getPaymentSettings();
    const parseAgentCodes = (raw) => {
      try { return JSON.parse(raw || '[]').filter(c => c.active); } catch { return []; }
    };
    const omRow = await PaymentSetting.findOne({ where: { key: 'om_agent_codes' } });
    const afRow = await PaymentSetting.findOne({ where: { key: 'africell_agent_codes' } });
    res.json({
      success: true,
      data: {
        orange_money_number: settings.orange_money_number || null,
        africell_number: settings.africell_number || null,
        binance_wallet_address: settings.binance_wallet_address || process.env.DEPOSIT_WALLET_ADDRESS || null,
        binance_network: settings.binance_network || 'TRC20 (USDT)',
        om_agent_codes: parseAgentCodes(omRow?.value),
        africell_agent_codes: parseAgentCodes(afRow?.value),
      }
    });
  } catch (error) {
    logger.error('Payment methods error:', error);
    res.status(500).json({ message: 'Error fetching payment methods' });
  }
});

// POST /api/deposit/submit — user submits deposit proof
// HIGH FIX: depositLimiter prevents submission spam
router.post('/submit', authenticate, depositLimiter, upload.single('receipt'), assertImageMagicBytes, async (req, res) => {
  try {
    const { amount, txid, notes } = req.body;

    if (!req.file) {
      return res.status(400).json({ message: 'Receipt image is required' });
    }

    const receipt = sanitizeReceiptSubmission({
      provider: 'binance',
      amount,
      currency: 'USDT',
      reference_id: txid,
    });
    const validation = validateDepositReceipt(receipt);
    if (!validation.valid) {
      purgeLocalUpload(req.file);
      return res.status(400).json({ message: validation.errors[0] || 'Receipt scan is incomplete.' });
    }

    const existingCrypto = await DepositProof.findOne({
      where: sequelize.where(
        sequelize.fn('lower', sequelize.col('user_submitted_txid')),
        receipt.reference_id.toLowerCase()
      ),
    });
    if (existingCrypto) {
      purgeLocalUpload(req.file);
      return res.status(400).json({ message: 'This Binance reference has already been submitted.' });
    }

    const receiptImage = await storeSanitizedReceiptImage({
      file: req.file,
      userId: req.user.id,
      localDir: 'uploads/deposits',
      blobPrefix: 'deposits',
      filePrefix: 'deposit',
    });

    const proof = await DepositProof.create({
      user_id: req.user.id,
      receipt_image: receiptImage,
      original_filename: req.file.originalname,
      ocr_extracted_data: {
        provider: receipt.provider,
        amount: receipt.amount,
        currency: receipt.currency,
        reference_id: receipt.reference_id,
        source: 'client_ocr_sanitized',
      },
      user_submitted_amount: receipt.amount,
      user_submitted_currency: 'USDT',
      user_submitted_txid: receipt.reference_id,
      user_notes: notes || null,
      deposit_type: 'crypto_wallet',
      ip_address: req.ip,
      status: 'pending'
    });

    notifyDepositReviewers({
      provider: receipt.provider,
      providerLabel: providerLabel(receipt.provider),
      amount: receipt.amount,
      currency: 'USDT',
      referenceId: receipt.reference_id,
      depositType: 'crypto',
      depositId: proof.id,
    }).catch(error => logger.error('Deposit reviewer notification failed:', error));

    logger.info(`Deposit proof submitted by user ${req.user.id}: ${receipt.amount} USDT`);

    recordAdminAudit(req, { action: 'user.deposit_submit', targetType: 'deposit', targetId: proof.id, targetUserId: req.user.id, metadata: { amount: receipt.amount, currency: 'USDT', reference_id: receipt.reference_id } })
      .catch(err => logger.error('Audit log error (deposit-submit):', err.message));

    res.status(201).json({
      success: true,
      message: 'Deposit proof submitted. An admin will review and credit your account shortly.',
      data: { id: proof.id, status: proof.status, amount: proof.user_submitted_amount }
    });
  } catch (error) {
    purgeLocalUpload(req.file);
    logger.error('Deposit submit error:', error);
    res.status(500).json({ message: 'Error submitting deposit proof', error: error.message });
  }
});

// GET /api/deposit/my — user views their own deposit history
router.get('/my', authenticate, async (req, res) => {
  try {
    const proofs = await DepositProof.findAll({
      where: { user_id: req.user.id },
      order: [['created_at', 'DESC']],
      limit: 20
    });
    res.json({ success: true, data: proofs });
  } catch (error) {
    logger.error('Deposit history error:', error);
    res.status(500).json({ message: 'Error fetching deposit history' });
  }
});

// GET /api/deposit/pending — admin views all pending proofs
router.get('/pending', authenticate, authorizeRoles('admin', 'superadmin', 'finance'), async (req, res) => {
  try {
    const proofs = await DepositProof.findAll({
      where: { status: 'pending' },
      include: [{ model: User, as: 'user', attributes: ['id', 'username', 'phone', 'balance_NSL', 'balance_usdt'] }],
      order: [['created_at', 'ASC']]
    });
    res.json({ success: true, data: proofs });
  } catch (error) {
    logger.error('Pending deposits fetch error:', error);
    res.status(500).json({ message: 'Error fetching pending deposits' });
  }
});

// PATCH /api/deposit/:id/approve — admin approves deposit
// C-3 FIX: entire approve action runs inside a serializable DB transaction with row-level
// locking (SELECT … FOR UPDATE) so concurrent admin approvals cannot double-credit a deposit.
router.patch('/:id/approve', authenticate, authorizeRoles('admin', 'superadmin', 'finance'), async (req, res) => {
  const { approved_amount, notes } = req.body;
  const { Op } = require('sequelize');

  let nslAmountResult;
  try {
    await sequelize.transaction({ isolationLevel: sequelize.constructor.Transaction.ISOLATION_LEVELS.SERIALIZABLE }, async (t) => {
      // Lock the deposit proof row so concurrent requests are serialized
      const proof = await DepositProof.findOne({
        where: { id: req.params.id },
        lock: t.LOCK.UPDATE,
        transaction: t
      });

      if (!proof) {
        const err = new Error('Deposit proof not found');
        err.status = 404;
        throw err;
      }
      if (proof.status !== 'pending') {
        const err = new Error('Deposit already processed');
        err.status = 400;
        throw err;
      }

      const amount = parseFloat(approved_amount || proof.user_submitted_amount);
      const nslRate = await getNslPerUsdt();
      const feePercent = await ps.get('recharge_fee_pct');
      const amountAfterFee = amount * (1 - feePercent / 100);
      const nslAmount = usdtToNsl(amountAfterFee, nslRate);

      // Lock the user row as well to prevent concurrent balance updates
      const user = await User.findOne({
        where: { id: proof.user_id },
        lock: t.LOCK.UPDATE,
        transaction: t
      });
      if (!user) {
        const err = new Error('User not found');
        err.status = 404;
        throw err;
      }

      // Mark proof approved inside the transaction
      proof.status = 'approved';
      proof.reviewed_by = req.user.id;
      proof.reviewed_at = new Date();
      proof.approved_amount = amount;
      proof.approved_currency = 'USDT';
      proof.approved_transaction_id = `DEP-${proof.id}`;
      proof.admin_notes = notes || null;
      await proof.save({ transaction: t });

      // Credit balance inside the same transaction
      user.balance_NSL = parseFloat(user.balance_NSL) + nslAmount;
      user.balance_usdt = syncUsdtBalanceFromNsl(user.balance_NSL, nslRate);
      await user.save({ transaction: t });

      await Transaction.create({
        user_id: user.id,
        type: 'recharge',
        amount_NSL: nslAmount,
        amount_usdt: amount,
        status: 'approved',
        notes: `Deposit approved. ${amount} USDT -> ${nslAmount.toFixed(4)} NSL (${feePercent}% fee, rate ${nslRate} NSL per USDT)`
      }, { transaction: t });

      nslAmountResult = { nslAmount, user, amount, feePercent, nslRate };
      logger.info(`Deposit ${proof.id} approved for user ${user.username}: ${amount} USDT → ${nslAmount} NSL`);
    });

    const { nslAmount, user, amount } = nslAmountResult;

    if (user.email) {
      emailService.sendTransactionApproved(user.email, user.username, 'deposit', nslAmount, amount, user.balance_NSL)
        .catch(err => logger.error('Deposit approval email failed:', err));
    }
    notificationService.notifyRechargeApproved(user.id, nslAmount, 'NSL', {
      deposit_id: req.params.id,
      approved_usdt: amount,
    }).catch(err => logger.error('Deposit approval notification failed:', err));

    res.json({
      success: true,
      message: 'Deposit approved and balance credited',
      nsl_credited: nslAmountResult.nslAmount,
      usdt_approved: nslAmountResult.amount,
      exchange_rate_nsl_per_usdt: nslAmountResult.nslRate
    });
  } catch (error) {
    logger.error('Deposit approve error:', error);
    const status = error.status || 500;
    res.status(status).json({ message: error.message || 'Error approving deposit' });
  }
});

// PATCH /api/deposit/:id/reject — admin rejects deposit
router.patch('/:id/reject', authenticate, authorizeRoles('admin', 'superadmin', 'finance'), async (req, res) => {
  try {
    const { reason } = req.body;
    if (!reason) return res.status(400).json({ message: 'Rejection reason is required' });

    const proof = await DepositProof.findByPk(req.params.id);
    if (!proof) return res.status(404).json({ message: 'Deposit proof not found' });
    if (proof.status !== 'pending') return res.status(400).json({ message: 'Deposit already processed' });

    await proof.reject(req.user.id, reason);

    const user = await User.findByPk(proof.user_id, { attributes: ['id', 'email', 'username'] });
    if (user?.email) {
      emailService.sendTransactionRejected(user.email, user.username, 'deposit', proof.user_submitted_amount, reason)
        .catch(err => logger.error('Deposit rejection email failed:', err));
    }
    if (user) {
      notificationService.notifyRechargeRejected(user.id, proof.user_submitted_amount, 'USDT', reason, {
        deposit_id: proof.id,
      }).catch(err => logger.error('Deposit rejection notification failed:', err));
    }

    logger.info(`Deposit ${proof.id} rejected: ${reason}`);
    res.json({ success: true, message: 'Deposit rejected' });
  } catch (error) {
    logger.error('Deposit reject error:', error);
    res.status(500).json({ message: 'Error rejecting deposit', error: error.message });
  }
});

module.exports = router;
