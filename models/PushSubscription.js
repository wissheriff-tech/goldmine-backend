const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');

const PushSubscription = sequelize.define('PushSubscription', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  user_id: {
    type: DataTypes.INTEGER,
    allowNull: false
  },
  endpoint: {
    type: DataTypes.TEXT,
    allowNull: false,
    unique: true
  },
  p256dh: {
    type: DataTypes.TEXT,
    allowNull: false
  },
  auth: {
    type: DataTypes.STRING(50),
    allowNull: false
  }
}, {
  tableName: 'push_subscriptions',
  timestamps: true,
  createdAt: 'created_at',
  updatedAt: false,
  indexes: [
    { fields: ['user_id'] },
    { fields: ['endpoint'], unique: true }
  ]
});

module.exports = PushSubscription;
