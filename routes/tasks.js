const express = require('express');
const { Op } = require('sequelize');
const { sequelize, User, Transaction, UserTask } = require('../models');
const { authenticate } = require('../middleware/auth');
const { getNslPerUsdt, syncUsdtBalanceFromNsl } = require('../utils/currencyConversion');
const logger = require('../utils/logger');

const router = express.Router();

// Task catalogue — hardcoded definitions
const TASKS = [
  {
    key: 'daily_checkin',
    title: 'Daily Check-In',
    description: 'Open the app and claim your daily reward',
    reward_NSL: 5,
    type: 'daily',
    icon: 'calendar',
  },
  {
    key: 'view_products',
    title: 'Explore VIP Plans',
    description: 'Browse the VIP investment plans and discover your next level',
    reward_NSL: 10,
    type: 'daily',
    icon: 'star',
    action_url: '/products',
  },
  {
    key: 'complete_kyc',
    title: 'Verify Your Identity',
    description: 'Complete KYC verification to unlock full account features',
    reward_NSL: 50,
    type: 'one_time',
    icon: 'shield',
    action_url: '/account/kyc',
  },
  {
    key: 'first_deposit',
    title: 'Make Your First Deposit',
    description: 'Top up your wallet to start earning on your investments',
    reward_NSL: 100,
    type: 'one_time',
    icon: 'wallet',
    action_url: '/deposit',
  },
];

const TASK_MAP = Object.fromEntries(TASKS.map(t => [t.key, t]));

function todayUTCStart() {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

// GET /api/tasks — list all tasks with user's claim status
router.get('/', authenticate, async (req, res) => {
  try {
    const claims = await UserTask.findAll({ where: { user_id: req.user.id } });
    const todayStart = todayUTCStart();

    const result = TASKS.map(task => {
      const taskClaims = claims.filter(c => c.task_key === task.key);
      let claimed = false;
      let claimed_at = null;

      if (task.type === 'daily') {
        const todayClaim = taskClaims.find(c => new Date(c.claimed_at) >= todayStart);
        claimed = !!todayClaim;
        claimed_at = todayClaim?.claimed_at || null;
      } else {
        claimed = taskClaims.length > 0;
        claimed_at = taskClaims[0]?.claimed_at || null;
      }

      return { ...task, claimed, claimed_at };
    });

    res.json({ success: true, tasks: result });
  } catch (error) {
    logger.error('Tasks list error:', error);
    res.status(500).json({ message: 'Error fetching tasks' });
  }
});

// POST /api/tasks/:key/claim — claim a task reward
router.post('/:key/claim', authenticate, async (req, res) => {
  const { key } = req.params;
  const task = TASK_MAP[key];
  if (!task) return res.status(404).json({ message: 'Task not found' });

  try {
    await sequelize.transaction(async (t) => {
      const user = await User.findByPk(req.user.id, { lock: true, transaction: t });
      if (!user) throw Object.assign(new Error('User not found'), { status: 404 });

      // Check if already claimed
      const todayStart = todayUTCStart();
      const whereClause = task.type === 'daily'
        ? { user_id: user.id, task_key: key, claimed_at: { [Op.gte]: todayStart } }
        : { user_id: user.id, task_key: key };

      const existing = await UserTask.findOne({ where: whereClause, transaction: t });
      if (existing) {
        throw Object.assign(
          new Error(task.type === 'daily' ? 'Already claimed today. Come back tomorrow!' : 'Already claimed'),
          { status: 409 }
        );
      }

      // Check prerequisites
      if (key === 'complete_kyc' && !user.kyc_verified) {
        throw Object.assign(new Error('Complete your identity verification first'), { status: 400 });
      }

      if (key === 'first_deposit') {
        const deposit = await Transaction.findOne({
          where: { user_id: user.id, type: 'recharge', status: 'approved' },
          transaction: t,
        });
        if (!deposit) throw Object.assign(new Error('Make your first deposit before claiming this reward'), { status: 400 });
      }

      // Credit balance
      const rate = await getNslPerUsdt();
      const newBalance = parseFloat(user.balance_NSL) + task.reward_NSL;
      await user.update({
        balance_NSL: newBalance,
        balance_usdt: syncUsdtBalanceFromNsl(newBalance, rate),
      }, { transaction: t });

      // Record transaction
      await Transaction.create({
        user_id: user.id,
        type: 'income',
        amount_NSL: task.reward_NSL,
        amount_usdt: task.reward_NSL / rate,
        status: 'completed',
        description: `Task reward: ${task.title}`,
        reference_id: `task_${key}_${Date.now()}`,
      }, { transaction: t });

      // Record claim
      await UserTask.create({ user_id: user.id, task_key: key }, { transaction: t });

      res.json({
        success: true,
        message: `+${task.reward_NSL} NSL claimed!`,
        reward_NSL: task.reward_NSL,
        new_balance_NSL: newBalance,
      });
    });
  } catch (error) {
    if (error.status) {
      return res.status(error.status).json({ message: error.message });
    }
    logger.error(`Task claim error [${key}]:`, error);
    res.status(500).json({ message: 'Error claiming task reward' });
  }
});

module.exports = router;
