const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');

const AdminAuditLog = sequelize.define('AdminAuditLog', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true,
  },
  actor_user_id: {
    type: DataTypes.INTEGER,
    allowNull: true,
  },
  actor_role: {
    type: DataTypes.STRING(50),
    allowNull: true,
  },
  action: {
    type: DataTypes.STRING(120),
    allowNull: false,
  },
  target_type: {
    type: DataTypes.STRING(80),
    allowNull: true,
  },
  target_id: {
    type: DataTypes.STRING(80),
    allowNull: true,
  },
  target_user_id: {
    type: DataTypes.INTEGER,
    allowNull: true,
  },
  status: {
    type: DataTypes.STRING(30),
    allowNull: false,
    defaultValue: 'success',
  },
  ip_address: {
    type: DataTypes.STRING(100),
    allowNull: true,
  },
  user_agent: {
    type: DataTypes.STRING(500),
    allowNull: true,
  },
  metadata: {
    type: DataTypes.JSON,
    allowNull: true,
  },
}, {
  tableName: 'admin_audit_logs',
  timestamps: true,
  createdAt: 'created_at',
  updatedAt: 'updated_at',
  indexes: [
    { fields: ['actor_user_id'] },
    { fields: ['target_user_id'] },
    { fields: ['action'] },
    { fields: ['created_at'] },
  ],
});

module.exports = AdminAuditLog;
