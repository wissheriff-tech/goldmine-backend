const express = require('express');
const { User, Transaction, Product, Referral, UserProduct } = require('../models');
const { Op, fn, col, literal } = require('sequelize');
const { authenticate, authorize } = require('../middleware/auth');
const logger = require('../utils/logger');

const router = express.Router();

// User Dashboard Analytics
router.get('/user/dashboard', authenticate, async (req, res) => {
  try {
    const userId = req.user.id;
    const user = await User.findByPk(userId);

    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    // Get user products with product details
    const userProducts = await UserProduct.findAll({
      where: { user_id: userId },
      include: [{ model: Product, as: 'product' }]
    });

    // Get date ranges
    const now = new Date();
    const last7Days = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const last30Days = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const thisMonth = new Date(now.getFullYear(), now.getMonth(), 1);

    // Transaction stats
    const totalTransactions = await Transaction.count({ where: { user_id: userId } });
    const pendingTransactions = await Transaction.count({ where: { user_id: userId, status: 'pending' } });
    const approvedTransactions = await Transaction.count({ where: { user_id: userId, status: 'approved' } });

    // Income stats
    const totalIncome = await Transaction.findAll({
      where: {
        user_id: userId,
        type: 'income',
        status: 'approved'
      },
      attributes: [[fn('SUM', col('amount_NSL')), 'total']],
      raw: true
    });

    const last7DaysIncome = await Transaction.findAll({
      where: {
        user_id: userId,
        type: 'income',
        status: 'approved',
        timestamp: { [Op.gte]: last7Days }
      },
      attributes: [[fn('SUM', col('amount_NSL')), 'total']],
      raw: true
    });

    const thisMonthIncome = await Transaction.findAll({
      where: {
        user_id: userId,
        type: 'income',
        status: 'approved',
        timestamp: { [Op.gte]: thisMonth }
      },
      attributes: [[fn('SUM', col('amount_NSL')), 'total']],
      raw: true
    });

    // Referral stats
    const totalReferrals = await Referral.count({ where: { referrer_id: userId } });
    const referralEarnings = await Referral.findAll({
      where: {
        referrer_id: userId,
        status: 'paid'
      },
      attributes: [[fn('SUM', col('bonus_NSL')), 'total']],
      raw: true
    });

    // Product stats
    const activeProducts = userProducts.filter(p => p.is_active);
    const totalDailyIncome = activeProducts.reduce((sum, p) => {
      const prod = p.product;
      return sum + (prod?.daily_income_NSL || 0);
    }, 0);

    // Transaction history chart data (last 30 days)
    const transactionHistory = await Transaction.findAll({
      where: {
        user_id: userId,
        timestamp: { [Op.gte]: last30Days }
      },
      attributes: [
        [fn('DATE_FORMAT', col('timestamp'), '%Y-%m-%d'), 'date'],
        'type',
        [fn('COUNT', col('id')), 'count'],
        [fn('SUM', col('amount_NSL')), 'amount']
      ],
      group: [fn('DATE_FORMAT', col('timestamp'), '%Y-%m-%d'), 'type'],
      order: [[fn('DATE_FORMAT', col('timestamp'), '%Y-%m-%d'), 'ASC']],
      raw: true
    });

    // Income trend (daily for last 7 days)
    const incomeTrend = await Transaction.findAll({
      where: {
        user_id: userId,
        type: 'income',
        status: 'approved',
        timestamp: { [Op.gte]: last7Days }
      },
      attributes: [
        [fn('DATE_FORMAT', col('timestamp'), '%Y-%m-%d'), 'date'],
        [fn('SUM', col('amount_NSL')), 'total']
      ],
      group: [fn('DATE_FORMAT', col('timestamp'), '%Y-%m-%d')],
      order: [[fn('DATE_FORMAT', col('timestamp'), '%Y-%m-%d'), 'ASC']],
      raw: true
    });

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
        total: parseFloat(totalIncome[0]?.total) || 0,
        last_7_days: parseFloat(last7DaysIncome[0]?.total) || 0,
        this_month: parseFloat(thisMonthIncome[0]?.total) || 0,
        daily_potential: totalDailyIncome
      },
      referrals: {
        total_count: totalReferrals,
        total_earnings: parseFloat(referralEarnings[0]?.total) || 0
      },
      products: {
        active_count: activeProducts.length,
        total_count: userProducts.length
      },
      charts: {
        transaction_history: transactionHistory.map(t => ({
          date: t.date,
          type: t.type,
          count: parseInt(t.count),
          amount: parseFloat(t.amount) || 0
        })),
        income_trend: incomeTrend.map(t => ({
          date: t.date,
          total: parseFloat(t.total) || 0
        }))
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
    const totalUsers = await User.count();
    const activeUsers = await User.count({ where: { status: 'active' } });
    const pendingUsers = await User.count({ where: { status: 'pending' } });
    const frozenUsers = await User.count({ where: { status: 'frozen' } });
    const newUsersToday = await User.count({ where: { created_at: { [Op.gte]: today } } });
    const newUsersThisMonth = await User.count({ where: { created_at: { [Op.gte]: thisMonth } } });

    // VIP distribution
    const vipDistribution = await User.findAll({
      attributes: [
        'vip_level',
        [fn('COUNT', col('id')), 'count']
      ],
      group: ['vip_level'],
      order: [['vip_level', 'ASC']],
      raw: true
    });

    // Transaction stats
    const totalTransactions = await Transaction.count();
    const pendingTransactions = await Transaction.count({ where: { status: 'pending' } });
    const approvedTransactions = await Transaction.count({ where: { status: 'approved' } });
    const rejectedTransactions = await Transaction.count({ where: { status: 'rejected' } });

    // Transaction volume by type
    const transactionsByType = await Transaction.findAll({
      attributes: [
        'type',
        [fn('COUNT', col('id')), 'count'],
        [fn('SUM', col('amount_NSL')), 'total_NSL'],
        [fn('SUM', col('amount_usdt')), 'total_USDT']
      ],
      group: ['type'],
      raw: true
    });

    // Revenue stats (approved recharges)
    const totalRevenue = await Transaction.findAll({
      where: {
        type: 'recharge',
        status: 'approved'
      },
      attributes: [
        [fn('SUM', col('amount_NSL')), 'total_NSL'],
        [fn('SUM', col('amount_usdt')), 'total_USDT']
      ],
      raw: true
    });

    const thisMonthRevenue = await Transaction.findAll({
      where: {
        type: 'recharge',
        status: 'approved',
        timestamp: { [Op.gte]: thisMonth }
      },
      attributes: [
        [fn('SUM', col('amount_NSL')), 'total_NSL'],
        [fn('SUM', col('amount_usdt')), 'total_USDT']
      ],
      raw: true
    });

    const lastMonthRevenue = await Transaction.findAll({
      where: {
        type: 'recharge',
        status: 'approved',
        timestamp: { [Op.gte]: lastMonth, [Op.lt]: thisMonth }
      },
      attributes: [
        [fn('SUM', col('amount_NSL')), 'total_NSL'],
        [fn('SUM', col('amount_usdt')), 'total_USDT']
      ],
      raw: true
    });

    // Withdrawal stats
    const pendingWithdrawals = await Transaction.findAll({
      where: {
        type: 'withdrawal',
        status: 'pending'
      },
      attributes: [
        [fn('COUNT', col('id')), 'count'],
        [fn('SUM', col('amount_NSL')), 'total_NSL'],
        [fn('SUM', col('amount_usdt')), 'total_USDT']
      ],
      raw: true
    });

    // Product stats
    const productSales = await Transaction.findAll({
      where: {
        type: 'purchase',
        status: 'approved'
      },
      attributes: [
        'product_id',
        [fn('COUNT', col('Transaction.id')), 'sales_count'],
        [fn('SUM', col('amount_NSL')), 'revenue']
      ],
      include: [{
        model: Product,
        as: 'product',
        attributes: ['name']
      }],
      group: ['product_id', 'product.id', 'product.name'],
      order: [[fn('COUNT', col('Transaction.id')), 'DESC']],
      raw: true,
      nest: true
    });

    // User growth chart (last 30 days)
    const userGrowth = await User.findAll({
      where: {
        created_at: { [Op.gte]: last30Days }
      },
      attributes: [
        [fn('DATE_FORMAT', col('created_at'), '%Y-%m-%d'), 'date'],
        [fn('COUNT', col('id')), 'count']
      ],
      group: [fn('DATE_FORMAT', col('created_at'), '%Y-%m-%d')],
      order: [[fn('DATE_FORMAT', col('created_at'), '%Y-%m-%d'), 'ASC']],
      raw: true
    });

    // Revenue trend (last 30 days)
    const revenueTrend = await Transaction.findAll({
      where: {
        type: 'recharge',
        status: 'approved',
        timestamp: { [Op.gte]: last30Days }
      },
      attributes: [
        [fn('DATE_FORMAT', col('timestamp'), '%Y-%m-%d'), 'date'],
        [fn('SUM', col('amount_NSL')), 'NSL'],
        [fn('SUM', col('amount_usdt')), 'USDT']
      ],
      group: [fn('DATE_FORMAT', col('timestamp'), '%Y-%m-%d')],
      order: [[fn('DATE_FORMAT', col('timestamp'), '%Y-%m-%d'), 'ASC']],
      raw: true
    });

    // Referral stats
    const totalReferrals = await Referral.count();
    const totalReferralPayouts = await Referral.findAll({
      where: {
        status: 'paid'
      },
      attributes: [[fn('SUM', col('bonus_NSL')), 'total']],
      raw: true
    });

    // Calculate growth rates
    const thisMonthRev = parseFloat(thisMonthRevenue[0]?.total_NSL) || 0;
    const lastMonthRev = parseFloat(lastMonthRevenue[0]?.total_NSL) || 0;
    const revenueGrowth = lastMonthRev > 0 ? ((thisMonthRev - lastMonthRev) / lastMonthRev * 100).toFixed(2) : 0;

    res.json({
      users: {
        total: totalUsers,
        active: activeUsers,
        pending: pendingUsers,
        frozen: frozenUsers,
        new_today: newUsersToday,
        new_this_month: newUsersThisMonth,
        vip_distribution: vipDistribution.map(v => ({
          vip_level: v.vip_level,
          count: parseInt(v.count)
        }))
      },
      transactions: {
        total: totalTransactions,
        pending: pendingTransactions,
        approved: approvedTransactions,
        rejected: rejectedTransactions,
        by_type: transactionsByType.map(t => ({
          type: t.type,
          count: parseInt(t.count),
          total_NSL: parseFloat(t.total_NSL) || 0,
          total_USDT: parseFloat(t.total_USDT) || 0
        }))
      },
      revenue: {
        total: {
          total_NSL: parseFloat(totalRevenue[0]?.total_NSL) || 0,
          total_USDT: parseFloat(totalRevenue[0]?.total_USDT) || 0
        },
        this_month: {
          total_NSL: thisMonthRev,
          total_USDT: parseFloat(thisMonthRevenue[0]?.total_USDT) || 0
        },
        last_month: {
          total_NSL: lastMonthRev,
          total_USDT: parseFloat(lastMonthRevenue[0]?.total_USDT) || 0
        },
        growth_rate: `${revenueGrowth}%`
      },
      withdrawals: {
        pending: {
          count: parseInt(pendingWithdrawals[0]?.count) || 0,
          total_NSL: parseFloat(pendingWithdrawals[0]?.total_NSL) || 0,
          total_USDT: parseFloat(pendingWithdrawals[0]?.total_USDT) || 0
        }
      },
      products: {
        sales: productSales.map(p => ({
          product_name: p.product?.name || 'Unknown',
          sales_count: parseInt(p.sales_count),
          revenue: parseFloat(p.revenue) || 0
        }))
      },
      referrals: {
        total_count: totalReferrals,
        total_payouts: parseFloat(totalReferralPayouts[0]?.total) || 0
      },
      charts: {
        user_growth: userGrowth.map(u => ({
          date: u.date,
          count: parseInt(u.count)
        })),
        revenue_trend: revenueTrend.map(r => ({
          date: r.date,
          NSL: parseFloat(r.NSL) || 0,
          USDT: parseFloat(r.USDT) || 0
        }))
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
    const pendingByType = await Transaction.findAll({
      where: {
        status: 'pending'
      },
      attributes: [
        'type',
        [fn('COUNT', col('id')), 'count'],
        [fn('SUM', col('amount_NSL')), 'total_NSL'],
        [fn('SUM', col('amount_usdt')), 'total_USDT']
      ],
      group: ['type'],
      raw: true
    });

    // Today's processed transactions
    const todayProcessed = await Transaction.count({
      where: {
        status: { [Op.in]: ['approved', 'rejected'] },
        completed_at: { [Op.gte]: today }
      }
    });

    // This month's processed transactions
    const thisMonthProcessed = await Transaction.count({
      where: {
        status: { [Op.in]: ['approved', 'rejected'] },
        completed_at: { [Op.gte]: thisMonth }
      }
    });

    // Pending recharges (high priority)
    const pendingRecharges = await Transaction.findAll({
      where: {
        type: 'recharge',
        status: 'pending'
      },
      include: [{
        model: User,
        as: 'user',
        attributes: ['phone', 'username']
      }],
      order: [['timestamp', 'ASC']],
      limit: 10
    });

    // Pending withdrawals (high priority)
    const pendingWithdrawals = await Transaction.findAll({
      where: {
        type: 'withdrawal',
        status: 'pending'
      },
      include: [{
        model: User,
        as: 'user',
        attributes: ['phone', 'username', 'balance_NSL']
      }],
      order: [['timestamp', 'ASC']],
      limit: 10
    });

    // Recent activity
    const recentActivity = await Transaction.findAll({
      where: {
        status: { [Op.in]: ['approved', 'rejected'] },
        approved_by: req.user.id
      },
      include: [{
        model: User,
        as: 'user',
        attributes: ['phone', 'username']
      }],
      order: [['completed_at', 'DESC']],
      limit: 20
    });

    const formattedPendingByType = pendingByType.map(p => ({
      type: p.type,
      count: parseInt(p.count),
      total_NSL: parseFloat(p.total_NSL) || 0,
      total_USDT: parseFloat(p.total_USDT) || 0
    }));

    res.json({
      pending: {
        by_type: formattedPendingByType,
        total_count: formattedPendingByType.reduce((sum, item) => sum + item.count, 0)
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
