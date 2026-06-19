const express = require('express');
const { User, Transaction, sequelize } = require('../models');
const { Op } = require('sequelize');
const { authenticate, authorize } = require('../middleware/auth');
const { adminLimiter, financeLimiter } = require('../middleware/security');
const logger = require('../utils/logger');
const notificationService = require('../utils/notificationService');
const { buildConversion, getNslPerUsdt, syncUsdtBalanceFromNsl } = require('../utils/currencyConversion');
const { recordAdminAudit } = require('../utils/adminAudit');

const router = express.Router();
const MAX_BATCH_SIZE = 100;

function normalizeIdBatch(ids, label) {
  if (!Array.isArray(ids) || ids.length === 0) {
    const error = new Error(`${label} array is required`);
    error.status = 400;
    throw error;
  }

  const normalized = [...new Set(ids.map(id => Number.parseInt(id, 10)).filter(Number.isInteger))];
  if (normalized.length === 0) {
    const error = new Error(`${label} must contain valid numeric IDs`);
    error.status = 400;
    throw error;
  }
  if (normalized.length > MAX_BATCH_SIZE) {
    const error = new Error(`Batch size cannot exceed ${MAX_BATCH_SIZE}`);
    error.status = 400;
    throw error;
  }

  return normalized;
}

function userTargetWhere(req, userIds) {
  const where = { id: { [Op.in]: userIds } };
  if (req.user.role !== 'superadmin') where.role = 'user';
  return where;
}

// Batch update user status
router.post('/users/update-status', authenticate, authorize(['superadmin', 'admin']), adminLimiter, async (req, res) => {
  try {
    const { user_ids, status, reason } = req.body;
    const userIds = normalizeIdBatch(user_ids, 'User IDs');

    if (!['active', 'frozen', 'pending'].includes(status)) {
      return res.status(400).json({ message: 'Invalid status' });
    }

    const [updatedCount] = await User.update(
      { status, updated_at: new Date() },
      { where: userTargetWhere(req, userIds) }
    );

    // Send notifications to affected users
    if (status === 'active') {
      await notificationService.createBulk(
        userIds,
        'account_approved',
        'Account Activated',
        'Your account has been activated by an administrator.',
        { priority: 'high', icon: '✅' }
      );
    } else if (status === 'frozen') {
      await notificationService.createBulk(
        userIds,
        'account_suspended',
        'Account Suspended',
        `Your account has been suspended. ${reason || 'Please contact support for details.'}`,
        { priority: 'urgent', icon: '⚠️' }
      );
    }

    logger.info(`Batch status update by ${req.user.phone}: ${userIds.length} users set to ${status}`);
    await recordAdminAudit(req, {
      action: 'batch.users.status.update',
      targetType: 'user',
      metadata: { user_ids: userIds, status, reason, updated_count: updatedCount },
    });

    res.json({
      message: 'Batch status update successful',
      updated_count: updatedCount,
      matched_count: userIds.length
    });
  } catch (error) {
    logger.error('Batch status update error:', error);
    res.status(error.status || 500).json({ message: error.status ? error.message : 'Error updating user status', error: error.message });
  }
});

// Batch update user VIP level
router.post('/users/update-vip', authenticate, authorize(['superadmin', 'admin']), adminLimiter, async (req, res) => {
  try {
    const { user_ids, vip_level } = req.body;
    const userIds = normalizeIdBatch(user_ids, 'User IDs');

    const validVipLevels = ['none', 'VIP0', 'VIP1', 'VIP2', 'VIP3', 'VIP4', 'VIP5', 'VIP6', 'VIP7', 'VIP8', 'VIP9'];
    if (!validVipLevels.includes(vip_level)) {
      return res.status(400).json({ message: 'Invalid VIP level' });
    }

    const [updatedCount] = await User.update(
      { vip_level, updated_at: new Date() },
      { where: userTargetWhere(req, userIds) }
    );

    // Send VIP upgrade notifications
    if (vip_level !== 'none') {
      await notificationService.createBulk(
        userIds,
        'vip_upgrade',
        'VIP Level Updated',
        `Your VIP level has been updated to ${vip_level}. Enjoy your benefits!`,
        { priority: 'high', icon: '⭐' }
      );
    }

    logger.info(`Batch VIP update by ${req.user.phone}: ${userIds.length} users set to ${vip_level}`);
    await recordAdminAudit(req, {
      action: 'batch.users.vip.update',
      targetType: 'user',
      metadata: { user_ids: userIds, vip_level, updated_count: updatedCount },
    });

    res.json({
      message: 'Batch VIP update successful',
      updated_count: updatedCount,
      matched_count: userIds.length
    });
  } catch (error) {
    logger.error('Batch VIP update error:', error);
    res.status(error.status || 500).json({ message: error.status ? error.message : 'Error updating VIP level', error: error.message });
  }
});

// Batch add currency to users
router.post('/users/add-currency', authenticate, authorize(['superadmin', 'admin']), adminLimiter, async (req, res) => {
  try {
    const { user_ids, amount_NSL, amount_usdt, reason } = req.body;
    const userIds = normalizeIdBatch(user_ids, 'User IDs');

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
        where: userTargetWhere(req, userIds),
        lock: t.LOCK.UPDATE,
        transaction: t
      });

      for (const user of users) {
        user.balance_NSL = (parseFloat(user.balance_NSL) || 0) + conversion.amount_NSL;
        user.balance_usdt = syncUsdtBalanceFromNsl(user.balance_NSL, rate);
        user.updated_at = new Date();
        await user.save({ transaction: t });
      }

      // Create transaction records for each user
      const transactions = users.map(user => ({
        user_id: user.id,
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
      userIds,
      'transaction_approved',
      'Currency Added',
      `${conversion.amount_NSL} NSL (${conversion.amount_usdt} USDT) has been added to your account. ${reason}`,
      { priority: 'high', icon: '💰' }
    );

    logger.info(`Batch currency addition by ${req.user.phone}: ${userIds.length} users received ${conversion.amount_NSL} NSL (${conversion.amount_usdt} USDT at ${rate})`);
    await recordAdminAudit(req, {
      action: 'batch.users.balance.add',
      targetType: 'user',
      metadata: {
        user_ids: userIds,
        amount_NSL: conversion.amount_NSL,
        amount_usdt: conversion.amount_usdt,
        exchange_rate_nsl_per_usdt: conversion.exchange_rate_nsl_per_usdt,
        reason,
        updated_count: result.updatedCount,
      },
    });

    res.json({
      message: 'Batch currency addition successful',
      updated_count: result.updatedCount,
      matched_count: userIds.length,
      transactions_created: result.transactionsCreated
    });
  } catch (error) {
    logger.error('Batch currency addition error:', error);
    res.status(error.status || 500).json({ message: error.status ? error.message : 'Error adding currency', error: error.message });
  }
});

// Batch delete users (soft delete by setting status to frozen)
router.post('/users/delete', authenticate, authorize(['superadmin']), adminLimiter, async (req, res) => {
  try {
    const { user_ids, reason } = req.body;
    const userIds = normalizeIdBatch(user_ids, 'User IDs');

    // Prevent deleting superadmin accounts
    const users = await User.findAll({ where: { id: { [Op.in]: userIds } } });
    const superadmins = users.filter(u => u.role === 'superadmin');

    if (superadmins.length > 0) {
      return res.status(403).json({ message: 'Cannot delete superadmin accounts' });
    }

    const [updatedCount] = await User.update(
      { status: 'frozen', updated_at: new Date() },
      { where: { id: { [Op.in]: userIds }, role: { [Op.ne]: 'superadmin' } } }
    );

    logger.warn(`Batch user deletion by ${req.user.phone}: ${userIds.length} users frozen - Reason: ${reason || 'No reason provided'}`);
    await recordAdminAudit(req, {
      action: 'batch.users.freeze',
      targetType: 'user',
      metadata: { user_ids: userIds, reason, updated_count: updatedCount },
    });

    res.json({
      message: 'Batch user deletion (freeze) successful',
      updated_count: updatedCount,
      matched_count: userIds.length
    });
  } catch (error) {
    logger.error('Batch user deletion error:', error);
    res.status(error.status || 500).json({ message: error.status ? error.message : 'Error deleting users', error: error.message });
  }
});

// Batch approve transactions
router.post('/transactions/approve', authenticate, authorize(['superadmin', 'finance']), financeLimiter, async (req, res) => {
  try {
    const { transaction_ids, reason } = req.body;
    const transactionIds = normalizeIdBatch(transaction_ids, 'Transaction IDs');

    const transactions = await Transaction.findAll({
      where: {
        id: { [Op.in]: transactionIds },
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
    await recordAdminAudit(req, {
      action: 'batch.transactions.approve',
      targetType: 'transaction',
      metadata: { transaction_ids: transactionIds, reason, results },
    });

    res.json({
      message: 'Batch transaction approval completed',
      results
    });
  } catch (error) {
    logger.error('Batch transaction approval error:', error);
    res.status(error.status || 500).json({ message: error.status ? error.message : 'Error approving transactions', error: error.message });
  }
});

// Batch reject transactions
router.post('/transactions/reject', authenticate, authorize(['superadmin', 'finance']), financeLimiter, async (req, res) => {
  try {
    const { transaction_ids, reason } = req.body;
    const transactionIds = normalizeIdBatch(transaction_ids, 'Transaction IDs');

    if (!reason) {
      return res.status(400).json({ message: 'Reason is required for rejection' });
    }

    const transactions = await Transaction.findAll({
      where: {
        id: { [Op.in]: transactionIds },
        status: 'pending'
      },
      include: [{ model: User, as: 'user' }]
    });

    let updatedCount = 0;
    const rate = await getNslPerUsdt();
    await sequelize.transaction(async (t) => {
      for (const transaction of transactions) {
        const lockedTx = await Transaction.findOne({
          where: { id: transaction.id, status: 'pending' },
          lock: t.LOCK.UPDATE,
          transaction: t,
        });
        if (!lockedTx) continue;

        if (lockedTx.type === 'withdrawal') {
          const user = await User.findOne({
            where: { id: lockedTx.user_id },
            lock: t.LOCK.UPDATE,
            transaction: t,
          });
          if (user) {
            const grossMatch = (lockedTx.notes || '').match(/Withdrawal:\s*([\d.]+)\s*NSL/);
            const refundNSL = grossMatch ? parseFloat(grossMatch[1]) : parseFloat(lockedTx.amount_NSL);
            user.balance_NSL = parseFloat(user.balance_NSL) + refundNSL;
            user.balance_usdt = syncUsdtBalanceFromNsl(user.balance_NSL, rate);
            await user.save({ transaction: t });
          }
        }

        lockedTx.status = 'rejected';
        lockedTx.approved_by = req.user.id;
        lockedTx.notes = reason;
        lockedTx.completed_at = new Date();
        lockedTx.rejected_at = new Date();
        await lockedTx.save({ transaction: t });
        updatedCount++;
      }
    });

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
    await recordAdminAudit(req, {
      action: 'batch.transactions.reject',
      targetType: 'transaction',
      metadata: { transaction_ids: transactionIds, reason, rejected_count: updatedCount },
    });

    res.json({
      message: 'Batch transaction rejection successful',
      rejected_count: updatedCount,
      matched_count: transactionIds.length
    });
  } catch (error) {
    logger.error('Batch transaction rejection error:', error);
    res.status(error.status || 500).json({ message: error.status ? error.message : 'Error rejecting transactions', error: error.message });
  }
});

module.exports = router;
