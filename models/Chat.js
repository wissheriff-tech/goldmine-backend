const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');

const Chat = sequelize.define('Chat', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  user_id: {
    type: DataTypes.INTEGER,
    allowNull: false
  },
  admin_id: {
    type: DataTypes.INTEGER,
    allowNull: true,
    defaultValue: null
  },
  status: {
    type: DataTypes.ENUM('open', 'assigned', 'resolved', 'closed'),
    defaultValue: 'open'
  },
  priority: {
    type: DataTypes.ENUM('low', 'medium', 'high', 'urgent'),
    defaultValue: 'medium'
  },
  category: {
    type: DataTypes.ENUM('general', 'transaction', 'technical', 'account', 'vip', 'kyc'),
    defaultValue: 'general'
  },
  subject: {
    type: DataTypes.STRING(200),
    allowNull: true
  },
  last_message_at: {
    type: DataTypes.DATE,
    defaultValue: DataTypes.NOW
  },
  resolved_at: {
    type: DataTypes.DATE,
    allowNull: true
  },
  closed_at: {
    type: DataTypes.DATE,
    allowNull: true
  },
  user_typing: {
    type: DataTypes.BOOLEAN,
    defaultValue: false
  },
  admin_typing: {
    type: DataTypes.BOOLEAN,
    defaultValue: false
  },
  rating: {
    type: DataTypes.INTEGER,
    allowNull: true,
    validate: { min: 1, max: 5 }
  },
  feedback: {
    type: DataTypes.TEXT,
    allowNull: true
  },
  tags: {
    type: DataTypes.JSON,
    defaultValue: []
  }
}, {
  tableName: 'chats',
  timestamps: true,
  createdAt: 'created_at',
  updatedAt: 'updated_at',
  indexes: [
    { fields: ['user_id'] },
    { fields: ['admin_id'] },
    { fields: ['status'] },
    { fields: ['priority', 'last_message_at'] }
  ]
});

module.exports = Chat;
