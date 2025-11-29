const mongoose = require('mongoose');

const currencyRateSchema = new mongoose.Schema({
  currency_code: {
    type: String,
    required: true,
    unique: true,
    uppercase: true,
    trim: true
  },
  currency_name: {
    type: String,
    required: true
  },
  rate_to_usd: {
    type: Number,
    required: true,
    min: 0
  },
  rate_to_nsl: {
    type: Number,
    required: true,
    min: 0
  },
  enabled: {
    type: Boolean,
    default: true
  },
  updated_by: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  updated_at: {
    type: Date,
    default: Date.now
  },
  created_at: {
    type: Date,
    default: Date.now
  }
}, { timestamps: true });

// Auto-calculate rate_to_nsl based on rate_to_usd
currencyRateSchema.pre('save', function(next) {
  const NSL_PER_USDT = 25; // 1 USDT = 25 NSL
  this.rate_to_nsl = this.rate_to_usd * NSL_PER_USDT;
  this.updated_at = new Date();
  next();
});

module.exports = mongoose.model('CurrencyRate', currencyRateSchema);
