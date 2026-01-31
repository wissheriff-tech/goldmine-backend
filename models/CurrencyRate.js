const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');

const CurrencyRate = sequelize.define('CurrencyRate', {
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
  rate_to_usd: {
    type: DataTypes.DECIMAL(18, 8),
    allowNull: false,
    get() {
      const val = this.getDataValue('rate_to_usd');
      return val === null ? 0 : parseFloat(val);
    }
  },
  rate_to_nsl: {
    type: DataTypes.DECIMAL(18, 8),
    allowNull: false,
    get() {
      const val = this.getDataValue('rate_to_nsl');
      return val === null ? 0 : parseFloat(val);
    }
  },
  enabled: {
    type: DataTypes.BOOLEAN,
    defaultValue: true
  },
  updated_by: {
    type: DataTypes.INTEGER,
    allowNull: true
  }
}, {
  tableName: 'currency_rates',
  timestamps: true,
  createdAt: 'created_at',
  updatedAt: 'updated_at',
  indexes: [
    { fields: ['currency_code'] }
  ]
});

// Auto-calculate rate_to_nsl
CurrencyRate.beforeSave((rate) => {
  const NSL_PER_USDT = 25;
  rate.rate_to_nsl = rate.rate_to_usd * NSL_PER_USDT;
});

module.exports = CurrencyRate;
