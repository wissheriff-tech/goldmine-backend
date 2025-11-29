const mongoose = require('mongoose');

const referralSchema = new mongoose.Schema({
  referrer_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  referred_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  bonus_NSL: {
    type: Number,
    default: 0,
    min: 0
  },
  recharge_amount_NSL: {
    type: Number,
    default: 0
  },
  bonus_percentage: {
    type: Number,
    default: 35
  },
  status: {
    type: String,
    enum: ['pending', 'approved', 'paid'],
    default: 'pending'
  },
  timestamp: {
    type: Date,
    default: Date.now
  }
}, { timestamps: true });

// Index for fast lookups
referralSchema.index({ referrer_id: 1 });
referralSchema.index({ referred_id: 1 });

module.exports = mongoose.model('Referral', referralSchema);
