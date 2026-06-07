const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');

const Transaction = sequelize.define('Transaction', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  user_id: {
    type: DataTypes.INTEGER,
    allowNull: false
  },
  type: {
    type: DataTypes.ENUM('recharge', 'withdrawal', 'income', 'referral_bonus', 'purchase', 'renewal'),
    allowNull: false
  },
  product_id: {
    type: DataTypes.INTEGER,
    allowNull: true,
    defaultValue: null
  },
  amount_NSL: {
    type: DataTypes.DECIMAL(18, 4),
    defaultValue: 0,
    get() {
      const val = this.getDataValue('amount_NSL');
      return val === null ? 0 : parseFloat(val);
    }
  },
  amount_usdt: {
    type: DataTypes.DECIMAL(18, 4),
    defaultValue: 0,
    get() {
      const val = this.getDataValue('amount_usdt');
      return val === null ? 0 : parseFloat(val);
    }
  },
  status: {
    type: DataTypes.ENUM('pending', 'approved', 'rejected', 'completed'),
    defaultValue: 'pending'
  },
  approved_by: {
    type: DataTypes.INTEGER,
    allowNull: true,
    defaultValue: null
  },
  notes: {
    type: DataTypes.TEXT,
    allowNull: true
  },
  binance_tx_id: {
    type: DataTypes.STRING,
    allowNull: true
  },
  binance_withdraw_id: {
    type: DataTypes.STRING,
    allowNull: true
  },
  deposit_address: {
    type: DataTypes.STRING,
    allowNull: true
  },
  deposit_network: {
    type: DataTypes.STRING(50),
    defaultValue: 'BSC'
  },
  withdrawal_address: {
    type: DataTypes.STRING,
    allowNull: true
  },
  withdrawal_network: {
    type: DataTypes.STRING(50),
    defaultValue: 'BSC'
  },
  payment_method: {
    type: DataTypes.ENUM('binance', 'manual', 'crypto_wallet', 'orange_money', 'africell'),
    defaultValue: 'binance'
  },
  reference_id: {
    type: DataTypes.STRING,
    allowNull: true
  },
  approved_at: {
    type: DataTypes.DATE,
    allowNull: true
  },
  payment_proof: {
    type: DataTypes.STRING(500),
    allowNull: true
  },
  admin_notes: {
    type: DataTypes.TEXT,
    allowNull: true
  },
  timestamp: {
    type: DataTypes.DATE,
    defaultValue: DataTypes.NOW
  },
  completed_at: {
    type: DataTypes.DATE,
    allowNull: true
  },
  rejected_at: {
    type: DataTypes.DATE,
    allowNull: true
  },
  confirmations: {
    type: DataTypes.INTEGER,
    defaultValue: 0
  }
}, {
  tableName: 'transactions',
  timestamps: true,
  createdAt: 'created_at',
  updatedAt: 'updated_at',
  indexes: [
    { fields: ['user_id'] },
    { fields: ['status'] },
    { fields: ['type'] },
    { fields: ['timestamp'] }
  ]
});

module.exports = Transaction;
