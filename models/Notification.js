const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');

const Notification = sequelize.define('Notification', {
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
    type: DataTypes.ENUM(
      'transaction_approved', 'transaction_rejected',
      'product_purchased', 'product_expiring', 'product_expired',
      'daily_income', 'referral_bonus',
      'account_approved', 'account_suspended',
      'account_updated', 'balance_adjusted', 'phone_changed',
      'password_changed', 'password_reset',
      'kyc_verified', 'kyc_rejected',
      'withdrawal_approved', 'withdrawal_rejected',
      'recharge_approved', 'recharge_rejected',
      'system_announcement', 'admin_message', 'security_alert', 'vip_upgrade'
    ),
    allowNull: false
  },
  title: {
    type: DataTypes.STRING(200),
    allowNull: false
  },
  message: {
    type: DataTypes.STRING(1000),
    allowNull: false
  },
  data: {
    type: DataTypes.JSON,
    defaultValue: {}
  },
  read: {
    type: DataTypes.BOOLEAN,
    defaultValue: false
  },
  priority: {
    type: DataTypes.ENUM('low', 'medium', 'high', 'urgent'),
    defaultValue: 'medium'
  },
  action_url: {
    type: DataTypes.STRING,
    allowNull: true
  },
  icon: {
    type: DataTypes.STRING,
    allowNull: true
  },
  read_at: {
    type: DataTypes.DATE,
    allowNull: true
  },
  expires_at: {
    type: DataTypes.DATE,
    allowNull: true
  }
}, {
  tableName: 'notifications',
  timestamps: true,
  createdAt: 'created_at',
  updatedAt: 'updated_at',
  indexes: [
    { fields: ['user_id', 'read'] },
    { fields: ['user_id', 'created_at'] },
    { fields: ['expires_at'] }
  ]
});

module.exports = Notification;
