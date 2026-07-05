const express = require('express');
const { Op, QueryTypes } = require('sequelize');
const { sequelize } = require('../models');
const User = require('../models/User');
const { FEE } = require('../config/constants');
const ps = require('../utils/platformSettings');
const Transaction = require('../models/Transaction');
const Referral = require('../models/Referral');
const Product = require('../models/Product');
const UserProduct = require('../models/UserProduct');
const Session = require('../models/Session');
const { authenticate } = require('../middleware/auth');
const logger = require('../utils/logger');
const notificationService = require('../utils/notificationService');
const { getNslPerUsdt, nslToUsdt, syncUsdtBalanceFromNsl } = require('../utils/currencyConversion');
const { paymentUpload, kycUpload, assertImageMagicBytes, assertDocumentMagicBytes } = require('../middleware/upload');
const { storeSanitizedReceiptImage } = require('../utils/receiptImageStorage');
const { protectedFileUrl } = require('../utils/protectedFiles');
const path = require('path');
const fs = require('fs');
const { put: blobPut } = require('@vercel/blob');
const isVercel = process.env.VERCEL === '1';
const isStrongPassword = (value) => /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]{8,}$/.test(String(value || ''));
const purgeUpload = (file) => {
  if (file?.path) fs.unlink(file.path, () => {});
};

// Validation and Security Middleware
const {
  validateRecharge,
  validateWithdraw,
  validateUpdateProfile
} = require('../middleware/validation');

const { transactionLimiter, passwordResetLimiter, kycUploadLimiter } = require('../middleware/security');
const { recordAdminAudit } = require('../utils/adminAudit');

const router = express.Router();

// Get user dashboard
router.get('/dashboard', authenticate, async (req, res) => {
  try {
    const user = await User.findByPk(req.user.id);

    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }
    const rate = await getNslPerUsdt();

    const userProducts = await UserProduct.findAll({
      where: { user_id: user.id, is_active: true },
      include: [{ model: Product, as: 'product' }]
    });

    const referralCount = await Referral.count({ where: { referrer_id: user.id } });
    const totalReferralEarnings = await Referral.sum('bonus_NSL', {
      where: { referrer_id: user.id, status: 'paid' }
    });

    res.json({
      user: {
        id: user.id,
        phone: user.phone,
        username: user.username,
        role: user.role,
        balance_NSL: user.balance_NSL,
        balance_usdt: nslToUsdt(user.balance_NSL, rate),
        exchange_rate_nsl_per_usdt: rate,
        vip_level: user.vip_level,
        referral_code: user.referral_code,
        referred_by: user.referred_by,
        ambassador_region: user.ambassador_region,
        ambassador_sector: user.ambassador_sector,
        status: user.status,
        kyc_verified: user.kyc_verified,
        created_at: user.created_at
      },
      products: userProducts,
      referrals: {
        count: referralCount,
        total_earnings_NSL: totalReferralEarnings || 0
      }
    });
  } catch (error) {
    logger.error('Dashboard error:', error);
    res.status(500).json({ message: 'Error fetching dashboard' });
  }
});

router.put('/change-password', authenticate, passwordResetLimiter, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    if (!currentPassword || !newPassword) {
      return res.status(400).json({ message: 'Current password and new password are required' });
    }
    if (!isStrongPassword(newPassword)) {
      return res.status(400).json({ message: 'Password must be at least 8 characters and contain uppercase, lowercase, number, and special character' });
    }

    const user = await User.scope('withSecrets').findByPk(req.user.id);
    if (!user) return res.status(404).json({ message: 'User not found' });

    const passwordMatches = await user.comparePassword(currentPassword);
    if (!passwordMatches) {
      return res.status(401).json({ message: 'Current password is incorrect' });
    }

    const samePassword = await user.comparePassword(newPassword);
    if (samePassword) {
      return res.status(400).json({ message: 'New password must be different from the current password' });
    }

    user.password_hash = newPassword;
    await user.save();
    await Session.update({ is_active: false }, { where: { user_id: user.id, is_active: true } });

    res.clearCookie('access_token');
    res.clearCookie('refresh_token', { path: '/api/auth/refresh' });

    try {
      await notificationService.notifyPasswordChanged(user.id);
    } catch (notifyError) {
      logger.error('Password change notification error:', notifyError);
    }

    res.json({ message: 'Password changed successfully. Please sign in again.' });
  } catch (error) {
    logger.error('User password change error:', error);
    res.status(500).json({ message: 'Error changing password' });
  }
});

// Get transactions
router.get('/transactions', authenticate, async (req, res) => {
  try {
    const { type, status, date_from, date_to, limit = 20, skip = 0 } = req.query;
    const where = { user_id: req.user.id };

    if (type) where.type = type;
    if (status) where.status = status;
    if (date_from || date_to) {
      where.timestamp = {};
      if (date_from) where.timestamp[Op.gte] = new Date(date_from);
      if (date_to) {
        const toEnd = new Date(date_to);
        toEnd.setHours(23, 59, 59, 999);
        where.timestamp[Op.lte] = toEnd;
      }
    }

    // HIGH FIX: cap pagination limit to prevent unbounded result sets
    const MAX_PAGE_SIZE = 100;
    const parsedLimit = Math.min(Math.max(1, parseInt(limit) || 20), MAX_PAGE_SIZE);

    const { count: total, rows: transactions } = await Transaction.findAndCountAll({
      where,
      order: [['timestamp', 'DESC']],
      limit: parsedLimit,
      offset: Math.max(0, parseInt(skip) || 0),
      include: [{ model: User, as: 'approver', attributes: ['phone'] }]
    });

    res.json({
      transactions,
      pagination: {
        total,
        limit: parsedLimit,
        skip: Math.max(0, parseInt(skip) || 0)
      }
    });
  } catch (error) {
    logger.error('Transaction fetch error:', error);
    res.status(500).json({ message: 'Error fetching transactions' });
  }
});


// Income summary — today / this month / all time / streak
router.get('/income-summary', authenticate, async (req, res) => {
  try {
    const userId = req.user.id;
    const now = new Date();
    const todayStart = new Date(now); todayStart.setHours(0, 0, 0, 0);
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const approvedStatuses = ['approved', 'completed'];

    const [allTime, month, today] = await Promise.all([
      Transaction.findAll({
        where: { user_id: userId, type: 'income', status: { [Op.in]: approvedStatuses } },
        attributes: [
          [sequelize.fn('SUM', sequelize.col('amount_NSL')), 'total'],
          [sequelize.fn('COUNT', sequelize.col('id')), 'count'],
        ],
        raw: true,
      }),
      Transaction.findAll({
        where: { user_id: userId, type: 'income', status: { [Op.in]: approvedStatuses }, timestamp: { [Op.gte]: monthStart } },
        attributes: [[sequelize.fn('SUM', sequelize.col('amount_NSL')), 'total']],
        raw: true,
      }),
      Transaction.findAll({
        where: { user_id: userId, type: 'income', status: { [Op.in]: approvedStatuses }, timestamp: { [Op.gte]: todayStart } },
        attributes: [[sequelize.fn('SUM', sequelize.col('amount_NSL')), 'total']],
        raw: true,
      }),
    ]);

    // Streak: consecutive days with income (check last 90 days)
    const ninetyDaysAgo = new Date(now); ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);
    const incomeDays = await Transaction.findAll({
      where: { user_id: userId, type: 'income', status: { [Op.in]: approvedStatuses }, timestamp: { [Op.gte]: ninetyDaysAgo } },
      attributes: [[sequelize.fn('DATE', sequelize.col('timestamp')), 'day']],
      group: [sequelize.fn('DATE', sequelize.col('timestamp'))],
      order: [[sequelize.fn('DATE', sequelize.col('timestamp')), 'DESC']],
      raw: true,
    });

    let streak = 0;
    const todayDate = new Date(); todayDate.setHours(0, 0, 0, 0);
    for (let i = 0; i < incomeDays.length; i++) {
      const expected = new Date(todayDate); expected.setDate(expected.getDate() - i);
      const actual = new Date(incomeDays[i].day);
      if (actual.toDateString() === expected.toDateString()) { streak++; } else { break; }
    }

    res.json({
      today_NSL: parseFloat(today[0]?.total || 0),
      this_month_NSL: parseFloat(month[0]?.total || 0),
      all_time_NSL: parseFloat(allTime[0]?.total || 0),
      total_payments: parseInt(allTime[0]?.count || 0),
      streak,
    });
  } catch (error) {
    logger.error('Income summary error:', error);
    res.status(500).json({ message: 'Error fetching income summary' });
  }
});

// Request recharge
router.post('/recharge', authenticate, transactionLimiter, validateRecharge, async (req, res) => {
  try {
    const { amount_NSL, payment_method, deposit_address, tx_hash } = req.body;
    const user = await User.findByPk(req.user.id);

    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    // Ensure amount_NSL is a valid number
    const amountNSL = Number(amount_NSL);
    if (isNaN(amountNSL) || amountNSL <= 0) {
      return res.status(400).json({ message: 'Invalid amount' });
    }

    if (amountNSL < 100) {
      return res.status(400).json({ message: 'Minimum recharge amount is 100 NSL' });
    }

    // Calculate amount_usdt as a number, not string
    const conversionRate = await getNslPerUsdt();
    const amount_usdt = nslToUsdt(amountNSL, conversionRate);

    const transaction = await Transaction.create({
      user_id: user.id,
      type: 'recharge',
      amount_NSL: amountNSL,
      amount_usdt,
      status: 'pending',
      payment_method: payment_method || 'manual',
      deposit_address,
      binance_tx_id: tx_hash,
      notes: `Recharge request for ${amountNSL} NSL via ${payment_method || 'Binance'}`
    });

    logger.info(`Recharge requested: user_id=${user.id} - ${amountNSL} NSL via ${payment_method}`);

    recordAdminAudit(req, { action: 'user.recharge_request', targetType: 'transaction', targetId: transaction.id, targetUserId: user.id, metadata: { amount_NSL: amountNSL, amount_usdt, payment_method: payment_method || 'manual' } })
      .catch(err => logger.error('Audit log error (recharge):', err.message));

    res.status(201).json({
      message: 'Recharge request submitted successfully! Finance admin will verify and approve your payment.',
      transaction: {
        id: transaction.id,
        amount_NSL: amountNSL,
        amount_usdt,
        exchange_rate_nsl_per_usdt: conversionRate,
        status: 'pending',
        payment_method,
        timestamp: transaction.timestamp
      }
    });
  } catch (error) {
    logger.error('Recharge error:', error);
    res.status(500).json({ message: 'Error processing recharge' });
  }
});

// Calculate withdrawal fees (preview)
router.post('/withdraw/calculate-fee', authenticate, transactionLimiter, async (req, res) => {
  try {
    const { amount_NSL } = req.body;
    const user = await User.findByPk(req.user.id);

    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    if (!amount_NSL || amount_NSL <= 0) {
      return res.status(400).json({ message: 'Invalid amount' });
    }

    const minWithdrawal = parseInt(process.env.MIN_WITHDRAWAL_AMOUNT_NSL || 100);

    if (amount_NSL < minWithdrawal) {
      return res.status(400).json({
        message: `Minimum withdrawal amount is ${minWithdrawal} NSL`,
        min_withdrawal: minWithdrawal
      });
    }

    const feePct = user.role === 'superadmin' ? 0 : await ps.get('withdrawal_fee_pct');
    let withdrawalFee = 0;
    let netAmount = amount_NSL;

    if (feePct > 0) {
      withdrawalFee = (amount_NSL * feePct) / 100;
      netAmount = amount_NSL - withdrawalFee;
    }

    const conversionRate = await getNslPerUsdt();
    const amount_usdt = nslToUsdt(netAmount, conversionRate);

    res.json({
      requested_amount_NSL: amount_NSL,
      user_role: user.role,
      fee_breakdown: {
        fee_percentage: user.role === 'superadmin' ? '0%' : `${feePct}%`,
        fee_amount: withdrawalFee.toFixed(2),
        is_exempt: user.role === 'superadmin'
      },
      net_amount_NSL: netAmount.toFixed(2),
      net_amount_usdt: amount_usdt,
      exchange_rate_nsl_per_usdt: conversionRate,
      conversion_rate: `1 USDT = ${conversionRate.toFixed(2)} NSL`
    });
  } catch (error) {
    logger.error('Fee calculation error:', error);
    res.status(500).json({ message: 'Error calculating fees' });
  }
});

// Request withdrawal
router.post('/withdraw', authenticate, transactionLimiter, validateWithdraw, async (req, res) => {
  try {
    const { amount_NSL, withdrawal_address, network } = req.body;

    if (!withdrawal_address) {
      return res.status(400).json({ message: 'Withdrawal address is required' });
    }

    const withdrawNet = (network || 'BSC').toUpperCase();
    const addressRegex = { BSC: /^0x[a-fA-F0-9]{40}$/, ETH: /^0x[a-fA-F0-9]{40}$/, TRC20: /^T[a-zA-Z0-9]{33}$/ };
    if (addressRegex[withdrawNet] && !addressRegex[withdrawNet].test(withdrawal_address)) {
      return res.status(400).json({ message: `Invalid ${withdrawNet} address format` });
    }

    const minWithdrawal = parseInt(process.env.MIN_WITHDRAWAL_AMOUNT_NSL || 100);
    if (amount_NSL < minWithdrawal) {
      return res.status(400).json({ message: `Minimum withdrawal amount is ${minWithdrawal} NSL` });
    }

    let result;
    await sequelize.transaction(async (t) => {
      // Re-fetch with FOR UPDATE so concurrent requests are serialized at the DB level
      const user = await User.findOne({ where: { id: req.user.id }, lock: t.LOCK.UPDATE, transaction: t });
      if (!user) { const e = new Error('User not found'); e.status = 404; throw e; }

      if (user.role === 'superadmin') {
        logger.warn(`AUDIT: Superadmin withdrawal bypass — user_id=${user.id} phone=${user.phone} amount_NSL=${amount_NSL} address=${withdrawal_address} network=${network || 'BSC'} ip=${req.ip}`);
      }

      if (user.role !== 'superadmin' && !user.kyc_verified) {
        const e = new Error('Identity verification required before withdrawal. Please complete KYC in your account settings.');
        e.status = 403;
        e.kyc_required = true;
        throw e;
      }

      if (user.role !== 'superadmin') {
        const cashout = await getCashoutStatus(user.id, user.kyc_verified);
        if (!cashout.conditions.all_ok) {
          const reasons = [];
          if (!cashout.conditions.earned_ok)   reasons.push(`Earn at least ${cashout.min_nsl} NSL from the system (you have ${cashout.total_earned_NSL.toFixed(2)} NSL)`);
          if (!cashout.conditions.referrals_ok) reasons.push(`Invite ${cashout.min_referrals} users who recharged and bought VIP (you have ${cashout.qualifying_referrals})`);
          if (!cashout.conditions.kyc_ok)       reasons.push('Complete KYC verification');
          const e = new Error('You do not yet meet the cash-out requirements: ' + reasons.join('; '));
          e.status = 403;
          e.cashout_conditions = cashout.conditions;
          throw e;
        }
      }

      const feePctW = user.role === 'superadmin' ? 0 : await ps.get('withdrawal_fee_pct');
      const withdrawalFee = (amount_NSL * feePctW) / 100;
      const netAmount = amount_NSL - withdrawalFee;

      if (netAmount <= 0) { const e = new Error('Withdrawal amount too small to cover fees'); e.status = 400; throw e; }

      if (amount_NSL > parseFloat(user.balance_NSL)) {
        const e = new Error('Insufficient balance to cover withdrawal amount and fees');
        e.status = 400;
        e.detail = {
          required_balance: amount_NSL,
          current_balance: user.balance_NSL,
          fee_amount: withdrawalFee.toFixed(2),
        };
        throw e;
      }

      const conversionRate = await getNslPerUsdt();
      const amount_usdt = nslToUsdt(netAmount, conversionRate);

      // Deduct balance atomically — prevents double-spend if two requests race
      user.balance_NSL = parseFloat(user.balance_NSL) - amount_NSL;
      user.balance_usdt = syncUsdtBalanceFromNsl(user.balance_NSL, conversionRate);
      await user.save({ transaction: t });

      const tx = await Transaction.create({
        user_id: user.id,
        type: 'withdrawal',
        amount_NSL: netAmount,
        amount_usdt,
        status: 'pending',
        withdrawal_address,
        withdrawal_network: network || 'BSC',
        payment_method: 'binance',
        notes: `Withdrawal: ${amount_NSL} NSL (Fee: ${withdrawalFee.toFixed(2)} NSL, Net: ${netAmount.toFixed(2)} NSL) to ${withdrawal_address}`,
      }, { transaction: t });

      const maskedAddr = `${withdrawal_address.substring(0, 6)}...${withdrawal_address.slice(-4)}`;
      logger.info(`Withdrawal requested: user_id=${user.id} - ${amount_NSL} NSL (Net: ${netAmount} NSL, Fee: ${withdrawalFee.toFixed(2)} NSL) to ${maskedAddr}`);

      result = { tx, user, withdrawalFee, netAmount, amount_usdt, conversionRate };
    });

    const { tx, user, withdrawalFee, netAmount, amount_usdt, conversionRate } = result;

    recordAdminAudit(req, { action: 'user.withdrawal_request', targetType: 'transaction', targetId: tx.id, targetUserId: user.id, metadata: { amount_NSL, net_amount_NSL: netAmount, fee_NSL: withdrawalFee, network: network || 'BSC' } })
      .catch(err => logger.error('Audit log error (withdrawal):', err.message));

    res.status(201).json({
      message: 'Withdrawal request submitted! Finance admin will process your withdrawal within 24 hours.',
      transaction: {
        id: tx.id,
        requested_amount_NSL: amount_NSL,
        fee_NSL: withdrawalFee.toFixed(2),
        net_amount_NSL: netAmount.toFixed(2),
        amount_usdt,
        exchange_rate_nsl_per_usdt: conversionRate,
        withdrawal_address,
        network: network || 'BSC',
        status: 'pending',
        timestamp: tx.timestamp,
      },
      fee_breakdown: {
        percentage: `${FEE.WITHDRAWAL_FEE_PERCENTAGE}%`,
        fee_amount: withdrawalFee.toFixed(2),
        is_exempt: user.role === 'superadmin',
      },
    });
  } catch (error) {
    logger.error('Withdrawal error:', error);
    const status = error.status || 500;
    res.status(status).json({
      message: error.message || 'Error processing withdrawal',
      ...(error.detail || {}),
      ...(error.kyc_required ? { kyc_required: true } : {}),
    });
  }
});

// Get referrals
router.get('/referrals', authenticate, async (req, res) => {
  try {
    const referrals = await Referral.findAll({
      where: { referrer_id: req.user.id },
      include: [{ model: User, as: 'referred', attributes: ['phone', 'balance_NSL', 'created_at'] }],
      order: [['timestamp', 'DESC']]
    });

    const pendingCount = await Referral.count({
      where: { referrer_id: req.user.id, status: 'pending' }
    });

    const totalEarned = referrals.reduce((sum, ref) => sum + (ref.status === 'paid' ? ref.bonus_NSL : 0), 0);

    const stats = {
      total_referrals: referrals.length,
      pending_bonuses: pendingCount,
      total_earned_NSL: totalEarned
    };

    res.json({
      referrals,
      stats
    });
  } catch (error) {
    logger.error('Referrals fetch error:', error);
    res.status(500).json({ message: 'Error fetching referrals' });
  }
});

// Get referral leaderboard
router.get('/referrals/leaderboard', authenticate, async (req, res) => {
  try {
    const { period = 'all', limit = 50 } = req.query;
    // MEDIUM FIX: cap leaderboard limit to prevent unbounded result sets
    const MAX_LEADERBOARD_SIZE = 100;

    // Calculate date filter based on period
    let dateFilter = {};
    const now = new Date();

    if (period === 'today') {
      dateFilter = { [Op.gte]: new Date(now.getFullYear(), now.getMonth(), now.getDate()) };
    } else if (period === 'week') {
      dateFilter = { [Op.gte]: new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000) };
    } else if (period === 'month') {
      dateFilter = { [Op.gte]: new Date(now.getFullYear(), now.getMonth(), 1) };
    }

    const whereClause = { status: 'paid' };
    if (period !== 'all') {
      whereClause.timestamp = dateFilter;
    }

    // Get top referrers using Sequelize grouping
    const leaderboardData = await Referral.findAll({
      where: whereClause,
      attributes: [
        'referrer_id',
        [sequelize.fn('COUNT', sequelize.col('Referral.id')), 'total_referrals'],
        [sequelize.fn('SUM', sequelize.col('bonus_NSL')), 'total_earnings']
      ],
      include: [{
        model: User,
        as: 'referrer',
        attributes: ['username', 'vip_level']
      }],
      group: ['referrer_id', 'referrer.id'],
      order: [[sequelize.fn('SUM', sequelize.col('bonus_NSL')), 'DESC']],
      limit: Math.min(Math.max(1, parseInt(limit) || 50), MAX_LEADERBOARD_SIZE)
    });

    const rankedLeaderboard = leaderboardData.map((entry, index) => ({
      rank: index + 1,
      user_id: entry.referrer_id,
      username: entry.referrer?.username,
      vip_level: entry.referrer?.vip_level,
      total_referrals: parseInt(entry.getDataValue('total_referrals')) || 0,
      total_earnings: parseFloat(entry.getDataValue('total_earnings')) || 0
    }));

    // Find current user's stats
    const userStats = await Referral.findOne({
      where: { ...whereClause, referrer_id: req.user.id },
      attributes: [
        [sequelize.fn('COUNT', sequelize.col('id')), 'total_referrals'],
        [sequelize.fn('SUM', sequelize.col('bonus_NSL')), 'total_earnings']
      ]
    });

    const userTotalEarnings = parseFloat(userStats?.getDataValue('total_earnings')) || 0;
    const userTotalReferrals = parseInt(userStats?.getDataValue('total_referrals')) || 0;

    // Calculate user's rank
    const usersAbove = await Referral.count({
      where: whereClause,
      attributes: ['referrer_id'],
      group: ['referrer_id'],
      having: sequelize.where(
        sequelize.fn('SUM', sequelize.col('bonus_NSL')),
        { [Op.gt]: userTotalEarnings }
      )
    });

    const userRank = (Array.isArray(usersAbove) ? usersAbove.length : 0) + 1;

    res.json({
      period,
      leaderboard: rankedLeaderboard,
      current_user: {
        rank: userRank,
        total_referrals: userTotalReferrals,
        total_earnings: userTotalEarnings
      }
    });
  } catch (error) {
    logger.error('Leaderboard fetch error:', error);
    res.status(500).json({ message: 'Error fetching leaderboard' });
  }
});

// Update user profile
router.put('/profile', authenticate, transactionLimiter, validateUpdateProfile, async (req, res) => {
  try {
    const { username, email, phone } = req.body;
    const user = await User.findByPk(req.user.id);

    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    // Validate and update fields
    if (username && username !== user.username) {
      const existingUser = await User.findOne({ where: { username } });
      if (existingUser && existingUser.id !== user.id) {
        return res.status(400).json({ message: 'Username already taken' });
      }
      user.username = username;
    }

    if (email && email !== user.email) {
      const existingUser = await User.findOne({ where: { email } });
      if (existingUser && existingUser.id !== user.id) {
        return res.status(400).json({ message: 'Email already in use' });
      }
      user.email = email;
      user.emailVerified = false;
    }

    if (phone && phone !== user.phone) {
      const existingUser = await User.findOne({ where: { phone } });
      if (existingUser && existingUser.id !== user.id) {
        return res.status(400).json({ message: 'Phone number already in use' });
      }
      user.phone = phone;
    }

    await user.save();

    logger.info(`Profile updated for user ${user.id}`);
    res.json({
      message: 'Profile updated successfully',
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        phone: user.phone,
        updated_at: user.updated_at
      }
    });
  } catch (error) {
    logger.error('Profile update error:', error);
    res.status(500).json({ message: 'Error updating profile' });
  }
});

// Upload payment proof for transaction
router.post('/transactions/:id/upload-payment-proof', authenticate, paymentUpload.single('payment_proof'), assertImageMagicBytes, async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ message: 'No file uploaded' });
    }

    const transaction = await Transaction.findByPk(req.params.id);

    if (!transaction) {
      purgeUpload(req.file);
      return res.status(404).json({ message: 'Transaction not found' });
    }

    // Verify the transaction belongs to the user
    if (transaction.user_id !== parseInt(req.user.id)) {
      purgeUpload(req.file);
      return res.status(403).json({ message: 'Unauthorized access to transaction' });
    }

    // Only allow upload for pending transactions
    if (transaction.status !== 'pending') {
      purgeUpload(req.file);
      return res.status(400).json({ message: 'Can only upload payment proof for pending transactions' });
    }

    const proofUrl = await storeSanitizedReceiptImage({
      file: req.file,
      userId: req.user.id,
      localDir: 'uploads/payments',
      blobPrefix: 'payments',
      filePrefix: 'payment',
    });
    transaction.payment_proof = proofUrl;
    await transaction.save();

    logger.info(`Payment proof uploaded for transaction ${transaction.id} by user ${req.user.id}`);
    res.json({
      message: 'Payment proof uploaded successfully',
      transaction: {
        id: transaction.id,
        payment_proof: proofUrl,
        status: transaction.status
      }
    });
  } catch (error) {
    purgeUpload(req.file);
    logger.error('Payment proof upload error:', error);
    res.status(500).json({ message: 'Error uploading payment proof' });
  }
});

// Upload KYC documents (supports multiple documents)
router.post('/kyc/upload', authenticate, kycUploadLimiter, kycUpload.fields([
  { name: 'id_front', maxCount: 1 },
  { name: 'id_back', maxCount: 1 },
  { name: 'selfie', maxCount: 1 },
  { name: 'additional', maxCount: 1 }
]), assertDocumentMagicBytes, async (req, res) => {
  try {
    if (!req.files || Object.keys(req.files).length === 0) {
      return res.status(400).json({ message: 'No files uploaded' });
    }

    const user = await User.findByPk(req.user.id);
    if (!user) return res.status(404).json({ message: 'User not found' });

    const uploadedDocs = {};

    for (const [fieldName, fileArray] of Object.entries(req.files)) {
      if (!fileArray || fileArray.length === 0) continue;
      const file = fileArray[0];
      const kycField = `kyc_${fieldName}`;
      let docUrl;

      if (isVercel) {
        // On Vercel: stream buffer to Vercel Blob
        const ext = path.extname(file.originalname) || '.jpg';
        const blobPath = `kyc/${user.id}/${fieldName}-${Date.now()}${ext}`;
        await blobPut(blobPath, file.buffer, {
          access: 'private',
          contentType: file.mimetype,
        });
        docUrl = protectedFileUrl(`blob:${blobPath}`);
      } else {
        // Local: file already written to disk by multer
        docUrl = protectedFileUrl(`local:uploads/kyc/${file.filename}`);
      }

      user[kycField] = docUrl;
      uploadedDocs[fieldName] = docUrl;
    }

    await user.save();
    logger.info(`KYC documents uploaded for user ${user.id}: ${Object.keys(uploadedDocs).join(', ')}`);

    // Notify admins/finance/verificators of new KYC submission (fire-and-forget)
    User.findAll({
      where: { role: { [Op.in]: ['admin', 'superadmin', 'finance', 'verificator'] }, status: 'active' },
      attributes: ['id']
    }).then(staffUsers => {
      if (staffUsers.length === 0) return;
      const ids = staffUsers.map(s => s.id);
      return notificationService.createBulk(ids, 'kyc_submission', 'New KYC Submission',
        `${user.username || user.phone} has submitted KYC documents for review.`,
        { priority: 'high', icon: 'badge', action_url: '/admin?tab=kyc', data: { user_id: user.id } }
      );
    }).catch(err => logger.error('KYC admin notification error:', err));

    res.json({
      message: 'KYC documents uploaded successfully',
      uploaded_documents: uploadedDocs,
      kyc_documents: {
        id_front: user.kyc_id_front,
        id_back: user.kyc_id_back,
        selfie: user.kyc_selfie,
        additional: user.kyc_additional
      },
      kyc_verified: user.kyc_verified
    });
  } catch (error) {
    logger.error('KYC upload error:', error);
    res.status(500).json({ message: 'Error uploading KYC documents' });
  }
});

// Get KYC status
router.get('/kyc/status', authenticate, async (req, res) => {
  try {
    const user = await User.findByPk(req.user.id, {
      attributes: ['kyc_verified', 'kyc_id_front', 'kyc_id_back', 'kyc_selfie', 'kyc_additional']
    });

    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    const uploadedDocs = {
      id_front: !!user.kyc_id_front,
      id_back: !!user.kyc_id_back,
      selfie: !!user.kyc_selfie,
      additional: !!user.kyc_additional
    };

    const requiredDocs = ['id_front'];
    const allRequiredUploaded = requiredDocs.every(doc => uploadedDocs[doc]);

    res.json({
      kyc_verified: user.kyc_verified,
      documents: uploadedDocs,
      all_required_uploaded: allRequiredUploaded,
      message: user.kyc_verified
        ? 'KYC verified'
        : allRequiredUploaded
          ? 'Documents uploaded, pending verification'
          : 'Please upload your identity document to complete verification'
    });
  } catch (error) {
    logger.error('KYC status fetch error:', error);
    res.status(500).json({ message: 'Error fetching KYC status' });
  }
});

// Helper: compute cashout eligibility for a user
async function getCashoutStatus(userId, kycVerified) {
  const settings = await ps.getAll();
  const minNsl       = parseFloat(settings.cashout_min_nsl   || 150);
  const minReferrals = parseInt(settings.cashout_min_referrals || 5);

  const [incomeAgg, qualCount] = await Promise.all([
    Transaction.findOne({
      attributes: [[sequelize.fn('SUM', sequelize.col('amount_NSL')), 'total']],
      where: { user_id: userId, type: 'income' },
      raw: true,
    }),
    sequelize.query(
      `SELECT COUNT(DISTINCT r.referred_id) AS cnt
       FROM referrals r
       WHERE r.referrer_id = :uid
         AND EXISTS (SELECT 1 FROM transactions t WHERE t.user_id = r.referred_id AND t.type = 'recharge')
         AND EXISTS (SELECT 1 FROM user_products up2 WHERE up2.user_id = r.referred_id)`,
      { replacements: { uid: userId }, type: QueryTypes.SELECT }
    ),
  ]);

  const totalEarned   = parseFloat(incomeAgg?.total || 0);
  const qualReferrals = parseInt(qualCount?.[0]?.cnt || 0);
  const earnedOk      = totalEarned  >= minNsl;
  const referralsOk   = qualReferrals >= minReferrals;
  const kycOk         = !!kycVerified;

  return {
    total_earned_NSL: totalEarned,
    qualifying_referrals: qualReferrals,
    min_nsl: minNsl,
    min_referrals: minReferrals,
    conditions: { earned_ok: earnedOk, referrals_ok: referralsOk, kyc_ok: kycOk, all_ok: earnedOk && referralsOk && kycOk },
  };
}

// Toggle auto-renew on a user product
router.patch('/products/:id/auto-renew', authenticate, async (req, res) => {
  try {
    const up = await UserProduct.findOne({ where: { id: req.params.id, user_id: req.user.id } });
    if (!up) return res.status(404).json({ message: 'Plan not found' });
    up.auto_renew = !up.auto_renew;
    await up.save();
    res.json({ success: true, auto_renew: up.auto_renew });
  } catch (error) {
    logger.error('Auto-renew toggle error:', error);
    res.status(500).json({ message: 'Error toggling auto-renew' });
  }
});

// Check own cashout eligibility
router.get('/cashout-check', authenticate, async (req, res) => {
  try {
    const user = await User.findByPk(req.user.id, { attributes: ['id', 'kyc_verified', 'role'] });
    if (!user) return res.status(404).json({ message: 'User not found' });
    if (user.role === 'superadmin') return res.json({ eligible: true, superadmin: true });
    const status = await getCashoutStatus(user.id, user.kyc_verified);
    res.json({ eligible: status.conditions.all_ok, ...status });
  } catch (error) {
    logger.error('Cashout check error:', error);
    res.status(500).json({ message: 'Error checking cashout eligibility' });
  }
});

module.exports = router;
