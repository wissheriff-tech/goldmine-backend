const Notification = require('../models/Notification');
const logger = require('./logger');

class NotificationService {
  // Create a notification
  async create(userId, type, title, message, options = {}) {
    try {
      const notification = new Notification({
        user_id: userId,
        type,
        title,
        message,
        data: options.data || {},
        priority: options.priority || 'medium',
        action_url: options.action_url || null,
        icon: options.icon || null,
        expires_at: options.expires_at || new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
      });

      await notification.save();
      logger.info(`Notification created: ${type} for user ${userId}`);
      return notification;
    } catch (error) {
      logger.error('Notification creation error:', error);
      throw error;
    }
  }

  // Create bulk notifications for multiple users
  async createBulk(userIds, type, title, message, options = {}) {
    try {
      const notifications = userIds.map(userId => ({
        user_id: userId,
        type,
        title,
        message,
        data: options.data || {},
        priority: options.priority || 'medium',
        action_url: options.action_url || null,
        icon: options.icon || null,
        expires_at: options.expires_at || new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
      }));

      await Notification.insertMany(notifications);
      logger.info(`Bulk notifications created: ${type} for ${userIds.length} users`);
      return notifications;
    } catch (error) {
      logger.error('Bulk notification creation error:', error);
      throw error;
    }
  }

  // Transaction approved notification
  async notifyTransactionApproved(userId, transactionType, amount) {
    return this.create(
      userId,
      'transaction_approved',
      'Transaction Approved',
      `Your ${transactionType} of ${amount} NSL has been approved and processed successfully.`,
      {
        priority: 'high',
        icon: '✅',
        action_url: '/transactions'
      }
    );
  }

  // Transaction rejected notification
  async notifyTransactionRejected(userId, transactionType, amount, reason) {
    return this.create(
      userId,
      'transaction_rejected',
      'Transaction Rejected',
      `Your ${transactionType} of ${amount} NSL was rejected. Reason: ${reason}`,
      {
        priority: 'high',
        icon: '❌',
        action_url: '/transactions'
      }
    );
  }

  // Product purchased notification
  async notifyProductPurchased(userId, productName, expiresAt) {
    return this.create(
      userId,
      'product_purchased',
      'Product Purchased Successfully',
      `You have successfully purchased ${productName}. Valid until ${expiresAt.toLocaleDateString()}.`,
      {
        priority: 'high',
        icon: '🎉',
        action_url: '/products'
      }
    );
  }

  // Product expiring notification
  async notifyProductExpiring(userId, productName, daysLeft) {
    return this.create(
      userId,
      'product_expiring',
      'Product Expiring Soon',
      `Your ${productName} subscription will expire in ${daysLeft} days. Renew now to continue earning.`,
      {
        priority: 'medium',
        icon: '⏰',
        action_url: '/products'
      }
    );
  }

  // Daily income notification
  async notifyDailyIncome(userId, amount, productName) {
    return this.create(
      userId,
      'daily_income',
      'Daily Income Received',
      `You earned ${amount} NSL from ${productName} today!`,
      {
        priority: 'low',
        icon: '💰',
        action_url: '/dashboard'
      }
    );
  }

  // Referral bonus notification
  async notifyReferralBonus(userId, bonusAmount, referredUsername) {
    return this.create(
      userId,
      'referral_bonus',
      'Referral Bonus Earned',
      `You earned ${bonusAmount} NSL from ${referredUsername}'s first purchase!`,
      {
        priority: 'high',
        icon: '🎁',
        action_url: '/referrals'
      }
    );
  }

  // Account approved notification
  async notifyAccountApproved(userId) {
    return this.create(
      userId,
      'account_approved',
      'Account Approved',
      'Congratulations! Your account has been approved. You can now access all features.',
      {
        priority: 'high',
        icon: '✅',
        action_url: '/dashboard'
      }
    );
  }

  // KYC verified notification
  async notifyKYCVerified(userId) {
    return this.create(
      userId,
      'kyc_verified',
      'KYC Verification Successful',
      'Your KYC documents have been verified successfully. Your account is now fully activated.',
      {
        priority: 'high',
        icon: '✅',
        action_url: '/profile'
      }
    );
  }

  // System announcement
  async createSystemAnnouncement(userIds, title, message, priority = 'medium') {
    return this.createBulk(
      userIds,
      'system_announcement',
      title,
      message,
      {
        priority,
        icon: '📢'
      }
    );
  }

  // Security alert
  async notifySecurityAlert(userId, message) {
    return this.create(
      userId,
      'security_alert',
      'Security Alert',
      message,
      {
        priority: 'urgent',
        icon: '🔒',
        action_url: '/settings/security'
      }
    );
  }

  // VIP upgrade notification
  async notifyVIPUpgrade(userId, newLevel) {
    return this.create(
      userId,
      'vip_upgrade',
      'VIP Level Upgraded',
      `Congratulations! You have been upgraded to ${newLevel}. Enjoy your new benefits!`,
      {
        priority: 'high',
        icon: '⭐',
        action_url: '/vip'
      }
    );
  }

  // Mark notification as read
  async markAsRead(notificationId) {
    try {
      const notification = await Notification.findByIdAndUpdate(
        notificationId,
        { read: true, read_at: new Date() },
        { new: true }
      );
      return notification;
    } catch (error) {
      logger.error('Mark as read error:', error);
      throw error;
    }
  }

  // Mark all notifications as read for a user
  async markAllAsRead(userId) {
    try {
      await Notification.updateMany(
        { user_id: userId, read: false },
        { read: true, read_at: new Date() }
      );
      return true;
    } catch (error) {
      logger.error('Mark all as read error:', error);
      throw error;
    }
  }

  // Delete notification
  async delete(notificationId) {
    try {
      await Notification.findByIdAndDelete(notificationId);
      return true;
    } catch (error) {
      logger.error('Delete notification error:', error);
      throw error;
    }
  }

  // Get unread count
  async getUnreadCount(userId) {
    try {
      const count = await Notification.countDocuments({
        user_id: userId,
        read: false
      });
      return count;
    } catch (error) {
      logger.error('Get unread count error:', error);
      throw error;
    }
  }

  // Get user notifications
  async getUserNotifications(userId, options = {}) {
    try {
      const {
        limit = 20,
        skip = 0,
        read = null,
        type = null,
        priority = null
      } = options;

      const filter = { user_id: userId };
      if (read !== null) filter.read = read;
      if (type) filter.type = type;
      if (priority) filter.priority = priority;

      const notifications = await Notification.find(filter)
        .sort({ created_at: -1 })
        .limit(parseInt(limit))
        .skip(parseInt(skip));

      const total = await Notification.countDocuments(filter);

      return {
        notifications,
        pagination: {
          total,
          limit: parseInt(limit),
          skip: parseInt(skip)
        }
      };
    } catch (error) {
      logger.error('Get user notifications error:', error);
      throw error;
    }
  }
}

module.exports = new NotificationService();
