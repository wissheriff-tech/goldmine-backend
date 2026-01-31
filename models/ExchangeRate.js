const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');

const ExchangeRate = sequelize.define('ExchangeRate', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  currency_code: {
    type: DataTypes.STRING(10),
    allowNull: false,
    unique: true,
    set(val) {
      this.setDataValue('currency_code', val ? val.toUpperCase().trim() : val);
    }
  },
  currency_name: {
    type: DataTypes.STRING,
    allowNull: false
  },
  currency_symbol: {
    type: DataTypes.STRING(10),
    defaultValue: '$'
  },
  rate_to_usd: {
    type: DataTypes.DECIMAL(18, 8),
    allowNull: false,
    get() {
      const val = this.getDataValue('rate_to_usd');
      return val === null ? 0 : parseFloat(val);
    }
  },
  usd_per_unit: {
    type: DataTypes.DECIMAL(18, 8),
    allowNull: false,
    get() {
      const val = this.getDataValue('usd_per_unit');
      return val === null ? 0 : parseFloat(val);
    }
  },
  binance_rate: {
    type: DataTypes.DECIMAL(18, 8),
    allowNull: true,
    defaultValue: null,
    get() {
      const val = this.getDataValue('binance_rate');
      return val === null ? null : parseFloat(val);
    }
  },
  admin_override_rate: {
    type: DataTypes.DECIMAL(18, 8),
    allowNull: true,
    defaultValue: null,
    get() {
      const val = this.getDataValue('admin_override_rate');
      return val === null ? null : parseFloat(val);
    }
  },
  active_rate_source: {
    type: DataTypes.ENUM('binance', 'admin'),
    defaultValue: 'binance'
  },
  override_set_by: {
    type: DataTypes.INTEGER,
    allowNull: true,
    defaultValue: null
  },
  override_reason: {
    type: DataTypes.STRING,
    allowNull: true,
    defaultValue: null
  },
  override_set_at: {
    type: DataTypes.DATE,
    allowNull: true,
    defaultValue: null
  },
  last_binance_update: {
    type: DataTypes.DATE,
    allowNull: true,
    defaultValue: null
  },
  enabled: {
    type: DataTypes.BOOLEAN,
    defaultValue: true
  },
  country: {
    type: DataTypes.STRING,
    allowNull: true,
    defaultValue: null
  },
  notes: {
    type: DataTypes.TEXT,
    allowNull: true,
    defaultValue: null
  }
}, {
  tableName: 'exchange_rates',
  timestamps: true,
  createdAt: 'created_at',
  updatedAt: 'updated_at',
  indexes: [
    { fields: ['currency_code'] },
    { fields: ['enabled'] }
  ]
});

// Instance methods
ExchangeRate.prototype.getActiveRate = function () {
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

ExchangeRate.prototype.fromUSD = function (usdAmount) {
  const activeRate = this.getActiveRate();
  return usdAmount * activeRate.rate;
};

ExchangeRate.prototype.toUSD = function (localAmount) {
  const activeRate = this.getActiveRate();
  return localAmount * activeRate.usd_per_unit;
};

// Static method to convert between currencies
ExchangeRate.convert = async function (amount, fromCurrency, toCurrency) {
  if (fromCurrency === toCurrency) return amount;

  const from = await ExchangeRate.findOne({
    where: { currency_code: fromCurrency.toUpperCase(), enabled: true }
  });
  const to = await ExchangeRate.findOne({
    where: { currency_code: toCurrency.toUpperCase(), enabled: true }
  });

  if (!from || !to) {
    throw new Error(`Currency not found or disabled: ${!from ? fromCurrency : toCurrency}`);
  }

  const usdAmount = from.toUSD(amount);
  return to.fromUSD(usdAmount);
};

module.exports = ExchangeRate;
