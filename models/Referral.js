const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');

const Referral = sequelize.define('Referral', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  referrer_id: {
    type: DataTypes.INTEGER,
    allowNull: false
  },
  referred_id: {
    type: DataTypes.INTEGER,
    allowNull: false
  },
  bonus_NSL: {
    type: DataTypes.DECIMAL(18, 4),
    defaultValue: 0,
    get() {
      const val = this.getDataValue('bonus_NSL');
      return val === null ? 0 : parseFloat(val);
    }
  },
  recharge_amount_NSL: {
    type: DataTypes.DECIMAL(18, 4),
    defaultValue: 0,
    get() {
      const val = this.getDataValue('recharge_amount_NSL');
      return val === null ? 0 : parseFloat(val);
    }
  },
  bonus_percentage: {
    type: DataTypes.DECIMAL(5, 2),
    defaultValue: 35
  },
  status: {
    type: DataTypes.ENUM('pending', 'approved', 'paid'),
    defaultValue: 'pending'
  },
  timestamp: {
    type: DataTypes.DATE,
    defaultValue: DataTypes.NOW
  }
}, {
  tableName: 'referrals',
  timestamps: true,
  createdAt: 'created_at',
  updatedAt: 'updated_at',
  indexes: [
    { fields: ['referrer_id'] },
    { fields: ['referred_id'] }
  ]
});

module.exports = Referral;
