const express = require('express');
const crypto  = require('crypto');
const { User, Transaction, sequelize } = require('../models');
const { authenticate } = require('../middleware/auth');
const { transactionLimiter } = require('../middleware/rateLimiter');
const logger  = require('../utils/logger');
const om      = require('../services/orangeMoney');
const { FEE } = require('../config/constants');

const router = express.Router();

const FRONTEND_URL  = process.env.FRONTEND_URL  || 'https://getsalonmoney.vercel.app';
const BACKEND_URL   = process.env.BACKEND_URL   || 'https://backend-tau-seven-72.vercel.app';

// SLL per NSL exchange rate (configurable)
const SLL_PER_NSL = () => parseFloat(process.env.ORANGE_SLL_PER_NSL || 100);

// ── POST /api/orange-money/initiate-deposit ────────────────────────────────
// Creates an Orange Money payment session; returns pay_token + payment_url.
router.post('/initiate-deposit', authenticate, transactionLimiter, async (req, res) => {
  try {
    const { amount_NSL } = req.body;
    const nsl = parseFloat(amount_NSL);

    if (!nsl || nsl < 10) {
      return res.status(400).json({ message: 'Minimum deposit is 10 NSL' });
    }

    const orderId  = `DEP-${req.user.id}-${Date.now()}`;
    const amountSLL = Math.round(nsl * SLL_PER_NSL());

    const result = await om.initiateDeposit({
      orderId,
      amountSLL,
      returnUrl: `${FRONTEND_URL}/wallet?om_status=success&order_id=${orderId}`,
      cancelUrl: `${FRONTEND_URL}/wallet?om_status=cancelled`,
      notifUrl:  `${BACKEND_URL}/api/orange-money/callback`,
    });

    // Store pending transaction so we can reconcile on callback
    await Transaction.create({
      user_id:        req.user.id,
      type:           'recharge',
      amount_NSL:     nsl,
      amount_usdt:    0,
      status:         'pending',
      payment_method: 'orange_money',
      notes:          orderId,
      deposit_network:'Orange Money',
      reference_id:   result.pay_token || orderId,
    });

    logger.info(`Orange Money deposit initiated: ${orderId} — ${nsl} NSL (${amountSLL} SLL) for user ${req.user.id}`);

    return res.json({
      pay_token:   result.pay_token,
      payment_url: result.payment_url,
      order_id:    orderId,
      amount_NSL:  nsl,
      amount_SLL:  amountSLL,
    });
  } catch (err) {
    logger.error('Orange Money initiate-deposit error:', err.response?.data || err.message);
    return res.status(502).json({ message: 'Orange Money service unavailable. Please try again.' });
  }
});

// ── GET /api/orange-money/status/:payToken ────────────────────────────────
// Poll payment status (used by frontend while user completes payment).
router.get('/status/:payToken', authenticate, async (req, res) => {
  try {
    const data = await om.getPaymentStatus(req.params.payToken);
    return res.json(data);
  } catch (err) {
    logger.error('Orange Money status check error:', err.response?.data || err.message);
    return res.status(502).json({ message: 'Could not fetch payment status.' });
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
