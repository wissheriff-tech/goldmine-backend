const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');

const TwoFactorAuth = sequelize.define('TwoFactorAuth', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  user_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
    unique: true
  },
  secret: {
    type: DataTypes.STRING,
    allowNull: false
  },
  backup_codes: {
    type: DataTypes.JSON,
    defaultValue: []
  },
  enabled: {
    type: DataTypes.BOOLEAN,
    defaultValue: false
  },
  method: {
    type: DataTypes.ENUM('app', 'email'),
    defaultValue: 'email'
  },
  verified_at: {
    type: DataTypes.DATE,
    allowNull: true
  },
  last_used: {
    type: DataTypes.DATE,
    allowNull: true
  }
}, {
  tableName: 'two_factor_auth',
  timestamps: true,
  createdAt: 'created_at',
  updatedAt: 'updated_at',
  indexes: [
    { fields: ['user_id'] }
  ]
});

module.exports = TwoFactorAuth;
