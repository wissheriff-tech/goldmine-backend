const mongoose = require('mongoose');

const twoFactorAuthSchema = new mongoose.Schema({
  user_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    unique: true
  },
  secret: {
    type: String,
    required: true
  },
  backup_codes: [{
    code: String,
    used: {
      type: Boolean,
      default: false
    },
    used_at: Date
  }],
  enabled: {
    type: Boolean,
    default: false
  },
  method: {
    type: String,
    enum: ['app', 'sms', 'email'],
    default: 'app'
  },
  verified_at: Date,
  last_used: Date,
  created_at: {
    type: Date,
    default: Date.now
  }
}, { timestamps: true });

// Index
twoFactorAuthSchema.index({ user_id: 1 });

module.exports = mongoose.model('TwoFactorAuth', twoFactorAuthSchema);
