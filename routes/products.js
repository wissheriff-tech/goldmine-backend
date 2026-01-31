const express = require('express');
const { User, Product, UserProduct, Transaction, Referral } = require('../models');
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
    const user = await User.findByPk(req.user.id);
    const product = await Product.findByPk(product_id);

    if (!user || !product) {
      return res.status(404).json({ message: 'User or product not found' });
    }

    // Check if product is active
    if (!product.active) {
      return res.status(400).json({ message: 'Product is not available' });
    }

    // Check if user has sufficient balance
    if (user.balance_NSL < product.price_NSL) {
      return res.status(400).json({ message: 'Insufficient balance' });
    }

    // Check if user already owns this product and it's still active
    const existingProduct = await UserProduct.findOne({
      where: {
        user_id: req.user.id,
        product_id: product_id,
        is_active: true
      }
    });

    if (existingProduct) {
      return res.status(400).json({
        message: 'You already own this product. Wait for it to expire before repurchasing.',
        expires_at: existingProduct.expires_at
      });
    }

    // Calculate expiration date (60 days from now)
    const purchaseDate = new Date();
    const expiresAt = new Date(purchaseDate.getTime() + (product.validity_days * 24 * 60 * 60 * 1000));

    // Deduct balance
    user.balance_NSL -= product.price_NSL;

    // Add product to UserProduct table
    await UserProduct.create({
      user_id: user.id,
      product_id: product.id,
      purchase_date: purchaseDate,
      expires_at: expiresAt,
      auto_renew: true,
      is_active: true
    });

    // Update VIP level to highest owned product
    const activeUserProducts = await UserProduct.findAll({
      where: { user_id: user.id, is_active: true },
      include: [{ model: Product, as: 'product', attributes: ['name'] }]
    });

    const vipLevels = ['VIP1', 'VIP2', 'VIP3', 'VIP4', 'VIP5', 'VIP6', 'VIP7', 'VIP8', 'VIP9'];
    let highestVip = 'none';

    for (const userProduct of activeUserProducts) {
      const prod = userProduct.product;
      if (prod) {
        const prodName = prod.name;
        if (vipLevels.indexOf(prodName) > vipLevels.indexOf(highestVip)) {
          highestVip = prodName;
        }
      }
    }

    user.vip_level = highestVip;
    await user.save();

    // Create transaction with product reference
    const transaction = await Transaction.create({
      user_id: user.id,
      type: 'purchase',
      amount_NSL: product.price_NSL,
      amount_usdt: product.price_usdt,
      product_id: product.id,
      status: 'approved',
      notes: `Purchased ${product.name} - Valid until ${expiresAt.toLocaleDateString()}`
    });

    // Handle referral bonus (ONLY on first purchase)
    if (user.referred_by) {
      const referrer = await User.findOne({ where: { referral_code: user.referred_by } });

      if (referrer) {
        // Check if referral bonus has already been paid for this user
        const existingBonus = await Referral.findOne({
          where: {
            referrer_id: referrer.id,
            referred_id: user.id,
            status: 'paid'
          }
        });

        // Only pay bonus if this is the first purchase (no existing bonus paid)
        if (!existingBonus) {
          const bonusPercentage = parseInt(process.env.REFERRAL_BONUS_PERCENTAGE || 35);
          const bonusAmount = (product.price_NSL * bonusPercentage) / 100;

          referrer.balance_NSL += bonusAmount;
          await referrer.save();

          const referral = await Referral.create({
            referrer_id: referrer.id,
            referred_id: user.id,
            bonus_NSL: bonusAmount,
            recharge_amount_NSL: product.price_NSL,
            bonus_percentage: bonusPercentage,
            status: 'paid'
          });

          logger.info(`Referral bonus: ${referrer.phone} earned ${bonusAmount} NSL from ${user.phone}'s first purchase`);

          // Send email notification to referrer
          if (referrer.email) {
            await emailService.sendNewReferral(
              referrer.email,
              referrer.username,
              user.username,
              bonusAmount
            );
          }

          // Send in-app notification to referrer
          try {
            await notificationService.notifyReferralBonus(
              referrer.id,
              bonusAmount,
              user.username
            );
          } catch (notifError) {
            logger.error('Referral notification error:', notifError);
          }
        } else {
          logger.info(`Referral bonus already paid for ${user.phone} - skipping`);
        }
      }
    }

    logger.info(`Product purchased: ${user.phone} - ${product.name} (expires: ${expiresAt.toISOString()})`);

    // Send in-app notification to buyer
    try {
      await notificationService.notifyProductPurchased(
        user.id,
        product.name,
        expiresAt
      );
    } catch (notifError) {
      logger.error('Product purchase notification error:', notifError);
    }

    res.status(201).json({
      message: 'Product purchased successfully',
      user: {
        balance_NSL: user.balance_NSL,
        balance_usdt: user.balance_usdt,
        vip_level: user.vip_level
      },
      product: {
        name: product.name,
        daily_income_NSL: product.daily_income_NSL,
        purchase_date: purchaseDate,
        expires_at: expiresAt,
        auto_renew: true
      }
    });
  } catch (error) {
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
