const express = require('express');
const User = require('../models/User');
const bcrypt = require('bcryptjs');
const Transaction = require('../models/Transaction');
const Product = require('../models/Product');
const { authenticate, authorize } = require('../middleware/auth');
const logger = require('../utils/logger');

// Validation and Security Middleware
const {
  validateCreateUser,
  validateUpdateBalance,
  validateUpdateRole,
  validateUpdateStatus,
  validateUpdateVIP,
  validateResetPassword
} = require('../middleware/validation');

// --- MODIFIED: Added resetLimitsForIP to imports ---
const { adminLimiter, resetLimitsForIP } = require('../middleware/security');

const router = express.Router();

// Admin: Get all users
router.get('/users', authenticate, authorize(['superadmin']), async (req, res) => {
  try {
    const { status, role, limit = 20, skip = 0 } = req.query;
    const filter = {};

    if (status) filter.status = status;
    if (role) filter.role = role;

    const users = await User.find(filter)
      .select('-password_hash')
      .limit(parseInt(limit))
      .skip(parseInt(skip));

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
    logger.error('Users fetch error:', error);
    res.status(500).json({ message: 'Error fetching users', error: error.message });
  }
});

// Admin: Get user details
router.get('/users/:id', authenticate, authorize(['superadmin']), async (req, res) => {
  try {
    const user = await User.findById(req.params.id)
      .select('-password_hash')
      .populate('products');

    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    const transactions = await Transaction.find({ user_id: user._id }).limit(10);

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
    const { role } = req.body;
    const validRoles = ['user', 'admin', 'finance', 'verificator', 'approval', 'superadmin'];

    if (!validRoles.includes(role)) {
      return res.status(400).json({ message: 'Invalid role' });
    }

    const user = await User.findByIdAndUpdate(
      req.params.id,
      { role },
      { new: true }
    ).select('-password_hash');

    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    logger.info(`User role updated: ${user.phone} - ${role}`);

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

    const user = await User.findByIdAndUpdate(
      req.params.id,
      { status },
      { new: true }
    ).select('-password_hash');

    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    logger.info(`User status updated: ${user.phone} - ${status}`);

    res.json({
      message: 'User status updated',
      user
    });
  } catch (error) {
    logger.error('Status update error:', error);
    res.status(500).json({ message: 'Error updating user status', error: error.message });
  }
});

// Admin: Adjust balance
router.patch('/users/:id/balance', authenticate, authorize(['superadmin']), adminLimiter, validateUpdateBalance, async (req, res) => {
  try {
    const { balance_NSL, balance_usdt, reason } = req.body;
    const user = await User.findById(req.params.id);

    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    if (balance_NSL !== undefined) user.balance_NSL = balance_NSL;
    if (balance_usdt !== undefined) user.balance_usdt = balance_usdt;

    await user.save();

    logger.warn(`Balance adjusted for ${user.phone}: NSL=${balance_NSL}, USDT=${balance_usdt}, Reason: ${reason}`);

    res.json({
      message: 'User balance updated',
      user: {
        id: user._id,
        phone: user.phone,
        balance_NSL: user.balance_NSL,
        balance_usdt: user.balance_usdt
      }
    });
  } catch (error) {
    logger.error('Balance adjustment error:', error);
    res.status(500).json({ message: 'Error adjusting balance', error: error.message });
  }
});

// Admin: Update VIP level
router.patch('/users/:id/vip', authenticate, authorize(['superadmin']), adminLimiter, validateUpdateVIP, async (req, res) => {
  try {
    const { vip_level } = req.body;
    const validLevels = ['VIP1', 'VIP2', 'VIP3', 'VIP4', 'VIP5', 'VIP6', 'VIP7', 'VIP8', 'VIP9', 'none'];

    if (!validLevels.includes(vip_level)) {
      return res.status(400).json({ message: 'Invalid VIP level' });
    }

    const user = await User.findByIdAndUpdate(
      req.params.id,
      { vip_level },
      { new: true }
    ).select('-password_hash');

    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    logger.info(`User VIP level updated: ${user.phone} - ${vip_level}`);

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
    const { username, phone, password, role = 'user', status = 'active' } = req.body;

    if (!username || !phone || !password) {
      return res.status(400).json({ message: 'Username, phone and password are required' });
    }

    const userExists = await User.findOne({ $or: [{ phone }, { username }] });
    if (userExists) {
      return res.status(400).json({ message: 'User with this phone or username already exists' });
    }

    const referral_code = Math.random().toString(36).substring(2, 12).toUpperCase();
    const user = new User({
      username,
      phone,
      password_hash: password,
      referral_code,
      role,
      status,
      kyc_verified: true
    });

    await user.save();
    logger.info(`New user created by admin: ${username} (${phone})`);

    res.status(201).json({
      message: 'User created successfully',
      user: {
        id: user._id,
        username: user.username,
        phone: user.phone,
        role: user.role,
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
    const { username, phone, email, password, role } = req.body;

    // Validate required fields
    if (!username || !phone || !password || !role) {
      return res.status(400).json({
        message: 'Username, phone, password, and role are required'
      });
    }

    // Validate role - only allow admin-related roles
    const allowedRoles = ['superadmin', 'admin', 'finance', 'verificator', 'approval'];
    if (!allowedRoles.includes(role)) {
      return res.status(400).json({
        message: `Invalid role. Allowed roles: ${allowedRoles.join(', ')}`
      });
    }

    // Check if user already exists
    const userExists = await User.findOne({ $or: [{ phone }, { username }] });
    if (userExists) {
      return res.status(400).json({
        message: 'User with this phone or username already exists'
      });
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);

    // Generate referral code
    const referral_code = Math.random().toString(36).substring(2, 12).toUpperCase();

    // Create admin user
    const adminUser = new User({
      username,
      phone,
      email: email || `${username}@salonmoney.com`,
      password: hashedPassword,
      referral_code,
      role,
      status: 'active',
      email_verified: true,
      phone_verified: true,
      balance_NSL: 0,
      balance_usdt: 0
    });

    await adminUser.save();

    logger.info(`New ${role} created by superadmin ${req.user.phone}: ${username} (${phone})`);

    res.status(201).json({
      success: true,
      message: `${role.charAt(0).toUpperCase() + role.slice(1)} user created successfully`,
      user: {
        id: adminUser._id,
        username: adminUser.username,
        phone: adminUser.phone,
        email: adminUser.email,
        role: adminUser.role,
        referral_code: adminUser.referral_code,
        status: adminUser.status
      },
      credentials: {
        username: username,
        password: password,
        note: 'Please save these credentials and share them securely with the new admin'
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
    const user = await User.findById(req.params.id);

    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    // Prevent deleting superadmin accounts
    if (user.role === 'superadmin') {
      return res.status(403).json({ message: 'Cannot delete superadmin accounts' });
    }

    await User.findByIdAndDelete(req.params.id);
    logger.warn(`User deleted by admin: ${user.phone}`);

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

    const transactions = await Transaction.find(filter)
      .populate('user_id', 'phone')
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
    logger.error('Transactions fetch error:', error);
    res.status(500).json({ message: 'Error fetching transactions', error: error.message });
  }
});

// ============ PRODUCT MANAGEMENT ENDPOINTS ============

// Admin: Get all products
router.get('/products', authenticate, authorize(['superadmin', 'admin']), async (req, res) => {
  try {
    const products = await Product.find().sort({ price_NSL: 1 });

    res.json({
      products,
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
    const products = await Product.find();
    const stats = [];

    for (const product of products) {
      // Count active purchases
      const totalPurchases = await User.countDocuments({
        'products.product_id': product._id,
        'products.is_active': true
      });

      // Calculate total revenue from purchases and renewals
      const totalRevenue = await Transaction.aggregate([
        {
          $match: {
            product_id: product._id,
            type: { $in: ['purchase', 'renewal'] },
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

      stats.push({
        product_id: product._id,
        product_name: product.name,
        price_NSL: product.price_NSL,
        price_usdt: product.price_usdt,
        daily_income_NSL: product.daily_income_NSL,
        validity_days: product.validity_days,
        active: product.active,
        total_purchases: totalPurchases,
        total_revenue_NSL: totalRevenue[0]?.total || 0,
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
    const existingProduct = await Product.findOne({ name });
    if (existingProduct) {
      return res.status(400).json({ message: 'Product with this name already exists' });
    }

    // Calculate USDT price
    const nslToUsdt = parseInt(process.env.NSL_TO_USDT_RECHARGE || 25);
    const price_usdt = (price_NSL / nslToUsdt).toFixed(2);

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
    const updates = req.body;

    // Recalculate USDT if NSL price changed
    if (updates.price_NSL) {
      const nslToUsdt = parseInt(process.env.NSL_TO_USDT_RECHARGE || 25);
      updates.price_usdt = (updates.price_NSL / nslToUsdt).toFixed(2);
    }

    const product = await Product.findByIdAndUpdate(id, updates, { new: true });

    if (!product) {
      return res.status(404).json({ message: 'Product not found' });
    }

    logger.info(`Product updated by admin: ${product.name}`);

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
    const product = await Product.findByIdAndUpdate(
      req.params.id,
      { active: false },
      { new: true }
    );

    if (!product) {
      return res.status(404).json({ message: 'Product not found' });
    }

    logger.warn(`Product deactivated by admin: ${product.name}`);

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
    const product = await Product.findById(req.params.id);

    if (!product) {
      return res.status(404).json({ message: 'Product not found' });
    }

    product.active = !product.active;
    await product.save();

    logger.info(`Product ${product.active ? 'activated' : 'deactivated'} by admin: ${product.name}`);

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
    const product = await Product.findByIdAndUpdate(
      req.params.id,
      { active: is_active },
      { new: true }
    );

    if (!product) {
      return res.status(404).json({ message: 'Product not found' });
    }

    logger.info(`Product ${is_active ? 'activated' : 'deactivated'}: ${product.name}`);

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
    const product = await Product.findByIdAndUpdate(
      req.params.id,
      { active: false, suspended: true },
      { new: true }
    );

    if (!product) {
      return res.status(404).json({ message: 'Product not found' });
    }

    logger.warn(`Product suspended by admin: ${product.name}`);

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

    const nslToUsdt = parseInt(process.env.NSL_TO_USDT_RECHARGE || 25);
    const price_usdt = (price_NSL / nslToUsdt).toFixed(2);

    const product = await Product.findByIdAndUpdate(
      req.params.id,
      {
        name,
        price_NSL,
        price_usdt,
        daily_income_NSL,
        validity_days,
        description,
        active: is_active
      },
      { new: true }
    );

    if (!product) {
      return res.status(404).json({ message: 'Product not found' });
    }

    logger.info(`Product updated by admin: ${product.name} - Price: ${price_NSL} NSL`);

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
router.patch('/users/:id/reset-password', authenticate, authorize(['superadmin']), adminLimiter, validateResetPassword, async (req, res) => {
  try {
    const { new_password } = req.body;
    const user = await User.findById(req.params.id);

    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    if (!new_password || new_password.length < 6) {
      return res.status(400).json({ message: 'Password must be at least 6 characters' });
    }

    // Update password (will be hashed by pre-save hook)
    user.password_hash = new_password;
    await user.save();

    logger.warn(`Password reset by superadmin for user: ${user.phone || user.username}`);

    res.json({
      message: 'Password reset successfully',
      user: {
        id: user._id,
        username: user.username,
        phone: user.phone
      }
    });
  } catch (error) {
    logger.error('Password reset error:', error);
    res.status(500).json({ message: 'Error resetting password', error: error.message });
  }
});

// --- NEW ROUTE ADDED HERE ---
// Super Admin: Reset Rate Limits (Useful for Dev/Admin if blocked)
router.post('/reset-limits', authenticate, authorize(['superadmin']), async (req, res) => {
  try {
    const ip = req.ip || req.connection.remoteAddress;
    resetLimitsForIP(ip);
    
    // Also reset for the IP passed in body if provided (for unblocking others if IP is known)
    if (req.body.ip) {
      resetLimitsForIP(req.body.ip);
    }

    logger.warn(`Rate limits reset by superadmin for IP: ${ip}`);
    res.json({ message: 'Rate limits reset successfully' });
  } catch (error) {
    logger.error('Rate limit reset error:', error);
    res.status(500).json({ message: 'Error resetting rate limits', error: error.message });
  }
});
// ----------------------------

module.exports = router;