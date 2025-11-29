const express = require('express');
const User = require('../models/User');
const Transaction = require('../models/Transaction');
const Product = require('../models/Product');
const Referral = require('../models/Referral');
const { authenticate, authorize } = require('../middleware/auth');
const logger = require('../utils/logger');

const router = express.Router();

// User Dashboard Analytics
router.get('/user/dashboard', authenticate, async (req, res) => {
  try {
    const userId = req.user.id;
    const user = await User.findById(userId).populate('products.product_id');

    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    // Get date ranges
    const now = new Date();
    const last7Days = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const last30Days = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const thisMonth = new Date(now.getFullYear(), now.getMonth(), 1);

    // Transaction stats
    const totalTransactions = await Transaction.countDocuments({ user_id: userId });
    const pendingTransactions = await Transaction.countDocuments({ user_id: userId, status: 'pending' });
    const approvedTransactions = await Transaction.countDocuments({ user_id: userId, status: 'approved' });

    // Income stats
    const totalIncome = await Transaction.aggregate([
      {
        $match: {
          user_id: user._id,
          type: 'income',
          status: 'approved'
        }
      },
      {
        $group: {
          _id: null,
          total: { $sum: '$amount_NSL' }
        }
      }
    ]);

    const last7DaysIncome = await Transaction.aggregate([
      {
        $match: {
          user_id: user._id,
          type: 'income',
          status: 'approved',
          timestamp: { $gte: last7Days }
        }
      },
      {
        $group: {
          _id: null,
          total: { $sum: '$amount_NSL' }
        }
      }
    ]);

    const thisMonthIncome = await Transaction.aggregate([
      {
        $match: {
          user_id: user._id,
          type: 'income',
          status: 'approved',
          timestamp: { $gte: thisMonth }
        }
      },
      {
        $group: {
          _id: null,
          total: { $sum: '$amount_NSL' }
        }
      }
    ]);

    // Referral stats
    const totalReferrals = await Referral.countDocuments({ referrer_id: userId });
    const referralEarnings = await Referral.aggregate([
      {
        $match: {
          referrer_id: user._id,
          status: 'paid'
        }
      },
      {
        $group: {
          _id: null,
          total: { $sum: '$bonus_NSL' }
        }
      }
    ]);

    // Product stats
    const activeProducts = user.products.filter(p => p.is_active);
    const totalDailyIncome = activeProducts.reduce((sum, p) => {
      const prod = p.product_id;
      return sum + (prod?.daily_income_NSL || 0);
    }, 0);

    // Transaction history chart data (last 30 days)
    const transactionHistory = await Transaction.aggregate([
      {
        $match: {
          user_id: user._id,
          timestamp: { $gte: last30Days }
        }
      },
      {
        $group: {
          _id: {
            date: { $dateToString: { format: '%Y-%m-%d', date: '$timestamp' } },
            type: '$type'
          },
          count: { $sum: 1 },
          amount: { $sum: '$amount_NSL' }
        }
      },
      {
        $sort: { '_id.date': 1 }
      }
    ]);

    // Income trend (daily for last 7 days)
    const incomeTrend = await Transaction.aggregate([
      {
        $match: {
          user_id: user._id,
          type: 'income',
          status: 'approved',
          timestamp: { $gte: last7Days }
        }
      },
      {
        $group: {
          _id: { $dateToString: { format: '%Y-%m-%d', date: '$timestamp' } },
          total: { $sum: '$amount_NSL' }
        }
      },
      {
        $sort: { _id: 1 }
      }
    ]);

    res.json({
      balance: {
        NSL: user.balance_NSL,
        USDT: user.balance_usdt
      },
      transactions: {
        total: totalTransactions,
        pending: pendingTransactions,
        approved: approvedTransactions
      },
      income: {
        total: totalIncome[0]?.total || 0,
        last_7_days: last7DaysIncome[0]?.total || 0,
        this_month: thisMonthIncome[0]?.total || 0,
        daily_potential: totalDailyIncome
      },
      referrals: {
        total_count: totalReferrals,
        total_earnings: referralEarnings[0]?.total || 0
      },
      products: {
        active_count: activeProducts.length,
        total_count: user.products.length
      },
      charts: {
        transaction_history: transactionHistory,
        income_trend: incomeTrend
      },
      vip_level: user.vip_level
    });
  } catch (error) {
    logger.error('User dashboard analytics error:', error);
    res.status(500).json({ message: 'Error fetching dashboard analytics', error: error.message });
  }
});

// Admin Dashboard Analytics
router.get('/admin/dashboard', authenticate, authorize(['superadmin', 'admin']), async (req, res) => {
  try {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const last7Days = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const last30Days = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const thisMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const lastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);

    // User stats
    const totalUsers = await User.countDocuments();
    const activeUsers = await User.countDocuments({ status: 'active' });
    const pendingUsers = await User.countDocuments({ status: 'pending' });
    const frozenUsers = await User.countDocuments({ status: 'frozen' });
    const newUsersToday = await User.countDocuments({ created_at: { $gte: today } });
    const newUsersThisMonth = await User.countDocuments({ created_at: { $gte: thisMonth } });

    // VIP distribution
    const vipDistribution = await User.aggregate([
      {
        $group: {
          _id: '$vip_level',
          count: { $sum: 1 }
        }
      },
      {
        $sort: { _id: 1 }
      }
    ]);

    // Transaction stats
    const totalTransactions = await Transaction.countDocuments();
    const pendingTransactions = await Transaction.countDocuments({ status: 'pending' });
    const approvedTransactions = await Transaction.countDocuments({ status: 'approved' });
    const rejectedTransactions = await Transaction.countDocuments({ status: 'rejected' });

    // Transaction volume by type
    const transactionsByType = await Transaction.aggregate([
      {
        $group: {
          _id: '$type',
          count: { $sum: 1 },
          total_NSL: { $sum: '$amount_NSL' },
          total_USDT: { $sum: '$amount_usdt' }
        }
      }
    ]);

    // Revenue stats (approved recharges)
    const totalRevenue = await Transaction.aggregate([
      {
        $match: {
          type: 'recharge',
          status: 'approved'
        }
      },
      {
        $group: {
          _id: null,
          total_NSL: { $sum: '$amount_NSL' },
          total_USDT: { $sum: '$amount_usdt' }
        }
      }
    ]);

    const thisMonthRevenue = await Transaction.aggregate([
      {
        $match: {
          type: 'recharge',
          status: 'approved',
          timestamp: { $gte: thisMonth }
        }
      },
      {
        $group: {
          _id: null,
          total_NSL: { $sum: '$amount_NSL' },
          total_USDT: { $sum: '$amount_usdt' }
        }
      }
    ]);

    const lastMonthRevenue = await Transaction.aggregate([
      {
        $match: {
          type: 'recharge',
          status: 'approved',
          timestamp: { $gte: lastMonth, $lt: thisMonth }
        }
      },
      {
        $group: {
          _id: null,
          total_NSL: { $sum: '$amount_NSL' },
          total_USDT: { $sum: '$amount_usdt' }
        }
      }
    ]);

    // Withdrawal stats
    const pendingWithdrawals = await Transaction.aggregate([
      {
        $match: {
          type: 'withdrawal',
          status: 'pending'
        }
      },
      {
        $group: {
          _id: null,
          count: { $sum: 1 },
          total_NSL: { $sum: '$amount_NSL' },
          total_USDT: { $sum: '$amount_usdt' }
        }
      }
    ]);

    // Product stats
    const productSales = await Transaction.aggregate([
      {
        $match: {
          type: 'purchase',
          status: 'approved'
        }
      },
      {
        $group: {
          _id: '$product_id',
          count: { $sum: 1 },
          revenue: { $sum: '$amount_NSL' }
        }
      },
      {
        $lookup: {
          from: 'products',
          localField: '_id',
          foreignField: '_id',
          as: 'product'
        }
      },
      {
        $unwind: '$product'
      },
      {
        $project: {
          product_name: '$product.name',
          sales_count: '$count',
          revenue: '$revenue'
        }
      },
      {
        $sort: { sales_count: -1 }
      }
    ]);

    // User growth chart (last 30 days)
    const userGrowth = await User.aggregate([
      {
        $match: {
          created_at: { $gte: last30Days }
        }
      },
      {
        $group: {
          _id: { $dateToString: { format: '%Y-%m-%d', date: '$created_at' } },
          count: { $sum: 1 }
        }
      },
      {
        $sort: { _id: 1 }
      }
    ]);

    // Revenue trend (last 30 days)
    const revenueTrend = await Transaction.aggregate([
      {
        $match: {
          type: 'recharge',
          status: 'approved',
          timestamp: { $gte: last30Days }
        }
      },
      {
        $group: {
          _id: { $dateToString: { format: '%Y-%m-%d', date: '$timestamp' } },
          NSL: { $sum: '$amount_NSL' },
          USDT: { $sum: '$amount_usdt' }
        }
      },
      {
        $sort: { _id: 1 }
      }
    ]);

    // Referral stats
    const totalReferrals = await Referral.countDocuments();
    const totalReferralPayouts = await Referral.aggregate([
      {
        $match: {
          status: 'paid'
        }
      },
      {
        $group: {
          _id: null,
          total: { $sum: '$bonus_NSL' }
        }
      }
    ]);

    // Calculate growth rates
    const thisMonthRev = thisMonthRevenue[0]?.total_NSL || 0;
    const lastMonthRev = lastMonthRevenue[0]?.total_NSL || 0;
    const revenueGrowth = lastMonthRev > 0 ? ((thisMonthRev - lastMonthRev) / lastMonthRev * 100).toFixed(2) : 0;

    res.json({
      users: {
        total: totalUsers,
        active: activeUsers,
        pending: pendingUsers,
        frozen: frozenUsers,
        new_today: newUsersToday,
        new_this_month: newUsersThisMonth,
        vip_distribution: vipDistribution
      },
      transactions: {
        total: totalTransactions,
        pending: pendingTransactions,
        approved: approvedTransactions,
        rejected: rejectedTransactions,
        by_type: transactionsByType
      },
      revenue: {
        total: totalRevenue[0] || { total_NSL: 0, total_USDT: 0 },
        this_month: thisMonthRevenue[0] || { total_NSL: 0, total_USDT: 0 },
        last_month: lastMonthRevenue[0] || { total_NSL: 0, total_USDT: 0 },
        growth_rate: `${revenueGrowth}%`
      },
      withdrawals: {
        pending: pendingWithdrawals[0] || { count: 0, total_NSL: 0, total_USDT: 0 }
      },
      products: {
        sales: productSales
      },
      referrals: {
        total_count: totalReferrals,
        total_payouts: totalReferralPayouts[0]?.total || 0
      },
      charts: {
        user_growth: userGrowth,
        revenue_trend: revenueTrend
      }
    });
  } catch (error) {
    logger.error('Admin dashboard analytics error:', error);
    res.status(500).json({ message: 'Error fetching admin analytics', error: error.message });
  }
});

// Finance Dashboard Analytics
router.get('/finance/dashboard', authenticate, authorize(['superadmin', 'finance']), async (req, res) => {
  try {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const thisMonth = new Date(now.getFullYear(), now.getMonth(), 1);

    // Pending transactions by type
    const pendingByType = await Transaction.aggregate([
      {
        $match: {
          status: 'pending'
        }
      },
      {
        $group: {
          _id: '$type',
          count: { $sum: 1 },
          total_NSL: { $sum: '$amount_NSL' },
          total_USDT: { $sum: '$amount_usdt' }
        }
      }
    ]);

    // Today's processed transactions
    const todayProcessed = await Transaction.countDocuments({
      status: { $in: ['approved', 'rejected'] },
      completed_at: { $gte: today }
    });

    // This month's processed transactions
    const thisMonthProcessed = await Transaction.countDocuments({
      status: { $in: ['approved', 'rejected'] },
      completed_at: { $gte: thisMonth }
    });

    // Pending recharges (high priority)
    const pendingRecharges = await Transaction.find({
      type: 'recharge',
      status: 'pending'
    })
      .populate('user_id', 'phone username')
      .sort({ timestamp: 1 })
      .limit(10);

    // Pending withdrawals (high priority)
    const pendingWithdrawals = await Transaction.find({
      type: 'withdrawal',
      status: 'pending'
    })
      .populate('user_id', 'phone username balance_NSL')
      .sort({ timestamp: 1 })
      .limit(10);

    // Recent activity
    const recentActivity = await Transaction.find({
      status: { $in: ['approved', 'rejected'] },
      approved_by: req.user.id
    })
      .populate('user_id', 'phone username')
      .sort({ completed_at: -1 })
      .limit(20);

    res.json({
      pending: {
        by_type: pendingByType,
        total_count: pendingByType.reduce((sum, item) => sum + item.count, 0)
      },
      processed: {
        today: todayProcessed,
        this_month: thisMonthProcessed
      },
      priority_queue: {
        recharges: pendingRecharges,
        withdrawals: pendingWithdrawals
      },
      recent_activity: recentActivity
    });
  } catch (error) {
    logger.error('Finance dashboard analytics error:', error);
    res.status(500).json({ message: 'Error fetching finance analytics', error: error.message });
  }
});

module.exports = router;
