const express = require('express');
const { User, Product, UserProduct, Transaction, Referral, sequelize } = require('../models');
const { authenticate, authorize } = require('../middleware/auth');
const logger = require('../utils/logger');
const emailService = require('../utils/emailService');
const notificationService = require('../utils/notificationService');

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

// Buy product
// Added transactionLimiter to prevent purchase spamming
router.post('/buy', authenticate, transactionLimiter, validateBuyProduct, async (req, res) => {
  try {
    const { product_id } = req.body;

    // Validate product exists and is active before entering the transaction
    const product = await Product.findByPk(product_id);
    if (!product) return res.status(404).json({ message: 'Product not found' });
    if (!product.active) return res.status(400).json({ message: 'Product is not available' });

    let purchaseResult;

    await sequelize.transaction(async (t) => {
      const user = await User.findOne({
        where: { id: req.user.id },
        lock: t.LOCK.UPDATE,
        transaction: t,
      });

      if (!user) throw Object.assign(new Error('User not found'), { status: 404 });
      if (user.balance_NSL < product.price_NSL) throw Object.assign(new Error('Insufficient balance'), { status: 400 });

      const existingProduct = await UserProduct.findOne({
        where: { user_id: user.id, product_id, is_active: true },
        transaction: t,
      });

      if (existingProduct) throw Object.assign(new Error('You already own this product. Wait for it to expire before repurchasing.'), { status: 400, expires_at: existingProduct.expires_at });

      const purchaseDate = new Date();
      const expiresAt = new Date(purchaseDate.getTime() + (product.validity_days * 24 * 60 * 60 * 1000));

      user.balance_NSL -= product.price_NSL;

      await UserProduct.create({ user_id: user.id, product_id: product.id, purchase_date: purchaseDate, expires_at: expiresAt, auto_renew: true, is_active: true }, { transaction: t });

      const activeUserProducts = await UserProduct.findAll({
        where: { user_id: user.id, is_active: true },
        include: [{ model: Product, as: 'product', attributes: ['name'] }],
        transaction: t,
      });

      const vipLevels = ['VIP1', 'VIP2', 'VIP3', 'VIP4', 'VIP5', 'VIP6', 'VIP7', 'VIP8', 'VIP9'];
      let highestVip = 'none';
      for (const up of activeUserProducts) {
        if (up.product && vipLevels.indexOf(up.product.name) > vipLevels.indexOf(highestVip)) highestVip = up.product.name;
      }
      user.vip_level = highestVip;
      await user.save({ transaction: t });

      await Transaction.create({ user_id: user.id, type: 'purchase', amount_NSL: product.price_NSL, amount_usdt: product.price_usdt, product_id: product.id, status: 'approved', notes: `Purchased ${product.name} - Valid until ${expiresAt.toLocaleDateString()}` }, { transaction: t });

      // Referral bonus — only on first purchase
      if (user.referred_by) {
        const referrer = await User.findOne({ where: { referral_code: user.referred_by }, lock: t.LOCK.UPDATE, transaction: t });
        if (referrer) {
          const existingBonus = await Referral.findOne({ where: { referrer_id: referrer.id, referred_id: user.id, status: 'paid' }, transaction: t });
          if (!existingBonus) {
            const bonusPercentage = parseInt(process.env.REFERRAL_BONUS_PERCENTAGE || 35);
            const bonusAmount = (product.price_NSL * bonusPercentage) / 100;
            referrer.balance_NSL += bonusAmount;
            await referrer.save({ transaction: t });
            await Referral.create({ referrer_id: referrer.id, referred_id: user.id, bonus_NSL: bonusAmount, recharge_amount_NSL: product.price_NSL, bonus_percentage: bonusPercentage, status: 'paid' }, { transaction: t });
            logger.info(`Referral bonus: ${referrer.phone} earned ${bonusAmount} NSL from ${user.phone}'s first purchase`);
            if (referrer.email) emailService.sendNewReferral(referrer.email, referrer.username, user.username, bonusAmount).catch(() => {});
            notificationService.notifyReferralBonus(referrer.id, bonusAmount, user.username).catch(() => {});
          }
        }
      }

      purchaseResult = { user, product, purchaseDate, expiresAt };
    });

    logger.info(`Product purchased: ${purchaseResult.user.phone} - ${purchaseResult.product.name} (expires: ${purchaseResult.expiresAt.toISOString()})`);
    notificationService.notifyProductPurchased(purchaseResult.user.id, purchaseResult.product.name, purchaseResult.expiresAt).catch(() => {});

    res.status(201).json({
      message: 'Product purchased successfully',
      user: { balance_NSL: purchaseResult.user.balance_NSL, balance_usdt: purchaseResult.user.balance_usdt, vip_level: purchaseResult.user.vip_level },
      product: { name: purchaseResult.product.name, daily_income_NSL: purchaseResult.product.daily_income_NSL, purchase_date: purchaseResult.purchaseDate, expires_at: purchaseResult.expiresAt, auto_renew: true }
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
    const { name, price_NSL, price_usdt, daily_income_NSL, validity_days, description, benefits } = req.body;

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
    const { price_NSL, price_usdt, daily_income_NSL, active, description, benefits } = req.body;

    await Product.update(
      { price_NSL, price_usdt, daily_income_NSL, active, description, benefits },
      { where: { id: req.params.id } }
    );

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
