const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');

const DepositProof = sequelize.define('DepositProof', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  user_id: {
    type: DataTypes.INTEGER,
    allowNull: false
  },
  receipt_image: {
    type: DataTypes.STRING(500),
    allowNull: false
  },
  original_filename: {
    type: DataTypes.STRING,
    allowNull: true
  },
  ocr_extracted_data: {
    type: DataTypes.JSON,
    allowNull: true
  },
  user_submitted_amount: {
    type: DataTypes.DECIMAL(18, 4),
    allowNull: false,
    get() {
      const val = this.getDataValue('user_submitted_amount');
      return val === null ? 0 : parseFloat(val);
    }
  },
  user_submitted_currency: {
    type: DataTypes.STRING(20),
    defaultValue: 'USDT'
  },
  user_submitted_txid: {
    type: DataTypes.STRING,
    allowNull: true
  },
  user_notes: {
    type: DataTypes.TEXT,
    allowNull: true
  },
  status: {
    type: DataTypes.ENUM('pending', 'reviewing', 'approved', 'rejected'),
    defaultValue: 'pending'
  },
  reviewed_by: {
    type: DataTypes.INTEGER,
    allowNull: true
  },
  reviewed_at: {
    type: DataTypes.DATE,
    allowNull: true
  },
  admin_notes: {
    type: DataTypes.TEXT,
    allowNull: true
  },
  rejection_reason: {
    type: DataTypes.TEXT,
    allowNull: true
  },
  approved_amount: {
    type: DataTypes.DECIMAL(18, 4),
    allowNull: true,
    get() {
      const val = this.getDataValue('approved_amount');
      return val === null ? null : parseFloat(val);
    }
  },
  approved_currency: {
    type: DataTypes.STRING(20),
    allowNull: true
  },
  approved_transaction_id: {
    type: DataTypes.STRING,
    allowNull: true
  },
  transaction_id: {
    type: DataTypes.INTEGER,
    allowNull: true
  },
  ocr_processed: {
    type: DataTypes.BOOLEAN,
    defaultValue: false
  },
  ocr_failed: {
    type: DataTypes.BOOLEAN,
    defaultValue: false
  },
  ocr_error: {
    type: DataTypes.TEXT,
    allowNull: true
  },
  deposit_type: {
    type: DataTypes.ENUM('binance', 'crypto_wallet', 'bank_transfer', 'other'),
    defaultValue: 'binance'
  },
  ip_address: {
    type: DataTypes.STRING(45),
    allowNull: true
  },
  device_info: {
    type: DataTypes.STRING,
    allowNull: true
  }
}, {
  tableName: 'deposit_proofs',
  timestamps: true,
  createdAt: 'created_at',
  updatedAt: 'updated_at',
  indexes: [
    { fields: ['user_id', 'status'] },
    { fields: ['status', 'created_at'] },
    { fields: ['reviewed_by'] }
  ]
});

// Instance methods
DepositProof.prototype.approve = async function (adminId, approvedData) {
  this.status = 'approved';
  this.reviewed_by = adminId;
  this.reviewed_at = new Date();
  this.approved_amount = approvedData.amount;
  this.approved_currency = approvedData.currency || 'USDT';
  this.approved_transaction_id = approvedData.transaction_id;
  return await this.save();
};

DepositProof.prototype.reject = async function (adminId, reason) {
  this.status = 'rejected';
  this.reviewed_by = adminId;
  this.reviewed_at = new Date();
  this.rejection_reason = reason;
  return await this.save();
};

// Static methods
DepositProof.getPendingCount = async function () {
  return await DepositProof.count({ where: { status: 'pending' } });
};

DepositProof.getStats = async function () {
  const { fn, col } = require('sequelize');
  const stats = await DepositProof.findAll({
    attributes: [
      'status',
      [fn('COUNT', col('id')), 'count'],
      [fn('SUM', col('user_submitted_amount')), 'totalAmount']
    ],
    group: ['status'],
    raw: true
  });
  return stats;
};

module.exports = DepositProof;
