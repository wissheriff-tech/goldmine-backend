const express = require('express');
const { User, Transaction, sequelize } = require('../models');
const { Op } = require('sequelize');
const { authenticate, authorize } = require('../middleware/auth');
const logger = require('../utils/logger');
const notificationService = require('../utils/notificationService');
const { buildConversion, getNslPerUsdt, syncUsdtBalanceFromNsl } = require('../utils/currencyConversion');

const router = express.Router();

// Batch update user status
router.post('/users/update-status', authenticate, authorize(['superadmin', 'admin']), async (req, res) => {
  try {
    const { user_ids, status, reason } = req.body;

    if (!user_ids || !Array.isArray(user_ids) || user_ids.length === 0) {
      return res.status(400).json({ message: 'User IDs array is required' });
    }

    if (!['active', 'frozen', 'pending'].includes(status)) {
      return res.status(400).json({ message: 'Invalid status' });
    }

    const [updatedCount] = await User.update(
      { status, updated_at: new Date() },
      { where: { id: { [Op.in]: user_ids } } }
    );

    // Send notifications to affected users
    if (status === 'active') {
      await notificationService.createBulk(
        user_ids,
        'account_approved',
        'Account Activated',
        'Your account has been activated by an administrator.',
        { priority: 'high', icon: '✅' }
      );
    } else if (status === 'frozen') {
      await notificationService.createBulk(
        user_ids,
        'account_suspended',
        'Account Suspended',
        `Your account has been suspended. ${reason || 'Please contact support for details.'}`,
        { priority: 'urgent', icon: '⚠️' }
      );
    }

    logger.info(`Batch status update by ${req.user.phone}: ${user_ids.length} users set to ${status}`);

    res.json({
      message: 'Batch status update successful',
      updated_count: updatedCount,
      matched_count: user_ids.length
    });
  } catch (error) {
    logger.error('Batch status update error:', error);
    res.status(500).json({ message: 'Error updating user status', error: error.message });
  }
});

// Batch update user VIP level
router.post('/users/update-vip', authenticate, authorize(['superadmin', 'admin']), async (req, res) => {
  try {
    const { user_ids, vip_level } = req.body;

    if (!user_ids || !Array.isArray(user_ids) || user_ids.length === 0) {
      return res.status(400).json({ message: 'User IDs array is required' });
    }

    const validVipLevels = ['none', 'VIP0', 'VIP1', 'VIP2', 'VIP3', 'VIP4', 'VIP5', 'VIP6', 'VIP7', 'VIP8', 'VIP9'];
    if (!validVipLevels.includes(vip_level)) {
      return res.status(400).json({ message: 'Invalid VIP level' });
    }

    const [updatedCount] = await User.update(
      { vip_level, updated_at: new Date() },
      { where: { id: { [Op.in]: user_ids } } }
    );

    // Send VIP upgrade notifications
    if (vip_level !== 'none') {
      await notificationService.createBulk(
        user_ids,
        'vip_upgrade',
        'VIP Level Updated',
        `Your VIP level has been updated to ${vip_level}. Enjoy your benefits!`,
        { priority: 'high', icon: '⭐' }
      );
    }

    logger.info(`Batch VIP update by ${req.user.phone}: ${user_ids.length} users set to ${vip_level}`);

    res.json({
      message: 'Batch VIP update successful',
      updated_count: updatedCount,
      matched_count: user_ids.length
    });
  } catch (error) {
    logger.error('Batch VIP update error:', error);
    res.status(500).json({ message: 'Error updating VIP level', error: error.message });
  }
});

// Batch add currency to users
router.post('/users/add-currency', authenticate, authorize(['superadmin', 'admin']), async (req, res) => {
  try {
    const { user_ids, amount_NSL, amount_usdt, reason } = req.body;

    if (!user_ids || !Array.isArray(user_ids) || user_ids.length === 0) {
      return res.status(400).json({ message: 'User IDs array is required' });
    }

    if (!amount_NSL && !amount_usdt) {
      return res.status(400).json({ message: 'At least one amount (NSL or USDT) is required' });
    }

    if (!reason || reason.length < 5) {
      return res.status(400).json({ message: 'Reason must be at least 5 characters' });
    }

    const hasNSL = amount_NSL !== undefined && amount_NSL !== null && Number(amount_NSL) > 0;
    const hasUSDT = amount_usdt !== undefined && amount_usdt !== null && Number(amount_usdt) > 0;
    const rate = await getNslPerUsdt();
    const conversion = hasUSDT && !hasNSL
      ? buildConversion(amount_usdt, 'USDT', rate)
      : buildConversion(amount_NSL, 'NSL', rate);

    if (conversion.amount_NSL <= 0 && conversion.amount_usdt <= 0) {
      return res.status(400).json({ message: 'Specify a positive NSL or USDT amount' });
    }

    // Use a transaction for atomicity
    const result = await sequelize.transaction(async (t) => {
      // Update each user's balance atomically
      const users = await User.findAll({
        where: { id: { [Op.in]: user_ids } },
        transaction: t
      });

      for (const user of users) {
        user.balance_NSL = (parseFloat(user.balance_NSL) || 0) + conversion.amount_NSL;
        user.balance_usdt = syncUsdtBalanceFromNsl(user.balance_NSL, rate);
        user.updated_at = new Date();
        await user.save({ transaction: t });
      }

      // Create transaction records for each user
      const transactions = user_ids.map(userId => ({
        user_id: userId,
        type: 'recharge',
        amount_NSL: conversion.amount_NSL,
        amount_usdt: conversion.amount_usdt,
        status: 'approved',
        approved_by: req.user.id,
        notes: `Batch currency addition: ${reason} (${conversion.amount_NSL} NSL / ${conversion.amount_usdt} USDT at ${conversion.exchange_rate_nsl_per_usdt} NSL per USDT)`,
        completed_at: new Date()
      }));

      await Transaction.bulkCreate(transactions, { transaction: t });

      return { updatedCount: users.length, transactionsCreated: transactions.length };
    });

    // Send notifications
    await notificationService.createBulk(
      user_ids,
      'transaction_approved',
      'Currency Added',
      `${conversion.amount_NSL} NSL (${conversion.amount_usdt} USDT) has been added to your account. ${reason}`,
      { priority: 'high', icon: '💰' }
    );

    logger.info(`Batch currency addition by ${req.user.phone}: ${user_ids.length} users received ${conversion.amount_NSL} NSL (${conversion.amount_usdt} USDT at ${rate})`);

    res.json({
      message: 'Batch currency addition successful',
      updated_count: result.updatedCount,
      matched_count: user_ids.length,
      transactions_created: result.transactionsCreated
    });
  } catch (error) {
    logger.error('Batch currency addition error:', error);
    res.status(500).json({ message: 'Error adding currency', error: error.message });
  }
});

// Batch delete users (soft delete by setting status to frozen)
router.post('/users/delete', authenticate, authorize(['superadmin']), async (req, res) => {
  try {
    const { user_ids, reason } = req.body;

    if (!user_ids || !Array.isArray(user_ids) || user_ids.length === 0) {
      return res.status(400).json({ message: 'User IDs array is required' });
    }

    // Prevent deleting superadmin accounts
    const users = await User.findAll({ where: { id: { [Op.in]: user_ids } } });
    const superadmins = users.filter(u => u.role === 'superadmin');

    if (superadmins.length > 0) {
      return res.status(403).json({ message: 'Cannot delete superadmin accounts' });
    }

    const [updatedCount] = await User.update(
      { status: 'frozen', updated_at: new Date() },
      { where: { id: { [Op.in]: user_ids }, role: { [Op.ne]: 'superadmin' } } }
    );

    logger.warn(`Batch user deletion by ${req.user.phone}: ${user_ids.length} users frozen - Reason: ${reason || 'No reason provided'}`);

    res.json({
      message: 'Batch user deletion (freeze) successful',
      updated_count: updatedCount,
      matched_count: user_ids.length
    });
  } catch (error) {
    logger.error('Batch user deletion error:', error);
    res.status(500).json({ message: 'Error deleting users', error: error.message });
  }
});

// Batch approve transactions
router.post('/transactions/approve', authenticate, authorize(['superadmin', 'finance']), async (req, res) => {
  try {
    const { transaction_ids, reason } = req.body;

    if (!transaction_ids || !Array.isArray(transaction_ids) || transaction_ids.length === 0) {
      return res.status(400).json({ message: 'Transaction IDs array is required' });
    }

    const transactions = await Transaction.findAll({
      where: {
        id: { [Op.in]: transaction_ids },
        status: 'pending'
      },
      include: [{ model: User, as: 'user' }]
    });

    if (transactions.length === 0) {
      return res.status(404).json({ message: 'No pending transactions found' });
    }

    const results = {
      approved: 0,
      failed: 0,
      errors: []
    };

    for (const transaction of transactions) {
      try {
        await sequelize.transaction(async (t) => {
          const lockedTx = await Transaction.findOne({
            where: { id: transaction.id, status: 'pending' },
            lock: t.LOCK.UPDATE,
            transaction: t,
          });

          if (!lockedTx) throw new Error('Transaction no longer pending');

          const user = await User.findOne({
            where: { id: lockedTx.user_id },
            lock: t.LOCK.UPDATE,
            transaction: t,
          });

          if (!user) throw new Error('User not found');

          if (lockedTx.type === 'recharge') {
            const rate = await getNslPerUsdt();
            user.balance_NSL = (parseFloat(user.balance_NSL) || 0) + parseFloat(lockedTx.amount_NSL);
            user.balance_usdt = syncUsdtBalanceFromNsl(user.balance_NSL, rate);
          }
          // withdrawal: balance already deducted at submission time — no change needed here

          lockedTx.status = 'approved';
          lockedTx.approved_by = req.user.id;
          lockedTx.completed_at = new Date();
          if (reason) lockedTx.notes = reason;

          await lockedTx.save({ transaction: t });
          await user.save({ transaction: t });

          notificationService.notifyTransactionApproved(user.id, lockedTx.type, lockedTx.amount_NSL).catch(() => {});
        });

        results.approved++;
      } catch (error) {
        results.failed++;
        results.errors.push({ transaction_id: transaction.id, error: error.message });
        logger.error(`Batch approval error for transaction ${transaction.id}:`, error);
      }
    }

    logger.info(`Batch transaction approval by ${req.user.phone}: ${results.approved} approved, ${results.failed} failed`);

    res.json({
      message: 'Batch transaction approval completed',
      results
    });
  } catch (error) {
    logger.error('Batch transaction approval error:', error);
    res.status(500).json({ message: 'Error approving transactions', error: error.message });
  }
});

// Batch reject transactions
router.post('/transactions/reject', authenticate, authorize(['superadmin', 'finance']), async (req, res) => {
  try {
    const { transaction_ids, reason } = req.body;

    if (!transaction_ids || !Array.isArray(transaction_ids) || transaction_ids.length === 0) {
      return res.status(400).json({ message: 'Transaction IDs array is required' });
    }

    if (!reason) {
      return res.status(400).json({ message: 'Reason is required for rejection' });
    }

    const transactions = await Transaction.findAll({
      where: {
        id: { [Op.in]: transaction_ids },
        status: 'pending'
      },
      include: [{ model: User, as: 'user' }]
    });

    const [updatedCount] = await Transaction.update(
      {
        status: 'rejected',
        approved_by: req.user.id,
        notes: reason,
        completed_at: new Date()
      },
      { where: { id: { [Op.in]: transaction_ids }, status: 'pending' } }
    );

    // Send notifications
    for (const transaction of transactions) {
      if (transaction.user) {
        await notificationService.notifyTransactionRejected(
          transaction.user.id,
          transaction.type,
          transaction.amount_NSL,
          reason
        );
      }
    }

    logger.info(`Batch transaction rejection by ${req.user.phone}: ${updatedCount} rejected`);

    res.json({
      message: 'Batch transaction rejection successful',
      rejected_count: updatedCount,
      matched_count: transaction_ids.length
    });
  } catch (error) {
    logger.error('Batch transaction rejection error:', error);
    res.status(500).json({ message: 'Error rejecting transactions', error: error.message });
  }
});

module.exports = router;
