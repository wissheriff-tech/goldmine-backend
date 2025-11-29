const mongoose = require('mongoose');

const transactionSchema = new mongoose.Schema({
  user_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  type: {
    type: String,
    enum: ['recharge', 'withdrawal', 'income', 'referral_bonus', 'purchase', 'renewal'],
    required: true
  },
  product_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Product',
    default: null
  },
  amount_NSL: {
    type: Number,
    default: 0,
    min: 0
  },
  amount_usdt: {
    type: Number,
    default: 0,
    min: 0
  },
  status: {
    type: String,
    enum: ['pending', 'approved', 'rejected', 'completed'],
    default: 'pending'
  },
  approved_by: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null
  },
  notes: String,
  binance_tx_id: String,
  binance_withdraw_id: String,
  deposit_address: String,
  deposit_network: {
    type: String,
    default: 'BSC'
  },
  withdrawal_address: String,
  withdrawal_network: {
    type: String,
    default: 'BSC'
  },
  payment_method: {
    type: String,
    enum: ['binance', 'manual', 'crypto_wallet'],
    default: 'binance'
  },
  payment_proof: String, // URL to uploaded payment proof
  admin_notes: String,
  timestamp: {
    type: Date,
    default: Date.now
  },
  completed_at: Date,
  rejected_at: Date,
  confirmations: {
    type: Number,
    default: 0
  }
}, { timestamps: true });

// Index for fast lookups
transactionSchema.index({ user_id: 1 });
transactionSchema.index({ status: 1 });
transactionSchema.index({ type: 1 });
transactionSchema.index({ timestamp: -1 });

module.exports = mongoose.model('Transaction', transactionSchema);
