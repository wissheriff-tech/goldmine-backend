const mongoose = require('mongoose');

const sessionSchema = new mongoose.Schema({
  user_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  refresh_token: {
    type: String,
    required: true,
    unique: true
  },
  device_info: {
    user_agent: String,
    device_type: String, // mobile, desktop, tablet
    os: String,
    browser: String,
    ip_address: String,
    location: {
      city: String,
      country: String,
      timezone: String
    }
  },
  is_active: {
    type: Boolean,
    default: true
  },
  last_activity: {
    type: Date,
    default: Date.now
  },
  created_at: {
    type: Date,
    default: Date.now
  },
  expires_at: {
    type: Date,
    required: true,
    index: true
  }
}, { timestamps: true });

// Indexes
sessionSchema.index({ user_id: 1, is_active: 1 });
sessionSchema.index({ expires_at: 1 }, { expireAfterSeconds: 0 }); // Auto-delete expired sessions

module.exports = mongoose.model('Session', sessionSchema);
