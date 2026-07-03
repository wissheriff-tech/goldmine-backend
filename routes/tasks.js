const express = require('express');
const { Op } = require('sequelize');
const { sequelize, User, Product, UserProduct, Transaction, UserTask } = require('../models');
const { authenticate } = require('../middleware/auth');
const { getNslPerUsdt, syncUsdtBalanceFromNsl } = require('../utils/currencyConversion');
const ps = require('../utils/platformSettings');
const logger = require('../utils/logger');

const REVIEW_ITEMS = [
  { id: 1,  name: 'Rolex Submariner',        category: 'Watch',        emoji: '⌚', description: 'Luxury diving watch, 300m waterproof, automatic movement' },
  { id: 2,  name: 'Chanel No. 5 Perfume',    category: 'Fragrance',    emoji: '🌸', description: 'Iconic floral-aldehyde scent, 100ml EDP' },
  { id: 3,  name: 'Nike Air Force 1',         category: 'Sneakers',     emoji: '👟', description: 'Classic white leather, unisex sizing, cushioned sole' },
  { id: 4,  name: 'Samsung Galaxy S25',       category: 'Phone',        emoji: '📱', description: 'Flagship Android, 6.2" AMOLED, 50MP camera' },
  { id: 5,  name: "Levi's 501 Jeans",         category: 'Clothing',     emoji: '👖', description: 'Original straight fit, dark indigo stonewash' },
  { id: 6,  name: 'Sony WH-1000XM5',         category: 'Headphones',   emoji: '🎧', description: 'Industry-leading noise cancellation, 30h battery' },
  { id: 7,  name: 'Ray-Ban Aviator',          category: 'Sunglasses',   emoji: '🕶️', description: 'Gold metal frame, green G-15 classic lens' },
  { id: 8,  name: 'Adidas Ultraboost 24',    category: 'Running Shoes', emoji: '🏃', description: 'BOOST cushioning, Primeknit+ upper, 7.5mm drop' },
  { id: 9,  name: 'Dove Deep Moisture Lotion',category: 'Beauty',       emoji: '🧴', description: 'Fragrance-free body lotion, 400ml, sensitive skin' },
  { id: 10, name: 'Polo Ralph Lauren Tee',   category: 'T-Shirt',      emoji: '👕', description: 'Classic fit pique polo, 100% cotton, navy' },
  { id: 11, name: 'Louis Vuitton Speedy 30', category: 'Handbag',      emoji: '👜', description: 'Monogram canvas, iconic city bag, gold hardware' },
  { id: 12, name: 'Casio G-Shock GA-2100',   category: 'Watch',        emoji: '⌚', description: 'Carbon core guard, solar-powered, shock-resistant' },
  { id: 13, name: 'Old Spice Swagger Spray', category: 'Body Spray',   emoji: '💨', description: 'Cedar & lime masculine scent, 150ml aerosol' },
  { id: 14, name: 'Gucci Marmont Belt',      category: 'Accessories',  emoji: '🎗️', description: 'Double G buckle, black calfskin, 3.5cm width' },
  { id: 15, name: 'MacBook Air M3',          category: 'Laptop',       emoji: '💻', description: '13-inch, 8GB unified memory, 256GB SSD, Midnight' },
  { id: 16, name: 'Versace Eros Cologne',    category: 'Fragrance',    emoji: '💙', description: 'Fresh aquatic-woody EDT, 100ml, long-lasting' },
  { id: 17, name: 'Zara Slim Fit Shirt',     category: 'Clothing',     emoji: '👔', description: 'Stretch Oxford fabric, wrinkle-resistant, white' },
  { id: 18, name: 'JBL Flip 6 Speaker',      category: 'Speaker',      emoji: '🔊', description: 'Portable waterproof BT speaker, 12h playtime' },
  { id: 19, name: 'Nike Dri-FIT T-Shirt',   category: 'Sportswear',   emoji: '🏋️', description: 'Moisture-wicking mesh fabric, reflective logo' },
  { id: 20, name: 'Apple Watch Series 10',   category: 'Smartwatch',   emoji: '⌚', description: 'Always-on retina, health sensors, 18h battery' },
  { id: 21, name: 'Hermès Twilly Scarf',     category: 'Accessories',  emoji: '🧣', description: '100% silk twill, botanical print, 85cm×5cm' },
  { id: 22, name: 'Beats Studio Pro',        category: 'Headphones',   emoji: '🎵', description: 'Personalized Spatial Audio, ANC, 40h battery' },
  { id: 23, name: 'Converse Chuck Taylor Hi',category: 'Sneakers',     emoji: '👟', description: 'Hi-top canvas, all-black monochrome, vulcanized sole' },
  { id: 24, name: 'Nivea Men Body Spray',    category: 'Body Spray',   emoji: '💨', description: 'Fresh Active 48h protection, cool ocean, 150ml' },
];

function getDailyReviews(userId, subscriptionId, sessionIndex = 0) {
  const dateStr = new Date().toISOString().split('T')[0].replace(/-/g, '');
  const seed = (userId * 31337 + subscriptionId * 7919 + parseInt(dateStr, 10) + sessionIndex * 1013) % 999983;
  const idx1 = seed % REVIEW_ITEMS.length;
  const idx2Raw = (seed * 7 + 3) % REVIEW_ITEMS.length;
  const idx2 = idx2Raw === idx1 ? (idx2Raw + 1) % REVIEW_ITEMS.length : idx2Raw;
  return [REVIEW_ITEMS[idx1], REVIEW_ITEMS[idx2]];
}

const router = express.Router();

const TASKS = [
  {
    key: 'daily_checkin',
    title: 'Daily Check-In',
    description: 'Open the app and claim your daily reward',
    type: 'daily',
    icon: 'calendar',
    settingKey: 'daily_checkin_reward_NSL',
    defaultReward: 5,
  },
];

const TASK_MAP = Object.fromEntries(TASKS.map(t => [t.key, t]));

function todayUTCStart() {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

function resolveReward(task, settings) {
  return parseFloat(settings[task.settingKey]) || task.defaultReward;
}

// GET /api/tasks
router.get('/', authenticate, async (req, res) => {
  try {
    const [claims, settings] = await Promise.all([
      UserTask.findAll({ where: { user_id: req.user.id } }),
      ps.getAll(),
    ]);
    const todayStart = todayUTCStart();

    const showCheckinReward = settings.show_checkin_reward !== '0';
    const result = TASKS.map(task => {
      const reward_NSL = resolveReward(task, settings);
      const taskClaims = claims.filter(c => c.task_key === task.key);
      const todayClaim = taskClaims.find(c => new Date(c.claimed_at) >= todayStart);
      const claimed = !!todayClaim;
      const claimed_at = todayClaim?.claimed_at || null;
      const { settingKey, defaultReward, ...taskBase } = task;
      const show_reward = task.key === 'daily_checkin' ? showCheckinReward : true;
      return { ...taskBase, reward_NSL, claimed, claimed_at, show_reward };
    });

    res.json({ success: true, tasks: result });
  } catch (error) {
    logger.error('Tasks list error:', error);
    res.status(500).json({ message: 'Error fetching tasks' });
  }
});

// POST /api/tasks/:key/claim
router.post('/:key/claim', authenticate, async (req, res) => {
  const { key } = req.params;
  const task = TASK_MAP[key];
  if (!task) return res.status(404).json({ message: 'Task not found' });

  try {
    const [settings, rate] = await Promise.all([ps.getAll(), getNslPerUsdt()]);
    const reward_NSL = resolveReward(task, settings);

    await sequelize.transaction(async (t) => {
      const user = await User.findByPk(req.user.id, { lock: true, transaction: t });
      if (!user) throw Object.assign(new Error('User not found'), { status: 404 });

      const todayStart = todayUTCStart();
      const existing = await UserTask.findOne({
        where: { user_id: user.id, task_key: key, claimed_at: { [Op.gte]: todayStart } },
        transaction: t,
      });
      if (existing) {
        throw Object.assign(new Error('Already claimed today. Come back tomorrow!'), { status: 409 });
      }

      const newBalance = parseFloat(user.balance_NSL) + reward_NSL;
      await user.update({
        balance_NSL: newBalance,
        balance_usdt: syncUsdtBalanceFromNsl(newBalance, rate),
      }, { transaction: t });

      await Transaction.create({
        user_id: user.id,
        type: 'income',
        amount_NSL: reward_NSL,
        amount_usdt: reward_NSL / rate,
        status: 'completed',
        description: `Task reward: ${task.title}`,
        reference_id: `task_${key}_${Date.now()}`,
      }, { transaction: t });

      await UserTask.create({ user_id: user.id, task_key: key }, { transaction: t });

      res.json({
        success: true,
        message: `Reward claimed!`,
        reward_NSL,
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

// GET /api/tasks/vip-tax
router.get('/vip-tax', authenticate, async (req, res) => {
  try {
    const [userProducts, settings] = await Promise.all([
      UserProduct.findAll({
        where: { user_id: req.user.id, is_active: true },
        include: [{ model: Product, as: 'product' }],
        order: [['purchase_date', 'ASC']],
      }),
      ps.getAll(),
    ]);

    const vipDailyLimit = parseInt(settings.vip_tax_daily_count) || 3;
    const now = new Date();
    const windowStart = new Date(Date.now() - 24 * 60 * 60 * 1000);

    const subscriptions = await Promise.all(userProducts.map(async (up) => {
      const taskKey = `vip_tax_${up.id}`;
      const [windowCount, lastInWindow] = await Promise.all([
        UserTask.count({
          where: { user_id: req.user.id, task_key: taskKey, claimed_at: { [Op.gte]: windowStart } },
        }),
        UserTask.findOne({
          where: { user_id: req.user.id, task_key: taskKey, claimed_at: { [Op.gte]: windowStart } },
          order: [['claimed_at', 'DESC']],
        }),
      ]);

      const isExpired = up.expires_at && now > new Date(up.expires_at);
      const canClaim = !isExpired && windowCount < vipDailyLimit;
      const nextAvailableAt = (lastInWindow && windowCount >= vipDailyLimit)
        ? new Date(new Date(lastInWindow.claimed_at).getTime() + 24 * 60 * 60 * 1000).toISOString()
        : null;

      return {
        subscription_id: up.id,
        product_id: up.product_id,
        vip_level: up.product?.name || 'Unknown',
        tax_income_NSL: parseFloat(up.product?.tax_income_NSL || 0),
        expires_at: up.expires_at,
        purchase_date: up.purchase_date,
        is_expired: isExpired,
        today_count: windowCount,
        daily_limit: vipDailyLimit,
        can_claim: canClaim,
        next_available_at: nextAvailableAt,
        review_items: getDailyReviews(req.user.id, up.id, windowCount),
      };
    }));

    res.json({ success: true, subscriptions });
  } catch (error) {
    logger.error('VIP tax fetch error:', error);
    res.status(500).json({ message: 'Error fetching VIP tax status' });
  }
});

// POST /api/tasks/vip-tax/:subscriptionId/complete
router.post('/vip-tax/:subscriptionId/complete', authenticate, async (req, res) => {
  const subscriptionId = parseInt(req.params.subscriptionId, 10);
  const { reviews } = req.body;

  if (!Number.isInteger(subscriptionId) || subscriptionId <= 0) {
    return res.status(400).json({ message: 'Invalid subscription ID' });
  }
  if (!Array.isArray(reviews) || reviews.length < 2) {
    return res.status(400).json({ message: 'Please complete all 2 product reviews' });
  }
  if (!reviews.every(r => Number.isInteger(r.item_id) && Number.isInteger(r.rating) && r.rating >= 1 && r.rating <= 5)) {
    return res.status(400).json({ message: 'Each review requires a valid item and rating between 1 and 5 stars' });
  }

  try {
    const [settings, rate] = await Promise.all([ps.getAll(), getNslPerUsdt()]);
    const vipDailyLimit = parseInt(settings.vip_tax_daily_count) || 3;
    const windowStart = new Date(Date.now() - 24 * 60 * 60 * 1000);

    let result;
    await sequelize.transaction(async (t) => {
      const up = await UserProduct.findOne({
        where: { id: subscriptionId, user_id: req.user.id, is_active: true },
        lock: true,
        transaction: t,
      });
      if (!up) throw Object.assign(new Error('Subscription not found'), { status: 404 });
      if (new Date(up.expires_at) < new Date()) {
        throw Object.assign(new Error('This VIP subscription has expired'), { status: 400 });
      }

      const product = await Product.findByPk(up.product_id, { transaction: t });
      if (!product) throw Object.assign(new Error('VIP product not found'), { status: 404 });

      const taskKey = `vip_tax_${up.id}`;
      const windowCount = await UserTask.count({
        where: { user_id: req.user.id, task_key: taskKey, claimed_at: { [Op.gte]: windowStart } },
        transaction: t,
      });

      if (windowCount >= vipDailyLimit) {
        throw Object.assign(
          new Error(`Review limit reached (${windowCount}/${vipDailyLimit}). Come back in 24 hours!`),
          { status: 409 }
        );
      }

      const expectedItems = getDailyReviews(req.user.id, up.id, windowCount);
      const expectedIds = new Set(expectedItems.map(i => i.id));
      if (!reviews.every(r => expectedIds.has(r.item_id))) {
        throw Object.assign(new Error('Invalid review items submitted'), { status: 400 });
      }

      const user = await User.findByPk(req.user.id, { lock: true, transaction: t });
      if (!user) throw Object.assign(new Error('User not found'), { status: 404 });

      const taxIncome = parseFloat(product.tax_income_NSL) || 0;
      const newBalance = parseFloat(user.balance_NSL) + taxIncome;

      await user.update({
        balance_NSL: newBalance,
        balance_usdt: syncUsdtBalanceFromNsl(newBalance, rate),
      }, { transaction: t });

      await Transaction.create({
        user_id: user.id,
        type: 'income',
        amount_NSL: taxIncome,
        amount_usdt: taxIncome / rate,
        status: 'completed',
        description: `VIP tax review: ${product.name}`,
        reference_id: `vip_tax_${up.id}_${Date.now()}`,
      }, { transaction: t });

      await UserTask.create({ user_id: user.id, task_key: taskKey }, { transaction: t });

      result = {
        reward_NSL: taxIncome,
        new_balance_NSL: newBalance,
        vip_level: product.name,
        today_count: windowCount + 1,
        daily_limit: vipDailyLimit,
      };
    });

    res.json({
      success: true,
      message: `Review complete!`,
      ...result,
    });
  } catch (error) {
    if (error.status) {
      return res.status(error.status).json({ message: error.message });
    }
    logger.error('VIP tax complete error:', error);
    res.status(500).json({ message: 'Error completing VIP tax' });
  }
});

module.exports = router;
