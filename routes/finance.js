const express = require('express');
const Transaction = require('../models/Transaction');
const User = require('../models/User');
const { authenticate, authorize } = require('../middleware/auth');
const logger = require('../utils/logger');
const emailService = require('../utils/emailService');
const notificationService = require('../utils/notificationService');
const { FEE } = require('../config/constants');

// Validation Middleware
const {
  validateAddCurrency,
  validateApproveReject
} = require('../middleware/validation');

// Security Middleware
const { financeLimiter } = require('../middleware/security');
const router = express.Router();

// Finance: Get pending transactions
router.get('/transactions', authenticate, authorize(['superadmin', 'finance']), async (req, res) => {
  try {
    const { type, status = 'pending', limit = 20, skip = 0 } = req.query;
    const filter = {};

    if (type) filter.type = type;
    if (status) filter.status = status;

    const transactions = await Transaction.find(filter)
      .populate('user_id', 'phone balance_NSL balance_usdt')
      .populate('approved_by', 'phone')
      .sort({ timestamp: -1 })
      .limit(parseInt(limit))
      .skip(parseInt(skip));

    const total = await Transaction.countDocuments(filter);

    res.json({
      transactions,
      pagination: {
        total,
        limit: parseInt(limit),
        skip: parseInt(skip)
      }
    });
  } catch (error) {
    logger.error('Finance transactions fetch error:', error);
    res.status(500).json({ message: 'Error fetching transactions', error: error.message });
  }
});

// Finance: Approve transaction
router.patch('/transactions/:id/approve', authenticate, authorize(['superadmin', 'finance']), financeLimiter, validateApproveReject, async (req, res) => {
  try {
    const { reason } = req.body;
    const transaction = await Transaction.findById(req.params.id);

    if (!transaction) {
      return res.status(404).json({ message: 'Transaction not found' });
    }

    const user = await User.findById(transaction.user_id);

    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    // CRITICAL FIX: Only update NSL balance, not USDT
    // USDT is just a conversion for display purposes
    if (transaction.type === 'recharge') {
      user.balance_NSL += transaction.amount_NSL;
      // Removed: user.balance_usdt += transaction.amount_usdt;
    } else if (transaction.type === 'withdrawal') {
      if (user.balance_NSL < transaction.amount_NSL) {
        return res.status(400).json({ message: 'Insufficient balance for withdrawal' });
      }
      user.balance_NSL -= transaction.amount_NSL;
      // Removed: user.balance_usdt -= transaction.amount_usdt;
    }

    transaction.status = 'approved';
    transaction.approved_by = req.user.id;
    transaction.completed_at = new Date();
    if (reason) {
      transaction.notes = reason;
    }

    await transaction.save();
    await user.save();

    logger.info(`Transaction approved: ${transaction._id} by ${req.user.phone}`);

    // Send email notification
    if (user.email) {
      try {
        await emailService.sendTransactionApproved(
          user.email,
          user.username,
          transaction.type,
          transaction.amount_NSL,
          transaction.amount_usdt,
          user.balance_NSL
        );
      } catch (emailError) {
        logger.error('Email notification error:', emailError);
        // Don't fail the transaction if email fails
      }
    }

    // Send in-app notification
    try {
      await notificationService.notifyTransactionApproved(
        user._id,
        transaction.type,
        transaction.amount_NSL
      );
    } catch (notifError) {
      logger.error('In-app notification error:', notifError);
      // Don't fail the transaction if notification fails
    }

    res.json({
      message: 'Transaction approved',
      transaction,
      user: {
        balance_NSL: user.balance_NSL,
        balance_usdt: user.balance_usdt
      }
    });
  } catch (error) {
    logger.error('Transaction approval error:', error);
    res.status(500).json({ message: 'Error approving transaction', error: error.message });
  }
});

// Finance: Reject transaction
router.patch('/transactions/:id/reject', authenticate, authorize(['superadmin', 'finance']), financeLimiter, validateApproveReject, async (req, res) => {
  try {
    const { reason } = req.body;
    const transaction = await Transaction.findById(req.params.id).populate('user_id');

    if (!transaction) {
      return res.status(404).json({ message: 'Transaction not found' });
    }

    const user = transaction.user_id;

    transaction.status = 'rejected';
    transaction.approved_by = req.user.id;
    transaction.notes = reason || 'No reason provided';
    transaction.completed_at = new Date();

    await transaction.save();
    logger.info(`Transaction rejected: ${transaction._id} by ${req.user.phone}`);

    // Send email notification
    if (user && user.email) {
      try {
        await emailService.sendTransactionRejected(
          user.email,
          user.username,
          transaction.type,
          transaction.amount_NSL,
          transaction.amount_usdt,
          transaction.notes
        );
      } catch (emailError) {
        logger.error('Email notification error:', emailError);
        // Don't fail the transaction if email fails
      }
    }

    // Send in-app notification
    if (user) {
      try {
        await notificationService.notifyTransactionRejected(
          user._id,
          transaction.type,
          transaction.amount_NSL,
          transaction.notes
        );
      } catch (notifError) {
        logger.error('In-app notification error:', notifError);
        // Don't fail the transaction if notification fails
      }
    }

    res.json({
      message: 'Transaction rejected',
      transaction
    });
  } catch (error) {
    logger.error('Transaction rejection error:', error);
    res.status(500).json({ message: 'Error rejecting transaction', error: error.message });
  }
});

// ============ USER MANAGEMENT FOR FINANCE ============

// Finance: Get all users
router.get('/users', authenticate, authorize(['superadmin', 'finance']), async (req, res) => {
  try {
    const { status, limit = 50, skip = 0 } = req.query;
    const filter = {};

    if (status) filter.status = status;

    const users = await User.find(filter)
      .select('-password_hash')
      .limit(parseInt(limit))
      .skip(parseInt(skip))
      .sort({ created_at: -1 });

    const total = await User.countDocuments(filter);

    res.json({
      users,
      pagination: {
        total,
        limit: parseInt(limit),
        skip: parseInt(skip)
      }
    });
  } catch (error) {
    logger.error('Finance users fetch error:', error);
    res.status(500).json({ message: 'Error fetching users', error: error.message });
  }
});

// Finance: Add currency to user
router.patch('/users/:id/add-currency', authenticate, authorize(['superadmin', 'finance']), financeLimiter, validateAddCurrency, async (req, res) => {
  try {
    const { amount_NSL, amount_usdt, reason } = req.body;
    const user = await User.findById(req.params.id);

    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    if (amount_NSL) {
      user.balance_NSL += parseFloat(amount_NSL);
    }
    if (amount_usdt) {
      user.balance_usdt += parseFloat(amount_usdt);
    }

    await user.save();

    // Create transaction record
    const transaction = new Transaction({
      user_id: user._id,
      type: 'recharge',
      amount_NSL: amount_NSL || 0,
      amount_usdt: amount_usdt || 0,
      status: 'approved',
      approved_by: req.user.id,
      notes: `Currency added by finance: ${reason || 'Manual addition'}`,
      completed_at: new Date()
    });
    await transaction.save();

    logger.info(`Currency added by finance (${req.user.phone}) to user ${user.phone}: NSL=${amount_NSL}, USDT=${amount_usdt}`);

    res.json({
      message: 'Currency added successfully',
      user: {
        id: user._id,
        username: user.username,
        phone: user.phone,
        balance_NSL: user.balance_NSL,
        balance_usdt: user.balance_usdt
      },
      transaction
    });
  } catch (error) {
    logger.error('Add currency error:', error);
    res.status(500).json({ message: 'Error adding currency', error: error.message });
  }
});

// Finance: Suspend user account
router.patch('/users/:id/suspend', authenticate, authorize(['superadmin', 'finance']), financeLimiter, validateApproveReject, async (req, res) => {
  try {
    const { reason } = req.body;
    const user = await User.findByIdAndUpdate(
      req.params.id,
      { status: 'frozen' },
      { new: true }
    ).select('-password_hash');

    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    logger.warn(`User suspended by finance (${req.user.phone}): ${user.phone} - Reason: ${reason || 'No reason'}`);

    res.json({
      message: 'User account suspended',
      user
    });
  } catch (error) {
    logger.error('User suspension error:', error);
    res.status(500).json({ message: 'Error suspending user', error: error.message });
  }
});

// Finance: Activate user account
router.patch('/users/:id/activate', authenticate, authorize(['superadmin', 'finance']), financeLimiter, async (req, res) => {
  try {
    const user = await User.findByIdAndUpdate(
      req.params.id,
      { status: 'active' },
      { new: true }
    ).select('-password_hash');

    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    logger.info(`User activated by finance (${req.user.phone}): ${user.phone}`);

    res.json({
      message: 'User account activated',
      user
    });
  } catch (error) {
    logger.error('User activation error:', error);
    res.status(500).json({ message: 'Error activating user', error: error.message });
  }
});

// Finance: Approve user account (for pending users)
router.patch('/users/:id/approve', authenticate, authorize(['superadmin', 'finance']), financeLimiter, async (req, res) => {
  try {
    const user = await User.findByIdAndUpdate(
      req.params.id,
      { status: 'active', kyc_verified: true },
      { new: true }
    ).select('-password_hash');

    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    logger.info(`User approved by finance (${req.user.phone}): ${user.phone}`);

    // Send email notification
    if (user.email) {
      try {
        await emailService.sendAccountApproved(
          user.email,
          user.username
        );
      } catch (emailError) {
        logger.error('Email notification error:', emailError);
        // Don't fail the approval if email fails
      }
    }

    res.json({
      message: 'User account approved and activated',
      user
    });
  } catch (error) {
    logger.error('User approval error:', error);
    res.status(500).json({ message: 'Error approving user', error: error.message });
  }
});

// Finance: Add admin notes to transaction
router.patch('/transactions/:id/add-note', authenticate, authorize(['superadmin', 'finance']), financeLimiter, validateApproveReject, async (req, res) => {
  try {
    const { reason } = req.body; // Using 'reason' field from validation
    const transaction = await Transaction.findById(req.params.id);

    if (!transaction) {
      return res.status(404).json({ message: 'Transaction not found' });
    }

    if (!reason || reason.trim() === '') {
      return res.status(400).json({ message: 'Note cannot be empty' });
    }

    // Append note with timestamp and admin info
    const timestamp = new Date().toISOString();
    const adminInfo = req.user.phone || req.user.username || req.user.id;
    const newNote = `[${timestamp}] ${adminInfo}: ${reason}`;

    if (transaction.admin_notes) {
      transaction.admin_notes += '\n' + newNote;
    } else {
      transaction.admin_notes = newNote;
    }

    await transaction.save();
    logger.info(`Admin note added to transaction ${transaction._id} by ${adminInfo}`);

    res.json({
      message: 'Note added successfully',
      transaction: {
        id: transaction._id,
        admin_notes: transaction.admin_notes,
        status: transaction.status
      }
    });
  } catch (error) {
    logger.error('Add note error:', error);
    res.status(500).json({ message: 'Error adding note', error: error.message });
  }
});

// Finance: Get transaction details with notes
router.get('/transactions/:id', authenticate, authorize(['superadmin', 'finance']), async (req, res) => {
  try {
    const transaction = await Transaction.findById(req.params.id)
      .populate('user_id', 'phone username email balance_NSL balance_usdt')
      .populate('approved_by', 'phone username')
      .populate('product_id', 'name price_NSL');

    if (!transaction) {
      return res.status(404).json({ message: 'Transaction not found' });
    }

    res.json({
      transaction
    });
  } catch (error) {
    logger.error('Transaction fetch error:', error);
    res.status(500).json({ message: 'Error fetching transaction', error: error.message });
  }
});

// Finance: Get finance activity log (track what finance is doing)
router.get('/activity-log', authenticate, authorize(['superadmin']), async (req, res) => {
  try {
    const { limit = 50, skip = 0 } = req.query;

    // Get all transactions approved by finance users
    const financeUsers = await User.find({ role: 'finance' }).select('_id phone');
    const financeIds = financeUsers.map(u => u._id);

    const activities = await Transaction.find({
      approved_by: { $in: financeIds }
    })
      .populate('user_id', 'phone username')
      .populate('approved_by', 'phone username')
      .sort({ completed_at: -1 })
      .limit(parseInt(limit))
      .skip(parseInt(skip));

    const total = await Transaction.countDocuments({
      approved_by: { $in: financeIds }
    });

    res.json({
      activities,
      pagination: {
        total,
        limit: parseInt(limit),
        skip: parseInt(skip)
      }
    });
  } catch (error) {
    logger.error('Activity log fetch error:', error);
    res.status(500).json({ message: 'Error fetching activity log', error: error.message });
  }
});

module.exports = router;
