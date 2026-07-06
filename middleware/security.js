const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const { RedisStore } = require('rate-limit-redis');

let redisClient = null;

function getRedisClient() {
  if (redisClient) return redisClient;
  if (!process.env.REDIS_URL) return null;
  try {
    const Redis = require('ioredis');
    redisClient = new Redis(process.env.REDIS_URL, {
      enableOfflineQueue: false,
      maxRetriesPerRequest: 1,
      connectTimeout: 3000,
    });
    redisClient.on('error', (err) => {
      const logger = require('../utils/logger');
      logger.warn('Redis rate-limit store error:', err.message);
    });
    return redisClient;
  } catch {
    return null;
  }
}

function makeStore(prefix) {
  const client = getRedisClient();
  if (!client) return undefined;
  return new RedisStore({
    prefix: `rl:${prefix}:`,
    sendCommand: (...args) => client.call(...args),
  });
}

const UNSAFE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * Security Headers Middleware
 * Uses Helmet to set various HTTP headers for security
 */
const securityHeaders = helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
      fontSrc: ["'self'", "https://fonts.gstatic.com"],
      imgSrc: ["'self'", "data:", "https:", "blob:"],
      scriptSrc: ["'self'"],
      connectSrc: ["'self'", process.env.FRONTEND_URL || "http://localhost:3000"]
    }
  },
  hsts: {
    maxAge: 31536000,
    includeSubDomains: true,
    preload: true
  },
  // L-11: explicit referrer policy and origin isolation
  referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
  originAgentCluster: true,
  // L-2: disable COEP (we load cross-origin fonts/images)
  crossOriginEmbedderPolicy: false
});

// L-1: Permissions-Policy header (not built into Helmet 8)
const permissionsPolicyHeaders = (req, res, next) => {
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=(self)');
  next();
};

// L-7: Prevent caching of sensitive API responses
const noCacheHeaders = (req, res, next) => {
  res.setHeader('Cache-Control', 'private, no-cache, no-store, must-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  next();
};

/**
 * Global Rate Limiter
 */
const globalLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  max: 150,
  store: makeStore('global'),
  message: 'Too many requests from this IP, please try again later.',
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => {
    res.status(429).json({
      success: false,
      message: 'Too many requests. Please try again later.',
      retryAfter: Math.ceil(req.rateLimit.resetTime / 1000)
    });
  }
});

/**
 * Authentication Rate Limiter
 */
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 8,
  store: makeStore('auth'),
  skipSuccessfulRequests: true,
  standardHeaders: true,
  legacyHeaders: false,
  message: 'Too many authentication attempts. Please try again later.',
  handler: (req, res) => {
    res.status(429).json({
      success: false,
      message: 'Too many login attempts. Please try again after 15 minutes.',
      retryAfter: Math.ceil(req.rateLimit.resetTime / 1000)
    });
  }
});

/**
 * Transaction Rate Limiter
 */
const transactionLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 30,
  store: makeStore('tx'),
  message: 'Too many transaction requests. Please try again later.',
  handler: (req, res) => {
    res.status(429).json({
      success: false,
      message: 'Transaction limit exceeded. Please try again later.',
      retryAfter: Math.ceil(req.rateLimit.resetTime / 1000)
    });
  }
});

/**
 * Admin Action Rate Limiter
 */
const adminLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  store: makeStore('admin'),
  message: 'Too many admin operations. Please slow down.',
  handler: (req, res) => {
    res.status(429).json({
      success: false,
      message: 'Too many admin operations. Please wait before continuing.',
      retryAfter: Math.ceil(req.rateLimit.resetTime / 1000)
    });
  }
});

/**
 * Finance Action Rate Limiter
 */
const financeLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  max: 30,
  store: makeStore('finance'),
  message: 'Too many finance operations. Please slow down.',
  handler: (req, res) => {
    res.status(429).json({
      success: false,
      message: 'Too many finance operations. Please wait before continuing.',
      retryAfter: Math.ceil(req.rateLimit.resetTime / 1000)
    });
  }
});

/**
 * Password Reset Rate Limiter
 */
const passwordResetLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 3,
  store: makeStore('pwd-reset'),
  standardHeaders: true,
  legacyHeaders: false,
  message: 'Too many password reset attempts.',
  handler: (req, res) => {
    res.status(429).json({
      success: false,
      message: 'You have requested too many password resets. Please try again later.',
      retryAfter: Math.ceil(req.rateLimit.resetTime / 1000)
    });
  }
});

/**
 * Signup Rate Limiter — HIGH FIX
 * Prevents account creation spam / enumeration.
 */
const signupLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 2,
  store: makeStore('signup'),
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: false,
  message: 'Too many accounts created from this IP.',
  handler: (req, res) => {
    res.status(429).json({
      success: false,
      message: 'Too many signup attempts. Please try again later.',
      retryAfter: Math.ceil(req.rateLimit.resetTime / 1000)
    });
  }
});

/**
 * Deposit Submit Rate Limiter — HIGH FIX
 * Limits how many deposit submissions a user/IP can make per window.
 */
const depositLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 10,
  store: makeStore('deposit'),
  message: 'Too many deposit submissions.',
  handler: (req, res) => {
    res.status(429).json({
      success: false,
      message: 'Too many deposit submissions. Please wait before submitting again.',
      retryAfter: Math.ceil(req.rateLimit.resetTime / 1000)
    });
  }
});

/**
 * IP Whitelist Middleware (for admin routes in production)
 */
const ipWhitelist = (allowedIPs = []) => {
  return (req, res, next) => {
    if (process.env.NODE_ENV !== 'production') {
      return next();
    }

    const clientIP = req.ip || req.connection.remoteAddress;

    if (!allowedIPs.includes(clientIP)) {
      return res.status(403).json({
        success: false,
        message: 'Access denied from this IP address'
      });
    }

    next();
  };
};

/**
 * Request Logger Middleware
 */
const requestLogger = (req, res, next) => {
  const logger = require('../utils/logger');

  const logData = {
    method: req.method,
    url: req.url,
    ip: req.ip || req.connection.remoteAddress,
    userAgent: req.get('user-agent'),
    timestamp: new Date().toISOString()
  };

  if (req.user) {
    logData.userId = req.user.id;
    logData.userRole = req.user.role;
  }

  logger.info('Request received', logData);
  next();
};

/**
 * Validate Content Type
 */
const validateContentType = (req, res, next) => {
  if (['POST', 'PUT', 'PATCH'].includes(req.method)) {
    const contentType = req.get('content-type');
    // Only reject when a content-type IS provided but it's the wrong type.
    // No content-type = no body (or empty body) — allow through.
    if (contentType && !contentType.includes('application/json') && !contentType.includes('multipart/form-data')) {
      return res.status(400).json({
        success: false,
        message: 'Invalid content-type. Expected application/json or multipart/form-data'
      });
    }
  }
  next();
};

const createCookieWriteGuard = (isAllowedOrigin) => {
  return (req, res, next) => {
    if (!UNSAFE_METHODS.has(req.method)) return next();
    if (!req.path.startsWith('/api/')) return next();

    const hasCookieAuth = Boolean(req.cookies?.access_token || req.cookies?.refresh_token);
    if (!hasCookieAuth) return next();

    const origin = req.get('origin');
    if (origin && !isAllowedOrigin(origin)) {
      return res.status(403).json({ success: false, message: 'Request origin is not allowed' });
    }

    const requestedWith = req.get('x-requested-with');
    const hasBearer = req.get('authorization')?.startsWith('Bearer ');
    if (!hasBearer && requestedWith !== 'XMLHttpRequest') {
      return res.status(403).json({ success: false, message: 'Request verification failed' });
    }

    next();
  };
};

const sanitizeProductionErrors = (req, res, next) => {
  const originalJson = res.json.bind(res);

  res.json = (body) => {
    if (
      process.env.NODE_ENV === 'production' &&
      res.statusCode >= 500 &&
      body &&
      typeof body === 'object' &&
      Object.prototype.hasOwnProperty.call(body, 'error')
    ) {
      const sanitized = { ...body };
      delete sanitized.error;
      return originalJson(sanitized);
    }

    return originalJson(body);
  };

  next();
};

/**
 * Prevent Parameter Pollution
 */
const preventParameterPollution = (req, res, next) => {
  Object.keys(req.query).forEach(key => {
    if (Array.isArray(req.query[key])) {
      req.query[key] = req.query[key][req.query[key].length - 1];
    }
  });

  next();
};

/**
 * Change Password Rate Limiter — prevents brute-force password cycling
 */
const changePasswordLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 10,
  store: makeStore('pwd-change'),
  skipSuccessfulRequests: false,
  standardHeaders: true,
  legacyHeaders: false,
  message: 'Too many password change attempts.',
  handler: (req, res) => {
    res.status(429).json({
      success: false,
      message: 'Too many password change attempts. Please try again later.',
      retryAfter: Math.ceil(req.rateLimit.resetTime / 1000)
    });
  }
});

/**
 * KYC Upload Rate Limiter
 */
const kycUploadLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 10,
  store: makeStore('kyc'),
  message: 'Too many KYC upload attempts.',
  handler: (req, res) => {
    res.status(429).json({
      success: false,
      message: 'Too many KYC uploads. Please try again later.',
      retryAfter: Math.ceil(req.rateLimit.resetTime / 1000)
    });
  }
});

/**
 * Require superadmin to have completed 2FA in this session before
 * performing destructive/privileged actions.
 */
const requireSuperadmin2FA = (req, res, next) => {
  if (req.user?.role !== 'superadmin') return next();
  if (!req.user.twoFactorEnabled) return next();
  if (req.twoFactorVerified) return next();
  return res.status(403).json({
    success: false,
    message: 'This action requires 2FA verification. Please log out and log back in to complete 2FA.'
  });
};

/**
 * Helper function to reset all rate limits for a specific IP
 */
const resetLimitsForIP = async (ip) => {
  const logger = require('../utils/logger');
  try {
    logger.info(`Rate limit reset requested for IP: ${ip} (limits will auto-expire)`);
    return { success: true, message: 'Rate limits will auto-expire based on configured windows' };
  } catch (error) {
    logger.error('Error in resetLimitsForIP:', error);
    return { success: false, message: error.message };
  }
};

module.exports = {
  securityHeaders,
  permissionsPolicyHeaders,
  noCacheHeaders,
  globalLimiter,
  authLimiter,
  signupLimiter,
  depositLimiter,
  transactionLimiter,
  adminLimiter,
  financeLimiter,
  passwordResetLimiter,
  changePasswordLimiter,
  kycUploadLimiter,
  requireSuperadmin2FA,
  resetLimitsForIP,
  ipWhitelist,
  requestLogger,
  validateContentType,
  createCookieWriteGuard,
  sanitizeProductionErrors,
  preventParameterPollution
};
