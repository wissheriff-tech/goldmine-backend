// Force pg into ncc bundle
require("pg");
const express = require('express');
const http = require('http');
const cors = require('cors');
const compression = require('compression');
const dotenv = require('dotenv');
const logger = require('./utils/logger');

// Security middleware
const {
  securityHeaders,
  globalLimiter,
  requestLogger,
  validateContentType,
  preventParameterPollution
} = require('./middleware/security');
const { authenticate } = require('./middleware/auth');

dotenv.config();

if (!process.env.SUPER_ADMIN_PASSWORD) {
  throw new Error('SUPER_ADMIN_PASSWORD env var is required — refusing to start without it');
}

// Check if running on Vercel (serverless)
const isVercel = process.env.VERCEL === '1';

const app = express();
const server = http.createServer(app);

// Trust proxy - Important for rate limiting behind reverse proxies
app.set('trust proxy', 1);

// CORS Configuration
const allowedOrigins = [
  'http://localhost:3000',
  process.env.FRONTEND_URL,
].filter(Boolean);

const corsOptions = {
  origin: function (origin, callback) {
    // Allow no-origin only in development (Postman, curl, etc.)
    if (!origin) {
      if (process.env.NODE_ENV !== 'production') return callback(null, true);
      return callback(new Error('Origin required in production'));
    }

    // Check if origin matches any allowed origin (string or regex)
    const isAllowed = allowedOrigins.some(allowed => {
      if (allowed instanceof RegExp) {
        return allowed.test(origin);
      }
      return allowed === origin;
    });

    if (isAllowed) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  optionsSuccessStatus: 200
};

// Core Middleware (Order matters!)
app.use(cors(corsOptions));
app.use(compression()); // Compress responses
app.use(securityHeaders); // Security headers via Helmet
app.use(express.json({ limit: '10mb' })); // Parse JSON with size limit
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(preventParameterPollution); // Prevent parameter pollution
app.use(requestLogger); // Log all requests
app.use(validateContentType); // Validate content types

// Serve uploaded files with explicit CORS headers
app.use('/uploads', (req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');
  res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
  res.setHeader('Cache-Control', 'public, max-age=31536000');
  next();
}, express.static('uploads'));

// Global Rate Limiting
app.use('/api/', globalLimiter);

// Database Connection
const { sequelize, User } = require('./models');

// On Vercel: skip startup DB sync (too slow for cold start). Tables are synced lazily.
// On server: sync on startup as normal.
if (!isVercel) {
  (async () => {
    try {
      await sequelize.authenticate();
      logger.info('Database connected');
      await sequelize.sync({ alter: false, force: false });
      logger.info('Database tables synced');
      const admin = await User.findOne({ where: { username: 'superadmin' } });
      if (!admin) {
        await User.create({
          username: 'superadmin',
          phone: process.env.SUPER_ADMIN_PHONE || '+232777777777',
          email: process.env.SUPER_ADMIN_EMAIL || 'admin@salonmoney.com',
          password_hash: process.env.SUPER_ADMIN_PASSWORD,
          role: 'superadmin',
          referral_code: 'ADMIN00001',
          status: 'active',
        });
        logger.info('Superadmin seeded');
      }
    } catch (err) {
      logger.error('Database init error:', err.message);
    }
  })();
}

// Initialize Socket.io (skip on Vercel - serverless doesn't support WebSockets)
if (!isVercel) {
  const { initializeSocket } = require('./config/socket');
  initializeSocket(server);
  logger.info('Socket.io initialized');
}

// Import Routes
const authRoutes = require('./routes/auth');
const userRoutes = require('./routes/user');
const adminRoutes = require('./routes/admin');
const financeRoutes = require('./routes/finance');
const verificatorRoutes = require('./routes/verificator');
const approvalRoutes = require('./routes/approval');
const productsRoutes = require('./routes/products');
const currencyRoutes = require('./routes/currency');
const notificationRoutes = require('./routes/notifications');
const analyticsRoutes = require('./routes/analytics');
const batchRoutes = require('./routes/batch');
const exportRoutes = require('./routes/export');
const securityRoutes = require('./routes/security');
const chatRoutes = require('./routes/chat');
const depositRoutes = require('./routes/deposit');

// On Vercel: sync DB + seed admin on first request (lazy init)
let dbReady = false;
if (isVercel) {
  app.use(async (req, res, next) => {
    if (dbReady) return next();
    try {
      await sequelize.authenticate();
      logger.info('Vercel DB: authenticated');
      await sequelize.sync({ force: false });
      logger.info('Vercel DB: synced');
      const admin = await User.findOne({ where: { username: 'superadmin' } });
      if (!admin) {
        await User.create({
          username: 'superadmin',
          phone: process.env.SUPER_ADMIN_PHONE || '+232777777777',
          email: process.env.SUPER_ADMIN_EMAIL || 'admin@salonmoney.com',
          password_hash: process.env.SUPER_ADMIN_PASSWORD,
          role: 'superadmin',
          referral_code: 'ADMIN00001',
          status: 'active',
        });
      }
      dbReady = true;
      logger.info('Vercel DB: ready');
    } catch (err) {
      logger.error('Vercel DB init error:', err.message, err.stack?.split('\n')[1]);
    }
    next();
  });
}

app.get('/api/ping', (req, res) => {
  res.json({ ok: true, ready: dbReady });
});

// Register Routes
app.use('/api/auth', authRoutes);
app.use('/api/user', userRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/finance', financeRoutes);
app.use('/api/verificator', verificatorRoutes);
app.use('/api/approval', approvalRoutes);
app.use('/api/products', productsRoutes);
app.use('/api/currency', currencyRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/analytics', analyticsRoutes);
app.use('/api/batch', batchRoutes);
app.use('/api/export', exportRoutes);
app.use('/api/security', securityRoutes);
app.use('/api/chat', chatRoutes);
app.use('/api/deposit', depositRoutes);

// Root API info
app.get('/api', (req, res) => {
  res.json({ name: 'SalonMoney API', status: 'running', version: '1.0.0' });
});


// Seed products (admin-only, idempotent)
app.post('/api/admin/seed-products', authenticate, (req, res, next) => {
  if (req.user.role !== 'superadmin') return res.status(403).json({ message: 'Forbidden' });
  next();
}, async (req, res) => {

  const Product = require('./models/Product');
  const NSL_RATE = parseInt(process.env.NSL_TO_USDT_RECHARGE || 23);
  const plans = [
    { name: 'VIP0', price_NSL: 500,     daily_income_NSL: 15,    description: 'Starter package — begin your journey with minimal risk.' },
    { name: 'VIP1', price_NSL: 1000,    daily_income_NSL: 40,    description: 'Entry-level package with steady daily returns.' },
    { name: 'VIP2', price_NSL: 3000,    daily_income_NSL: 150,   description: 'Enhanced package with better returns and faster processing.' },
    { name: 'VIP3', price_NSL: 8000,    daily_income_NSL: 450,   description: 'Premium package with dedicated support.' },
    { name: 'VIP4', price_NSL: 20000,   daily_income_NSL: 1200,  description: 'Elite package with reduced fees and express withdrawals.' },
    { name: 'VIP5', price_NSL: 50000,   daily_income_NSL: 3200,  description: 'Platinum package with exclusive promotions.' },
    { name: 'VIP6', price_NSL: 100000,  daily_income_NSL: 6800,  description: 'Diamond package — zero withdrawal fees.' },
    { name: 'VIP7', price_NSL: 250000,  daily_income_NSL: 18000, description: 'Royal package with concierge investment service.' },
    { name: 'VIP8', price_NSL: 500000,  daily_income_NSL: 40000, description: 'Ultimate package with lifetime premium support.' },
    { name: 'VIP9', price_NSL: 1000000, daily_income_NSL: 85000, description: 'Legend package — the absolute peak.' },
  ];

  let created = 0, updated = 0;
  for (const p of plans) {
    const [, wasCreated] = await Product.upsert({
      name: p.name, description: p.description,
      price_NSL: p.price_NSL,
      price_usdt: (p.price_NSL / NSL_RATE).toFixed(2),
      daily_income_NSL: p.daily_income_NSL,
      validity_days: 60, active: true
    });
    wasCreated ? created++ : updated++;
  }
  res.json({ message: 'Products seeded', created, updated, total: plans.length });
});

// Health Check — always return 200 so Render considers the service healthy
app.get('/api/health', async (req, res) => {
  let dbStatus = 'connecting';
  try {
    await Promise.race([
      sequelize.authenticate().then(() => { dbStatus = 'connected'; }),
      new Promise(r => setTimeout(r, 3000)) // 3s timeout
    ]);
  } catch { dbStatus = 'disconnected'; }
  res.json({ status: 'Server is running', database: dbStatus, timestamp: new Date() });
});

// Cron Jobs (skip on Vercel - use Vercel Cron instead)
if (!isVercel) {
  const cron = require('node-cron');

  // Cron Job: Daily Income (Enhanced with validity checking)
  cron.schedule('0 0 * * *', async () => {
  try {
    logger.info('Running daily income cron job...');
    const { User, UserProduct, Product, Transaction } = require('./models');

    const userProducts = await UserProduct.findAll({
      where: { is_active: true },
      include: [
        { model: Product, as: 'product' },
        { model: User, as: 'user', where: { status: 'active' } }
      ]
    });

    const now = new Date();
    let totalIncomeGenerated = 0;
    const userIncomes = {};

    for (const up of userProducts) {
      if (up.expires_at > now && up.product && up.product.daily_income_NSL > 0) {
        const dailyIncome = up.product.daily_income_NSL;
        const userId = up.user_id;

        if (!userIncomes[userId]) {
          userIncomes[userId] = { user: up.user, total: 0 };
        }
        userIncomes[userId].total += dailyIncome;

        await Transaction.create({
          user_id: userId,
          type: 'income',
          amount_NSL: dailyIncome,
          product_id: up.product_id,
          status: 'approved',
          notes: `Daily income from ${up.product.name}`
        });
      }
    }

    let totalUsersProcessed = 0;
    for (const [userId, data] of Object.entries(userIncomes)) {
      if (data.total > 0) {
        data.user.balance_NSL = parseFloat(data.user.balance_NSL) + data.total;
        await data.user.save();
        totalIncomeGenerated += data.total;
        totalUsersProcessed++;
        logger.info(`Income generated for ${data.user.phone}: ${data.total} NSL`);
      }
    }

    logger.info(`Daily income cron completed: ${totalUsersProcessed} users, ${totalIncomeGenerated.toLocaleString()} NSL total`);
  } catch (error) {
    logger.error('Error in daily income cron:', error);
  }
});

// Cron Job: Auto-Renewal (Runs at 12:01 AM, after income generation)
cron.schedule('1 0 * * *', async () => {
  try {
    logger.info('Running auto-renewal cron job...');
    const { User, UserProduct, Product, Transaction } = require('./models');

    const now = new Date();
    const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);

    const expiringProducts = await UserProduct.findAll({
      where: {
        is_active: true,
        auto_renew: true
      },
      include: [
        { model: Product, as: 'product' },
        { model: User, as: 'user', where: { status: 'active' } }
      ]
    });

    let totalRenewed = 0;
    let totalDeactivated = 0;

    for (const up of expiringProducts) {
      if (up.expires_at <= tomorrow && up.expires_at > now && up.product) {
        const product = up.product;
        const user = up.user;

        if (parseFloat(user.balance_NSL) >= product.price_NSL) {
          user.balance_NSL = parseFloat(user.balance_NSL) - product.price_NSL;
          up.expires_at = new Date(up.expires_at.getTime() + (product.validity_days * 24 * 60 * 60 * 1000));

          await Transaction.create({
            user_id: user.id,
            type: 'renewal',
            amount_NSL: product.price_NSL,
            amount_usdt: product.price_usdt,
            product_id: product.id,
            status: 'approved',
            notes: `Auto-renewal of ${product.name} for ${product.validity_days} days`
          });

          await up.save();
          await user.save();
          totalRenewed++;
          logger.info(`Auto-renewed ${product.name} for ${user.phone} - New expiration: ${up.expires_at.toLocaleDateString()}`);
        } else {
          up.is_active = false;
          await up.save();
          totalDeactivated++;
          logger.warn(`Failed to renew ${product.name} for ${user.phone} - Insufficient balance (need ${product.price_NSL} NSL, have ${user.balance_NSL} NSL)`);
        }
      }
    }

    logger.info(`Auto-renewal cron completed: ${totalRenewed} products renewed, ${totalDeactivated} products deactivated`);
  } catch (error) {
    logger.error('Error in auto-renewal cron:', error);
  }
});

// Cron Job: Cleanup expired sessions and notifications
cron.schedule('0 2 * * *', async () => {
  try {
    logger.info('Running cleanup cron job...');
    const { Session, Notification } = require('./models');
    const { Op } = require('sequelize');
    const now = new Date();

    const deletedSessions = await Session.destroy({
      where: { expires_at: { [Op.lt]: now } }
    });

    const deletedNotifications = await Notification.destroy({
      where: { expires_at: { [Op.lt]: now } }
    });

    logger.info(`Cleanup completed: ${deletedSessions} expired sessions, ${deletedNotifications} expired notifications removed`);
  } catch (error) {
    logger.error('Error in cleanup cron:', error);
  }
  });
} // End of if (!isVercel) block for cron jobs

// 404 Handler - Must be after all routes
app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: 'Route not found',
    path: req.originalUrl
  });
});

// Global Error Handling Middleware
app.use((err, req, res, next) => {
  // Log error details
  logger.error('Error occurred:', {
    message: err.message,
    stack: err.stack,
    url: req.originalUrl,
    method: req.method,
    ip: req.ip
  });

  // Sequelize validation error
  if (err.name === 'SequelizeValidationError') {
    return res.status(400).json({
      success: false,
      message: 'Validation Error',
      errors: err.errors.map(e => e.message)
    });
  }

  // Sequelize unique constraint error
  if (err.name === 'SequelizeUniqueConstraintError') {
    const field = err.errors[0]?.path || 'field';
    return res.status(400).json({
      success: false,
      message: `${field} already exists`,
      field
    });
  }

  // JWT errors
  if (err.name === 'JsonWebTokenError') {
    return res.status(401).json({
      success: false,
      message: 'Invalid token'
    });
  }

  if (err.name === 'TokenExpiredError') {
    return res.status(401).json({
      success: false,
      message: 'Token expired'
    });
  }

  // Multer file upload errors
  if (err.name === 'MulterError') {
    return res.status(400).json({
      success: false,
      message: `File upload error: ${err.message}`
    });
  }

  // Default error
  const statusCode = err.status || err.statusCode || 500;
  const message = err.message || 'Internal Server Error';

  res.status(statusCode).json({
    success: false,
    message,
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack })
  });
});

// Catch unhandled errors — prevent silent crashes
process.on('uncaughtException', (err) => {
  logger.error('Uncaught Exception:', err.message, err.stack);
});
process.on('unhandledRejection', (reason) => {
  logger.error('Unhandled Rejection:', reason);
});

// Only start server if not running on Vercel (Vercel handles this automatically)
if (!isVercel) {
  const PORT = process.env.PORT || 5000;
  server.listen(PORT, () => {
    logger.info(`Server running on port ${PORT}`);
    logger.info(`Socket.io listening on port ${PORT}`);
  });
}

module.exports = app;
