const express = require('express');
const http = require('http');
const mongoose = require('mongoose');
const cors = require('cors');
const compression = require('compression');
const dotenv = require('dotenv');
const cron = require('node-cron');
const logger = require('./utils/logger');

// Security middleware
const {
  sanitizeInput,
  securityHeaders,
  globalLimiter,
  requestLogger,
  validateContentType,
  preventParameterPollution
} = require('./middleware/security');

dotenv.config();

const app = express();
const server = http.createServer(app);

// Trust proxy - Important for rate limiting behind reverse proxies
app.set('trust proxy', 1);

// CORS Configuration - Allow frontend to access backend
const corsOptions = {
  origin: process.env.FRONTEND_URL || 'http://localhost:3000',
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
app.use(sanitizeInput); // Prevent NoSQL injection
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
mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/salonmoney', {
  useNewUrlParser: true,
  useUnifiedTopology: true
})
.then(() => logger.info('MongoDB connected'))
.catch(err => logger.error('MongoDB connection error:', err));

// Initialize Socket.io
const { initializeSocket } = require('./config/socket');
initializeSocket(server);
logger.info('Socket.io initialized');

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
const binanceRoutes = require('./routes/binance');

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
app.use('/api/binance', binanceRoutes);

// Health Check
app.get('/api/health', (req, res) => {
  res.json({ status: 'Server is running', timestamp: new Date() });
});

// Cron Job: Daily Income (Enhanced with validity checking)
cron.schedule('0 0 * * *', async () => {
  try {
    logger.info('Running daily income cron job...');
    const User = require('./models/User');
    const Transaction = require('./models/Transaction');

    const users = await User.find({ status: 'active' }).populate('products.product_id');
    const now = new Date();
    let totalIncomeGenerated = 0;
    let totalUsersProcessed = 0;

    for (let user of users) {
      let userTotalIncome = 0;

      for (let userProduct of user.products) {
        // Check if product is active, not expired, and has daily income
        if (
          userProduct.is_active &&
          userProduct.expires_at > now &&
          userProduct.product_id &&
          userProduct.product_id.daily_income_NSL > 0
        ) {
          const dailyIncome = userProduct.product_id.daily_income_NSL;
          userTotalIncome += dailyIncome;

          // Create income transaction for this specific product
          await Transaction.create({
            user_id: user._id,
            type: 'income',
            amount_NSL: dailyIncome,
            product_id: userProduct.product_id._id,
            status: 'approved',
            notes: `Daily income from ${userProduct.product_id.name}`
          });
        }
      }

      if (userTotalIncome > 0) {
        user.balance_NSL += userTotalIncome;
        await user.save();
        totalIncomeGenerated += userTotalIncome;
        totalUsersProcessed++;
        logger.info(`Income generated for ${user.phone}: ${userTotalIncome} NSL from ${user.products.filter(p => p.is_active && p.expires_at > now).length} products`);
      }
    }

    logger.info(`Daily income cron completed: ${totalUsersProcessed} users, ${totalIncomeGenerated.toLocaleString()} NSL total`);
  } catch (error) {
    logger.error('Error in daily income cron:', error);
  }
});

// Cron Job: Update Exchange Rates (Runs every 4 hours)
cron.schedule('0 */4 * * *', async () => {
  try {
    logger.info('Running exchange rate update cron job...');
    const binanceService = require('./services/binanceService');

    if (binanceService.isConfigured) {
      const result = await binanceService.updateExchangeRates();
      logger.info(`Exchange rates updated: ${result.updated} currencies updated, ${result.failed} failed`);
    } else {
      logger.warn('Binance API not configured. Skipping exchange rate update.');
    }
  } catch (error) {
    logger.error('Error in exchange rate update cron:', error);
  }
});

// Cron Job: Auto-Renewal (Runs at 12:01 AM, after income generation)
cron.schedule('1 0 * * *', async () => {
  try {
    logger.info('Running auto-renewal cron job...');
    const User = require('./models/User');
    const Transaction = require('./models/Transaction');

    const users = await User.find({ status: 'active' }).populate('products.product_id');
    const now = new Date();
    const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);

    let totalRenewed = 0;
    let totalDeactivated = 0;

    for (let user of users) {
      let userModified = false;

      for (let userProduct of user.products) {
        // Check if product expires within 24 hours and auto-renew is enabled
        if (
          userProduct.is_active &&
          userProduct.auto_renew &&
          userProduct.expires_at <= tomorrow &&
          userProduct.expires_at > now &&
          userProduct.product_id
        ) {
          const product = userProduct.product_id;

          // Check if user has sufficient balance
          if (user.balance_NSL >= product.price_NSL) {
            // Renew product
            user.balance_NSL -= product.price_NSL;
            userProduct.expires_at = new Date(userProduct.expires_at.getTime() + (product.validity_days * 24 * 60 * 60 * 1000));

            // Create renewal transaction
            await Transaction.create({
              user_id: user._id,
              type: 'renewal',
              amount_NSL: product.price_NSL,
              amount_usdt: product.price_usdt,
              product_id: product._id,
              status: 'approved',
              notes: `Auto-renewal of ${product.name} for ${product.validity_days} days`
            });

            totalRenewed++;
            userModified = true;
            logger.info(`Auto-renewed ${product.name} for ${user.phone} - New expiration: ${userProduct.expires_at.toLocaleDateString()}`);
          } else {
            // Insufficient balance - deactivate product
            userProduct.is_active = false;
            totalDeactivated++;
            userModified = true;
            logger.warn(`Failed to renew ${product.name} for ${user.phone} - Insufficient balance (need ${product.price_NSL} NSL, have ${user.balance_NSL} NSL)`);
          }
        }
      }

      if (userModified) {
        await user.save();
      }
    }

    logger.info(`Auto-renewal cron completed: ${totalRenewed} products renewed, ${totalDeactivated} products deactivated`);
  } catch (error) {
    logger.error('Error in auto-renewal cron:', error);
  }
});

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

  // Mongoose validation error
  if (err.name === 'ValidationError') {
    return res.status(400).json({
      success: false,
      message: 'Validation Error',
      errors: Object.values(err.errors).map(e => e.message)
    });
  }

  // Mongoose duplicate key error
  if (err.code === 11000) {
    const field = Object.keys(err.keyPattern)[0];
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

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
  logger.info(`Server running on port ${PORT}`);
  logger.info(`Socket.io listening on port ${PORT}`);
});

module.exports = app;
