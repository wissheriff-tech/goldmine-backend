const mongoose = require('mongoose');

const exchangeRateSchema = new mongoose.Schema({
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
  currency_symbol: {
    type: String,
    default: '$'
  },
  // Rate: How much of this currency = 1 USD
  // Example: NGN = 1650 means 1 USD = 1650 NGN
  rate_to_usd: {
    type: Number,
    required: true,
    min: 0
  },
  // Rate: How much USD = 1 unit of this currency
  // Example: USD = 1, NGN = 0.000606 (1/1650)
  usd_per_unit: {
    type: Number,
    required: true,
    min: 0
  },
  // Binance live rate (automatic)
  binance_rate: {
    type: Number,
    default: null
  },
  // Admin override rate (manual)
  admin_override_rate: {
    type: Number,
    default: null
  },
  // Which rate to use: 'binance' or 'admin'
  active_rate_source: {
    type: String,
    enum: ['binance', 'admin'],
    default: 'binance'
  },
  // Admin who set the override
  override_set_by: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null
  },
  override_reason: {
    type: String,
    default: null
  },
  override_set_at: {
    type: Date,
    default: null
  },
  // Last time Binance rate was fetched
  last_binance_update: {
    type: Date,
    default: null
  },
  // Status
  enabled: {
    type: Boolean,
    default: true
  },
  // Country/Region
  country: {
    type: String,
    default: null
  },
  // Notes
  notes: {
    type: String,
    default: null
  }
}, { timestamps: true });

// Method to get the active rate
exchangeRateSchema.methods.getActiveRate = function() {
  if (this.active_rate_source === 'admin' && this.admin_override_rate) {
    return {
      rate: this.admin_override_rate,
      source: 'admin',
      usd_per_unit: 1 / this.admin_override_rate
    };
  }
  return {
    rate: this.rate_to_usd,
    source: 'binance',
    usd_per_unit: this.usd_per_unit
  };
};

// Method to convert from USD to local currency
exchangeRateSchema.methods.fromUSD = function(usdAmount) {
  const activeRate = this.getActiveRate();
  return usdAmount * activeRate.rate;
};

// Method to convert from local currency to USD
exchangeRateSchema.methods.toUSD = function(localAmount) {
  const activeRate = this.getActiveRate();
  return localAmount * activeRate.usd_per_unit;
};

// Static method to convert between any two currencies
exchangeRateSchema.statics.convert = async function(amount, fromCurrency, toCurrency) {
  if (fromCurrency === toCurrency) {
    return amount;
  }

  const from = await this.findOne({ currency_code: fromCurrency.toUpperCase(), enabled: true });
  const to = await this.findOne({ currency_code: toCurrency.toUpperCase(), enabled: true });

  if (!from || !to) {
    throw new Error(`Currency not found or disabled: ${!from ? fromCurrency : toCurrency}`);
  }

  // Convert to USD first, then to target currency
  const usdAmount = from.toUSD(amount);
  return to.fromUSD(usdAmount);
};

// Index for fast lookups
exchangeRateSchema.index({ currency_code: 1 });
exchangeRateSchema.index({ enabled: 1 });

module.exports = mongoose.model('ExchangeRate', exchangeRateSchema);
