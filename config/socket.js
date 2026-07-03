const socketIo = require('socket.io');
const crypto = require('crypto');
const { Op } = require('sequelize');
const User = require('../models/User');
const Session = require('../models/Session');
const Chat = require('../models/Chat');
const ChatMessage = require('../models/ChatMessage');
const logger = require('../utils/logger');

let io;

// Connected users map (userId -> socketId)
const connectedUsers = new Map();

// Admin users map (adminId -> socketId)
const connectedAdmins = new Map();

const initializeSocket = (server) => {
  io = socketIo(server, {
    cors: {
      origin: process.env.FRONTEND_URL || 'http://localhost:3000',
      methods: ['GET', 'POST'],
      credentials: true
    },
    pingTimeout: 60000,
    pingInterval: 25000
  });

  // Authentication middleware
  io.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth.token;

      if (!token) {
        return next(new Error('Authentication error: No token provided'));
      }

      const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
      const session = await Session.findOne({
        where: { access_token: tokenHash, is_active: true }
      });

      const now = new Date();
      if (!session || now > session.expires_at) {
        if (session) await session.update({ is_active: false });
        return next(new Error('Authentication error: Invalid or expired token'));
      }

      const user = await User.findByPk(session.user_id);
      if (!user) {
        return next(new Error('Authentication error: User not found'));
      }
      if (user.status !== 'active') {
        return next(new Error('Authentication error: User is not active'));
      }

      socket.userId = String(user.id);
      socket.userRole = user.role;
      socket.username = user.username;

      next();
    } catch (error) {
      logger.error('Socket authentication error:', error);
      next(new Error('Authentication error'));
    }
  });

  io.on('connection', (socket) => {
    logger.info(`User connected: ${socket.username} (${socket.userId})`);

    // Store connected user
    if (['admin', 'superadmin', 'finance'].includes(socket.userRole)) {
      connectedAdmins.set(socket.userId, socket.id);
      socket.join('admin-room');
    } else {
      connectedUsers.set(socket.userId, socket.id);
    }

    // Join user's personal room
    socket.join(`user-${socket.userId}`);

    // Emit online status
    io.emit('user-online', { userId: socket.userId, role: socket.userRole });

    // User joins a chat
    socket.on('join-chat', async (chatId) => {
      try {
        const chat = await Chat.findByPk(chatId, {
          include: [
            { model: User, as: 'user', attributes: ['id', 'username', 'phone'] },
            { model: User, as: 'admin', attributes: ['id', 'username', 'phone'] }
          ]
        });

        if (!chat) {
          return socket.emit('error', { message: 'Chat not found' });
        }

        // Verify user has access to this chat
        const isAuthorized =
          String(chat.user_id) === socket.userId ||
          (chat.admin_id && String(chat.admin_id) === socket.userId) ||
          ['admin', 'superadmin'].includes(socket.userRole);

        if (!isAuthorized) {
          return socket.emit('error', { message: 'Unauthorized access to chat' });
        }

        socket.join(`chat-${chatId}`);
        socket.currentChatId = chatId;

        // Mark messages as read
        const readCondition = socket.userRole === 'user'
          ? { chat_id: chatId, sender_role: { [Op.ne]: 'user' }, read: false }
          : { chat_id: chatId, sender_role: 'user', read: false };

        await ChatMessage.update(
          { read: true, read_at: new Date() },
          { where: readCondition }
        );

        // Get chat messages
        const messages = await ChatMessage.findAll({
          where: { chat_id: chatId },
          include: [{ model: User, as: 'sender', attributes: ['id', 'username', 'phone'] }],
          order: [['created_at', 'ASC']]
        });

        // Send chat history
        socket.emit('chat-history', { chat, messages });

        logger.info(`User ${socket.username} joined chat ${chatId}`);
      } catch (error) {
        logger.error('Join chat error:', error);
        socket.emit('error', { message: 'Failed to join chat' });
      }
    });

    // User sends a message
    socket.on('send-message', async (data) => {
      try {
        const { chatId, message, messageType, attachmentUrl } = data;

        const chat = await Chat.findByPk(chatId);

        if (!chat) {
          return socket.emit('error', { message: 'Chat not found' });
        }

        // Verify user has access
        const isAuthorized =
          String(chat.user_id) === socket.userId ||
          (chat.admin_id && String(chat.admin_id) === socket.userId) ||
          ['admin', 'superadmin'].includes(socket.userRole);

        if (!isAuthorized) {
          return socket.emit('error', { message: 'Unauthorized' });
        }

        // Create message
        const newMessage = await ChatMessage.create({
          chat_id: chatId,
          sender_id: parseInt(socket.userId),
          sender_role: socket.userRole,
          message,
          message_type: messageType || 'text',
          attachment_url: attachmentUrl || null
        });

        // Update chat last_message_at
        await chat.update({ last_message_at: new Date() });

        // Fetch the message with sender info
        const populatedMessage = await ChatMessage.findByPk(newMessage.id, {
          include: [{ model: User, as: 'sender', attributes: ['id', 'username', 'phone'] }]
        });

        // Emit to chat room
        io.to(`chat-${chatId}`).emit('new-message', {
          chatId,
          message: populatedMessage,
          sender: {
            id: socket.userId,
            username: socket.username,
            role: socket.userRole
          }
        });

        // Notify admin room if user sent message
        if (socket.userRole === 'user') {
          io.to('admin-room').emit('new-user-message', {
            chatId,
            userId: socket.userId,
            username: socket.username,
            message: message.substring(0, 100)
          });
        }

        // Stop typing indicator
        socket.to(`chat-${chatId}`).emit('user-stopped-typing', {
          userId: socket.userId,
          role: socket.userRole
        });

        logger.info(`Message sent in chat ${chatId} by ${socket.username}`);
      } catch (error) {
        logger.error('Send message error:', error);
        socket.emit('error', { message: 'Failed to send message' });
      }
    });

    // User is typing
    socket.on('typing', (chatId) => {
      socket.to(`chat-${chatId}`).emit('user-typing', {
        userId: socket.userId,
        username: socket.username,
        role: socket.userRole
      });
    });

    // User stopped typing
    socket.on('stop-typing', (chatId) => {
      socket.to(`chat-${chatId}`).emit('user-stopped-typing', {
        userId: socket.userId,
        role: socket.userRole
      });
    });

    // Admin assigns chat to themselves
    socket.on('assign-chat', async (chatId) => {
      try {
        if (!['admin', 'superadmin'].includes(socket.userRole)) {
          return socket.emit('error', { message: 'Unauthorized' });
        }

        await Chat.update(
          { admin_id: parseInt(socket.userId), status: 'assigned' },
          { where: { id: chatId } }
        );

        const chat = await Chat.findByPk(chatId, {
          include: [
            { model: User, as: 'user', attributes: ['id', 'username', 'phone'] },
            { model: User, as: 'admin', attributes: ['id', 'username', 'phone'] }
          ]
        });

        io.to('admin-room').emit('chat-assigned', { chat });
        io.to(`chat-${chatId}`).emit('chat-updated', { chat });

        logger.info(`Chat ${chatId} assigned to admin ${socket.username}`);
      } catch (error) {
        logger.error('Assign chat error:', error);
        socket.emit('error', { message: 'Failed to assign chat' });
      }
    });

    // Close/resolve chat
    socket.on('close-chat', async (data) => {
      try {
        const { chatId, rating, feedback } = data;

        const updateData = {
          status: 'closed',
          closed_at: new Date()
        };

        if (rating) updateData.rating = rating;
        if (feedback) updateData.feedback = feedback;

        await Chat.update(updateData, { where: { id: chatId } });

        const chat = await Chat.findByPk(chatId, {
          include: [
            { model: User, as: 'user', attributes: ['id', 'username', 'phone'] },
            { model: User, as: 'admin', attributes: ['id', 'username', 'phone'] }
          ]
        });

        io.to(`chat-${chatId}`).emit('chat-closed', { chat });
        io.to('admin-room').emit('chat-closed', { chatId });

        logger.info(`Chat ${chatId} closed`);
      } catch (error) {
        logger.error('Close chat error:', error);
        socket.emit('error', { message: 'Failed to close chat' });
      }
    });

    // Request admin stats (for admin dashboard)
    socket.on('get-admin-stats', async () => {
      try {
        if (!['admin', 'superadmin'].includes(socket.userRole)) {
          return socket.emit('error', { message: 'Unauthorized' });
        }

        const openChats = await Chat.count({ where: { status: 'open' } });
        const assignedChats = await Chat.count({ where: { status: 'assigned' } });
        const closedChats = await Chat.count({ where: { status: 'closed' } });

        const stats = {
          open: openChats,
          assigned: assignedChats,
          closed: closedChats,
          total: openChats + assignedChats + closedChats
        };

        const activeChats = await Chat.findAll({
          where: { status: { [Op.in]: ['open', 'assigned'] } },
          include: [{ model: User, as: 'user', attributes: ['id', 'username', 'phone'] }],
          order: [['priority', 'DESC'], ['last_message_at', 'DESC']],
          limit: 20
        });

        socket.emit('admin-stats', { stats, activeChats });
      } catch (error) {
        logger.error('Get admin stats error:', error);
        socket.emit('error', { message: 'Failed to get stats' });
      }
    });

    // Disconnect
    socket.on('disconnect', () => {
      logger.info(`User disconnected: ${socket.username} (${socket.userId})`);

      // Remove from connected users
      connectedUsers.delete(socket.userId);
      connectedAdmins.delete(socket.userId);

      // Emit offline status
      io.emit('user-offline', { userId: socket.userId });

      // Stop typing in current chat
      if (socket.currentChatId) {
        socket.to(`chat-${socket.currentChatId}`).emit('user-stopped-typing', {
          userId: socket.userId,
          role: socket.userRole
        });
      }
    });
  });

  return io;
};

const getIO = () => {
  if (!io) {
    throw new Error('Socket.io not initialized');
  }
  return io;
};

const getConnectedUsers = () => connectedUsers;
const getConnectedAdmins = () => connectedAdmins;

module.exports = {
  initializeSocket,
  getIO,
  getConnectedUsers,
  getConnectedAdmins
};
