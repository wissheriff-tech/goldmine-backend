const express = require('express');
const multer  = require('multer');
const path    = require('path');
const fs      = require('fs');
const { User, Transaction, sequelize } = require('../models');
const { authenticate } = require('../middleware/auth');
const { transactionLimiter } = require('../middleware/rateLimiter');
const logger  = require('../utils/logger');
const { FEE } = require('../config/constants');

const router = express.Router();

const SLL_PER_NSL = () => parseFloat(process.env.ORANGE_SLL_PER_NSL || 100);

// Multer for screenshot uploads
const omStorage = multer.diskStorage({
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
router.post('/manual-deposit', authenticate, transactionLimiter, omUpload.single('screenshot'), async (req, res) => {
  try {
    const { amount_NSL, amount_SLE, reference_id, sender_number, receiver_number, timestamp_receipt } = req.body;
    const nsl = parseFloat(amount_NSL);

    if (!nsl || nsl < 10) return res.status(400).json({ message: 'Minimum deposit is 10 NSL' });
    if (!reference_id?.trim()) return res.status(400).json({ message: 'Reference ID is required' });
    if (!req.file) return res.status(400).json({ message: 'Screenshot is required' });

    // Enforce uniqueness of reference ID across all users
    const existing = await Transaction.findOne({ where: { reference_id: reference_id.trim() } });
    if (existing) return res.status(400).json({ message: 'This reference ID has already been submitted.' });

    const screenshotPath = req.file.path;

    await Transaction.create({
      user_id:          req.user.id,
      type:             'recharge',
      amount_NSL:       nsl,
      amount_usdt:      0,
      status:           'pending',
      payment_method:   'orange_money',
      deposit_network:  'Orange Money',
      reference_id:     reference_id.trim(),
      payment_proof:    screenshotPath,
      notes:            JSON.stringify({ amount_SLE, sender_number, receiver_number, timestamp_receipt }),
    });

    logger.info(`Orange Money manual deposit submitted: ref=${reference_id} ${nsl} NSL for user #${req.user.id}`);
    return res.json({ message: 'Deposit proof submitted. Admin will credit your account shortly.' });
  } catch (err) {
    logger.error('Orange Money manual-deposit error:', err.message);
    return res.status(500).json({ message: 'Submission failed. Please try again.' });
  }
});

// ── POST /api/orange-money/callback ──────────────────────────────────────
// Orange Money posts here on payment completion (notif_url).
router.post('/callback', async (req, res) => {
  try {
    const { order_id, status, pay_token } = req.body;
    logger.info('Orange Money callback received:', req.body);

    if (!order_id) {
      return res.status(400).json({ message: 'Missing order_id' });
    }

    // Find the pending transaction by notes (order_id)
    const transaction = await Transaction.findOne({
      where: { notes: order_id, payment_method: 'orange_money', status: 'pending' },
      include: [{ model: User, as: 'user' }],
    });

    if (!transaction) {
      logger.warn(`Orange Money callback: no pending transaction for order ${order_id}`);
      return res.status(404).json({ message: 'Transaction not found' });
    }

    // Verify status with Orange Money directly (don't trust callback body alone)
    let confirmed = status === 'SUCCESS';
    if (pay_token) {
      try {
        const verification = await om.getPaymentStatus(pay_token);
        confirmed = verification.status === 'SUCCESS';
      } catch (_) { /* use callback status if verification fails */ }
    }

    if (confirmed) {
      await sequelize.transaction(async (t) => {
        transaction.status = 'approved';
        transaction.approved_at = new Date();
        await transaction.save({ transaction: t });

        const user = transaction.user;
        user.balance_NSL = parseFloat(user.balance_NSL) + parseFloat(transaction.amount_NSL);
        await user.save({ transaction: t });
      });

      logger.info(`Orange Money deposit approved: ${order_id} — +${transaction.amount_NSL} NSL for user ${transaction.user_id}`);
    } else {
      transaction.status = 'rejected';
      await transaction.save();
      logger.info(`Orange Money deposit rejected: ${order_id}`);
    }

    return res.json({ message: 'Callback processed' });
  } catch (err) {
    logger.error('Orange Money callback error:', err.message);
    return res.status(500).json({ message: 'Callback processing failed' });
  }
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

    // Calculate fee
    let fee    = 0;
    let netNSL = nsl;
    if (user.role !== 'superadmin') {
      fee    = nsl * FEE.WITHDRAWAL_FEE_PERCENTAGE / 100;
      netNSL = nsl - fee;
    }

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

    // Attempt Orange Money transfer (non-blocking — transaction already created)
    let omResult = null;
    try {
      omResult = await om.initiateTransfer({
        recipientMSISDN: cleanPhone,
        amountSLL,
        orderId,
        description: `SalonMoney withdrawal — ${netNSL.toFixed(2)} NSL`,
      });

      // Auto-approve if Orange Money confirms immediately
      if (omResult?.status === 'SUCCESS') {
        await Transaction.update(
          { status: 'approved', approved_at: new Date() },
          { where: { notes: orderId } }
        );
      }
    } catch (omErr) {
      logger.error('Orange Money transfer API error (transaction stays pending for admin review):', omErr.response?.data || omErr.message);
    }

    logger.info(`Orange Money withdrawal submitted: ${orderId} — ${nsl} NSL for user ${user.id}`);

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
