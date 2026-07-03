const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');

const Product = sequelize.define('Product', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  name: {
    type: DataTypes.ENUM('VIP0', 'VIP1', 'VIP2', 'VIP3', 'VIP4', 'VIP5', 'VIP6', 'VIP7', 'VIP8', 'VIP9'),
    allowNull: false,
    unique: true
  },
  description: {
    type: DataTypes.TEXT,
    allowNull: true
  },
  price_NSL: {
    type: DataTypes.DECIMAL(18, 4),
    allowNull: false,
    get() {
      const val = this.getDataValue('price_NSL');
      return val === null ? 0 : parseFloat(val);
    }
  },
  price_usdt: {
    type: DataTypes.DECIMAL(18, 4),
    allowNull: false,
    get() {
      const val = this.getDataValue('price_usdt');
      return val === null ? 0 : parseFloat(val);
    }
  },
  daily_income_NSL: {
    type: DataTypes.DECIMAL(18, 4),
    allowNull: false,
    get() {
      const val = this.getDataValue('daily_income_NSL');
      return val === null ? 0 : parseFloat(val);
    }
  },
  tax_income_NSL: {
    type: DataTypes.DECIMAL(18, 4),
    allowNull: false,
    defaultValue: 0,
    get() {
      const val = this.getDataValue('tax_income_NSL');
      return val === null ? 0 : parseFloat(val);
    }
  },
  validity_days: {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 7
  },
  benefits: {
    type: DataTypes.JSON,
    defaultValue: []
  },
  active: {
    type: DataTypes.BOOLEAN,
    defaultValue: true
  }
}, {
  tableName: 'products',
  timestamps: true,
  createdAt: 'created_at',
  updatedAt: 'updated_at'
});

module.exports = Product;
