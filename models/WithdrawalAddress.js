const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');

const WithdrawalAddress = sequelize.define('WithdrawalAddress', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  user_id: {
    type: DataTypes.INTEGER,
    allowNull: false
  },
  address: {
    type: DataTypes.STRING,
    allowNull: false
  },
  network: {
    type: DataTypes.STRING(50),
    allowNull: false,
    defaultValue: 'BSC'
  },
  currency: {
    type: DataTypes.STRING(50),
    allowNull: false,
    defaultValue: 'USDT'
  },
  label: {
    type: DataTypes.STRING,
    allowNull: true
  },
  verified: {
    type: DataTypes.BOOLEAN,
    defaultValue: false
  },
  verified_by: {
    type: DataTypes.INTEGER,
    allowNull: true
  },
  verified_at: {
    type: DataTypes.DATE,
    allowNull: true
  },
  added_at: {
    type: DataTypes.DATE,
    defaultValue: DataTypes.NOW
  }
}, {
  tableName: 'withdrawal_addresses',
  timestamps: true,
  createdAt: 'created_at',
  updatedAt: 'updated_at'
});

module.exports = WithdrawalAddress;
