const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const userSchema = new mongoose.Schema({
  username: {
    type: String,
    required: true,
    unique: true,
    trim: true,
    lowercase: true
  },
  phone: {
    type: String,
    required: true,
    unique: true,
    trim: true
  },
  password_hash: {
    type: String,
    required: true
  },
  role: {
    type: String,
    enum: ['user', 'admin', 'superadmin', 'finance', 'verificator', 'approval'],
    default: 'user'
  },
  referral_code: {
    type: String,
    unique: true,
    sparse: true
  },
  referred_by: {
    type: String,
    default: null
  },
  balance_NSL: {
    type: Number,
    default: 0,
    min: 0
  },
  balance_usdt: {
    type: Number,
    default: 0,
    min: 0
  },
  vip_level: {
    type: String,
    enum: ['VIP1', 'VIP2', 'VIP3', 'VIP4', 'VIP5', 'VIP6', 'VIP7', 'VIP8', 'VIP9', 'none'],
    default: 'none'
  },
  products: [
    {
      product_id: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Product',
        required: true
      },
      purchase_date: {
        type: Date,
        required: true,
        default: Date.now
      },
      expires_at: {
        type: Date,
        required: true
      },
      auto_renew: {
        type: Boolean,
        default: true
      },
      is_active: {
        type: Boolean,
        default: true
      }
    }
  ],
  status: {
    type: String,
    enum: ['active', 'frozen', 'pending'],
    default: 'pending'
  },
  kyc_verified: {
    type: Boolean,
    default: false
  },
  kyc_documents: {
    id_front: String,
    id_back: String,
    selfie: String,
    additional: String
  },
  kyc_document: String, // Legacy field - kept for backward compatibility
  created_at: {
    type: Date,
    default: Date.now
  },
  last_login: {
    type: Date,
    default: null
  },
  updated_at: {
    type: Date,
    default: Date.now
  },
  email: {
    type: String,
    sparse: true,
    lowercase: true,
    trim: true
  },
  resetPasswordToken: {
    type: String,
    select: false
  },
  resetPasswordExpires: {
    type: Date,
    select: false
  },
  twoFactorEnabled: {
    type: Boolean,
    default: false
  },
  twoFactorCode: {
    type: String,
    select: false
  },
  twoFactorExpires: {
    type: Date,
    select: false
  },
  emailVerified: {
    type: Boolean,
    default: false
  },
  emailVerificationToken: {
    type: String,
    select: false
  },
  emailVerificationExpires: {
    type: Date,
    select: false
  },
  googleId: {
    type: String,
    sparse: true
  },
  facebookId: {
    type: String,
    sparse: true
  },
  authProvider: {
    type: String,
    enum: ['local', 'google', 'facebook'],
    default: 'local'
  },
  profile_photo: {
    type: String,
    default: null
  },
  // Binance Integration Fields
  binance_account_id: {
    type: String,
    default: null,
    trim: true
  },
  binance_wallet_address: {
    type: String,
    default: null,
    trim: true
  },
  binance_wallet_verified: {
    type: Boolean,
    default: false
  },
  binance_wallet_verified_by: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null
  },
  binance_wallet_verified_at: {
    type: Date,
    default: null
  },
  withdrawal_addresses: [
    {
      address: {
        type: String,
        required: true,
        trim: true
      },
      network: {
        type: String,
        required: true,
        default: 'BSC'
      },
      currency: {
        type: String,
        required: true,
        default: 'USDT'
      },
      label: String,
      verified: {
        type: Boolean,
        default: false
      },
      verified_by: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
      },
      verified_at: Date,
      added_at: {
        type: Date,
        default: Date.now
      }
    }
  ],
  preferred_currency: {
    type: String,
    default: 'USD'
  }
}, { timestamps: true });

// Hash password before saving
userSchema.pre('save', async function(next) {
  if (!this.isModified('password_hash')) return next();
  
  try {
    const salt = await bcrypt.genSalt(10);
    this.password_hash = await bcrypt.hash(this.password_hash, salt);
    next();
  } catch (error) {
    next(error);
  }
});

// Method to compare passwords
userSchema.methods.comparePassword = async function(inputPassword) {
  return await bcrypt.compare(inputPassword, this.password_hash);
};

// Method to generate referral code
userSchema.methods.generateReferralCode = function() {
  return Math.random().toString(36).substring(2, 12).toUpperCase();
};

module.exports = mongoose.model('User', userSchema);
