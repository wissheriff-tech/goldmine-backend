const express = require('express');
const Notification = require('../models/Notification');
const { authenticate, authorize } = require('../middleware/auth');
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
    const notification = await Notification.findById(req.params.id);

    if (!notification) {
      return res.status(404).json({ message: 'Notification not found' });
    }

    // Verify notification belongs to user
    if (notification.user_id.toString() !== req.user.id) {
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

// Delete notification
router.delete('/:id', authenticate, async (req, res) => {
  try {
    const notification = await Notification.findById(req.params.id);

    if (!notification) {
      return res.status(404).json({ message: 'Notification not found' });
    }

    // Verify notification belongs to user
    if (notification.user_id.toString() !== req.user.id) {
      return res.status(403).json({ message: 'Unauthorized' });
    }

    await notificationService.delete(req.params.id);

    res.json({ message: 'Notification deleted successfully' });
  } catch (error) {
    logger.error('Delete notification error:', error);
    res.status(500).json({ message: 'Error deleting notification', error: error.message });
  }
});

// Delete all read notifications
router.delete('/clear-read', authenticate, async (req, res) => {
  try {
    const result = await Notification.deleteMany({
      user_id: req.user.id,
      read: true
    });

    res.json({
      message: 'All read notifications cleared',
      deleted_count: result.deletedCount
    });
  } catch (error) {
    logger.error('Clear read notifications error:', error);
    res.status(500).json({ message: 'Error clearing notifications', error: error.message });
  }
});

// Admin: Send system announcement
router.post('/admin/announcement', authenticate, authorize(['superadmin', 'admin']), async (req, res) => {
  try {
    const { title, message, priority, target_users } = req.body;

    if (!title || !message) {
      return res.status(400).json({ message: 'Title and message are required' });
    }

    let userIds = target_users;

    // If no specific users, send to all active users
    if (!userIds || userIds.length === 0) {
      const User = require('../models/User');
      const users = await User.find({ status: 'active' }).select('_id');
      userIds = users.map(u => u._id);
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

// Admin: Get notification statistics
router.get('/admin/stats', authenticate, authorize(['superadmin', 'admin']), async (req, res) => {
  try {
    const totalNotifications = await Notification.countDocuments();
    const unreadNotifications = await Notification.countDocuments({ read: false });
    const readNotifications = await Notification.countDocuments({ read: true });

    const notificationsByType = await Notification.aggregate([
      {
        $group: {
          _id: '$type',
          count: { $sum: 1 }
        }
      },
      {
        $sort: { count: -1 }
      }
    ]);

    const notificationsByPriority = await Notification.aggregate([
      {
        $group: {
          _id: '$priority',
          count: { $sum: 1 }
        }
      }
    ]);

    res.json({
      total: totalNotifications,
      unread: unreadNotifications,
      read: readNotifications,
      by_type: notificationsByType,
      by_priority: notificationsByPriority
    });
  } catch (error) {
    logger.error('Get notification stats error:', error);
    res.status(500).json({ message: 'Error fetching statistics', error: error.message });
  }
});

module.exports = router;
