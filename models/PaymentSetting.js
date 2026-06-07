const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');

const PaymentSetting = sequelize.define('PaymentSetting', {
  key: {
    type: DataTypes.STRING(64),
    primaryKey: true,
  },
  value: {
    type: DataTypes.TEXT,
    allowNull: true,
  },
  updated_by: {
    type: DataTypes.INTEGER,
    allowNull: true,
  },
}, {
  tableName: 'payment_settings',
  timestamps: true,
});

module.exports = PaymentSetting;
