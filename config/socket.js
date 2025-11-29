const socketIo = require('socket.io');
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const Chat = require('../models/Chat');
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

      const decoded = jwt.verify(token, process.env.JWT_SECRET || 'your-secret-key');
      const user = await User.findById(decoded.userId);

      if (!user) {
        return next(new Error('Authentication error: User not found'));
      }

      socket.userId = user._id.toString();
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
        const chat = await Chat.findById(chatId).populate('user_id admin_id');

        if (!chat) {
          return socket.emit('error', { message: 'Chat not found' });
        }

        // Verify user has access to this chat
        const isAuthorized =
          chat.user_id._id.toString() === socket.userId ||
          (chat.admin_id && chat.admin_id._id.toString() === socket.userId) ||
          ['admin', 'superadmin'].includes(socket.userRole);

        if (!isAuthorized) {
          return socket.emit('error', { message: 'Unauthorized access to chat' });
        }

        socket.join(`chat-${chatId}`);
        socket.currentChatId = chatId;

        // Mark messages as read
        await chat.markAsRead(socket.userRole);

        // Send chat history
        socket.emit('chat-history', { chat });

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

        const chat = await Chat.findById(chatId);

        if (!chat) {
          return socket.emit('error', { message: 'Chat not found' });
        }

        // Verify user has access
        const isAuthorized =
          chat.user_id.toString() === socket.userId ||
          (chat.admin_id && chat.admin_id.toString() === socket.userId) ||
          ['admin', 'superadmin'].includes(socket.userRole);

        if (!isAuthorized) {
          return socket.emit('error', { message: 'Unauthorized' });
        }

        // Add message to chat
        await chat.addMessage(
          socket.userId,
          socket.userRole,
          message,
          messageType || 'text',
          attachmentUrl
        );

        const populatedChat = await Chat.findById(chatId)
          .populate('user_id admin_id');

        const newMessage = populatedChat.messages[populatedChat.messages.length - 1];

        // Emit to chat room
        io.to(`chat-${chatId}`).emit('new-message', {
          chatId,
          message: newMessage,
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

        const chat = await Chat.findByIdAndUpdate(
          chatId,
          {
            admin_id: socket.userId,
            status: 'assigned'
          },
          { new: true }
        ).populate('user_id admin_id');

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

        const chat = await Chat.findByIdAndUpdate(
          chatId,
          updateData,
          { new: true }
        ).populate('user_id admin_id');

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

        const stats = await Chat.getAdminStats();
        const activeChats = await Chat.find({
          status: { $in: ['open', 'assigned'] }
        })
          .populate('user_id')
          .sort({ priority: -1, last_message_at: -1 })
          .limit(20);

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
