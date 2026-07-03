// Force pg into ncc bundle
require("pg");
const crypto = require('crypto');
const express = require('express');
const http = require('http');
const crypto = require('crypto');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const compression = require('compression');
const dotenv = require('dotenv');
const logger = require('./utils/logger');
const emailService = require('./utils/emailService');
const ps = require('./utils/platformSettings');
const { getNslPerUsdt, nslToUsdt, syncUsdtBalanceFromNsl } = require('./utils/currencyConversion');
const { VIP_PRODUCT_PLANS, planToProductSeed } = require('./utils/productPlans');
const { Op } = require('sequelize');

// Security middleware
const {
  securityHeaders,
  permissionsPolicyHeaders,
  noCacheHeaders,
  globalLimiter,
  passwordResetLimiter,
  requestLogger,
  validateContentType,
  createCookieWriteGuard,
  sanitizeProductionErrors,
  preventParameterPollution,
  passwordResetLimiter
} = require('./middleware/security');
const { authenticate } = require('./middleware/auth');

dotenv.config();

if (!process.env.SUPER_ADMIN_PASSWORD) {
  console.error('WARNING: SUPER_ADMIN_PASSWORD env var is not set');
}

const SUPER_ADMIN_DEFAULTS = {
  username: 'superadmin',
  phone: '+232777777777',
  email: 'admin@salonmoney.com'
};

const getSuperAdminConfig = () => ({
  username: (process.env.SUPER_ADMIN_USERNAME || SUPER_ADMIN_DEFAULTS.username).trim().toLowerCase(),
  phone: (process.env.SUPER_ADMIN_PHONE || SUPER_ADMIN_DEFAULTS.phone).trim(),
  email: (process.env.SUPER_ADMIN_EMAIL || SUPER_ADMIN_DEFAULTS.email).trim().toLowerCase(),
  password: process.env.SUPER_ADMIN_PASSWORD
});

const isStrongPassword = (value) => /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]{8,}$/.test(String(value || ''));
const timingSafeEqualString = (left, right) => {
  const leftBuffer = Buffer.from(String(left || ''));
  const rightBuffer = Buffer.from(String(right || ''));
  return leftBuffer.length === rightBuffer.length && crypto.timingSafeEqual(leftBuffer, rightBuffer);
};

// Check if running on Vercel (serverless)
const isVercel = process.env.VERCEL === '1';

const app = express();
const server = http.createServer(app);

// Trust proxy - Important for rate limiting behind reverse proxies
app.set('trust proxy', 1);

// CORS Configuration
const allowedOrigins = [
  'http://localhost:3000',
  'http://localhost:3001',
  'https://salonmoneynew.vercel.app',
  process.env.FRONTEND_URL,
].filter(Boolean);

const isAllowedOrigin = (origin) => {
  if (!origin) return true;
  return allowedOrigins.some(allowed => {
    if (allowed instanceof RegExp) {
      return allowed.test(origin);
    }
    return allowed === origin;
  });
};

const corsOptions = {
  origin: function (origin, callback) {
    // Allow no-origin server-to-server requests, including uptime checks and Vercel probes.
    if (!origin) {
      return callback(null, true);
    }

    // Check if origin matches any allowed origin (string or regex)
    if (isAllowedOrigin(origin)) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
  optionsSuccessStatus: 200
};

// Core Middleware (Order matters!)
app.use(cors(corsOptions));
app.use(cookieParser());
app.use(compression()); // Compress responses
app.use(securityHeaders); // Security headers via Helmet
app.use(permissionsPolicyHeaders); // L-1: Permissions-Policy header
app.use(express.json({ limit: '10mb' })); // Parse JSON with size limit
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(preventParameterPollution); // Prevent parameter pollution
app.use(requestLogger); // Log all requests
app.use(validateContentType); // Validate content types
app.use(createCookieWriteGuard(isAllowedOrigin)); // CSRF-style protection for cookie-auth writes
app.use(sanitizeProductionErrors); // Avoid exposing internal error details in production route catches

// L-5: Serve public directory (.well-known/security.txt, robots.txt)
app.use(express.static(path.join(__dirname, 'public')));

// Serve uploaded files — authenticated route only (no unauthenticated static access)
app.get(/^\/uploads\/(.+)$/, require('./middleware/auth').authenticate, (req, res) => {
  const rawSegment = req.params[0] || '';
  const uploadsDir = path.join(__dirname, 'uploads');
  const requestedPath = path.normalize(rawSegment).replace(/^(\.\.[/\\])+/, '');
  const filePath = path.join(uploadsDir, requestedPath);
  if (!filePath.startsWith(uploadsDir + path.sep) && filePath !== uploadsDir) {
    return res.status(403).json({ message: 'Access denied' });
  }
  res.sendFile(filePath, (err) => {
    if (err) res.status(404).json({ message: 'File not found' });
  });
});

// Global Rate Limiting
app.use('/api/', globalLimiter);

// L-7: No-cache headers for all API responses
app.use('/api/', noCacheHeaders);

// Database Connection
let sequelize, User, Product, Session;
try {
  const models = require('./models');
  sequelize = models.sequelize;
  User = models.User;
  Product = models.Product;
  Session = models.Session;
  console.log('Models loaded OK. NODE_ENV:', process.env.NODE_ENV);
} catch (modelErr) {
  console.error('MODELS LOAD FAILED:', modelErr.message, modelErr.stack);
  sequelize = null;
  User = null;
}

const generateStartupReferralCode = () => Math.random().toString(36).substring(2, 12).toUpperCase();

const syncSuperAdminUser = async (label) => {
  const adminConfig = getSuperAdminConfig();

  const configuredMatches = await User.scope('withSecrets').findAll({
    where: {
      [Op.or]: [
        { username: adminConfig.username },
        { phone: adminConfig.phone },
        { email: adminConfig.email }
      ]
    },
    order: [['id', 'ASC']]
  });
  const admin =
    configuredMatches.find(user => user.username === adminConfig.username) ||
    configuredMatches.find(user => user.phone === adminConfig.phone) ||
    configuredMatches.find(user => user.email === adminConfig.email) ||
    await User.scope('withSecrets').findOne({
      where: { role: 'superadmin' },
      order: [['id', 'ASC']]
    });

  if (!admin) {
    if (!adminConfig.password) {
      logger.error(`${label}: SUPER_ADMIN_PASSWORD is required to seed the first superadmin`);
      return;
    }

    await User.create({
      username: adminConfig.username,
      phone: adminConfig.phone,
      email: adminConfig.email,
      password_hash: adminConfig.password,
      role: 'superadmin',
      referral_code: generateStartupReferralCode(),
      status: 'active',
      kyc_verified: true,
      emailVerified: true
    });
    logger.info(`${label}: superadmin seeded`);
    return;
  }

  const updates = {};
  if (admin.role !== 'superadmin') updates.role = 'superadmin';
  if (admin.status !== 'active') updates.status = 'active';

  const identifierUpdates = {};
  if (admin.username !== adminConfig.username) identifierUpdates.username = adminConfig.username;
  if (admin.phone !== adminConfig.phone) identifierUpdates.phone = adminConfig.phone;
  if (admin.email !== adminConfig.email) identifierUpdates.email = adminConfig.email;

  if (Object.keys(identifierUpdates).length > 0) {
    const conflictingUser = await User.findOne({
      where: {
        id: { [Op.ne]: admin.id },
        [Op.or]: [
          { username: adminConfig.username },
          { phone: adminConfig.phone },
          { email: adminConfig.email }
        ]
      }
    });

    if (conflictingUser) {
      logger.error(`${label}: cannot sync superadmin login identifiers because a configured identifier belongs to another user`);
    } else {
      Object.assign(updates, identifierUpdates);
    }
  }

  if (!admin.referral_code || admin.referral_code === 'ADMIN00001') {
    updates.referral_code = generateStartupReferralCode();
  }
  if (!admin.kyc_verified) updates.kyc_verified = true;
  if (!admin.emailVerified) updates.emailVerified = true;

  // Password is managed in the DB only. SUPER_ADMIN_PASSWORD is used once for initial seeding
  // and is intentionally ignored on subsequent boots to prevent env-driven overrides.

  if (Object.keys(updates).length > 0) {
    await admin.update(updates);
    logger.info(`${label}: superadmin account credentials and protections synced`);
  } else {
    logger.info(`${label}: superadmin account credentials and protections already synced`);
  }
};

const ensureNotificationEnumValues = async () => {
  if (!sequelize || sequelize.getDialect?.() !== 'postgres') return;

  const notificationTypes = [
    'account_updated',
    'balance_adjusted',
    'phone_changed',
    'password_changed',
    'password_reset',
    'recharge_approved',
    'recharge_rejected',
    'admin_message'
  ];

  for (const type of notificationTypes) {
    try {
      await sequelize.query(`ALTER TYPE "enum_notifications_type" ADD VALUE IF NOT EXISTS '${type}'`);
    } catch (error) {
      logger.warn(`Notification enum compatibility skipped for ${type}: ${error.message}`);
    }
  }
};

const syncVipProducts = async (label) => {
  if (process.env.AUTO_SYNC_VIP_PRODUCTS === 'false') {
    logger.info(`${label}: VIP product sync disabled`);
    return;
  }

  const rate = await getNslPerUsdt();
  const settings = await ps.getAll();
  const validityDays = Number(settings.dur_week) || 7;
  let created = 0;
  let updated = 0;

  for (const plan of VIP_PRODUCT_PLANS) {
    const [, wasCreated] = await Product.upsert(planToProductSeed(plan, rate, validityDays));
    wasCreated ? created++ : updated++;
  }

  logger.info(`${label}: VIP products synced (created=${created}, updated=${updated}, rate=${rate})`);
};

// On Vercel: skip startup DB sync (too slow for cold start). Tables are synced lazily.
// On server: sync on startup as normal.
if (!isVercel) {
  (async () => {
    try {
      await sequelize.authenticate();
      logger.info('Database connected');
      await ensureNotificationEnumValues();
      await sequelize.sync({ alter: false, force: false });
      logger.info('Database tables synced');
      await syncSuperAdminUser('Database');
      await syncVipProducts('Database');
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
const notificationRoutes = require('./routes/notifications');
const analyticsRoutes = require('./routes/analytics');
const batchRoutes = require('./routes/batch');
const exportRoutes = require('./routes/export');
const securityRoutes = require('./routes/security');
const depositRoutes = require('./routes/deposit');
const testimonialsRoutes = require('./routes/testimonials');
const chatRoutes = require('./routes/chat');
const ambassadorRoutes = require('./routes/ambassador');
const pushRoutes = require('./routes/push');

// Ping is always available — no DB dependency
app.get('/api/ping', (req, res) => {
  res.json({ ok: true, ready: dbReady, env: process.env.NODE_ENV });
});

// On Vercel: sync DB + seed admin on first request (lazy init)
let dbReady = false;
let dbInitPromise = null;

const initDb = async () => {
  try {
    await sequelize.authenticate();
    logger.info('Vercel DB: authenticated');
    // Add enum values and missing columns if not already present
    const safeMigrations = [
      `ALTER TYPE "enum_transactions_payment_method" ADD VALUE IF NOT EXISTS 'orange_money'`,
      `ALTER TYPE "enum_transactions_payment_method" ADD VALUE IF NOT EXISTS 'africell'`,
      `ALTER TABLE "transactions" ADD COLUMN IF NOT EXISTS "reference_id" VARCHAR(255)`,
      `ALTER TABLE "transactions" ADD COLUMN IF NOT EXISTS "approved_at" TIMESTAMP WITH TIME ZONE`,
      `ALTER TABLE "transactions" ADD COLUMN IF NOT EXISTS "rejected_at" TIMESTAMP WITH TIME ZONE`,
      `ALTER TABLE "transactions" ADD COLUMN IF NOT EXISTS "admin_notes" TEXT`,
      `ALTER TABLE "transactions" ADD COLUMN IF NOT EXISTS "confirmations" INTEGER DEFAULT 0`,
      `ALTER TYPE "enum_users_role" ADD VALUE IF NOT EXISTS 'ambassador'`,
      `ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "ambassador_region" VARCHAR(100)`,
      `ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "ambassador_sector" VARCHAR(100)`,
      `ALTER TABLE "users" DROP COLUMN IF EXISTS "profile_photo"`,
      `ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "tax_income_NSL" DECIMAL(18,4) NOT NULL DEFAULT 0`,
      `ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "failed_login_attempts" INTEGER NOT NULL DEFAULT 0`,
      `ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "locked_until" TIMESTAMP WITH TIME ZONE`,
      `ALTER TABLE "sessions" ADD COLUMN IF NOT EXISTS "twoFactorVerified" BOOLEAN NOT NULL DEFAULT FALSE`,
    ];
    for (const migration of safeMigrations) {
      try {
        await sequelize.query(migration);
      } catch (_) { /* ignore dialect-specific no-op migrations */ }
    }
    await ensureNotificationEnumValues();
    await sequelize.sync({ force: false });
    logger.info('Vercel DB: synced');
    await syncSuperAdminUser('Vercel DB');

    // Fix corrupted exchange rate — NSL is internal (1 USDT = 23 NSL), never real-world SLE
    try {
      const { PaymentSetting } = require('./models');
      const rateRow = await PaymentSetting.findOne({ where: { key: 'exchange_rate_nsl_per_usdt' } });
      const storedRate = rateRow ? parseFloat(rateRow.value) : 0;
      if (!storedRate || storedRate > 100) {
        await PaymentSetting.upsert({ key: 'exchange_rate_nsl_per_usdt', value: '23' });
        ps.invalidate();
        logger.info('Vercel DB: exchange rate reset to 23 NSL/USDT');
      }
    } catch (e) {
      logger.warn('Exchange rate reset skipped:', e.message);
    }

    // Seed task reward settings if not yet present
    try {
      const { PaymentSetting: PS2 } = require('./models');
      const taskSettingDefaults = [
        ['daily_checkin_reward_NSL', '5'],
        ['explore_vip_reward_NSL', '10'],
        ['first_deposit_bonus_NSL', '100'],
        ['vip_tax_daily_count', '3'],
      ];
      for (const [key, value] of taskSettingDefaults) {
        const existing = await PS2.findOne({ where: { key } });
        if (!existing) await PS2.upsert({ key, value });
      }
      ps.invalidate();
      logger.info('Vercel DB: task reward settings seeded');
    } catch (e) {
      logger.warn('Task reward settings seed skipped:', e.message);
    }

    await syncVipProducts('Vercel DB');
    dbReady = true;
    logger.info('Vercel DB: ready');
  } catch (err) {
    dbInitPromise = null; // allow retry on next request
    logger.error('Vercel DB init error:', err.message, err.stack);
    throw err;
  }
};

if (isVercel) {
  app.use(async (req, res, next) => {
    if (dbReady) return next();
    try {
      if (!dbInitPromise) dbInitPromise = initDb();
      await dbInitPromise;
    } catch (err) {
      return res.status(503).json({ message: 'Service initializing, please retry', error: err.message });
    }
    next();
  });
}

// Register Routes
app.use('/api/auth', authRoutes);
app.use('/api/user', userRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/superadmin', adminRoutes);
app.use('/api/finance', financeRoutes);
app.use('/api/verificator', verificatorRoutes);
app.use('/api/approval', approvalRoutes);
app.use('/api/products', productsRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/admin/notifications', notificationRoutes);
app.use('/api/analytics', analyticsRoutes);
app.use('/api/batch', batchRoutes);
app.use('/api/export', exportRoutes);
app.use('/api/security', securityRoutes);
app.use('/api/deposit', depositRoutes);
app.use('/api/files', fileRoutes);
app.use('/api/testimonials', testimonialsRoutes);
app.use('/api/chat', chatRoutes);
app.use('/api/ambassador', ambassadorRoutes);
app.use('/api/push', pushRoutes);
app.use('/api/orange-money', require('./routes/orangeMoney'));
app.use('/api/cron', require('./routes/cron'));
app.use('/api/tasks', require('./routes/tasks'));

// Root API info
app.get('/api', (req, res) => {
  res.json({ name: 'Gold Mine API', status: 'running', version: '1.0.0' });
});

app.get(['/admin', '/superadmin'], (req, res) => {
  const frontendUrl = (process.env.FRONTEND_URL || 'https://salonmoneynew.vercel.app').replace(/\/+$/, '');
  res.redirect(302, `${frontendUrl}/admin`);
});

// Secret-protected superadmin password reset (emergency use only)
const _isStrongPassword = (v) => /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]{8,}$/.test(String(v || ''));
const _timingSafeEqual = (a, b) => {
  const ha = crypto.createHmac('sha256', 'cmp').update(a).digest();
  const hb = crypto.createHmac('sha256', 'cmp').update(b).digest();
  return crypto.timingSafeEqual(ha, hb);
};

app.post('/api/reset-admin-password', passwordResetLimiter, async (req, res) => {
  const { secret, new_password } = req.body;
  const resetSecret = process.env.RESET_SECRET;
  const auditCtx = { ip: req.ip, ua: req.get('user-agent'), ts: new Date().toISOString() };

  if (!resetSecret) {
    logger.error('Emergency reset: RESET_SECRET not configured', auditCtx);
    return res.status(503).json({ message: 'Emergency reset unavailable' });
  }

  if (!_timingSafeEqual(String(secret || ''), resetSecret)) {
    logger.warn('SECURITY: Emergency reset invalid secret attempt', auditCtx);
    return res.status(403).json({ message: 'Forbidden' });
  }

  if (!_isStrongPassword(new_password)) {
    return res.status(400).json({ message: 'Password must be at least 8 characters with uppercase, lowercase, number, and special character' });
  }

  try {
    const admin = await User.scope('withSecrets').findOne({ where: { role: 'superadmin' } });
    if (!admin) {
      logger.warn('SECURITY: Emergency reset — superadmin not found', auditCtx);
      return res.status(404).json({ message: 'Superadmin not found' });
    }
    admin.password_hash = new_password;
    await admin.save();

    const { Session } = require('./models');
    await Session.update({ is_active: false }, { where: { user_id: admin.id, is_active: true } });

    logger.warn('SECURITY: Emergency admin password reset succeeded', { ...auditCtx, username: admin.username });
    res.json({ message: 'Password reset', username: admin.username });
  } catch (err) {
    logger.error('Emergency reset error', { ...auditCtx, error: err.message });
    res.status(500).json({ message: err.message });
  }
});

// Seed products (admin-only, idempotent)
app.post('/api/admin/seed-products', authenticate, (req, res, next) => {
  if (req.user.role !== 'superadmin') return res.status(403).json({ message: 'Forbidden' });
  next();
}, async (req, res) => {

  const Product = require('./models/Product');
  const NSL_RATE = await getNslPerUsdt();
  const settings = await ps.getAll();
  const validityDays = Number(settings.dur_week) || 7;
  const plans = VIP_PRODUCT_PLANS.map(plan => planToProductSeed(plan, NSL_RATE, validityDays));

  let created = 0, updated = 0;
  for (const p of plans) {
    const [, wasCreated] = await Product.upsert(p);
    wasCreated ? created++ : updated++;
  }
  const { recordAdminAudit } = require('./utils/adminAudit');
  await recordAdminAudit(req, {
    action: 'products.seed',
    targetType: 'product',
    metadata: { created, updated, total: plans.length, exchange_rate_nsl_per_usdt: NSL_RATE },
  });
  res.json({ message: 'Products seeded', created, updated, total: plans.length, exchange_rate_nsl_per_usdt: NSL_RATE });
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
    const nslRate = await getNslPerUsdt();

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
          amount_usdt: nslToUsdt(dailyIncome, nslRate),
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
        data.user.balance_usdt = syncUsdtBalanceFromNsl(data.user.balance_NSL, nslRate);
        await data.user.save();
        totalIncomeGenerated += data.total;
        totalUsersProcessed++;
        logger.info(`Income generated for ${data.user.phone}: ${data.total} NSL`);

        if (data.user.email) {
          emailService.sendDailyIncomeSummary(data.user.email, data.user.username, data.total, data.user.balance_NSL)
            .catch(err => logger.error(`Daily income email failed for ${data.user.phone}:`, err));
        }
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
    const nslRate = await getNslPerUsdt();

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
          user.balance_usdt = syncUsdtBalanceFromNsl(user.balance_NSL, nslRate);
          up.expires_at = new Date(up.expires_at.getTime() + (product.validity_days * 24 * 60 * 60 * 1000));

          await Transaction.create({
            user_id: user.id,
            type: 'renewal',
            amount_NSL: product.price_NSL,
            amount_usdt: nslToUsdt(product.price_NSL, nslRate),
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

          if (user.email) {
            emailService.sendProductExpiring(user.email, user.username, product.name, up.expires_at, user.balance_NSL, product.price_NSL)
              .catch(err => logger.error(`Product expiry email failed for ${user.phone}:`, err));
          }
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
    ...(process.env.NODE_ENV === 'development' && { path: req.originalUrl })
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

  const statusCode = err.status || err.statusCode || 500;
  const isClientError = statusCode >= 400 && statusCode < 500;
  const message = isClientError
    ? (err.message || 'Request failed')
    : 'Internal Server Error';

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
