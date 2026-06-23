const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');

const UserTask = sequelize.define('UserTask', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true,
  },
  user_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
  },
  task_key: {
    type: DataTypes.STRING(50),
    allowNull: false,
  },
  claimed_at: {
    type: DataTypes.DATE,
    allowNull: false,
    defaultValue: DataTypes.NOW,
  },
}, {
  tableName: 'user_tasks',
  timestamps: false,
  indexes: [
    { fields: ['user_id', 'task_key'] },
    { fields: ['user_id', 'claimed_at'] },
  ],
});

module.exports = UserTask;
