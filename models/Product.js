const mongoose = require('mongoose');

const productSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    enum: ['VIP1', 'VIP2', 'VIP3', 'VIP4', 'VIP5', 'VIP6', 'VIP7', 'VIP8', 'VIP9'],
    unique: true
  },
  description: String,
  price_NSL: {
    type: Number,
    required: true,
    min: 0
  },
  price_usdt: {
    type: Number,
    required: true,
    min: 0
  },
  daily_income_NSL: {
    type: Number,
    required: true,
    min: 0
  },
  validity_days: {
    type: Number,
    required: true,
    default: 60
  },
  benefits: [String],
  active: {
    type: Boolean,
    default: true
  },
  created_at: {
    type: Date,
    default: Date.now
  },
  updated_at: {
    type: Date,
    default: Date.now
  }
}, { timestamps: true });

module.exports = mongoose.model('Product', productSchema);
