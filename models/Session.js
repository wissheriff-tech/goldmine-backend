const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');

const Session = sequelize.define('Session', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  user_id: {
    type: DataTypes.INTEGER,
    allowNull: false
  },
  access_token: {
    type: DataTypes.STRING(128),
    allowNull: true,
    unique: true
  },
  refresh_token: {
    type: DataTypes.STRING(128),
    allowNull: false,
    unique: true
  },
  device_info: {
    type: DataTypes.JSON,
    allowNull: true
  },
  is_active: {
    type: DataTypes.BOOLEAN,
    defaultValue: true
  },
  access_expires_at: {
    type: DataTypes.DATE,
    allowNull: true
  },
  last_activity: {
    type: DataTypes.DATE,
    defaultValue: DataTypes.NOW
  },
  expires_at: {
    type: DataTypes.DATE,
    allowNull: false
  },
  twoFactorVerified: {
    type: DataTypes.BOOLEAN,
    defaultValue: false
  }
}, {
  tableName: 'sessions',
  timestamps: true,
  createdAt: 'created_at',
  updatedAt: 'updated_at',
  indexes: [
    { fields: ['user_id', 'is_active'] },
    { fields: ['expires_at'] }
  ]
});

module.exports = Session;
