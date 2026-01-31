const express = require('express');
const { Chat, ChatMessage, User } = require('../models');
const { Op, fn, col, literal } = require('sequelize');
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
      where: {
        user_id: req.user.userId,
        status: { [Op.in]: ['open', 'assigned'] }
      }
    });

    if (existingChat) {
      return res.status(400).json({
        message: 'You already have an active chat. Please close it before starting a new one.',
        chatId: existingChat.id
      });
    }

    // Create new chat
    const chat = await Chat.create({
      user_id: req.user.userId,
      subject: subject || 'General Inquiry',
      category: category || 'general',
      priority: priority || 'medium',
      status: 'open'
    });

    // Add initial message if provided
    if (message) {
      await ChatMessage.create({
        chat_id: chat.id,
        sender_id: req.user.userId,
        sender_role: req.user.role,
        message
      });

      // Update last_message_at on the chat
      await chat.update({ last_message_at: new Date() });
    }

    const populatedChat = await Chat.findByPk(chat.id, {
      include: [{ model: User, as: 'user' }]
    });

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

    const where = { user_id: req.user.userId };

    if (status) {
      where.status = status;
    }

    const { rows: chats, count: total } = await Chat.findAndCountAll({
      where,
      include: [{
        model: User,
        as: 'admin',
        attributes: ['username', 'role']
      }],
      order: [['last_message_at', 'DESC']],
      limit: parseInt(limit),
      offset: parseInt(offset)
    });

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

    const where = {};

    if (status) where.status = status;
    if (priority) where.priority = priority;
    if (category) where.category = category;
    if (admin_id) where.admin_id = admin_id;

    const { rows: chats, count: total } = await Chat.findAndCountAll({
      where,
      include: [
        {
          model: User,
          as: 'user',
          attributes: ['username', 'phone', 'email', 'vip_level']
        },
        {
          model: User,
          as: 'admin',
          attributes: ['username', 'role']
        }
      ],
      order: [['priority', 'DESC'], ['last_message_at', 'DESC']],
      limit: parseInt(limit),
      offset: parseInt(offset)
    });

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

    const chat = await Chat.findByPk(chatId, {
      include: [
        {
          model: User,
          as: 'user',
          attributes: ['id', 'username', 'phone', 'email', 'vip_level']
        },
        {
          model: User,
          as: 'admin',
          attributes: ['id', 'username', 'role']
        }
      ]
    });

    if (!chat) {
      return res.status(404).json({ message: 'Chat not found' });
    }

    // Verify user has access
    const isAuthorized =
      chat.user_id.toString() === req.user.userId.toString() ||
      (chat.admin_id && chat.admin_id.toString() === req.user.userId.toString()) ||
      ['admin', 'superadmin'].includes(req.user.role);

    if (!isAuthorized) {
      return res.status(403).json({ message: 'Unauthorized access to chat' });
    }

    // Get messages for this chat
    const messages = await ChatMessage.findAll({
      where: { chat_id: chatId },
      include: [{
        model: User,
        as: 'sender',
        attributes: ['username', 'role']
      }],
      order: [['created_at', 'ASC']]
    });

    // Mark messages as read
    await ChatMessage.update(
      { read: true, read_at: new Date() },
      {
        where: {
          chat_id: chatId,
          read: false,
          sender_role: { [Op.ne]: req.user.role }
        }
      }
    );

    const chatData = chat.toJSON();
    chatData.messages = messages;

    res.json({ chat: chatData });
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

    const [affectedCount] = await Chat.update(updateData, {
      where: { id: chatId }
    });

    if (affectedCount === 0) {
      return res.status(404).json({ message: 'Chat not found' });
    }

    const chat = await Chat.findByPk(chatId, {
      include: [
        { model: User, as: 'user' },
        { model: User, as: 'admin' }
      ]
    });

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

    const [affectedCount] = await Chat.update(
      {
        admin_id: admin_id || req.user.userId,
        status: 'assigned'
      },
      { where: { id: chatId } }
    );

    if (affectedCount === 0) {
      return res.status(404).json({ message: 'Chat not found' });
    }

    const chat = await Chat.findByPk(chatId, {
      include: [
        { model: User, as: 'user' },
        { model: User, as: 'admin' }
      ]
    });

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

    const chat = await Chat.findByPk(chatId);

    if (!chat) {
      return res.status(404).json({ message: 'Chat not found' });
    }

    // Verify user has access
    const isAuthorized =
      chat.user_id.toString() === req.user.userId.toString() ||
      (chat.admin_id && chat.admin_id.toString() === req.user.userId.toString()) ||
      ['admin', 'superadmin'].includes(req.user.role);

    if (!isAuthorized) {
      return res.status(403).json({ message: 'Unauthorized' });
    }

    // Create the message in the ChatMessage table
    const newMessage = await ChatMessage.create({
      chat_id: chatId,
      sender_id: req.user.userId,
      sender_role: req.user.role,
      message,
      message_type: messageType || 'text',
      attachment_url: attachmentUrl || null
    });

    // Update last_message_at on the chat
    await chat.update({ last_message_at: new Date() });

    // Fetch the message with sender info
    const populatedMessage = await ChatMessage.findByPk(newMessage.id, {
      include: [{
        model: User,
        as: 'sender',
        attributes: ['username', 'role']
      }]
    });

    // Notify via socket
    try {
      const io = getIO();
      io.to(`chat-${chatId}`).emit('new-message', {
        chatId,
        message: populatedMessage
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
      newMessage: populatedMessage
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

    const chat = await Chat.findByPk(chatId);

    if (!chat) {
      return res.status(404).json({ message: 'Chat not found' });
    }

    // Verify user has access
    const isAuthorized =
      chat.user_id.toString() === req.user.userId.toString() ||
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

    await Chat.update(updateData, { where: { id: chatId } });

    const updatedChat = await Chat.findByPk(chatId, {
      include: [
        { model: User, as: 'user' },
        { model: User, as: 'admin' }
      ]
    });

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
    // Chat counts by status
    const statsCounts = await Chat.findAll({
      attributes: [
        'status',
        [fn('COUNT', col('id')), 'count']
      ],
      group: ['status'],
      raw: true
    });

    const stats = {};
    statsCounts.forEach(s => {
      stats[s.status] = parseInt(s.count);
    });

    // Urgent count (open + high/urgent priority)
    const urgentCount = await Chat.count({
      where: {
        status: { [Op.in]: ['open', 'assigned'] },
        priority: { [Op.in]: ['high', 'urgent'] }
      }
    });

    // Average response time for closed chats
    const avgResponseTime = await Chat.findAll({
      where: {
        status: 'closed',
        resolved_at: { [Op.ne]: null }
      },
      attributes: [
        [fn('AVG', literal('TIMESTAMPDIFF(SECOND, created_at, resolved_at) * 1000')), 'avgTime']
      ],
      raw: true
    });

    // Average rating
    const avgRating = await Chat.findAll({
      where: {
        rating: { [Op.ne]: null }
      },
      attributes: [
        [fn('AVG', col('rating')), 'avgRating'],
        [fn('COUNT', col('id')), 'totalRatings']
      ],
      raw: true
    });

    res.json({
      stats,
      urgentCount,
      avgResponseTimeMs: parseFloat(avgResponseTime[0]?.avgTime) || 0,
      avgRating: parseFloat(avgRating[0]?.avgRating) || 0,
      totalRatings: parseInt(avgRating[0]?.totalRatings) || 0
    });
  } catch (error) {
    logger.error('Get chat stats error:', error);
    res.status(500).json({ message: 'Failed to get stats', error: error.message });
  }
});

module.exports = router;
