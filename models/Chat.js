const mongoose = require('mongoose');

const messageSchema = new mongoose.Schema({
  sender_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  sender_role: {
    type: String,
    enum: ['user', 'admin', 'superadmin', 'finance', 'support'],
    required: true
  },
  message: {
    type: String,
    required: true,
    trim: true,
    maxlength: 2000
  },
  message_type: {
    type: String,
    enum: ['text', 'image', 'file', 'system'],
    default: 'text'
  },
  attachment_url: String,
  read: {
    type: Boolean,
    default: false
  },
  timestamp: {
    type: Date,
    default: Date.now
  },
  read_at: Date
});

const chatSchema = new mongoose.Schema({
  user_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  admin_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null
  },
  status: {
    type: String,
    enum: ['open', 'assigned', 'resolved', 'closed'],
    default: 'open'
  },
  priority: {
    type: String,
    enum: ['low', 'medium', 'high', 'urgent'],
    default: 'medium'
  },
  category: {
    type: String,
    enum: ['general', 'transaction', 'technical', 'account', 'vip', 'kyc'],
    default: 'general'
  },
  subject: {
    type: String,
    trim: true,
    maxlength: 200
  },
  messages: [messageSchema],
  last_message_at: {
    type: Date,
    default: Date.now
  },
  created_at: {
    type: Date,
    default: Date.now
  },
  resolved_at: Date,
  closed_at: Date,
  user_typing: {
    type: Boolean,
    default: false
  },
  admin_typing: {
    type: Boolean,
    default: false
  },
  rating: {
    type: Number,
    min: 1,
    max: 5,
    default: null
  },
  feedback: String,
  tags: [String]
}, { timestamps: true });

// Indexes for performance
chatSchema.index({ user_id: 1 });
chatSchema.index({ admin_id: 1 });
chatSchema.index({ status: 1 });
chatSchema.index({ priority: -1, last_message_at: -1 });
chatSchema.index({ created_at: -1 });

// Virtual for unread message count
chatSchema.virtual('unread_count').get(function() {
  return this.messages.filter(m => !m.read).length;
});

// Method to add message
chatSchema.methods.addMessage = function(senderId, senderRole, message, messageType = 'text', attachmentUrl = null) {
  this.messages.push({
    sender_id: senderId,
    sender_role: senderRole,
    message,
    message_type: messageType,
    attachment_url: attachmentUrl,
    timestamp: new Date()
  });
  this.last_message_at = new Date();
  return this.save();
};

// Method to mark messages as read
chatSchema.methods.markAsRead = function(role) {
  const targetRole = role === 'user' ? 'admin' : 'user';
  this.messages.forEach(msg => {
    if (msg.sender_role !== targetRole && !msg.read) {
      msg.read = true;
      msg.read_at = new Date();
    }
  });
  return this.save();
};

// Static method to get admin dashboard stats
chatSchema.statics.getAdminStats = async function() {
  const stats = await this.aggregate([
    {
      $group: {
        _id: '$status',
        count: { $sum: 1 }
      }
    }
  ]);

  const urgentCount = await this.countDocuments({
    status: { $in: ['open', 'assigned'] },
    priority: 'urgent'
  });

  return {
    stats,
    urgentCount
  };
};

module.exports = mongoose.model('Chat', chatSchema);
