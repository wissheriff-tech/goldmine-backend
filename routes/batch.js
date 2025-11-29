const express = require('express');
const User = require('../models/User');
const Transaction = require('../models/Transaction');
const { authenticate, authorize } = require('../middleware/auth');
const logger = require('../utils/logger');
const notificationService = require('../utils/notificationService');

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

    const result = await User.updateMany(
      { _id: { $in: user_ids } },
      { status, updated_at: new Date() }
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
      updated_count: result.modifiedCount,
      matched_count: result.matchedCount
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

    const validVipLevels = ['none', 'VIP1', 'VIP2', 'VIP3', 'VIP4', 'VIP5', 'VIP6', 'VIP7', 'VIP8', 'VIP9'];
    if (!validVipLevels.includes(vip_level)) {
      return res.status(400).json({ message: 'Invalid VIP level' });
    }

    const result = await User.updateMany(
      { _id: { $in: user_ids } },
      { vip_level, updated_at: new Date() }
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
      updated_count: result.modifiedCount,
      matched_count: result.matchedCount
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

    const updateData = { updated_at: new Date() };
    if (amount_NSL) updateData.$inc = { balance_NSL: parseFloat(amount_NSL) };
    if (amount_usdt) {
      updateData.$inc = updateData.$inc || {};
      updateData.$inc.balance_usdt = parseFloat(amount_usdt);
    }

    const result = await User.updateMany(
      { _id: { $in: user_ids } },
      updateData
    );

    // Create transaction records for each user
    const transactions = user_ids.map(userId => ({
      user_id: userId,
      type: 'recharge',
      amount_NSL: amount_NSL || 0,
      amount_usdt: amount_usdt || 0,
      status: 'approved',
      approved_by: req.user.id,
      notes: `Batch currency addition: ${reason}`,
      completed_at: new Date()
    }));

    await Transaction.insertMany(transactions);

    // Send notifications
    await notificationService.createBulk(
      user_ids,
      'transaction_approved',
      'Currency Added',
      `${amount_NSL || 0} NSL has been added to your account. ${reason}`,
      { priority: 'high', icon: '💰' }
    );

    logger.info(`Batch currency addition by ${req.user.phone}: ${user_ids.length} users received ${amount_NSL} NSL`);

    res.json({
      message: 'Batch currency addition successful',
      updated_count: result.modifiedCount,
      matched_count: result.matchedCount,
      transactions_created: transactions.length
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
    const users = await User.find({ _id: { $in: user_ids } });
    const superadmins = users.filter(u => u.role === 'superadmin');

    if (superadmins.length > 0) {
      return res.status(403).json({ message: 'Cannot delete superadmin accounts' });
    }

    const result = await User.updateMany(
      { _id: { $in: user_ids }, role: { $ne: 'superadmin' } },
      { status: 'frozen', updated_at: new Date() }
    );

    logger.warn(`Batch user deletion by ${req.user.phone}: ${user_ids.length} users frozen - Reason: ${reason || 'No reason provided'}`);

    res.json({
      message: 'Batch user deletion (freeze) successful',
      updated_count: result.modifiedCount,
      matched_count: result.matchedCount
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

    const transactions = await Transaction.find({
      _id: { $in: transaction_ids },
      status: 'pending'
    }).populate('user_id');

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
        const user = transaction.user_id;

        if (!user) {
          results.failed++;
          results.errors.push({ transaction_id: transaction._id, error: 'User not found' });
          continue;
        }

        // Update user balance
        if (transaction.type === 'recharge') {
          user.balance_NSL += transaction.amount_NSL;
        } else if (transaction.type === 'withdrawal') {
          if (user.balance_NSL < transaction.amount_NSL) {
            results.failed++;
            results.errors.push({ transaction_id: transaction._id, error: 'Insufficient balance' });
            continue;
          }
          user.balance_NSL -= transaction.amount_NSL;
        }

        transaction.status = 'approved';
        transaction.approved_by = req.user.id;
        transaction.completed_at = new Date();
        if (reason) transaction.notes = reason;

        await transaction.save();
        await user.save();

        // Send notification
        await notificationService.notifyTransactionApproved(
          user._id,
          transaction.type,
          transaction.amount_NSL
        );

        results.approved++;
      } catch (error) {
        results.failed++;
        results.errors.push({ transaction_id: transaction._id, error: error.message });
        logger.error(`Batch approval error for transaction ${transaction._id}:`, error);
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

    const transactions = await Transaction.find({
      _id: { $in: transaction_ids },
      status: 'pending'
    }).populate('user_id');

    const result = await Transaction.updateMany(
      { _id: { $in: transaction_ids }, status: 'pending' },
      {
        status: 'rejected',
        approved_by: req.user.id,
        notes: reason,
        completed_at: new Date()
      }
    );

    // Send notifications
    const userIds = transactions.map(t => t.user_id._id);
    for (const transaction of transactions) {
      if (transaction.user_id) {
        await notificationService.notifyTransactionRejected(
          transaction.user_id._id,
          transaction.type,
          transaction.amount_NSL,
          reason
        );
      }
    }

    logger.info(`Batch transaction rejection by ${req.user.phone}: ${result.modifiedCount} rejected`);

    res.json({
      message: 'Batch transaction rejection successful',
      rejected_count: result.modifiedCount,
      matched_count: result.matchedCount
    });
  } catch (error) {
    logger.error('Batch transaction rejection error:', error);
    res.status(500).json({ message: 'Error rejecting transactions', error: error.message });
  }
});

module.exports = router;
