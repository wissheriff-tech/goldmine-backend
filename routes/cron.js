const express = require('express');
const { Op } = require('sequelize');
const { User, UserProduct, Product, Transaction, Session, Notification, sequelize } = require('../models');
const { authenticate, authorize } = require('../middleware/auth');
const logger = require('../utils/logger');
const emailService = require('../utils/emailService');
const notificationService = require('../utils/notificationService');

const router = express.Router();
const NSL_RATE = parseFloat(process.env.NSL_TO_USDT_RECHARGE || 23);

// ── Auth ──────────────────────────────────────────────────────────────────
// Vercel injects Authorization: Bearer <CRON_SECRET> on every cron invocation
function cronAuth(req, res, next) {
  const secret = process.env.CRON_SECRET;
  if (!secret && process.env.NODE_ENV !== 'production') return next(); // local dev, no secret required
  if (secret && req.headers.authorization === `Bearer ${secret}`) return next();
  return res.status(401).json({ message: 'Unauthorized' });
}

// ── Helpers ───────────────────────────────────────────────────────────────
async function recalcVipLevel(userId, t) {
  const vipOrder = ['VIP0','VIP1','VIP2','VIP3','VIP4','VIP5','VIP6','VIP7','VIP8','VIP9'];
  const active = await UserProduct.findAll({
    where: { user_id: userId, is_active: true },
    include: [{ model: Product, as: 'product', attributes: ['name'] }],
    transaction: t,
  });
  let highest = 'none';
  for (const up of active) {
    const name = up.product?.name;
    if (name && vipOrder.indexOf(name) > vipOrder.indexOf(highest)) highest = name;
  }
  await User.update({ vip_level: highest }, { where: { id: userId }, transaction: t });
  return highest;
}

// ── Job: Daily Income ─────────────────────────────────────────────────────
async function runDailyIncome() {
  const now = new Date();
  const todayStart = new Date(now); todayStart.setHours(0, 0, 0, 0);
  const todayEnd   = new Date(todayStart.getTime() + 24 * 60 * 60 * 1000);

  const userProducts = await UserProduct.findAll({
    where: { is_active: true, expires_at: { [Op.gt]: now } },
    include: [
      { model: Product, as: 'product', where: { active: true }, attributes: ['id', 'name', 'daily_income_NSL'] },
      { model: User,    as: 'user',    where: { status: 'active' }, attributes: ['id', 'username', 'phone', 'email', 'balance_NSL'] },
    ],
  });

  // Idempotency: skip (user_id, product_id) pairs already credited today
  const alreadyDone = await Transaction.findAll({
    where: { type: 'income', created_at: { [Op.gte]: todayStart, [Op.lt]: todayEnd } },
    attributes: ['user_id', 'product_id'],
    raw: true,
  });
  const doneSet = new Set(alreadyDone.map(r => `${r.user_id}:${r.product_id}`));

  // Group by user
  const byUser = {};
  for (const up of userProducts) {
    const key = `${up.user_id}:${up.product_id}`;
    if (doneSet.has(key)) continue;
    const income = parseFloat(up.product.daily_income_NSL);
    if (income <= 0) continue;
    if (!byUser[up.user_id]) byUser[up.user_id] = { user: up.user, total: 0, txs: [] };
    byUser[up.user_id].total += income;
    byUser[up.user_id].txs.push({
      user_id: up.user_id,
      type: 'income',
      amount_NSL: income,
      amount_usdt: parseFloat((income / NSL_RATE).toFixed(4)),
      product_id: up.product_id,
      status: 'approved',
      notes: `Daily income from ${up.product.name}`,
    });
  }

  let totalUsers = 0, totalNSL = 0;

  for (const data of Object.values(byUser)) {
    if (data.total <= 0) continue;
    await sequelize.transaction(
      { isolationLevel: sequelize.constructor.Transaction.ISOLATION_LEVELS.SERIALIZABLE },
      async (t) => {
        const user = await User.findOne({ where: { id: data.user.id }, lock: t.LOCK.UPDATE, transaction: t });
        user.balance_NSL = parseFloat(user.balance_NSL) + data.total;
        await user.save({ transaction: t });
        await Transaction.bulkCreate(data.txs, { transaction: t });
      }
    );
    totalUsers++;
    totalNSL += data.total;
    logger.info(`Daily income: user ${data.user.phone} +${data.total} NSL`);
    if (data.user.email) {
      emailService.sendDailyIncomeSummary(data.user.email, data.user.username, data.total, parseFloat(data.user.balance_NSL) + data.total)
        .catch(e => logger.error(`Income email error: ${e.message}`));
    }
  }

  return { users_processed: totalUsers, total_NSL: totalNSL, skipped: doneSet.size };
}

// ── Job: Auto-Renewal ─────────────────────────────────────────────────────
async function runAutoRenewal() {
  const now = new Date();

  const expired = await UserProduct.findAll({
    where: { is_active: true, expires_at: { [Op.lte]: now } },
    include: [
      { model: Product, as: 'product' },
      { model: User,    as: 'user', where: { status: 'active' } },
    ],
  });

  let renewed = 0, deactivated = 0;

  for (const up of expired) {
    const { product, user } = up;
    const canAfford = up.auto_renew && parseFloat(user.balance_NSL) >= parseFloat(product.price_NSL);

    if (canAfford) {
      await sequelize.transaction(
        { isolationLevel: sequelize.constructor.Transaction.ISOLATION_LEVELS.SERIALIZABLE },
        async (t) => {
          const locked = await User.findOne({ where: { id: user.id }, lock: t.LOCK.UPDATE, transaction: t });
          if (parseFloat(locked.balance_NSL) < parseFloat(product.price_NSL)) {
            // race: insufficient by the time we locked — deactivate
            up.is_active = false;
            await up.save({ transaction: t });
            await recalcVipLevel(user.id, t);
            deactivated++;
            return;
          }
          locked.balance_NSL = parseFloat(locked.balance_NSL) - parseFloat(product.price_NSL);
          await locked.save({ transaction: t });
          const newExpiry = new Date(now.getTime() + product.validity_days * 24 * 60 * 60 * 1000);
          up.expires_at = newExpiry;
          await up.save({ transaction: t });
          await Transaction.create({
            user_id: user.id,
            type: 'renewal',
            amount_NSL: product.price_NSL,
            amount_usdt: product.price_usdt,
            product_id: product.id,
            status: 'approved',
            notes: `Auto-renewal of ${product.name} — valid until ${newExpiry.toLocaleDateString()}`,
          }, { transaction: t });
        }
      );
      logger.info(`Auto-renewed ${product.name} for ${user.phone}`);
      renewed++;
    } else {
      await sequelize.transaction(async (t) => {
        up.is_active = false;
        await up.save({ transaction: t });
        await recalcVipLevel(user.id, t);
      });
      logger.warn(`Deactivated ${product.name} for ${user.phone} — ${up.auto_renew ? 'insufficient balance' : 'auto_renew off'}`);
      deactivated++;
      if (user.email) {
        emailService.sendProductExpiring(user.email, user.username, product.name, up.expires_at, user.balance_NSL, product.price_NSL)
          .catch(e => logger.error(`Expiry email error: ${e.message}`));
      }
      notificationService.notifyProductExpiring(user.id, product.name, 0).catch(() => {});
    }
  }

  return { renewed, deactivated };
}

// ── Job: Cleanup ──────────────────────────────────────────────────────────
async function runCleanup() {
  const now = new Date();
  const sessions      = await Session.destroy({ where: { expires_at: { [Op.lt]: now } } });
  const notifications = await Notification.destroy({ where: { expires_at: { [Op.lt]: now } } });
  return { sessions_deleted: sessions, notifications_deleted: notifications };
}

// ── Vercel Cron Endpoints ─────────────────────────────────────────────────
router.get('/daily-income', cronAuth, async (req, res) => {
  logger.info('Cron: daily-income triggered');
  try {
    const result = await runDailyIncome();
    logger.info(`Cron: daily-income done — ${result.users_processed} users, ${result.total_NSL} NSL`);
    res.json({ success: true, ...result });
  } catch (err) {
    logger.error('Cron: daily-income error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
});

router.get('/auto-renewal', cronAuth, async (req, res) => {
  logger.info('Cron: auto-renewal triggered');
  try {
    const result = await runAutoRenewal();
    logger.info(`Cron: auto-renewal done — ${result.renewed} renewed, ${result.deactivated} deactivated`);
    res.json({ success: true, ...result });
  } catch (err) {
    logger.error('Cron: auto-renewal error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
});

router.get('/cleanup', cronAuth, async (req, res) => {
  logger.info('Cron: cleanup triggered');
  try {
    const result = await runCleanup();
    logger.info(`Cron: cleanup done — ${result.sessions_deleted} sessions, ${result.notifications_deleted} notifications`);
    res.json({ success: true, ...result });
  } catch (err) {
    logger.error('Cron: cleanup error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// ── POST /api/cron/trigger — admin manual trigger ─────────────────────────
router.post('/trigger', authenticate, authorize(['superadmin', 'admin']), async (req, res) => {
  const { job } = req.body;
  const jobs = { 'daily-income': runDailyIncome, 'auto-renewal': runAutoRenewal, 'cleanup': runCleanup };
  if (!jobs[job]) {
    return res.status(400).json({ message: 'job must be one of: daily-income, auto-renewal, cleanup' });
  }
  logger.info(`Manual cron trigger: ${job} by admin ${req.user.id}`);
  try {
    const result = await jobs[job]();
    res.json({ success: true, job, result });
  } catch (err) {
    logger.error(`Manual cron trigger error (${job}):`, err);
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;
