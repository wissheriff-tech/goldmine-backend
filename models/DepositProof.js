const mongoose = require('mongoose');

const depositProofSchema = new mongoose.Schema({
  user_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },

  // Upload Information
  receipt_image: {
    type: String,
    required: true
  },
  original_filename: String,

  // OCR Extracted Data
  ocr_extracted_data: {
    amount: Number,
    currency: String,
    transaction_id: String,
    wallet_address: String,
    timestamp: String,
    recipient: String,
    payment_method: String,
    network: String,
    raw_text: String, // Full OCR text
    confidence: Number // OCR confidence score
  },

  // User Submitted Data (Manual Input)
  user_submitted_amount: {
    type: Number,
    required: true
  },
  user_submitted_currency: {
    type: String,
    default: 'USDT'
  },
  user_submitted_txid: String,
  user_notes: String,

  // Admin Review
  status: {
    type: String,
    enum: ['pending', 'reviewing', 'approved', 'rejected'],
    default: 'pending',
    index: true
  },
  reviewed_by: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  reviewed_at: Date,
  admin_notes: String,
  rejection_reason: String,

  // Approved Data (What admin confirms)
  approved_amount: Number,
  approved_currency: String,
  approved_transaction_id: String,

  // Linked Transaction
  transaction_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Transaction'
  },

  // Flags
  ocr_processed: {
    type: Boolean,
    default: false
  },
  ocr_failed: {
    type: Boolean,
    default: false
  },
  ocr_error: String,

  // Metadata
  deposit_type: {
    type: String,
    enum: ['binance', 'crypto_wallet', 'bank_transfer', 'other'],
    default: 'binance'
  },
  ip_address: String,
  device_info: String,

  created_at: {
    type: Date,
    default: Date.now,
    index: true
  },
  updated_at: {
    type: Date,
    default: Date.now
  }
}, { timestamps: true });

// Update timestamp on save
depositProofSchema.pre('save', function(next) {
  this.updated_at = new Date();
  next();
});

// Indexes for fast queries
depositProofSchema.index({ user_id: 1, status: 1 });
depositProofSchema.index({ status: 1, created_at: -1 });
depositProofSchema.index({ reviewed_by: 1 });

// Virtual for OCR match quality
depositProofSchema.virtual('ocr_match_quality').get(function() {
  if (!this.ocr_extracted_data || !this.user_submitted_amount) {
    return 'unknown';
  }

  const extractedAmount = this.ocr_extracted_data.amount;
  const submittedAmount = this.user_submitted_amount;

  if (!extractedAmount) return 'no_data';

  const difference = Math.abs(extractedAmount - submittedAmount);
  const percentDiff = (difference / submittedAmount) * 100;

  if (percentDiff === 0) return 'perfect';
  if (percentDiff < 1) return 'excellent';
  if (percentDiff < 5) return 'good';
  if (percentDiff < 10) return 'fair';
  return 'poor';
});

// Method to mark as approved
depositProofSchema.methods.approve = async function(adminId, approvedData) {
  this.status = 'approved';
  this.reviewed_by = adminId;
  this.reviewed_at = new Date();
  this.approved_amount = approvedData.amount;
  this.approved_currency = approvedData.currency || 'USDT';
  this.approved_transaction_id = approvedData.transaction_id;

  return await this.save();
};

// Method to mark as rejected
depositProofSchema.methods.reject = async function(adminId, reason) {
  this.status = 'rejected';
  this.reviewed_by = adminId;
  this.reviewed_at = new Date();
  this.rejection_reason = reason;

  return await this.save();
};

// Static method to get pending count
depositProofSchema.statics.getPendingCount = async function() {
  return await this.countDocuments({ status: 'pending' });
};

// Static method to get stats
depositProofSchema.statics.getStats = async function() {
  const stats = await this.aggregate([
    {
      $group: {
        _id: '$status',
        count: { $sum: 1 },
        totalAmount: { $sum: '$user_submitted_amount' }
      }
    }
  ]);

  return stats;
};

module.exports = mongoose.model('DepositProof', depositProofSchema);
