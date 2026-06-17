const express = require('express');
const { Notification, User } = require('../models');
const { Op, fn, col } = require('sequelize');
const { authenticate, authorize } = require('../middleware/auth');
const { adminLimiter } = require('../middleware/security');
const notificationService = require('../utils/notificationService');
const logger = require('../utils/logger');

const router = express.Router();

// Get user notifications
router.get('/', authenticate, async (req, res) => {
  try {
    const { limit = 20, skip = 0, read, type, priority } = req.query;

    const result = await notificationService.getUserNotifications(req.user.id, {
      limit,
      skip,
      read: read !== undefined ? read === 'true' : null,
      type,
      priority
    });

    res.json(result);
  } catch (error) {
    logger.error('Get notifications error:', error);
    res.status(500).json({ message: 'Error fetching notifications', error: error.message });
  }
});

// Get unread count
router.get('/unread-count', authenticate, async (req, res) => {
  try {
    const count = await notificationService.getUnreadCount(req.user.id);
    res.json({ unread_count: count });
  } catch (error) {
    logger.error('Get unread count error:', error);
    res.status(500).json({ message: 'Error fetching unread count', error: error.message });
  }
});

// Mark notification as read
router.patch('/:id/read', authenticate, async (req, res) => {
  try {
    const notification = await Notification.findByPk(req.params.id);

    if (!notification) {
      return res.status(404).json({ message: 'Notification not found' });
    }

    // Verify notification belongs to user
    if (notification.user_id !== req.user.id) {
      return res.status(403).json({ message: 'Unauthorized' });
    }

    const updatedNotification = await notificationService.markAsRead(req.params.id);

    res.json({
      message: 'Notification marked as read',
      notification: updatedNotification
    });
  } catch (error) {
    logger.error('Mark as read error:', error);
    res.status(500).json({ message: 'Error marking notification as read', error: error.message });
  }
});

// Mark all as read
router.patch('/mark-all-read', authenticate, async (req, res) => {
  try {
    await notificationService.markAllAsRead(req.user.id);
    res.json({ message: 'All notifications marked as read' });
  } catch (error) {
    logger.error('Mark all as read error:', error);
    res.status(500).json({ message: 'Error marking all as read', error: error.message });
  }
});

const clearReadNotifications = async (req, res) => {
  try {
    const deletedCount = await Notification.destroy({
      where: {
        user_id: req.user.id,
        read: true
      }
    });

    res.json({
      message: 'All read notifications cleared',
      deleted_count: deletedCount
    });
  } catch (error) {
    logger.error('Clear read notifications error:', error);
    res.status(500).json({ message: 'Error clearing notifications', error: error.message });
  }
};

// Delete all read notifications
router.delete('/clear-read', authenticate, clearReadNotifications);

// Delete notification
router.delete('/:id', authenticate, async (req, res) => {
  try {
    const notification = await Notification.findByPk(req.params.id);

    if (!notification) {
      return res.status(404).json({ message: 'Notification not found' });
    }

    // Verify notification belongs to user
    if (notification.user_id !== req.user.id) {
      return res.status(403).json({ message: 'Unauthorized' });
    }

    await notificationService.delete(req.params.id);

    res.json({ message: 'Notification deleted successfully' });
  } catch (error) {
    logger.error('Delete notification error:', error);
    res.status(500).json({ message: 'Error deleting notification', error: error.message });
  }
});

// Admin: Send system announcement
router.post('/admin/announcement', authenticate, authorize(['superadmin', 'admin']), adminLimiter, async (req, res) => {
  try {
    const { title, message, priority, target_users } = req.body;

    if (!title || !message) {
      return res.status(400).json({ message: 'Title and message are required' });
    }

    let userIds = target_users;

    // If no specific users, send to all active users
    if (!userIds || userIds.length === 0) {
      const users = await User.findAll({
        where: { status: 'active' },
        attributes: ['id']
      });
      userIds = users.map(u => u.id);
    }

    await notificationService.createSystemAnnouncement(
      userIds,
      title,
      message,
      priority || 'medium'
    );

    logger.info(`System announcement sent by ${req.user.phone} to ${userIds.length} users`);

    res.json({
      message: 'Announcement sent successfully',
      recipients: userIds.length
    });
  } catch (error) {
    logger.error('Send announcement error:', error);
    res.status(500).json({ message: 'Error sending announcement', error: error.message });
  }
});

const sendAdminMessage = async (req, res) => {
  try {
    const { user_id, title, message, priority } = req.body;

    if (!user_id || !title || !message) {
      return res.status(400).json({ message: 'User, title, and message are required' });
    }

    const targetUser = await User.findByPk(user_id, {
      attributes: ['id', 'username', 'phone', 'status']
    });

    if (!targetUser) {
      return res.status(404).json({ message: 'User not found' });
    }

    const notification = await notificationService.notifyAdminMessage(
      targetUser.id,
      title.trim(),
      message.trim(),
      {
        priority: priority || 'high',
        data: {
          sender_id: req.user.id,
          sender_username: req.user.username,
          sender_role: req.user.role
        }
      }
    );

    logger.info(`Admin message sent by ${req.user.username || req.user.phone} to user ${targetUser.id}`);

    res.status(201).json({
      message: 'Special message sent successfully',
      notification,
      user: targetUser
    });
  } catch (error) {
    logger.error('Send admin message error:', error);
    res.status(500).json({ message: 'Error sending message', error: error.message });
  }
};

// Admin: Send a targeted special message to one user
router.post('/admin/message', authenticate, authorize(['superadmin', 'admin']), adminLimiter, sendAdminMessage);
router.post('/message', authenticate, authorize(['superadmin', 'admin']), adminLimiter, sendAdminMessage);

// Admin: Get notification statistics
router.get('/admin/stats', authenticate, authorize(['superadmin', 'admin']), async (req, res) => {
  try {
    const totalNotifications = await Notification.count();
    const unreadNotifications = await Notification.count({ where: { read: false } });
    const readNotifications = await Notification.count({ where: { read: true } });

    const notificationsByType = await Notification.findAll({
      attributes: [
        'type',
        [fn('COUNT', col('id')), 'count']
      ],
      group: ['type'],
      order: [[fn('COUNT', col('id')), 'DESC']],
      raw: true
    });

    const notificationsByPriority = await Notification.findAll({
      attributes: [
        'priority',
        [fn('COUNT', col('id')), 'count']
      ],
      group: ['priority'],
      raw: true
    });

    res.json({
      total: totalNotifications,
      unread: unreadNotifications,
      read: readNotifications,
      by_type: notificationsByType.map(n => ({
        type: n.type,
        count: parseInt(n.count)
      })),
      by_priority: notificationsByPriority.map(n => ({
        priority: n.priority,
        count: parseInt(n.count)
      }))
    });
  } catch (error) {
    logger.error('Get notification stats error:', error);
    res.status(500).json({ message: 'Error fetching statistics', error: error.message });
  }
});

module.exports = router;
