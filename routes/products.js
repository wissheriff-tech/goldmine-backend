const express = require('express');
const { User, Product, UserProduct, Transaction, Referral, sequelize } = require('../models');
const { authenticate, authorize } = require('../middleware/auth');
const logger = require('../utils/logger');
const emailService = require('../utils/emailService');
const notificationService = require('../utils/notificationService');
const ps = require('../utils/platformSettings');

// Validation Middleware
const {
  validateBuyProduct,
  validateCreateProduct,
  validateUpdateProduct
} = require('../middleware/validation');

// Security Middleware
const {
  transactionLimiter,
  adminLimiter
} = require('../middleware/security');

const router = express.Router();

// Get all products
router.get('/', async (req, res) => {
  try {
    const products = await Product.findAll({ where: { active: true } });
    res.json(products);
  } catch (error) {
    logger.error('Products fetch error:', error);
    res.status(500).json({ message: 'Error fetching products', error: error.message });
  }
});

// Public: get duration options + platform info for landing page
router.get('/durations', async (req, res) => {
  try {
    const s = await ps.getAll();
    res.json({
      options: [
        { key: 'short', label: `${s.dur_short} Days`,  days: s.dur_short  },
        { key: 'week',  label: '1 Week',                days: s.dur_week   },
        { key: 'month', label: '1 Month',               days: s.dur_month  },
        { key: 'promo', label: s.dur_promo_label,       days: s.dur_promo  },
      ],
      referral: {
        l1_pct: s.referral_l1_pct,
        l2_pct: s.referral_l2_pct,
        l3_pct: s.referral_l3_pct,
      },
      fees: {
        recharge_fee_pct:   s.recharge_fee_pct,
        withdrawal_fee_pct: s.withdrawal_fee_pct,
      },
    });
  } catch (err) {
    res.status(500).json({ message: 'Error fetching durations', error: err.message });
  }
});

// 3-level referral commission on every product purchase (fire-and-forget)
async function payPurchaseReferrals(buyer, investedNSL) {
  const s = await ps.getAll();
  const pcts = [s.referral_l1_pct, s.referral_l2_pct, s.referral_l3_pct];
  let currentCode = buyer.referred_by;
  for (let level = 0; level < pcts.length; level++) {
    if (!currentCode) break;
    const referrer = await User.findOne({ where: { referral_code: currentCode } });
    if (!referrer) break;
    const commission = parseFloat((investedNSL * pcts[level] / 100).toFixed(4));
    if (commission > 0) {
      await sequelize.transaction(async (t) => {
        referrer.balance_NSL = parseFloat(referrer.balance_NSL) + commission;
        await referrer.save({ transaction: t });
        await Transaction.create({
          user_id: referrer.id, type: 'referral_bonus',
          amount_NSL: commission, amount_usdt: 0, status: 'approved',
          payment_method: 'manual',
          notes: `L${level + 1} referral commission (${pcts[level]}%) from ${buyer.phone || buyer.id} purchase of ${investedNSL} NSL`,
          approved_at: new Date(),
        }, { transaction: t });
      });
      notificationService.notifyReferralBonus(referrer.id, commission, buyer.username || buyer.phone).catch(() => {});
      logger.info(`Referral L${level + 1}: +${commission} NSL → user #${referrer.id} (${pcts[level]}% of ${investedNSL})`);
    }
    currentCode = referrer.referred_by;
  }
}

// Buy product
router.post('/buy', authenticate, transactionLimiter, validateBuyProduct, async (req, res) => {
  try {
    const { product_id, duration_key } = req.body;

    // Load platform duration settings
    const s = await ps.getAll();
    const durationMap = {
      short: s.dur_short,
      week:  s.dur_week,
      month: s.dur_month,
      promo: s.dur_promo,
    };

    const product = await Product.findByPk(product_id);
    if (!product) return res.status(404).json({ message: 'Product not found' });
    if (!product.active) return res.status(400).json({ message: 'Product is not available' });

    // Use user-selected duration, fall back to product default
    const validDuration = duration_key && durationMap[duration_key];
    const chosenDays = validDuration ? durationMap[duration_key] : product.validity_days;

    let purchaseResult;

    await sequelize.transaction(async (t) => {
      const user = await User.findOne({ where: { id: req.user.id }, lock: t.LOCK.UPDATE, transaction: t });
      if (!user) throw Object.assign(new Error('User not found'), { status: 404 });
      if (user.balance_NSL < product.price_NSL) throw Object.assign(new Error('Insufficient balance'), { status: 400 });

      const existingProduct = await UserProduct.findOne({
        where: { user_id: user.id, product_id, is_active: true }, transaction: t,
      });
      if (existingProduct) throw Object.assign(new Error('You already own this product. Wait for it to expire before repurchasing.'), { status: 400, expires_at: existingProduct.expires_at });

      const purchaseDate = new Date();
      const expiresAt = new Date(purchaseDate.getTime() + chosenDays * 24 * 60 * 60 * 1000);
      user.balance_NSL -= product.price_NSL;

      await UserProduct.create({
        user_id: user.id, product_id: product.id,
        purchase_date: purchaseDate, expires_at: expiresAt,
        auto_renew: true, is_active: true,
      }, { transaction: t });

      const activeUserProducts = await UserProduct.findAll({
        where: { user_id: user.id, is_active: true },
        include: [{ model: Product, as: 'product', attributes: ['name'] }],
        transaction: t,
      });
      const vipLevels = ['VIP1','VIP2','VIP3','VIP4','VIP5','VIP6','VIP7','VIP8','VIP9'];
      let highestVip = 'none';
      for (const up of activeUserProducts) {
        if (up.product && vipLevels.indexOf(up.product.name) > vipLevels.indexOf(highestVip)) highestVip = up.product.name;
      }
      user.vip_level = highestVip;
      await user.save({ transaction: t });

      await Transaction.create({
        user_id: user.id, type: 'purchase', amount_NSL: product.price_NSL, amount_usdt: product.price_usdt,
        product_id: product.id, status: 'approved',
        notes: `Purchased ${product.name} (${chosenDays} days) — expires ${expiresAt.toLocaleDateString()}`,
      }, { transaction: t });

      purchaseResult = { user, product, purchaseDate, expiresAt, chosenDays };
    });

    // 3-level referral commission on every purchase (fire-and-forget)
    if (purchaseResult.user.referred_by) {
      payPurchaseReferrals(purchaseResult.user, product.price_NSL).catch(e =>
        logger.error('Purchase referral commission error:', e)
      );
    }

    logger.info(`Product purchased: ${purchaseResult.user.phone} - ${purchaseResult.product.name} (${chosenDays} days, expires: ${purchaseResult.expiresAt.toISOString()})`);
    notificationService.notifyProductPurchased(purchaseResult.user.id, purchaseResult.product.name, purchaseResult.expiresAt).catch(() => {});

    res.status(201).json({
      message: 'Product purchased successfully',
      user: { balance_NSL: purchaseResult.user.balance_NSL, balance_usdt: purchaseResult.user.balance_usdt, vip_level: purchaseResult.user.vip_level },
      product: { name: purchaseResult.product.name, daily_income_NSL: purchaseResult.product.daily_income_NSL, validity_days: chosenDays, purchase_date: purchaseResult.purchaseDate, expires_at: purchaseResult.expiresAt, auto_renew: true },
    });
  } catch (error) {
    if (error.status) return res.status(error.status).json({ message: error.message, ...(error.expires_at && { expires_at: error.expires_at }) });
    logger.error('Product purchase error:', error);
    res.status(500).json({ message: 'Error purchasing product', error: error.message });
  }
});

// Admin: Create product
// Added adminLimiter
router.post('/', authenticate, authorize(['superadmin', 'admin']), adminLimiter, validateCreateProduct, async (req, res) => {
  try {
    const { name, price_NSL, daily_income_NSL, validity_days, description, benefits } = req.body;
    const NSL_RATE = parseFloat(process.env.NSL_TO_USDT_RECHARGE || 23);
    const price_usdt = req.body.price_usdt != null
      ? parseFloat(req.body.price_usdt)
      : parseFloat((price_NSL / NSL_RATE).toFixed(2));

    const productExists = await Product.findOne({ where: { name } });
    if (productExists) {
      return res.status(400).json({ message: 'Product already exists' });
    }

    const product = await Product.create({
      name,
      price_NSL,
      price_usdt,
      daily_income_NSL,
      validity_days: validity_days || 60,
      description,
      benefits: benefits || [],
      active: true
    });

    logger.info(`Product created: ${name}`);

    res.status(201).json({
      message: 'Product created successfully',
      product
    });
  } catch (error) {
    logger.error('Product creation error:', error);
    res.status(500).json({ message: 'Error creating product', error: error.message });
  }
});

// Admin: Update product
// Added adminLimiter
router.patch('/:id', authenticate, authorize(['superadmin', 'admin']), adminLimiter, validateUpdateProduct, async (req, res) => {
  try {
    const { price_NSL, daily_income_NSL, validity_days, active, description, benefits } = req.body;
    const NSL_RATE = parseFloat(process.env.NSL_TO_USDT_RECHARGE || 23);
    const price_usdt = req.body.price_usdt != null
      ? parseFloat(req.body.price_usdt)
      : (price_NSL != null ? parseFloat((price_NSL / NSL_RATE).toFixed(2)) : undefined);

    const updates = {};
    if (price_NSL       !== undefined) updates.price_NSL       = price_NSL;
    if (price_usdt      !== undefined) updates.price_usdt      = price_usdt;
    if (daily_income_NSL !== undefined) updates.daily_income_NSL = daily_income_NSL;
    if (validity_days   !== undefined) updates.validity_days   = validity_days;
    if (active          !== undefined) updates.active          = active;
    if (description     !== undefined) updates.description     = description;
    if (benefits        !== undefined) updates.benefits        = benefits;

    await Product.update(updates, { where: { id: req.params.id } });

    const product = await Product.findByPk(req.params.id);

    if (!product) {
      return res.status(404).json({ message: 'Product not found' });
    }

    logger.info(`Product updated: ${product.name}`);
    res.json({ message: 'Product updated', product });
  } catch (error) {
    logger.error('Product update error:', error);
    res.status(500).json({ message: 'Error updating product', error: error.message });
  }
});

module.exports = router;
