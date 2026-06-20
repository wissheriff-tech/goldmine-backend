const express = require('express');
const { User, Product, UserProduct, Transaction, DepositProof, PaymentSetting, sequelize } = require('../models');
const { Op } = require('sequelize');
const bcrypt = require('bcryptjs');
const { authenticate, authorize } = require('../middleware/auth');
const logger = require('../utils/logger');
const emailService = require('../utils/emailService');
const ps = require('../utils/platformSettings');
const notificationService = require('../utils/notificationService');
const {
  buildConversion,
  getNslPerUsdt,
  nslToUsdt,
  syncUsdtBalanceFromNsl
} = require('../utils/currencyConversion');
const { syncUserUsdtBalances } = require('../utils/balanceSync');
const { refreshExchangeRate } = require('../utils/exchangeRateProvider');
const { recordAdminAudit } = require('../utils/adminAudit');

// Validation and Security Middleware
const {
  validateCreateUser,
  validateUpdateBalance,
  validateUpdateRole,
  validateUpdateStatus,
  validateUpdateVIP,
  validateAdminResetPassword
} = require('../middleware/validation');

// --- MODIFIED: Added resetLimitsForIP to imports ---
const { adminLimiter, resetLimitsForIP } = require('../middleware/security');

const router = express.Router();

const priceUsdtForNsl = (priceNSL, rate) => nslToUsdt(priceNSL, rate);
const productWithRate = (product, rate) => {
  const data = product.toJSON ? product.toJSON() : { ...product };
  data.price_usdt = parseFloat(priceUsdtForNsl(data.price_NSL, rate));
  data.exchange_rate_nsl_per_usdt = rate;
  return data;
};
const isStrongPassword = (value) => /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]{8,}$/.test(String(value || ''));
const normalizePhoneInput = (value) => String(value || '').trim().replace(/[\s\-().]/g, '');
const isValidPhoneInput = (value) => /^\+?[1-9]\d{6,14}$/.test(normalizePhoneInput(value));

const sendAccountNotification = async (description, task) => {
  try {
    await task();
  } catch (error) {
    logger.error(`${description} notification error:`, error);
  }
};

// Admin: Get all users
router.get('/users', authenticate, authorize(['superadmin']), async (req, res) => {
  try {
    const { status, role, limit = 20, skip = 0 } = req.query;
    const filter = {};

    if (status) filter.status = status;
    if (role) filter.role = role;

    // HIGH FIX: cap pagination limit to prevent unbounded result sets
    const MAX_PAGE_SIZE = 100;
    const parsedLimit = Math.min(Math.max(1, parseInt(limit) || 20), MAX_PAGE_SIZE);
    const parsedSkip = Math.max(0, parseInt(skip) || 0);

    const users = await User.findAll({
      where: filter,
      attributes: { exclude: ['password_hash'] },
      limit: parsedLimit,
      offset: parsedSkip
    });

    const total = await User.count({ where: filter });

    res.json({
      users,
      pagination: {
        total,
        limit: parsedLimit,
        skip: parsedSkip
      }
    });
  } catch (error) {
    logger.error('Users fetch error:', error);
    res.status(500).json({ message: 'Error fetching users', error: error.message });
  }
});

// Admin: Get user details
router.get('/users/:id', authenticate, authorize(['superadmin']), async (req, res) => {
  try {
    const user = await User.findByPk(req.params.id, {
      attributes: { exclude: ['password_hash'] },
      include: [
        {
          model: UserProduct,
          as: 'products',
          include: [{ model: Product, as: 'product' }]
        }
      ]
    });

    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    const transactions = await Transaction.findAll({
      where: { user_id: user.id },
      limit: 10
    });

    res.json({
      user,
      recent_transactions: transactions
    });
  } catch (error) {
    logger.error('User details fetch error:', error);
    res.status(500).json({ message: 'Error fetching user details', error: error.message });
  }
});

// Admin: Assign role
router.patch('/users/:id/role', authenticate, authorize(['superadmin']), adminLimiter, validateUpdateRole, async (req, res) => {
  try {
    const { role, ambassador_region, ambassador_sector } = req.body;
    const validRoles = ['user', 'admin', 'finance', 'verificator', 'approval', 'superadmin', 'ambassador'];

    if (!validRoles.includes(role)) {
      return res.status(400).json({ message: 'Invalid role' });
    }

    const [affectedRows] = await User.update(
      {
        role,
        ambassador_region: role === 'ambassador' ? (ambassador_region || null) : null,
        ambassador_sector: role === 'ambassador' ? (ambassador_sector || null) : null
      },
      { where: { id: req.params.id } }
    );

    if (affectedRows === 0) {
      return res.status(404).json({ message: 'User not found' });
    }

    const user = await User.findByPk(req.params.id, {
      attributes: { exclude: ['password_hash'] }
    });

    logger.info(`User role updated: ${user.phone} - ${role}`);

    await sendAccountNotification('Role update', () => notificationService.notifyAccountUpdated(
      user.id,
      'Account Role Updated',
      role === 'ambassador'
        ? `Your account role was updated to ambassador for ${ambassador_sector || 'your sector'} in ${ambassador_region || 'your region'}.`
        : `Your account role was updated to ${role}.`,
      { priority: 'high', data: { role, ambassador_region, ambassador_sector, updated_by: req.user.id } }
    ));

    await recordAdminAudit(req, {
      action: 'user.role.update',
      targetType: 'user',
      targetId: user.id,
      targetUserId: user.id,
      metadata: { role, ambassador_region, ambassador_sector },
    });

    res.json({
      message: 'User role updated',
      user
    });
  } catch (error) {
    logger.error('Role update error:', error);
    res.status(500).json({ message: 'Error updating user role', error: error.message });
  }
});

// Admin: Freeze/Unfreeze account
router.patch('/users/:id/status', authenticate, authorize(['superadmin']), adminLimiter, validateUpdateStatus, async (req, res) => {
  try {
    const { status } = req.body;
    const validStatuses = ['active', 'frozen', 'pending'];

    if (!validStatuses.includes(status)) {
      return res.status(400).json({ message: 'Invalid status' });
    }

    const [affectedRows] = await User.update(
      { status },
      { where: { id: req.params.id } }
    );

    if (affectedRows === 0) {
      return res.status(404).json({ message: 'User not found' });
    }

    const user = await User.findByPk(req.params.id, {
      attributes: { exclude: ['password_hash'] }
    });

    logger.info(`User status updated: ${user.phone} - ${status}`);

    if (status === 'active') {
      await sendAccountNotification('Status update', () => notificationService.notifyAccountApproved(user.id));
    } else if (status === 'frozen') {
      await sendAccountNotification('Status update', () => notificationService.create(
        user.id,
        'account_suspended',
        'Account Suspended',
        'Your account was suspended by an administrator. Please contact support for details.',
        { priority: 'urgent', icon: 'block', action_url: '/account' }
      ));
    } else {
      await sendAccountNotification('Status update', () => notificationService.notifyAccountUpdated(
        user.id,
        'Account Status Updated',
        'Your account status was changed to pending review.',
        { priority: 'high', data: { status, updated_by: req.user.id } }
      ));
    }

    await recordAdminAudit(req, {
      action: 'user.status.update',
      targetType: 'user',
      targetId: user.id,
      targetUserId: user.id,
      metadata: { status },
    });

    res.json({
      message: 'User status updated',
      user
    });
  } catch (error) {
    logger.error('Status update error:', error);
    res.status(500).json({ message: 'Error updating user status', error: error.message });
  }
});

// Admin: Add or deduct user balance with audit trail
router.patch('/users/:id/balance', authenticate, authorize(['superadmin', 'admin']), adminLimiter, validateUpdateBalance, async (req, res) => {
  try {
    const { action, currency, amount, reason } = req.body;
    const numericAmount = parseFloat(amount);
    const rate = await getNslPerUsdt();
    const conversion = buildConversion(numericAmount, currency, rate);

    const result = await sequelize.transaction(async (t) => {
      const user = await User.findOne({
        where: { id: req.params.id },
        lock: t.LOCK.UPDATE,
        transaction: t
      });

      if (!user) {
        const notFound = new Error('User not found');
        notFound.statusCode = 404;
        throw notFound;
      }

      if (req.user.role !== 'superadmin' && user.role !== 'user') {
        const forbidden = new Error('Admins can only adjust balances for normal users');
        forbidden.statusCode = 403;
        throw forbidden;
      }

      const currentBalance = parseFloat(user.balance_NSL) || 0;
      const signedAmountNSL = action === 'deduct' ? -conversion.amount_NSL : conversion.amount_NSL;
      const nextBalance = currentBalance + signedAmountNSL;

      if (nextBalance < 0) {
        const insufficient = new Error(`Insufficient NSL balance to deduct this amount`);
        insufficient.statusCode = 400;
        throw insufficient;
      }

      user.balance_NSL = nextBalance;
      user.balance_usdt = syncUsdtBalanceFromNsl(nextBalance, rate);
      await user.save({ transaction: t });

      await Transaction.create({
        user_id: user.id,
        type: action === 'add' ? 'recharge' : 'withdrawal',
        amount_NSL: conversion.amount_NSL,
        amount_usdt: conversion.amount_usdt,
        status: 'approved',
        approved_by: req.user.id,
        notes: `Manual ${action === 'add' ? 'credit' : 'deduction'} by ${req.user.role}: ${reason} (${conversion.amount_NSL} NSL / ${conversion.amount_usdt} USDT at ${conversion.exchange_rate_nsl_per_usdt} NSL per USDT)`,
        completed_at: new Date(),
        approved_at: new Date()
      }, { transaction: t });

      return {
        user,
        previousBalance: currentBalance,
        newBalance: nextBalance,
        signedAmount: signedAmountNSL
      };
    });

    logger.warn(`Manual balance ${action} by ${req.user.phone}: user=${result.user.phone} ${currency} amount=${numericAmount} previous=${result.previousBalance} new=${result.newBalance} reason=${reason}`);

    await sendAccountNotification('Balance update', () => notificationService.notifyBalanceAdjusted(
      result.user.id,
      action,
      numericAmount,
      currency,
      result.newBalance,
      reason
    ));

    await recordAdminAudit(req, {
      action: `user.balance.${action}`,
      targetType: 'user',
      targetId: result.user.id,
      targetUserId: result.user.id,
      metadata: {
        currency,
        amount: numericAmount,
        amount_NSL: conversion.amount_NSL,
        amount_usdt: conversion.amount_usdt,
        exchange_rate_nsl_per_usdt: conversion.exchange_rate_nsl_per_usdt,
        previous_balance: result.previousBalance,
        new_balance: result.newBalance,
        reason,
      },
    });

    res.json({
      message: `User balance ${action === 'add' ? 'credited' : 'deducted'}`,
      user: {
        id: result.user.id,
        phone: result.user.phone,
        role: result.user.role,
        balance_NSL: result.user.balance_NSL,
        balance_usdt: result.user.balance_usdt
      },
      adjustment: {
        action,
        currency,
        amount: numericAmount,
        amount_NSL: conversion.amount_NSL,
        amount_usdt: conversion.amount_usdt,
        exchange_rate_nsl_per_usdt: conversion.exchange_rate_nsl_per_usdt,
        previous_balance: result.previousBalance,
        new_balance: result.newBalance
      }
    });
  } catch (error) {
    logger.error('Balance adjustment error:', error);
    res.status(error.statusCode || 500).json({ message: error.statusCode ? error.message : 'Error adjusting balance', error: error.message });
  }
});

// Admin: Update VIP level
router.patch('/users/:id/vip', authenticate, authorize(['superadmin']), adminLimiter, validateUpdateVIP, async (req, res) => {
  try {
    const { vip_level } = req.body;
    const validLevels = ['none', 'VIP0', 'VIP1', 'VIP2', 'VIP3', 'VIP4', 'VIP5', 'VIP6', 'VIP7', 'VIP8', 'VIP9'];

    if (!validLevels.includes(vip_level)) {
      return res.status(400).json({ message: 'Invalid VIP level' });
    }

    const [affectedRows] = await User.update(
      { vip_level },
      { where: { id: req.params.id } }
    );

    if (affectedRows === 0) {
      return res.status(404).json({ message: 'User not found' });
    }

    const user = await User.findByPk(req.params.id, {
      attributes: { exclude: ['password_hash'] }
    });

    logger.info(`User VIP level updated: ${user.phone} - ${vip_level}`);

    if (vip_level !== 'none') {
      await sendAccountNotification('VIP update', () => notificationService.notifyVIPUpgrade(user.id, vip_level));
    } else {
      await sendAccountNotification('VIP update', () => notificationService.notifyAccountUpdated(
        user.id,
        'VIP Level Updated',
        'Your VIP level was changed to none.',
        { priority: 'high', data: { vip_level, updated_by: req.user.id } }
      ));
    }

    await recordAdminAudit(req, {
      action: 'user.vip.update',
      targetType: 'user',
      targetId: user.id,
      targetUserId: user.id,
      metadata: { vip_level },
    });

    res.json({
      message: 'User VIP level updated',
      user
    });
  } catch (error) {
    logger.error('VIP level update error:', error);
    res.status(500).json({ message: 'Error updating VIP level', error: error.message });
  }
});

// Admin: Create new user
router.post('/users', authenticate, authorize(['superadmin']), adminLimiter, validateCreateUser, async (req, res) => {
  try {
    const { username, phone, password, role = 'user', status = 'active', ambassador_region, ambassador_sector } = req.body;

    if (!username || !phone || !password) {
      return res.status(400).json({ message: 'Username, phone and password are required' });
    }

    const userExists = await User.findOne({
      where: {
        [Op.or]: [{ phone }, { username }]
      }
    });
    if (userExists) {
      return res.status(400).json({ message: 'User with this phone or username already exists' });
    }

    const referral_code = Math.random().toString(36).substring(2, 12).toUpperCase();
    const user = await User.create({
      username,
      phone,
      password_hash: password,
      referral_code,
      role,
      status,
      ambassador_region: role === 'ambassador' ? (ambassador_region || null) : null,
      ambassador_sector: role === 'ambassador' ? (ambassador_sector || null) : null,
      kyc_verified: true
    });

    logger.info(`New user created by admin: ${username} (${phone})`);

    await sendAccountNotification('Admin-created account', () => notificationService.notifyAccountUpdated(
      user.id,
      'Account Created',
      'Your SalonMoney account was created by an administrator.',
      { priority: 'high', action_url: '/dashboard', data: { created_by: req.user.id } }
    ));

    await recordAdminAudit(req, {
      action: 'user.create',
      targetType: 'user',
      targetId: user.id,
      targetUserId: user.id,
      metadata: { username, phone, role, status, ambassador_region, ambassador_sector },
    });

    res.status(201).json({
      message: 'User created successfully',
      user: {
        id: user.id,
        username: user.username,
        phone: user.phone,
        role: user.role,
        ambassador_region: user.ambassador_region,
        ambassador_sector: user.ambassador_sector,
        referral_code: user.referral_code,
        status: user.status
      }
    });
  } catch (error) {
    logger.error('User creation error:', error);
    res.status(500).json({ message: 'Error creating user', error: error.message });
  }
});

// Admin: Delete user

// Super Admin: Create admin/superadmin users
router.post('/create-admin', authenticate, authorize(['superadmin']), adminLimiter, async (req, res) => {
  try {
    const { username, phone, email, password, role, ambassador_region, ambassador_sector } = req.body;

    // Validate required fields
    if (!username || !phone || !password || !role) {
      return res.status(400).json({
        message: 'Username, phone, password, and role are required'
      });
    }

    // Validate role - only allow admin-related roles
    const allowedRoles = ['superadmin', 'admin', 'finance', 'verificator', 'approval', 'ambassador'];
    if (!allowedRoles.includes(role)) {
      return res.status(400).json({
        message: `Invalid role. Allowed roles: ${allowedRoles.join(', ')}`
      });
    }

    // Check if user already exists
    const userExists = await User.findOne({
      where: {
        [Op.or]: [{ phone }, { username }]
      }
    });
    if (userExists) {
      return res.status(400).json({
        message: 'User with this phone or username already exists'
      });
    }

    // Generate referral code
    const referral_code = Math.random().toString(36).substring(2, 12).toUpperCase();

    // Create admin user — let the beforeCreate hook hash password_hash
    const adminUser = await User.create({
      username,
      phone,
      email: email || `${username}@salonmoney.com`,
      password_hash: password,
      referral_code,
      role,
      ambassador_region: role === 'ambassador' ? (ambassador_region || null) : null,
      ambassador_sector: role === 'ambassador' ? (ambassador_sector || null) : null,
      status: 'active',
      email_verified: true,
      phone_verified: true,
      balance_NSL: 0,
      balance_usdt: 0
    });

    logger.info(`New ${role} created by superadmin ${req.user.phone}: ${username} (${phone})`);

    await recordAdminAudit(req, {
      action: 'admin.create',
      targetType: 'user',
      targetId: adminUser.id,
      targetUserId: adminUser.id,
      metadata: { username, phone, email, role, ambassador_region, ambassador_sector },
    });

    res.status(201).json({
      success: true,
      message: `${role.charAt(0).toUpperCase() + role.slice(1)} user created successfully`,
      user: {
        id: adminUser.id,
        username: adminUser.username,
        phone: adminUser.phone,
        email: adminUser.email,
        role: adminUser.role,
        referral_code: adminUser.referral_code,
        status: adminUser.status
      }
    });
  } catch (error) {
    logger.error('Admin creation error:', error);
    res.status(500).json({
      success: false,
      message: 'Error creating admin user',
      error: error.message
    });
  }
});

router.delete('/users/:id', authenticate, authorize(['superadmin']), async (req, res) => {
  try {
    const user = await User.findByPk(req.params.id);

    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    // Prevent deleting superadmin accounts
    if (user.role === 'superadmin') {
      return res.status(403).json({ message: 'Cannot delete superadmin accounts' });
    }

    await User.destroy({ where: { id: req.params.id } });
    logger.warn(`User deleted by admin: ${user.phone}`);

    await recordAdminAudit(req, {
      action: 'user.delete',
      targetType: 'user',
      targetId: user.id,
      targetUserId: user.id,
      metadata: { phone: user.phone, username: user.username, role: user.role },
    });

    res.json({
      message: 'User deleted successfully',
      deletedUser: {
        phone: user.phone,
        role: user.role
      }
    });
  } catch (error) {
    logger.error('User deletion error:', error);
    res.status(500).json({ message: 'Error deleting user', error: error.message });
  }
});

// Admin: Get all transactions
router.get('/transactions', authenticate, authorize(['superadmin']), async (req, res) => {
  try {
    const { type, status, limit = 20, skip = 0 } = req.query;
    const filter = {};

    if (type) filter.type = type;
    if (status) filter.status = status;

    // HIGH FIX: cap pagination limit to prevent unbounded result sets
    const MAX_PAGE_SIZE = 100;
    const parsedLimit = Math.min(Math.max(1, parseInt(limit) || 20), MAX_PAGE_SIZE);
    const parsedSkip = Math.max(0, parseInt(skip) || 0);

    const transactions = await Transaction.findAll({
      where: filter,
      include: [
        { model: User, as: 'user', attributes: ['phone'] },
        { model: User, as: 'approver', attributes: ['phone'] }
      ],
      order: [['timestamp', 'DESC']],
      limit: parsedLimit,
      offset: parsedSkip
    });

    const total = await Transaction.count({ where: filter });

    res.json({
      transactions,
      pagination: {
        total,
        limit: parsedLimit,
        skip: parsedSkip
      }
    });
  } catch (error) {
    logger.error('Transactions fetch error:', error);
    res.status(500).json({ message: 'Error fetching transactions', error: error.message });
  }
});

// ============ PRODUCT MANAGEMENT ENDPOINTS ============

// Admin: Get all products
router.get('/products', authenticate, authorize(['superadmin', 'admin']), async (req, res) => {
  try {
    const rate = await getNslPerUsdt();
    const products = await Product.findAll({
      order: [['price_NSL', 'ASC']]
    });

    res.json({
      products: products.map(product => productWithRate(product, rate)),
      total: products.length
    });
  } catch (error) {
    logger.error('Products fetch error:', error);
    res.status(500).json({ message: 'Error fetching products', error: error.message });
  }
});

// Admin: Get product statistics
router.get('/products/stats', authenticate, authorize(['superadmin', 'admin']), async (req, res) => {
  try {
    const rate = await getNslPerUsdt();
    const products = await Product.findAll();
    const stats = [];

    for (const product of products) {
      // Count active purchases via UserProduct table
      const totalPurchases = await UserProduct.count({
        where: {
          product_id: product.id,
          is_active: true
        }
      });

      // Calculate total revenue from purchases and renewals
      const revenueResult = await Transaction.findAll({
        where: {
          product_id: product.id,
          type: { [Op.in]: ['purchase', 'renewal'] },
          status: 'approved'
        },
        attributes: [
          [sequelize.fn('SUM', sequelize.col('amount_NSL')), 'total']
        ],
        raw: true
      });

      stats.push({
        product_id: product.id,
        product_name: product.name,
        price_NSL: product.price_NSL,
        price_usdt: parseFloat(priceUsdtForNsl(product.price_NSL, rate)),
        daily_income_NSL: product.daily_income_NSL,
        validity_days: product.validity_days,
        active: product.active,
        total_purchases: totalPurchases,
        total_revenue_NSL: parseFloat(revenueResult[0]?.total) || 0,
        active_users: totalPurchases
      });
    }

    // Calculate summary statistics
    const summary = {
      total_products: products.length,
      active_products: products.filter(p => p.active).length,
      total_purchases: stats.reduce((sum, s) => sum + s.total_purchases, 0),
      total_revenue_NSL: stats.reduce((sum, s) => sum + s.total_revenue_NSL, 0),
      most_popular: stats.sort((a, b) => b.total_purchases - a.total_purchases)[0]
    };

    res.json({
      summary,
      products_stats: stats
    });
  } catch (error) {
    logger.error('Product stats error:', error);
    res.status(500).json({ message: 'Error fetching product statistics', error: error.message });
  }
});

// Admin: Create new product
router.post('/products', authenticate, authorize(['superadmin', 'admin']), async (req, res) => {
  try {
    const { name, description, price_NSL, daily_income_NSL, validity_days, benefits } = req.body;

    // Validation
    if (!name || !price_NSL || !daily_income_NSL) {
      return res.status(400).json({ message: 'Name, price_NSL, and daily_income_NSL are required' });
    }

    if (price_NSL <= 0 || daily_income_NSL <= 0) {
      return res.status(400).json({ message: 'Price and daily income must be positive numbers' });
    }

    // Check if product already exists
    const existingProduct = await Product.findOne({ where: { name } });
    if (existingProduct) {
      return res.status(400).json({ message: 'Product with this name already exists' });
    }

    // Calculate USDT price
    const nslPerUsdt = await getNslPerUsdt();
    const price_usdt = priceUsdtForNsl(price_NSL, nslPerUsdt);

    const product = await Product.create({
      name,
      description: description || `${name} Investment Package`,
      price_NSL,
      price_usdt,
      daily_income_NSL,
      validity_days: validity_days || 60,
      benefits: benefits || [],
      active: true
    });

    logger.info(`Product created by admin: ${name} - ${price_NSL} NSL`);

    await recordAdminAudit(req, {
      action: 'product.create',
      targetType: 'product',
      targetId: product.id,
      metadata: { name, price_NSL, daily_income_NSL, validity_days },
    });

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
router.patch('/products/:id', authenticate, authorize(['superadmin', 'admin']), async (req, res) => {
  try {
    const { id } = req.params;
    const { price_NSL, daily_income_NSL, active, description, validity_days } = req.body;
    const updates = {};
    if (price_NSL       !== undefined) updates.price_NSL = price_NSL;
    if (daily_income_NSL !== undefined) updates.daily_income_NSL = daily_income_NSL;
    if (active          !== undefined) updates.active = active;
    if (description     !== undefined) updates.description = description;
    if (validity_days   !== undefined) updates.validity_days = validity_days;

    if (updates.price_NSL) {
      const nslPerUsdt = await getNslPerUsdt();
      updates.price_usdt = priceUsdtForNsl(updates.price_NSL, nslPerUsdt);
    }

    const [affectedRows] = await Product.update(updates, { where: { id } });

    if (affectedRows === 0) {
      return res.status(404).json({ message: 'Product not found' });
    }

    const product = await Product.findByPk(id);

    logger.info(`Product updated by admin: ${product.name}`);

    await recordAdminAudit(req, {
      action: 'product.update',
      targetType: 'product',
      targetId: product.id,
      metadata: { updates },
    });

    res.json({
      message: 'Product updated successfully',
      product
    });
  } catch (error) {
    logger.error('Product update error:', error);
    res.status(500).json({ message: 'Error updating product', error: error.message });
  }
});

// Admin: Delete product (soft delete)
router.delete('/products/:id', authenticate, authorize(['superadmin', 'admin']), async (req, res) => {
  try {
    const [affectedRows] = await Product.update(
      { active: false },
      { where: { id: req.params.id } }
    );

    if (affectedRows === 0) {
      return res.status(404).json({ message: 'Product not found' });
    }

    const product = await Product.findByPk(req.params.id);

    logger.warn(`Product deactivated by admin: ${product.name}`);

    await recordAdminAudit(req, {
      action: 'product.deactivate',
      targetType: 'product',
      targetId: product.id,
      metadata: { name: product.name },
    });

    res.json({
      message: 'Product deactivated successfully',
      product
    });
  } catch (error) {
    logger.error('Product deletion error:', error);
    res.status(500).json({ message: 'Error deactivating product', error: error.message });
  }
});

// Admin: Toggle product active status
router.patch('/products/:id/toggle', authenticate, authorize(['superadmin', 'admin']), async (req, res) => {
  try {
    const product = await Product.findByPk(req.params.id);

    if (!product) {
      return res.status(404).json({ message: 'Product not found' });
    }

    product.active = !product.active;
    await product.save();

    logger.info(`Product ${product.active ? 'activated' : 'deactivated'} by admin: ${product.name}`);

    await recordAdminAudit(req, {
      action: product.active ? 'product.activate' : 'product.deactivate',
      targetType: 'product',
      targetId: product.id,
      metadata: { name: product.name, active: product.active },
    });

    res.json({
      message: `Product ${product.active ? 'activated' : 'deactivated'} successfully`,
      product
    });
  } catch (error) {
    logger.error('Product toggle error:', error);
    res.status(500).json({ message: 'Error toggling product status', error: error.message });
  }
});

// Admin: Toggle product active/inactive
router.patch('/products/:id/toggle-active', authenticate, authorize(['superadmin', 'admin']), async (req, res) => {
  try {
    const { is_active } = req.body;

    const [affectedRows] = await Product.update(
      { active: is_active },
      { where: { id: req.params.id } }
    );

    if (affectedRows === 0) {
      return res.status(404).json({ message: 'Product not found' });
    }

    const product = await Product.findByPk(req.params.id);

    logger.info(`Product ${is_active ? 'activated' : 'deactivated'}: ${product.name}`);

    await recordAdminAudit(req, {
      action: is_active ? 'product.activate' : 'product.deactivate',
      targetType: 'product',
      targetId: product.id,
      metadata: { name: product.name, active: is_active },
    });

    res.json({
      message: `Product ${is_active ? 'activated' : 'deactivated'} successfully`,
      product
    });
  } catch (error) {
    logger.error('Product toggle error:', error);
    res.status(500).json({ message: 'Error toggling product', error: error.message });
  }
});

// Admin: Suspend product
router.patch('/products/:id/suspend', authenticate, authorize(['superadmin', 'admin']), async (req, res) => {
  try {
    const [affectedRows] = await Product.update(
      { active: false, suspended: true },
      { where: { id: req.params.id } }
    );

    if (affectedRows === 0) {
      return res.status(404).json({ message: 'Product not found' });
    }

    const product = await Product.findByPk(req.params.id);

    logger.warn(`Product suspended by admin: ${product.name}`);

    await recordAdminAudit(req, {
      action: 'product.suspend',
      targetType: 'product',
      targetId: product.id,
      metadata: { name: product.name },
    });

    res.json({
      message: 'Product suspended successfully',
      product
    });
  } catch (error) {
    logger.error('Product suspension error:', error);
    res.status(500).json({ message: 'Error suspending product', error: error.message });
  }
});

// Admin: Update product price
router.put('/products/:id', authenticate, authorize(['superadmin', 'admin']), async (req, res) => {
  try {
    const { name, price_NSL, daily_income_NSL, validity_days, description, is_active } = req.body;

    const nslPerUsdt = await getNslPerUsdt();
    const price_usdt = priceUsdtForNsl(price_NSL, nslPerUsdt);

    const [affectedRows] = await Product.update(
      {
        name,
        price_NSL,
        price_usdt,
        daily_income_NSL,
        validity_days,
        description,
        active: is_active
      },
      { where: { id: req.params.id } }
    );

    if (affectedRows === 0) {
      return res.status(404).json({ message: 'Product not found' });
    }

    const product = await Product.findByPk(req.params.id);

    logger.info(`Product updated by admin: ${product.name} - Price: ${price_NSL} NSL`);

    await recordAdminAudit(req, {
      action: 'product.update',
      targetType: 'product',
      targetId: product.id,
      metadata: { name, price_NSL, daily_income_NSL, validity_days, description, is_active },
    });

    res.json({
      message: 'Product updated successfully',
      product
    });
  } catch (error) {
    logger.error('Product update error:', error);
    res.status(500).json({ message: 'Error updating product', error: error.message });
  }
});

// ============ SUPERADMIN PASSWORD RESET ============

// Superadmin: Reset user password
router.patch('/users/:id/reset-password', authenticate, authorize(['superadmin']), adminLimiter, validateAdminResetPassword, async (req, res) => {
  try {
    const { new_password } = req.body;
    const user = await User.findByPk(req.params.id);

    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    if (!isStrongPassword(new_password)) {
      return res.status(400).json({ message: 'Password must be at least 8 characters and contain uppercase, lowercase, number, and special character' });
    }

    // Update password (will be hashed by beforeUpdate hook if configured)
    user.password_hash = new_password;
    await user.save();

    await sendAccountNotification('Admin password reset', () => notificationService.notifyPasswordReset(user.id, 'admin'));

    logger.warn(`Password reset by superadmin for user: ${user.phone || user.username}`);

    await recordAdminAudit(req, {
      action: 'user.password.reset',
      targetType: 'user',
      targetId: user.id,
      targetUserId: user.id,
      metadata: { username: user.username, phone: user.phone },
    });

    res.json({
      message: 'Password reset successfully',
      user: {
        id: user.id,
        username: user.username,
        phone: user.phone
      }
    });
  } catch (error) {
    logger.error('Password reset error:', error);
    res.status(500).json({ message: 'Error resetting password', error: error.message });
  }
});

// Super Admin: Change user phone number
router.patch('/users/:id/phone', authenticate, authorize(['superadmin']), adminLimiter, async (req, res) => {
  try {
    const { phone } = req.body;
    if (!phone || !phone.trim()) return res.status(400).json({ message: 'Phone number is required' });
    if (!isValidPhoneInput(phone)) {
      return res.status(400).json({ message: 'Please enter a valid phone number' });
    }

    const normalizedPhone = normalizePhoneInput(phone);

    const exists = await User.findOne({ where: { phone: normalizedPhone } });
    if (exists && exists.id !== parseInt(req.params.id)) {
      return res.status(400).json({ message: 'Phone number already in use by another account' });
    }

    const user = await User.findByPk(req.params.id);
    if (!user) return res.status(404).json({ message: 'User not found' });

    const oldPhone = user.phone;
    user.phone = normalizedPhone;
    // If username was the old phone number, keep it in sync
    if (user.username === oldPhone) user.username = normalizedPhone;
    await user.save();

    await sendAccountNotification('Phone update', () => notificationService.notifyPhoneChanged(user.id, user.phone));

    logger.warn(`Phone changed by superadmin for user #${user.id}: ${normalizedPhone}`);
    await recordAdminAudit(req, {
      action: 'user.phone.update',
      targetType: 'user',
      targetId: user.id,
      targetUserId: user.id,
      metadata: { oldPhone, newPhone: normalizedPhone },
    });
    res.json({ message: 'Phone number updated', user: { id: user.id, phone: user.phone, username: user.username } });
  } catch (error) {
    logger.error('Phone update error:', error);
    res.status(500).json({ message: 'Error updating phone number', error: error.message });
  }
});

// --- NEW ROUTE: Get Rate Limit Info ---
// Super Admin: Get rate limit information
router.get('/rate-limit-info', authenticate, authorize(['superadmin']), (req, res) => {
  try {
    const ip = req.ip || req.connection.remoteAddress;

    // Rate limit configuration info
    const rateLimitInfo = {
      currentIP: ip,
      limiters: [
        {
          name: 'Global API Limiter',
          window: '5 minutes',
          maxRequests: 150,
          description: 'Overall API request limit',
          autoResetTime: '5 minutes'
        },
        {
          name: 'Authentication Limiter',
          window: '15 minutes',
          maxRequests: 8,
          description: 'Login/signup attempts',
          autoResetTime: '15 minutes',
          skipSuccessful: true
        },
        {
          name: 'Transaction Limiter',
          window: '1 hour',
          maxRequests: 30,
          description: 'Recharge/withdrawal requests',
          autoResetTime: '1 hour'
        },
        {
          name: 'Admin Actions Limiter',
          window: '1 minute',
          maxRequests: 30,
          description: 'Admin operations',
          autoResetTime: '1 minute'
        },
        {
          name: 'Finance Limiter',
          window: '5 minutes',
          maxRequests: 30,
          description: 'Finance operations',
          autoResetTime: '5 minutes'
        },
        {
          name: 'Password Reset Limiter',
          window: '1 hour',
          maxRequests: 3,
          description: 'Password reset requests',
          autoResetTime: '1 hour'
        }
      ],
      note: 'Rate limits automatically reset after their window time',
      resetEndpoint: 'POST /api/admin/reset-limits'
    };

    res.json(rateLimitInfo);
  } catch (error) {
    logger.error('Rate limit info error:', error);
    res.status(500).json({ message: 'Error fetching rate limit info', error: error.message });
  }
});

// --- FIXED ROUTE ---
// Super Admin: Reset Rate Limits (Useful for Dev/Admin if blocked)
router.post('/reset-limits', authenticate, authorize(['superadmin']), async (req, res) => {
  try {
    const ip = req.ip || req.connection.remoteAddress;
    const result1 = await resetLimitsForIP(ip);

    // Also reset for the IP passed in body if provided (for unblocking others if IP is known)
    let result2 = null;
    if (req.body.ip) {
      result2 = await resetLimitsForIP(req.body.ip);
    }

    logger.warn(`Rate limits reset requested by superadmin for IP: ${ip}${req.body.ip ? ` and ${req.body.ip}` : ''}`);

    await recordAdminAudit(req, {
      action: 'rate_limit.reset',
      targetType: 'ip',
      targetId: req.body.ip || ip,
      metadata: { requestorIP: ip, targetIP: req.body.ip || null },
    });

    res.json({
      message: 'Rate limits will auto-expire based on configured time windows',
      details: {
        requestorIP: result1,
        targetIP: result2
      },
      info: 'Rate limits automatically reset after their configured time window (5 min for auth, 1 hour for transactions, etc.)'
    });
  } catch (error) {
    logger.error('Rate limit reset error:', error);
    res.status(500).json({ message: 'Error processing rate limit reset', error: error.message });
  }
});
// ----------------------------

// KYC: List users with pending review (docs uploaded, not yet verified)
router.get('/kyc/pending', authenticate, authorize(['superadmin', 'admin']), async (req, res) => {
  try {
    const users = await User.findAll({
      where: {
        kyc_verified: false,
        [Op.or]: [
          { kyc_id_front: { [Op.ne]: null } },
          { kyc_selfie: { [Op.ne]: null } }
        ]
      },
      attributes: ['id', 'username', 'phone', 'email', 'kyc_verified', 'kyc_id_front', 'kyc_id_back', 'kyc_selfie', 'kyc_additional', 'created_at'],
      order: [['created_at', 'ASC']],
      limit: 500,
    });
    res.json({ success: true, data: users, total: users.length });
  } catch (error) {
    logger.error('KYC pending list error:', error);
    res.status(500).json({ message: 'Error fetching pending KYC submissions' });
  }
});

// KYC: Approve a user's documents
router.patch('/kyc/:userId/approve', authenticate, authorize(['superadmin', 'admin']), adminLimiter, async (req, res) => {
  try {
    const user = await User.findByPk(req.params.userId, {
      attributes: { exclude: ['password_hash'] }
    });
    if (!user) return res.status(404).json({ message: 'User not found' });
    if (user.kyc_verified) return res.status(400).json({ message: 'KYC already verified' });

    await user.update({ kyc_verified: true });

    logger.info(`KYC approved for user ${user.username} by admin ${req.user.username}`);

    if (user.email) {
      emailService.sendKYCApproved(user.email, user.username)
        .catch(err => logger.error('KYC approval email failed:', err));
    }

    await sendAccountNotification('KYC approval', () => notificationService.notifyKYCVerified(user.id));

    await recordAdminAudit(req, {
      action: 'kyc.approve',
      targetType: 'user',
      targetId: user.id,
      targetUserId: user.id,
      metadata: { username: user.username },
    });

    res.json({ success: true, message: 'KYC approved', user });
  } catch (error) {
    logger.error('KYC approve error:', error);
    res.status(500).json({ message: 'Error approving KYC' });
  }
});

// KYC: Reject a user's documents
router.patch('/kyc/:userId/reject', authenticate, authorize(['superadmin', 'admin']), adminLimiter, async (req, res) => {
  try {
    const { reason } = req.body;
    if (!reason) return res.status(400).json({ message: 'Rejection reason is required' });

    const user = await User.findByPk(req.params.userId, {
      attributes: { exclude: ['password_hash'] }
    });
    if (!user) return res.status(404).json({ message: 'User not found' });

    await user.update({
      kyc_verified: false,
      kyc_id_front: null,
      kyc_id_back: null,
      kyc_selfie: null,
      kyc_additional: null
    });

    logger.info(`KYC rejected for user ${user.username} by admin ${req.user.username}: ${reason}`);

    if (user.email) {
      emailService.sendKYCRejected(user.email, user.username, reason)
        .catch(err => logger.error('KYC rejection email failed:', err));
    }

    await sendAccountNotification('KYC rejection', () => notificationService.notifyKYCRejected(user.id, reason));

    await recordAdminAudit(req, {
      action: 'kyc.reject',
      targetType: 'user',
      targetId: user.id,
      targetUserId: user.id,
      metadata: { username: user.username, reason },
    });

    res.json({ success: true, message: 'KYC rejected and documents cleared' });
  } catch (error) {
    logger.error('KYC reject error:', error);
    res.status(500).json({ message: 'Error rejecting KYC' });
  }
});

// ── Payment Settings ─────────────────────────────────────────────────────────

const ALLOWED_PAYMENT_KEYS = ['orange_money_number', 'africell_number', 'binance_wallet_address', 'binance_network'];

router.get('/payment-settings', authenticate, authorize(['superadmin']), async (req, res) => {
  try {
    const rows = await PaymentSetting.findAll();
    const data = {};
    rows.forEach(r => { data[r.key] = r.value; });
    res.json({ success: true, data });
  } catch (error) {
    logger.error('Get payment settings error:', error);
    res.status(500).json({ message: 'Error fetching payment settings' });
  }
});

router.put('/payment-settings', authenticate, authorize(['superadmin']), async (req, res) => {
  try {
    for (const key of ALLOWED_PAYMENT_KEYS) {
      if (key in req.body) {
        const value = req.body[key]?.toString().trim() || null;
        await PaymentSetting.upsert({ key, value, updated_by: req.user.id });
      }
    }
    await recordAdminAudit(req, {
      action: 'payment_settings.update',
      targetType: 'payment_settings',
      metadata: Object.fromEntries(ALLOWED_PAYMENT_KEYS.filter(key => key in req.body).map(key => [key, req.body[key]])),
    });
    res.json({ success: true, message: 'Payment settings updated' });
  } catch (error) {
    logger.error('Update payment settings error:', error);
    res.status(500).json({ message: 'Error updating payment settings' });
  }
});

// ── Mobile Money Deposit Management ──────────────────────────────────────────

// GET /api/admin/mobile-deposits/pending — list pending Orange Money + Africell deposits
router.get('/mobile-deposits/pending', authenticate, authorize(['superadmin', 'admin', 'finance']), async (req, res) => {
  try {
    const { literal } = require('sequelize');
    const txs = await Transaction.findAll({
      where: {
        payment_method: { [Op.in]: ['orange_money', 'africell'] },
        status: 'pending',
        type: 'recharge',
      },
      include: [{ model: User, as: 'user', attributes: ['id', 'username', 'phone', 'balance_NSL'] }],
      order: [[literal('"created_at"'), 'ASC']],
    });
    res.json({ success: true, data: txs });
  } catch (error) {
    logger.error('Mobile deposits pending error:', error);
    res.status(500).json({ message: 'Error fetching mobile deposits' });
  }
});

// PATCH /api/admin/transaction/:id/approve — approve a pending Transaction (deposit or withdrawal)
router.patch('/transaction/:id/approve', authenticate, authorize(['superadmin', 'admin', 'finance']), adminLimiter, async (req, res) => {
  const { approved_NSL, notes } = req.body;

  try {
    let result;
    await sequelize.transaction(async (t) => {
      const tx = await Transaction.findOne({ where: { id: req.params.id }, lock: t.LOCK.UPDATE, transaction: t });
      if (!tx) { const e = new Error('Transaction not found'); e.status = 404; throw e; }
      if (tx.status !== 'pending') { const e = new Error('Already processed'); e.status = 400; throw e; }

      tx.status = 'approved';
      tx.admin_notes = notes || null;
      tx.approved_at = new Date();
      await tx.save({ transaction: t });

      if (tx.type === 'withdrawal') {
        // Balance was already deducted at submission time — just mark approved, no balance change.
        result = { txType: 'withdrawal', txId: tx.id, userId: tx.user_id, amountNSL: tx.amount_NSL };
        logger.info(`Withdrawal ${tx.id} approved by admin ${req.user.username}`);
      } else {
        // Deposit: credit balance now — admin enters the raw SLE/NSL from receipt, fee applied here
        const feePercent = await ps.get('recharge_fee_pct');
        const baseNSL = parseFloat(approved_NSL || tx.amount_NSL);
        const creditNSL = baseNSL * (1 - feePercent / 100);

        const user = await User.findOne({ where: { id: tx.user_id }, lock: t.LOCK.UPDATE, transaction: t });
        if (!user) { const e = new Error('User not found'); e.status = 404; throw e; }

        const rate = await getNslPerUsdt();
        user.balance_NSL = parseFloat(user.balance_NSL) + creditNSL;
        user.balance_usdt = syncUsdtBalanceFromNsl(user.balance_NSL, rate);
        tx.amount_NSL = creditNSL;
        tx.amount_usdt = nslToUsdt(creditNSL, rate);
        await tx.save({ transaction: t });
        await user.save({ transaction: t });

        result = { txType: 'deposit', creditNSL, user, baseNSL, feePercent, rate };
        logger.info(`Deposit ${tx.id} approved by admin ${req.user.username}: ${baseNSL} NSL → ${creditNSL} credited to user ${user.username}`);
      }
    });

    if (result.txType === 'withdrawal') {
      await sendAccountNotification('Withdrawal approval', () => notificationService.notifyTransactionApproved(
        result.userId,
        'withdrawal',
        result.amountNSL
      ));
      await recordAdminAudit(req, {
        action: 'transaction.approve',
        targetType: 'transaction',
        targetId: req.params.id,
        targetUserId: result.userId,
        metadata: { type: 'withdrawal', amount_NSL: result.amountNSL, notes },
      });
      res.json({ success: true, message: 'Withdrawal approved. Please process the payout manually.' });
    } else {
      await sendAccountNotification('Deposit approval', () => notificationService.notifyRechargeApproved(
        result.user.id,
        result.creditNSL.toFixed(0),
        'NSL',
        { transaction_id: req.params.id, gross_NSL: result.baseNSL, feePercent: result.feePercent }
      ));
      await recordAdminAudit(req, {
        action: 'transaction.approve',
        targetType: 'transaction',
        targetId: req.params.id,
        targetUserId: result.user.id,
        metadata: {
          type: 'deposit',
          base_NSL: result.baseNSL,
          credited_NSL: result.creditNSL,
          feePercent: result.feePercent,
          rate: result.rate,
          notes,
        },
      });
      res.json({
        success: true,
        message: `Approved. ${result.creditNSL.toFixed(0)} NSL credited (${result.feePercent}% fee applied).`,
        data: {
          credited_NSL: result.creditNSL,
          credited_usdt: nslToUsdt(result.creditNSL, result.rate),
          exchange_rate_nsl_per_usdt: result.rate,
          new_balance: result.user.balance_NSL,
          new_balance_usdt: result.user.balance_usdt
        },
      });
    }
  } catch (error) {
    logger.error('Transaction approve error:', error);
    res.status(error.status || 500).json({ message: error.message || 'Approval failed' });
  }
});

// PATCH /api/admin/transaction/:id/reject — reject a pending Transaction (deposit or withdrawal)
router.patch('/transaction/:id/reject', authenticate, authorize(['superadmin', 'admin', 'finance']), adminLimiter, async (req, res) => {
  const { reason } = req.body;
  if (!reason?.trim()) return res.status(400).json({ message: 'Rejection reason required' });

  try {
    let txType;
    let txUserId;
    let txAmountNSL;
    await sequelize.transaction(async (t) => {
      const tx = await Transaction.findOne({ where: { id: req.params.id }, lock: t.LOCK.UPDATE, transaction: t });
      if (!tx) { const e = new Error('Transaction not found'); e.status = 404; throw e; }
      if (tx.status !== 'pending') { const e = new Error('Already processed'); e.status = 400; throw e; }

      txType = tx.type;
      txUserId = tx.user_id;
      txAmountNSL = tx.amount_NSL;
      tx.status = 'rejected';
      tx.admin_notes = reason;
      await tx.save({ transaction: t });

      // Refund balance when a withdrawal is rejected — balance was pre-deducted at submission time
      if (tx.type === 'withdrawal') {
        const user = await User.findOne({ where: { id: tx.user_id }, lock: t.LOCK.UPDATE, transaction: t });
        if (user) {
          // Recover gross amount from notes; fall back to amount_NSL (net)
          const grossMatch = (tx.notes || '').match(/Withdrawal:\s*([\d.]+)\s*NSL/);
          const refundNSL = grossMatch ? parseFloat(grossMatch[1]) : parseFloat(tx.amount_NSL);
          const rate = await getNslPerUsdt();
          user.balance_NSL = parseFloat(user.balance_NSL) + refundNSL;
          user.balance_usdt = syncUsdtBalanceFromNsl(user.balance_NSL, rate);
          await user.save({ transaction: t });
          logger.info(`Withdrawal ${tx.id} rejected; refunded ${refundNSL} NSL to user ${tx.user_id}`);
        }
      }

      logger.info(`Transaction ${tx.id} (${tx.type}) rejected by admin ${req.user.username}: ${reason}`);
    });

    if (txType === 'recharge') {
      await sendAccountNotification('Deposit rejection', () => notificationService.notifyRechargeRejected(
        txUserId,
        txAmountNSL,
        'NSL',
        reason,
        { transaction_id: req.params.id }
      ));
    } else {
      await sendAccountNotification('Transaction rejection', () => notificationService.notifyTransactionRejected(
        txUserId,
        txType,
        txAmountNSL,
        reason
      ));
    }

    await recordAdminAudit(req, {
      action: 'transaction.reject',
      targetType: 'transaction',
      targetId: req.params.id,
      targetUserId: txUserId,
      metadata: { type: txType, amount_NSL: txAmountNSL, reason },
    });

    res.json({ success: true, message: txType === 'withdrawal' ? 'Withdrawal rejected and balance refunded.' : 'Deposit rejected.' });
  } catch (error) {
    logger.error('Transaction reject error:', error);
    res.status(error.status || 500).json({ message: error.message || 'Rejection failed' });
  }
});

// ── Platform Settings ─────────────────────────────────────────────────────────

router.get('/platform-settings', authenticate, authorize(['superadmin', 'finance']), async (req, res) => {
  try {
    const settings = await ps.getAll();
    res.json({ settings });
  } catch (err) {
    logger.error('Platform settings fetch error:', err);
    res.status(500).json({ message: 'Error fetching platform settings' });
  }
});

router.put('/platform-settings', authenticate, authorize(['superadmin', 'finance']), async (req, res) => {
  try {
    const allowed = [
      'referral_l1_pct', 'referral_l2_pct', 'referral_l3_pct',
      'recharge_fee_pct', 'withdrawal_fee_pct',
      'exchange_rate_nsl_per_usdt',
      'dur_short', 'dur_week', 'dur_month', 'dur_promo', 'dur_promo_label',
    ];

    for (const key of allowed) {
      if (req.body[key] === undefined) continue;
      await PaymentSetting.upsert({
        key,
        value: String(req.body[key]),
        updated_by: req.user.id,
      });
    }

    ps.invalidate(); // clear cache so next read is fresh
    const updated = await ps.getAll();
    logger.info(`Platform settings updated by ${req.user.phone}`);
    await recordAdminAudit(req, {
      action: 'platform_settings.update',
      targetType: 'platform_settings',
      metadata: Object.fromEntries(allowed.filter(key => req.body[key] !== undefined).map(key => [key, req.body[key]])),
    });
    res.json({ message: 'Settings saved', settings: updated });
  } catch (err) {
    logger.error('Platform settings save error:', err);
    res.status(500).json({ message: 'Error saving platform settings' });
  }
});

router.post('/exchange-rate/refresh', authenticate, authorize(['superadmin', 'finance']), adminLimiter, async (req, res) => {
  try {
    const snapshot = await refreshExchangeRate({ force: true, updatedBy: req.user.id });
    logger.info(`Exchange rate refresh by ${req.user.phone}: rate=${snapshot.rate}, source=${snapshot.source}, fallback=${snapshot.fallback}`);
    await recordAdminAudit(req, {
      action: 'exchange_rate.refresh',
      targetType: 'exchange_rate',
      metadata: {
        rate: snapshot.rate,
        source: snapshot.source,
        provider: snapshot.provider,
        fallback: snapshot.fallback,
      },
    });
    res.json({
      success: true,
      message: snapshot.fallback ? 'Using saved exchange rate fallback' : 'Exchange rate refreshed',
      exchange_rate_nsl_per_usdt: snapshot.rate,
      source: snapshot.source,
      provider: snapshot.provider,
      provider_updated_at: snapshot.provider_updated_at,
      provider_next_update_at: snapshot.provider_next_update_at,
      fallback: snapshot.fallback,
    });
  } catch (err) {
    logger.error('Exchange rate refresh error:', err);
    res.status(500).json({ message: 'Error refreshing exchange rate' });
  }
});

router.post('/sync-usdt-balances', authenticate, authorize(['superadmin']), adminLimiter, async (req, res) => {
  try {
    const result = await syncUserUsdtBalances();
    logger.warn(`USDT balance sync by ${req.user.phone}: scanned=${result.scanned}, updated=${result.updated}, rate=${result.exchange_rate_nsl_per_usdt}`);
    await recordAdminAudit(req, {
      action: 'balances.usdt.sync',
      targetType: 'balances',
      metadata: result,
    });
    res.json({
      success: true,
      message: 'USDT balances synced from NSL balances',
      ...result,
    });
  } catch (error) {
    logger.error('USDT balance sync error:', error);
    res.status(500).json({ message: 'Error syncing USDT balances' });
  }
});

module.exports = router;
