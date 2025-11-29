const express = require('express');
const Chat = require('../models/Chat');
const { authenticate, authorizeRoles } = require('../middleware/auth');
const { getIO } = require('../config/socket');
const logger = require('../utils/logger');

const router = express.Router();

// Create a new chat (user initiates)
router.post('/', authenticate, async (req, res) => {
  try {
    const { subject, category, priority, message } = req.body;

    // Check if user has an open chat already
    const existingChat = await Chat.findOne({
      user_id: req.user.userId,
      status: { $in: ['open', 'assigned'] }
    });

    if (existingChat) {
      return res.status(400).json({
        message: 'You already have an active chat. Please close it before starting a new one.',
        chatId: existingChat._id
      });
    }

    // Create new chat
    const chat = new Chat({
      user_id: req.user.userId,
      subject: subject || 'General Inquiry',
      category: category || 'general',
      priority: priority || 'medium',
      status: 'open'
    });

    // Add initial message if provided
    if (message) {
      await chat.addMessage(req.user.userId, req.user.role, message);
    }

    await chat.save();

    const populatedChat = await Chat.findById(chat._id).populate('user_id');

    // Notify admins via socket
    try {
      const io = getIO();
      io.to('admin-room').emit('new-chat-created', {
        chat: populatedChat,
        message: message ? message.substring(0, 100) : null
      });
    } catch (socketError) {
      logger.warn('Socket notification failed:', socketError);
    }

    logger.info(`New chat created by user ${req.user.userId}`);

    res.status(201).json({
      message: 'Chat created successfully',
      chat: populatedChat
    });
  } catch (error) {
    logger.error('Create chat error:', error);
    res.status(500).json({ message: 'Failed to create chat', error: error.message });
  }
});

// Get user's chats
router.get('/my-chats', authenticate, async (req, res) => {
  try {
    const { status, limit = 20, offset = 0 } = req.query;

    const query = { user_id: req.user.userId };

    if (status) {
      query.status = status;
    }

    const chats = await Chat.find(query)
      .populate('admin_id', 'username role')
      .sort({ last_message_at: -1 })
      .limit(parseInt(limit))
      .skip(parseInt(offset));

    const total = await Chat.countDocuments(query);

    res.json({
      chats,
      total,
      limit: parseInt(limit),
      offset: parseInt(offset)
    });
  } catch (error) {
    logger.error('Get user chats error:', error);
    res.status(500).json({ message: 'Failed to get chats', error: error.message });
  }
});

// Get all chats (admin only)
router.get('/all', authenticate, authorizeRoles('admin', 'superadmin'), async (req, res) => {
  try {
    const {
      status,
      priority,
      category,
      admin_id,
      limit = 50,
      offset = 0
    } = req.query;

    const query = {};

    if (status) query.status = status;
    if (priority) query.priority = priority;
    if (category) query.category = category;
    if (admin_id) query.admin_id = admin_id;

    const chats = await Chat.find(query)
      .populate('user_id', 'username phone email vip_level')
      .populate('admin_id', 'username role')
      .sort({ priority: -1, last_message_at: -1 })
      .limit(parseInt(limit))
      .skip(parseInt(offset));

    const total = await Chat.countDocuments(query);

    res.json({
      chats,
      total,
      limit: parseInt(limit),
      offset: parseInt(offset)
    });
  } catch (error) {
    logger.error('Get all chats error:', error);
    res.status(500).json({ message: 'Failed to get chats', error: error.message });
  }
});

// Get single chat by ID
router.get('/:chatId', authenticate, async (req, res) => {
  try {
    const { chatId } = req.params;

    const chat = await Chat.findById(chatId)
      .populate('user_id', 'username phone email vip_level')
      .populate('admin_id', 'username role')
      .populate('messages.sender_id', 'username role');

    if (!chat) {
      return res.status(404).json({ message: 'Chat not found' });
    }

    // Verify user has access
    const isAuthorized =
      chat.user_id._id.toString() === req.user.userId ||
      (chat.admin_id && chat.admin_id._id.toString() === req.user.userId) ||
      ['admin', 'superadmin'].includes(req.user.role);

    if (!isAuthorized) {
      return res.status(403).json({ message: 'Unauthorized access to chat' });
    }

    // Mark messages as read
    await chat.markAsRead(req.user.role);

    res.json({ chat });
  } catch (error) {
    logger.error('Get chat error:', error);
    res.status(500).json({ message: 'Failed to get chat', error: error.message });
  }
});

// Update chat status/priority (admin only)
router.patch('/:chatId', authenticate, authorizeRoles('admin', 'superadmin'), async (req, res) => {
  try {
    const { chatId } = req.params;
    const { status, priority, category, tags } = req.body;

    const updateData = {};
    if (status) updateData.status = status;
    if (priority) updateData.priority = priority;
    if (category) updateData.category = category;
    if (tags) updateData.tags = tags;

    if (status === 'resolved') {
      updateData.resolved_at = new Date();
    }

    const chat = await Chat.findByIdAndUpdate(
      chatId,
      updateData,
      { new: true, runValidators: true }
    ).populate('user_id admin_id');

    if (!chat) {
      return res.status(404).json({ message: 'Chat not found' });
    }

    // Notify via socket
    try {
      const io = getIO();
      io.to(`chat-${chatId}`).emit('chat-updated', { chat });
      io.to('admin-room').emit('chat-updated', { chat });
    } catch (socketError) {
      logger.warn('Socket notification failed:', socketError);
    }

    logger.info(`Chat ${chatId} updated by admin ${req.user.userId}`);

    res.json({
      message: 'Chat updated successfully',
      chat
    });
  } catch (error) {
    logger.error('Update chat error:', error);
    res.status(500).json({ message: 'Failed to update chat', error: error.message });
  }
});

// Assign chat to admin
router.post('/:chatId/assign', authenticate, authorizeRoles('admin', 'superadmin'), async (req, res) => {
  try {
    const { chatId } = req.params;
    const { admin_id } = req.body;

    const chat = await Chat.findByIdAndUpdate(
      chatId,
      {
        admin_id: admin_id || req.user.userId,
        status: 'assigned'
      },
      { new: true }
    ).populate('user_id admin_id');

    if (!chat) {
      return res.status(404).json({ message: 'Chat not found' });
    }

    // Notify via socket
    try {
      const io = getIO();
      io.to(`chat-${chatId}`).emit('chat-assigned', { chat });
      io.to('admin-room').emit('chat-assigned', { chat });
    } catch (socketError) {
      logger.warn('Socket notification failed:', socketError);
    }

    logger.info(`Chat ${chatId} assigned to admin ${admin_id || req.user.userId}`);

    res.json({
      message: 'Chat assigned successfully',
      chat
    });
  } catch (error) {
    logger.error('Assign chat error:', error);
    res.status(500).json({ message: 'Failed to assign chat', error: error.message });
  }
});

// Add a message to chat (REST fallback)
router.post('/:chatId/messages', authenticate, async (req, res) => {
  try {
    const { chatId } = req.params;
    const { message, messageType, attachmentUrl } = req.body;

    if (!message || message.trim() === '') {
      return res.status(400).json({ message: 'Message cannot be empty' });
    }

    const chat = await Chat.findById(chatId);

    if (!chat) {
      return res.status(404).json({ message: 'Chat not found' });
    }

    // Verify user has access
    const isAuthorized =
      chat.user_id.toString() === req.user.userId ||
      (chat.admin_id && chat.admin_id.toString() === req.user.userId) ||
      ['admin', 'superadmin'].includes(req.user.role);

    if (!isAuthorized) {
      return res.status(403).json({ message: 'Unauthorized' });
    }

    await chat.addMessage(
      req.user.userId,
      req.user.role,
      message,
      messageType || 'text',
      attachmentUrl
    );

    const populatedChat = await Chat.findById(chatId)
      .populate('user_id admin_id')
      .populate('messages.sender_id', 'username role');

    const newMessage = populatedChat.messages[populatedChat.messages.length - 1];

    // Notify via socket
    try {
      const io = getIO();
      io.to(`chat-${chatId}`).emit('new-message', {
        chatId,
        message: newMessage
      });

      if (req.user.role === 'user') {
        io.to('admin-room').emit('new-user-message', {
          chatId,
          userId: req.user.userId,
          message: message.substring(0, 100)
        });
      }
    } catch (socketError) {
      logger.warn('Socket notification failed:', socketError);
    }

    logger.info(`Message added to chat ${chatId} by ${req.user.userId}`);

    res.status(201).json({
      message: 'Message sent successfully',
      newMessage
    });
  } catch (error) {
    logger.error('Add message error:', error);
    res.status(500).json({ message: 'Failed to send message', error: error.message });
  }
});

// Close chat with rating
router.post('/:chatId/close', authenticate, async (req, res) => {
  try {
    const { chatId } = req.params;
    const { rating, feedback } = req.body;

    const chat = await Chat.findById(chatId);

    if (!chat) {
      return res.status(404).json({ message: 'Chat not found' });
    }

    // Verify user has access
    const isAuthorized =
      chat.user_id.toString() === req.user.userId ||
      ['admin', 'superadmin'].includes(req.user.role);

    if (!isAuthorized) {
      return res.status(403).json({ message: 'Unauthorized' });
    }

    const updateData = {
      status: 'closed',
      closed_at: new Date()
    };

    if (rating && rating >= 1 && rating <= 5) {
      updateData.rating = rating;
    }

    if (feedback) {
      updateData.feedback = feedback;
    }

    const updatedChat = await Chat.findByIdAndUpdate(
      chatId,
      updateData,
      { new: true }
    ).populate('user_id admin_id');

    // Notify via socket
    try {
      const io = getIO();
      io.to(`chat-${chatId}`).emit('chat-closed', { chat: updatedChat });
      io.to('admin-room').emit('chat-closed', { chatId });
    } catch (socketError) {
      logger.warn('Socket notification failed:', socketError);
    }

    logger.info(`Chat ${chatId} closed`);

    res.json({
      message: 'Chat closed successfully',
      chat: updatedChat
    });
  } catch (error) {
    logger.error('Close chat error:', error);
    res.status(500).json({ message: 'Failed to close chat', error: error.message });
  }
});

// Get chat statistics (admin only)
router.get('/stats/overview', authenticate, authorizeRoles('admin', 'superadmin'), async (req, res) => {
  try {
    const stats = await Chat.getAdminStats();

    const avgResponseTime = await Chat.aggregate([
      {
        $match: {
          status: 'closed',
          resolved_at: { $exists: true }
        }
      },
      {
        $project: {
          responseTime: {
            $subtract: ['$resolved_at', '$created_at']
          }
        }
      },
      {
        $group: {
          _id: null,
          avgTime: { $avg: '$responseTime' }
        }
      }
    ]);

    const avgRating = await Chat.aggregate([
      {
        $match: { rating: { $exists: true, $ne: null } }
      },
      {
        $group: {
          _id: null,
          avgRating: { $avg: '$rating' },
          totalRatings: { $sum: 1 }
        }
      }
    ]);

    res.json({
      stats: stats.stats,
      urgentCount: stats.urgentCount,
      avgResponseTimeMs: avgResponseTime[0]?.avgTime || 0,
      avgRating: avgRating[0]?.avgRating || 0,
      totalRatings: avgRating[0]?.totalRatings || 0
    });
  } catch (error) {
    logger.error('Get chat stats error:', error);
    res.status(500).json({ message: 'Failed to get stats', error: error.message });
  }
});

module.exports = router;
