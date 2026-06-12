const helmet = require('helmet');
const rateLimit = require('express-rate-limit');

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
  }
});

/**
 * Global Rate Limiter
 */
const globalLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  max: 150,
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
  windowMs: 5 * 60 * 1000,
  max: 15,
  skipSuccessfulRequests: true,
  message: 'Too many authentication attempts. Please try again later.',
  handler: (req, res) => {
    res.status(429).json({
      success: false,
      message: 'Too many login attempts. Please try again after 5 minutes.',
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
  max: 5,
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
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 10,
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
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 10,
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
    const contentLength = parseInt(req.get('content-length') || '0', 10);

    // Allow empty-body requests and chunked transfers with no content-length
    if (!contentLength) return next();

    if (!contentType || (!contentType.includes('application/json') && !contentType.includes('multipart/form-data'))) {
      return res.status(400).json({
        success: false,
        message: 'Invalid content-type. Expected application/json or multipart/form-data'
      });
    }
  }

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
  globalLimiter,
  authLimiter,
  signupLimiter,
  depositLimiter,
  transactionLimiter,
  adminLimiter,
  financeLimiter,
  passwordResetLimiter,
  resetLimitsForIP,
  ipWhitelist,
  requestLogger,
  validateContentType,
  preventParameterPollution
};
