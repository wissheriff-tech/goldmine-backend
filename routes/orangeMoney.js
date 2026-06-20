const express = require('express');
const multer  = require('multer');
const path    = require('path');
const fs      = require('fs');
const { User, Transaction, DepositProof, sequelize } = require('../models');
const { authenticate } = require('../middleware/auth');
const { transactionLimiter } = require('../middleware/security');
const { assertImageMagicBytes } = require('../middleware/upload');
const logger  = require('../utils/logger');
const { FEE } = require('../config/constants');
const ps = require('../utils/platformSettings');
const { getNslPerUsdt, nslToUsdt, syncUsdtBalanceFromNsl } = require('../utils/currencyConversion');
const { storeSanitizedReceiptImage } = require('../utils/receiptImageStorage');
const { notifyDepositReviewers } = require('../utils/depositReviewNotifications');
const {
  sanitizeReceiptSubmission,
  validateDepositReceipt,
  providerLabel,
  isMobileProvider,
} = require('../utils/depositReceiptParser');
const isVercel = process.env.VERCEL === '1';

const router = express.Router();

const SLL_PER_NSL = () => parseFloat(process.env.ORANGE_SLL_PER_NSL || 1);

function purgeLocalUpload(file) {
  if (file?.path) fs.unlink(file.path, () => {});
}

// Multer for screenshot uploads: memory on Vercel, disk locally
const omStorage = isVercel
  ? multer.memoryStorage()
  : multer.diskStorage({
      destination: (req, file, cb) => {
        const dir = 'uploads/payments';
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        cb(null, dir);
      },
      filename: (req, file, cb) => {
        const ext = path.extname(file.originalname);
        cb(null, `om_${req.user.id}_${Date.now()}${ext}`);
      }
    });
const omUpload = multer({
  storage: omStorage,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowedExts = new Set(['.jpg', '.jpeg', '.png', '.gif', '.webp']);
    const allowedMime = new Set(['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp']);
    const ext = path.extname(file.originalname).toLowerCase();
    if (!allowedMime.has(file.mimetype) || !allowedExts.has(ext)) {
      return cb(new Error('Only image files (jpg, jpeg, png, gif, webp) are allowed'));
    }
    cb(null, true);
  }
});

// ── POST /api/orange-money/manual-deposit ─────────────────────────────────
// User uploads a scanned payment receipt; admin or finance approves manually.
router.post('/manual-deposit', authenticate, transactionLimiter, omUpload.single('screenshot'), assertImageMagicBytes, async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ message: 'Screenshot is required' });

    const receipt = sanitizeReceiptSubmission(req.body);
    const validation = validateDepositReceipt(receipt);
    if (!validation.valid) {
      purgeLocalUpload(req.file);
      return res.status(400).json({ message: validation.errors[0] || 'Receipt scan is incomplete.' });
    }

    if (receipt.provider === 'binance') {
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
          timestamp_receipt: receipt.timestamp_receipt || null,
          source: 'client_ocr_sanitized',
        },
        user_submitted_amount: receipt.amount,
        user_submitted_currency: 'USDT',
        user_submitted_txid: receipt.reference_id,
        user_notes: 'Submitted from receipt screenshot scan.',
        deposit_type: 'crypto_wallet',
        ip_address: req.ip,
        status: 'pending',
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

      logger.info(`Binance scanned deposit submitted: ref=${receipt.reference_id} ${receipt.amount} USDT for user #${req.user.id}`);
      return res.status(201).json({
        message: 'Deposit proof submitted. Finance will review it shortly.',
        data: { id: proof.id, status: proof.status, provider: receipt.provider, amount: receipt.amount, currency: 'USDT' },
      });
    }

    if (!isMobileProvider(receipt.provider)) {
      purgeLocalUpload(req.file);
      return res.status(400).json({ message: 'Unsupported payment provider.' });
    }

    // Enforce uniqueness of reference ID across all mobile deposits
    const existing = await Transaction.findOne({
      where: sequelize.where(
        sequelize.fn('lower', sequelize.col('reference_id')),
        receipt.reference_id.toLowerCase()
      ),
    });
    if (existing) {
      purgeLocalUpload(req.file);
      return res.status(400).json({ message: 'This reference ID has already been submitted.' });
    }

    const screenshotPath = await storeSanitizedReceiptImage({
      file: req.file,
      userId: req.user.id,
      localDir: 'uploads/payments',
      blobPrefix: 'payments',
      filePrefix: 'om',
    });

    const isAfricell = receipt.provider === 'africell';
    const paymentMethod = isAfricell ? 'africell' : 'orange_money';
    const networkLabel = providerLabel(receipt.provider);

    const transaction = await Transaction.create({
      user_id:          req.user.id,
      type:             'recharge',
      amount_NSL:       receipt.amount,        // gross local amount, credited after approval and fee
      amount_usdt:      0,
      status:           'pending',
      payment_method:   paymentMethod,
      deposit_network:  networkLabel,
      reference_id:     receipt.reference_id,
      payment_proof:    screenshotPath,
      notes:            JSON.stringify({
        amount_SLE: receipt.amount,
        currency: receipt.currency,
        sender_number: receipt.sender_number,
        receiver_number: receipt.receiver_number,
        timestamp_receipt: receipt.timestamp_receipt,
        scan_source: 'client_ocr_sanitized',
      }),
    });

    notifyDepositReviewers({
      provider: receipt.provider,
      providerLabel: networkLabel,
      amount: receipt.amount,
      currency: receipt.currency,
      referenceId: receipt.reference_id,
      depositType: 'mobile_money',
      transactionId: transaction.id,
    }).catch(error => logger.error('Deposit reviewer notification failed:', error));

    logger.info(`${networkLabel} scanned deposit submitted: ref=${receipt.reference_id} ${receipt.amount} ${receipt.currency} for user #${req.user.id}`);
    return res.status(201).json({
      message: 'Deposit proof submitted. Finance will review it shortly.',
      data: { id: transaction.id, status: transaction.status, provider: receipt.provider, amount: receipt.amount, currency: receipt.currency },
    });
  } catch (err) {
    purgeLocalUpload(req.file);
    logger.error('Scanned deposit submission error:', err.message);
    return res.status(500).json({ message: 'Submission failed. Please try again.' });
  }
});

// ── POST /api/orange-money/callback ──────────────────────────────────────
// Automated callbacks are disabled — this platform uses manual admin approval.
// Registered so external callers receive a clear 501 rather than a 404 that triggers retries.
router.post('/callback', (req, res) => {
  logger.warn('Orange Money callback received but automated processing is disabled', { ip: req.ip });
  return res.status(501).json({ message: 'Automated callbacks are not enabled. Deposits are reviewed manually by admin.' });
});

// ── POST /api/orange-money/withdraw ──────────────────────────────────────
// Transfer NSL earnings to user's Orange Money phone.
router.post('/withdraw', authenticate, transactionLimiter, async (req, res) => {
  try {
    const { amount_NSL, phone } = req.body;
    const nsl = parseFloat(amount_NSL);

    if (!nsl || nsl < 100) {
      return res.status(400).json({ message: 'Minimum withdrawal is 100 NSL' });
    }
    if (!phone || !/^\+?\d{7,15}$/.test(phone.replace(/\s/g, ''))) {
      return res.status(400).json({ message: 'Valid Orange Money phone number is required' });
    }

    const user = await User.findByPk(req.user.id);
    if (!user) return res.status(404).json({ message: 'User not found' });

    // Calculate fee — Orange Money uses a higher rate than crypto withdrawals
    const omFeePct = user.role === 'superadmin' ? 0 : await ps.get('om_withdrawal_fee_pct');
    let fee    = nsl * omFeePct / 100;
    let netNSL = nsl - fee;

    if (parseFloat(user.balance_NSL) < nsl) {
      return res.status(400).json({ message: 'Insufficient balance' });
    }

    const orderId   = `WDR-${user.id}-${Date.now()}`;
    const amountSLL = Math.round(netNSL * SLL_PER_NSL());
    const cleanPhone = phone.replace(/\s/g, '');

    // Deduct balance and create pending transaction immediately
    await sequelize.transaction(async (t) => {
      const rate = await getNslPerUsdt();
      user.balance_NSL = parseFloat(user.balance_NSL) - nsl;
      user.balance_usdt = syncUsdtBalanceFromNsl(user.balance_NSL, rate);
      await user.save({ transaction: t });

      await Transaction.create({
        user_id:            user.id,
        type:               'withdrawal',
        amount_NSL:         nsl,
        amount_usdt:        nslToUsdt(nsl, rate),
        status:             'pending',
        payment_method:     'orange_money',
        notes:              orderId,
        withdrawal_address: cleanPhone,
        withdrawal_network: 'Orange Money',
        reference_id:       orderId,
      }, { transaction: t });
    });

    // Withdrawal stays pending — admin reviews and processes manually.
    logger.info(`Orange Money withdrawal submitted (pending admin review): ${orderId} — ${nsl} NSL for user ${user.id}`);

    return res.json({
      message:    'Withdrawal submitted. Funds will arrive via Orange Money shortly.',
      order_id:   orderId,
      amount_NSL: nsl,
      fee_NSL:    fee,
      net_NSL:    netNSL,
      amount_SLL: amountSLL,
      phone:      cleanPhone,
    });
  } catch (err) {
    logger.error('Orange Money withdraw error:', err.message);
    return res.status(500).json({ message: 'Withdrawal failed. Please try again.' });
  }
});

module.exports = router;
