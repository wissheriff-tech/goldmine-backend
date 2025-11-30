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
  max: 100, // Limit each IP to 100 requests per windowMs
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
  max: 20, // Limit each IP to 20 login attempts per windowMs (increased for testing)
  skipSuccessfulRequests: true,
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
 * Prevents spam of transaction requests
 */
const transactionLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 10, // Limit each user to 10 transactions per hour
  message: 'Too many transaction requests. Please try again later.',
  handler: (req, res) => {
    res.status(429).json({
      success: false,
      message: 'Transaction limit exceeded. Please try again in 1 hour.',
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
  max: 30, // 30 requests per minute
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
  max: 30, // 30 requests per 15 minutes
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
  max: 3, // Maximum 3 password reset requests per hour
  message: 'Too many password reset attempts.',
  handler: (req, res) => {
    res.status(429).json({
      success: false,
      message: 'You have requested too many password resets. Please try again in 1 hour.',
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

module.exports = {
  sanitizeInput,
  securityHeaders,
  globalLimiter,
  authLimiter,
  transactionLimiter,
  adminLimiter,
  financeLimiter,
  passwordResetLimiter,
  ipWhitelist,
  requestLogger,
  validateContentType,
  preventParameterPollution
};
