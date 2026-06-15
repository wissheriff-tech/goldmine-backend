const express = require('express');
const multer  = require('multer');
const path    = require('path');
const fs      = require('fs');
const { User, Transaction, sequelize } = require('../models');
const { authenticate } = require('../middleware/auth');
const { transactionLimiter } = require('../middleware/security');
const { assertImageMagicBytes } = require('../middleware/upload');
const logger  = require('../utils/logger');
const { FEE } = require('../config/constants');
const ps = require('../utils/platformSettings');
const { put: blobPut } = require('@vercel/blob');
const isVercel = process.env.VERCEL === '1';

const router = express.Router();

const SLL_PER_NSL = () => parseFloat(process.env.ORANGE_SLL_PER_NSL || 1);

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
    if (!file.mimetype.startsWith('image/')) return cb(new Error('Images only'));
    cb(null, true);
  }
});

// ── POST /api/orange-money/manual-deposit ─────────────────────────────────
// User uploads screenshot of Orange Money receipt; admin approves manually.
router.post('/manual-deposit', authenticate, transactionLimiter, omUpload.single('screenshot'), assertImageMagicBytes, async (req, res) => {
  try {
    const { amount_SLE, amount_NSL, reference_id, sender_number, receiver_number, timestamp_receipt, provider } = req.body;
    // Accept SLE amount (what user sent on their receipt) — fall back to NSL for legacy clients
    const rawAmount = parseFloat(amount_SLE || amount_NSL);
    const isAfricell = (provider || '').toLowerCase() === 'africell';
    const paymentMethod = isAfricell ? 'africell' : 'orange_money';
    const networkLabel  = isAfricell ? 'Africell' : 'Orange Money';

    if (!rawAmount || rawAmount < 1000) return res.status(400).json({ message: 'Minimum deposit is 1,000 SLE' });
    if (!reference_id?.trim()) return res.status(400).json({ message: 'Reference ID is required' });
    if (!req.file) return res.status(400).json({ message: 'Screenshot is required' });

    // Enforce uniqueness of reference ID across all users
    const existing = await Transaction.findOne({ where: { reference_id: reference_id.trim() } });
    if (existing) return res.status(400).json({ message: 'This reference ID has already been submitted.' });

    let screenshotPath;
    if (isVercel) {
      const ext = path.extname(req.file.originalname) || '.jpg';
      const blob = await blobPut(`payments/${req.user.id}/${Date.now()}${ext}`, req.file.buffer, {
        access: 'public',
        contentType: req.file.mimetype,
      });
      screenshotPath = blob.url;
    } else {
      screenshotPath = req.file.path;
    }

    await Transaction.create({
      user_id:          req.user.id,
      type:             'recharge',
      amount_NSL:       rawAmount,        // gross SLE amount (1 SLE = 1 NSL at current rate)
      amount_usdt:      0,
      status:           'pending',
      payment_method:   paymentMethod,
      deposit_network:  networkLabel,
      reference_id:     reference_id.trim(),
      payment_proof:    screenshotPath,
      notes:            JSON.stringify({ amount_SLE: rawAmount, sender_number, receiver_number, timestamp_receipt }),
    });

    logger.info(`${networkLabel} manual deposit submitted: ref=${reference_id} ${rawAmount} SLE for user #${req.user.id}`);
    return res.json({ message: 'Deposit proof submitted. Admin will credit your account shortly.' });
  } catch (err) {
    logger.error('Orange Money manual-deposit error:', err.message);
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
      user.balance_NSL = parseFloat(user.balance_NSL) - nsl;
      await user.save({ transaction: t });

      await Transaction.create({
        user_id:            user.id,
        type:               'withdrawal',
        amount_NSL:         nsl,
        amount_usdt:        0,
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
