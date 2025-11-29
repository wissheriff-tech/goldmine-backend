const Joi = require('joi');

// Validation middleware factory
const validate = (schema) => {
  return (req, res, next) => {
    const { error } = schema.validate(req.body, { abortEarly: false });

    if (error) {
      const errors = error.details.map(detail => ({
        field: detail.path.join('.'),
        message: detail.message
      }));

      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors
      });
    }

    next();
  };
};

// Authentication Schemas
const signupSchema = Joi.object({
  username: Joi.string()
    .alphanum()
    .min(3)
    .max(30)
    .lowercase()
    .required()
    .messages({
      'string.alphanum': 'Username must contain only letters and numbers',
      'string.min': 'Username must be at least 3 characters',
      'string.max': 'Username cannot exceed 30 characters'
    }),

  phone: Joi.string()
    .pattern(/^\+?[0-9]{10,15}$/)
    .required()
    .messages({
      'string.pattern.base': 'Phone number must be 10-15 digits'
    }),

  email: Joi.string()
    .email()
    .lowercase()
    .optional()
    .allow(''),

  password: Joi.string()
    .min(8)
    .pattern(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]/)
    .required()
    .messages({
      'string.min': 'Password must be at least 8 characters',
      'string.pattern.base': 'Password must contain uppercase, lowercase, number, and special character'
    }),

  referred_by: Joi.string()
    .optional()
    .allow('')
});

const loginSchema = Joi.object({
  username: Joi.string()
    .required()
    .messages({
      'any.required': 'Username is required'
    }),

  password: Joi.string()
    .required()
    .messages({
      'any.required': 'Password is required'
    }),

  rememberMe: Joi.boolean()
    .optional()
});

const changePasswordSchema = Joi.object({
  oldPassword: Joi.string()
    .required()
    .messages({
      'any.required': 'Current password is required'
    }),

  newPassword: Joi.string()
    .min(8)
    .pattern(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]/)
    .required()
    .messages({
      'string.min': 'New password must be at least 8 characters',
      'string.pattern.base': 'Password must contain uppercase, lowercase, number, and special character'
    })
});

const resetPasswordSchema = Joi.object({
  password: Joi.string()
    .min(8)
    .pattern(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]/)
    .required()
    .messages({
      'string.min': 'Password must be at least 8 characters',
      'string.pattern.base': 'Password must contain uppercase, lowercase, number, and special character'
    })
});

// Transaction Schemas
const rechargeSchema = Joi.object({
  amount_NSL: Joi.number()
    .positive()
    .min(1)
    .required()
    .messages({
      'number.positive': 'Amount must be positive',
      'number.min': 'Minimum recharge is 1 NSL'
    }),

  payment_method: Joi.string()
    .valid('binance', 'manual', 'crypto_wallet')
    .default('manual'),

  payment_proof: Joi.string()
    .uri()
    .optional()
    .allow(''),

  notes: Joi.string()
    .max(500)
    .optional()
    .allow('')
});

const withdrawSchema = Joi.object({
  amount_NSL: Joi.number()
    .positive()
    .min(100)
    .required()
    .messages({
      'number.positive': 'Amount must be positive',
      'number.min': 'Minimum withdrawal is 100 NSL'
    }),

  withdrawal_address: Joi.string()
    .required()
    .messages({
      'any.required': 'Withdrawal address is required'
    }),

  withdrawal_network: Joi.string()
    .valid('BSC', 'ETH', 'TRC20')
    .default('BSC'),

  notes: Joi.string()
    .max(500)
    .optional()
    .allow('')
});

// Product Schemas
const buyProductSchema = Joi.object({
  product_id: Joi.string()
    .required()
    .messages({
      'any.required': 'Product ID is required'
    })
});

const createProductSchema = Joi.object({
  name: Joi.string()
    .valid('VIP1', 'VIP2', 'VIP3', 'VIP4', 'VIP5', 'VIP6', 'VIP7', 'VIP8', 'VIP9')
    .required(),

  description: Joi.string()
    .required(),

  price_NSL: Joi.number()
    .positive()
    .required(),

  daily_income_NSL: Joi.number()
    .positive()
    .required(),

  validity_days: Joi.number()
    .integer()
    .positive()
    .default(60),

  benefits: Joi.array()
    .items(Joi.string())
    .optional(),

  is_active: Joi.boolean()
    .default(true)
});

const updateProductSchema = Joi.object({
  name: Joi.string()
    .valid('VIP1', 'VIP2', 'VIP3', 'VIP4', 'VIP5', 'VIP6', 'VIP7', 'VIP8', 'VIP9')
    .optional(),

  description: Joi.string()
    .optional(),

  price_NSL: Joi.number()
    .positive()
    .optional(),

  daily_income_NSL: Joi.number()
    .positive()
    .optional(),

  validity_days: Joi.number()
    .integer()
    .positive()
    .optional(),

  benefits: Joi.array()
    .items(Joi.string())
    .optional(),

  is_active: Joi.boolean()
    .optional()
});

// Admin Schemas
const createUserSchema = Joi.object({
  username: Joi.string()
    .alphanum()
    .min(3)
    .max(30)
    .lowercase()
    .required(),

  phone: Joi.string()
    .pattern(/^\+?[0-9]{10,15}$/)
    .required(),

  email: Joi.string()
    .email()
    .optional()
    .allow(''),

  password: Joi.string()
    .min(6)
    .required(),

  role: Joi.string()
    .valid('user', 'admin', 'finance', 'verificator', 'approval', 'superadmin')
    .default('user'),

  status: Joi.string()
    .valid('pending', 'active', 'frozen')
    .default('active')
});

const updateBalanceSchema = Joi.object({
  balance_NSL: Joi.number()
    .min(0)
    .required(),

  balance_usdt: Joi.number()
    .min(0)
    .required(),

  reason: Joi.string()
    .required()
    .min(5)
    .messages({
      'string.min': 'Reason must be at least 5 characters'
    })
});

const updateRoleSchema = Joi.object({
  role: Joi.string()
    .valid('user', 'admin', 'finance', 'verificator', 'approval', 'superadmin')
    .required()
});

const updateStatusSchema = Joi.object({
  status: Joi.string()
    .valid('pending', 'active', 'frozen')
    .required()
});

const updateVIPSchema = Joi.object({
  vip_level: Joi.string()
    .valid('none', 'VIP1', 'VIP2', 'VIP3', 'VIP4', 'VIP5', 'VIP6', 'VIP7', 'VIP8', 'VIP9')
    .required()
});

// Finance Schemas
const addCurrencySchema = Joi.object({
  amount_NSL: Joi.number()
    .min(0)
    .optional(),

  amount_usdt: Joi.number()
    .min(0)
    .optional(),

  reason: Joi.string()
    .required()
    .min(5)
});

const approveRejectSchema = Joi.object({
  reason: Joi.string()
    .optional()
    .allow('')
});

// Profile Update Schema
const updateProfileSchema = Joi.object({
  username: Joi.string()
    .alphanum()
    .min(3)
    .max(30)
    .lowercase()
    .optional(),

  email: Joi.string()
    .email()
    .lowercase()
    .optional(),

  profile_photo: Joi.string()
    .uri()
    .optional()
});

// Currency Rate Schema
const currencyRateSchema = Joi.object({
  currency_code: Joi.string()
    .uppercase()
    .length(3)
    .required(),

  currency_name: Joi.string()
    .required(),

  rate_to_usd: Joi.number()
    .positive()
    .required(),

  enabled: Joi.boolean()
    .default(true)
});

// Export validation middleware
module.exports = {
  validate,

  // Auth validations
  validateSignup: validate(signupSchema),
  validateLogin: validate(loginSchema),
  validateChangePassword: validate(changePasswordSchema),
  validateResetPassword: validate(resetPasswordSchema),

  // Transaction validations
  validateRecharge: validate(rechargeSchema),
  validateWithdraw: validate(withdrawSchema),

  // Product validations
  validateBuyProduct: validate(buyProductSchema),
  validateCreateProduct: validate(createProductSchema),
  validateUpdateProduct: validate(updateProductSchema),

  // Admin validations
  validateCreateUser: validate(createUserSchema),
  validateUpdateBalance: validate(updateBalanceSchema),
  validateUpdateRole: validate(updateRoleSchema),
  validateUpdateStatus: validate(updateStatusSchema),
  validateUpdateVIP: validate(updateVIPSchema),

  // Finance validations
  validateAddCurrency: validate(addCurrencySchema),
  validateApproveReject: validate(approveRejectSchema),

  // Profile validations
  validateUpdateProfile: validate(updateProfileSchema),

  // Currency validations
  validateCurrencyRate: validate(currencyRateSchema)
};
