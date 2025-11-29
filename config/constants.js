/**
 * Application Constants
 * Centralized configuration values used throughout the application
 */

module.exports = {
  // Currency Conversion Rates
  CURRENCY: {
    NSL_TO_USDT_RATE: process.env.NSL_TO_USDT_RECHARGE || 25,
    USDT_TO_NSL_RATE: process.env.USDT_TO_NSL_WITHDRAWAL || 25,
    DEFAULT_CURRENCY: 'NSL',
    SUPPORTED_CURRENCIES: ['NSL', 'USDT']
  },

  // Referral Program Settings
  REFERRAL: {
    BONUS_PERCENTAGE: parseFloat(process.env.REFERRAL_BONUS_PERCENTAGE) || 35,
    MAX_REFERRAL_LEVEL: parseInt(process.env.MAX_REFERRAL_LEVEL) || 1,
    MIN_RECHARGE_FOR_BONUS: 0 // Minimum recharge amount to trigger referral bonus
  },

  // Product Settings
  PRODUCT: {
    DEFAULT_VALIDITY_DAYS: 60,
    VIP_LEVELS: ['VIP1', 'VIP2', 'VIP3', 'VIP4', 'VIP5', 'VIP6', 'VIP7', 'VIP8', 'VIP9'],
    AUTO_RENEWAL_ENABLED: true
  },

  // Transaction Settings
  TRANSACTION: {
    TYPES: ['recharge', 'withdrawal', 'income', 'referral_bonus', 'purchase', 'renewal'],
    STATUSES: ['pending', 'approved', 'rejected', 'completed'],
    DEFAULT_STATUS: 'pending',
    PENDING_EXPIRY_DAYS: 7 // Days before pending transaction expires
  },

  // User Settings
  USER: {
    ROLES: ['user', 'admin', 'superadmin', 'finance', 'verificator', 'approval'],
    DEFAULT_ROLE: 'user',
    STATUSES: ['pending', 'active', 'frozen', 'rejected'],
    DEFAULT_STATUS: 'pending',
    MIN_PASSWORD_LENGTH: 8
  },

  // File Upload Settings
  UPLOAD: {
    MAX_FILE_SIZE: 10 * 1024 * 1024, // 10MB
    ALLOWED_IMAGE_TYPES: ['image/jpeg', 'image/jpg', 'image/png', 'image/gif'],
    ALLOWED_DOCUMENT_TYPES: ['application/pdf', 'image/jpeg', 'image/jpg', 'image/png'],
    PROFILE_PHOTO_PATH: 'uploads/profiles',
    DOCUMENT_PATH: 'uploads/documents'
  },

  // Security Settings
  SECURITY: {
    JWT_EXPIRE: process.env.JWT_EXPIRE || '24h',
    REFRESH_TOKEN_EXPIRE: process.env.REFRESH_TOKEN_EXPIRE || '7d',
    PASSWORD_RESET_EXPIRE: 60 * 60 * 1000, // 1 hour in milliseconds
    EMAIL_VERIFICATION_EXPIRE: 24 * 60 * 60 * 1000, // 24 hours
    TWO_FA_CODE_EXPIRE: 10 * 60 * 1000, // 10 minutes
    BCRYPT_SALT_ROUNDS: 10,
    RATE_LIMIT_WINDOW: 15 * 60 * 1000, // 15 minutes
    RATE_LIMIT_MAX_REQUESTS: 100
  },

  // Cron Job Schedules
  CRON: {
    DAILY_INCOME: '0 0 * * *', // Midnight
    AUTO_RENEWAL: '1 0 * * *', // 12:01 AM
    CLEANUP_EXPIRED_TOKENS: '0 2 * * *' // 2 AM
  },

  // Email Templates
  EMAIL: {
    FROM_NAME: process.env.EMAIL_FROM || 'SalonMoney',
    SUPPORT_EMAIL: 'support@salonmoney.com',
    NO_REPLY_EMAIL: 'noreply@salonmoney.com'
  },

  // Binance Integration
  BINANCE: {
    TESTNET: process.env.BINANCE_TESTNET === 'true',
    DEFAULT_NETWORK: 'BSC', // Binance Smart Chain
    SUPPORTED_NETWORKS: ['BSC', 'ETH', 'TRC20'],
    DEPOSIT_CONFIRMATION_BLOCKS: 12
  },

  // Pagination
  PAGINATION: {
    DEFAULT_PAGE: 1,
    DEFAULT_LIMIT: 20,
    MAX_LIMIT: 100
  },

  // Application Info
  APP: {
    NAME: 'SalonMoney',
    VERSION: '1.0.0',
    ENVIRONMENT: process.env.NODE_ENV || 'development',
    FRONTEND_URL: process.env.FRONTEND_URL || 'http://localhost:3000'
  }
};
