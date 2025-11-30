const mongoSanitize = require('express-mongo-sanitize');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');

/**
 * Request Sanitization Middleware
 * Prevents NoSQL injection by removing $ and . from user input
 */
const sanitizeInput = mongoSanitize({
  replaceWith: '_',
  onSanitize: ({ req, key }) => {
    console.warn(`Potential NoSQL injection attempt detected. Field: ${key}`);
  }
});

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
 * Prevents brute force attacks by limiting requests per IP
 */
const globalLimiter = rateLimit({
  windowMs: 5 * 60 * 1000, // 5 minutes
  max: 1000, // INCREASED FOR DEV: Limit each IP to 1000 requests per windowMs
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
 * Stricter limits for login/signup to prevent brute force
 */
const authLimiter = rateLimit({
  windowMs: 5 * 60 * 1000, // 5 minutes
  max: 100, // INCREASED FOR DEV: Limit each IP to 100 login attempts per windowMs
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
 * Prevents spam of transaction requests
 */
const transactionLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 100, // INCREASED FOR DEV: Limit each user to 100 transactions per hour
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
 * Limits admin operations to prevent accidental bulk operations
 */
const adminLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 60, // INCREASED FOR DEV: 60 requests per minute
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
 * Limits finance operations to prevent errors
 */
const financeLimiter = rateLimit({
  windowMs: 5 * 60 * 1000, // 5 minutes
  max: 60, // INCREASED FOR DEV: 60 requests per 5 minutes
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
 * Prevents password reset spam
 */
const passwordResetLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 10, // INCREASED FOR DEV: Maximum 10 password reset requests per hour
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
 * IP Whitelist Middleware (for admin routes in production)
 */
const ipWhitelist = (allowedIPs = []) => {
  return (req, res, next) => {
    // Skip in development
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
 * Logs all requests for security auditing
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

  // Log authenticated user if available
  if (req.user) {
    logData.userId = req.user.id;
    logData.userRole = req.user.role;
  }

  logger.info('Request received', logData);
  next();
};

/**
 * Validate Content Type
 * Ensures requests have proper content-type
 */
const validateContentType = (req, res, next) => {
  if (['POST', 'PUT', 'PATCH'].includes(req.method)) {
    const contentType = req.get('content-type');

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
 * Removes duplicate query parameters
 */
const preventParameterPollution = (req, res, next) => {
  // Convert array parameters to single values (use last value)
  Object.keys(req.query).forEach(key => {
    if (Array.isArray(req.query[key])) {
      req.query[key] = req.query[key][req.query[key].length - 1];
    }
  });

  next();
};

// --- NEW FUNCTION ADDED HERE ---
/**
 * Helper function to reset all rate limits for a specific IP
 */
const resetLimitsForIP = (ip) => {
  globalLimiter.resetKey(ip);
  authLimiter.resetKey(ip);
  transactionLimiter.resetKey(ip);
  adminLimiter.resetKey(ip);
  financeLimiter.resetKey(ip);
  passwordResetLimiter.resetKey(ip);
};
// -------------------------------

module.exports = {
  sanitizeInput,
  securityHeaders,
  globalLimiter,
  authLimiter,
  transactionLimiter,
  adminLimiter,
  financeLimiter,
  passwordResetLimiter,
  resetLimitsForIP, // Added to exports
  ipWhitelist,
  requestLogger,
  validateContentType,
  preventParameterPollution
};