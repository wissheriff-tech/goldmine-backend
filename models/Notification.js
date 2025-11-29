const mongoose = require('mongoose');

const notificationSchema = new mongoose.Schema({
  user_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  type: {
    type: String,
    enum: [
      'transaction_approved',
      'transaction_rejected',
      'product_purchased',
      'product_expiring',
      'product_expired',
      'daily_income',
      'referral_bonus',
      'account_approved',
      'account_suspended',
      'kyc_verified',
      'kyc_rejected',
      'withdrawal_approved',
      'withdrawal_rejected',
      'recharge_approved',
      'recharge_rejected',
      'system_announcement',
      'security_alert',
      'vip_upgrade'
    ],
    required: true
  },
  title: {
    type: String,
    required: true,
    maxlength: 200
  },
  message: {
    type: String,
    required: true,
    maxlength: 1000
  },
  data: {
    type: mongoose.Schema.Types.Mixed,
    default: {}
  },
  read: {
    type: Boolean,
    default: false,
    index: true
  },
  priority: {
    type: String,
    enum: ['low', 'medium', 'high', 'urgent'],
    default: 'medium'
  },
  action_url: String,
  icon: String,
  created_at: {
    type: Date,
    default: Date.now,
    index: true
  },
  read_at: Date,
  expires_at: {
    type: Date,
    default: () => new Date(Date.now() + 30 * 24 * 60 * 60 * 1000) // 30 days
  }
}, { timestamps: true });

// Indexes for fast queries
notificationSchema.index({ user_id: 1, read: 1 });
notificationSchema.index({ user_id: 1, created_at: -1 });
notificationSchema.index({ expires_at: 1 });

// Auto-delete expired notifications
notificationSchema.index({ expires_at: 1 }, { expireAfterSeconds: 0 });

module.exports = mongoose.model('Notification', notificationSchema);
