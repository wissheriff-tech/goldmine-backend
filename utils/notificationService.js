const Notification = require('../models/Notification');
const logger = require('./logger');
const pushService = require('./pushService');

function formatMoney(amount, currency = 'NSL') {
  const value = Number(amount);
  const formatted = Number.isFinite(value)
    ? value.toLocaleString('en-US', { maximumFractionDigits: currency === 'USDT' ? 6 : 2 })
    : String(amount || 0);
  return `${formatted} ${currency}`;
}

class NotificationService {
  // Create a notification
  async create(userId, type, title, message, options = {}) {
    try {
      const notification = await Notification.create({
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

      logger.info(`Notification created: ${type} for user ${userId}`);

      pushService.sendToUser(userId, {
        title,
        body: message,
        url: options.action_url || '/dashboard',
        type
      }).catch(err => logger.warn(`Push send failed for user ${userId}:`, err.message));

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

      await Notification.bulkCreate(notifications);
      logger.info(`Bulk notifications created: ${type} for ${userIds.length} users`);

      pushService.sendToUsers(userIds, {
        title,
        body: message,
        url: options.action_url || '/dashboard',
        type
      }).catch(err => logger.warn(`Bulk push send failed (${userIds.length} users):`, err.message));

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
        icon: 'check_circle',
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
        icon: 'cancel',
        action_url: '/transactions'
      }
    );
  }

  // Deposit approved notification
  async notifyRechargeApproved(userId, amount, currency = 'NSL', data = {}) {
    return this.create(
      userId,
      'recharge_approved',
      'Deposit Successful',
      `Your deposit of ${formatMoney(amount, currency)} has been approved and credited successfully.`,
      {
        priority: 'high',
        icon: 'payments',
        action_url: '/transactions',
        data
      }
    );
  }

  // Deposit rejected notification
  async notifyRechargeRejected(userId, amount, currency = 'NSL', reason = 'No reason provided', data = {}) {
    return this.create(
      userId,
      'recharge_rejected',
      'Deposit Rejected',
      `Your deposit of ${formatMoney(amount, currency)} was rejected. Reason: ${reason}`,
      {
        priority: 'high',
        icon: 'cancel',
        action_url: '/transactions',
        data: { ...data, reason }
      }
    );
  }

  // Reviewer alert for a new deposit waiting for approval
  async notifyDepositPendingReviewer(userId, summary = {}) {
    const referenceText = summary.referenceId ? ` Reference: ${summary.referenceId}.` : '';
    return this.create(
      userId,
      'admin_message',
      'New Deposit Pending',
      `${summary.providerLabel || 'Deposit'} ${summary.amountLabel || ''} is waiting for approval.${referenceText}`,
      {
        priority: 'urgent',
        icon: 'payments',
        action_url: summary.actionUrl || '/admin?tab=Deposits',
        data: summary.data || {}
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
        icon: 'celebration',
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
        icon: 'alarm',
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
        icon: 'payments',
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
        icon: 'card_giftcard',
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
        icon: 'check_circle',
        action_url: '/dashboard'
      }
    );
  }

  // General account update notification
  async notifyAccountUpdated(userId, title, message, options = {}) {
    return this.create(
      userId,
      options.type || 'account_updated',
      title,
      message,
      {
        priority: options.priority || 'medium',
        icon: options.icon || 'account_circle',
        action_url: options.action_url || '/account',
        data: options.data || {}
      }
    );
  }

  // Balance adjusted by admin
  async notifyBalanceAdjusted(userId, action, amount, currency, newBalance, reason) {
    const verb = action === 'deduct' ? 'deducted from' : 'added to';
    const amountLabel = `${Number(amount).toLocaleString()} ${currency}`;

    return this.create(
      userId,
      'balance_adjusted',
      action === 'deduct' ? 'Money Deducted' : 'Money Added',
      `${amountLabel} was ${verb} your account. New ${currency} balance: ${Number(newBalance).toLocaleString()}.${reason ? ` Reason: ${reason}` : ''}`,
      {
        priority: 'high',
        icon: 'payments',
        action_url: '/wallet',
        data: { action, amount, currency, new_balance: newBalance, reason: reason || null }
      }
    );
  }

  // Phone changed by admin
  async notifyPhoneChanged(userId, phone) {
    return this.create(
      userId,
      'phone_changed',
      'Phone Number Updated',
      `The phone number on your account was changed to ${phone}.`,
      {
        priority: 'high',
        icon: 'phone',
        action_url: '/account/settings',
        data: { phone }
      }
    );
  }

  // Password changed by account owner
  async notifyPasswordChanged(userId) {
    return this.create(
      userId,
      'password_changed',
      'Password Changed',
      'Your password was changed successfully. If this was not you, contact support immediately.',
      {
        priority: 'urgent',
        icon: 'lock',
        action_url: '/account/security'
      }
    );
  }

  // Password reset through recovery or by admin
  async notifyPasswordReset(userId, performedBy = 'system') {
    const message = performedBy === 'admin'
      ? 'Your password was reset by an administrator. If you did not request this, contact support immediately.'
      : 'Your password was reset successfully. If this was not you, contact support immediately.';

    return this.create(
      userId,
      'password_reset',
      'Password Reset',
      message,
      {
        priority: 'urgent',
        icon: 'lock_reset',
        action_url: '/account/security',
        data: { performed_by: performedBy }
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
        icon: 'verified',
        action_url: '/account/kyc'
      }
    );
  }

  async notifyKYCRejected(userId, reason) {
    return this.create(
      userId,
      'kyc_rejected',
      'KYC Verification Rejected',
      `Your KYC verification was rejected.${reason ? ` Reason: ${reason}` : ''}`,
      {
        priority: 'high',
        icon: 'cancel',
        action_url: '/account/kyc',
        data: { reason: reason || null }
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
        icon: 'campaign'
      }
    );
  }

  // Targeted admin message
  async notifyAdminMessage(userId, title, message, options = {}) {
    return this.create(
      userId,
      'admin_message',
      title,
      message,
      {
        priority: options.priority || 'high',
        icon: 'campaign',
        action_url: options.action_url || null,
        data: options.data || {}
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
        icon: 'lock',
        action_url: '/account/security'
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
        icon: 'star',
        action_url: '/vip'
      }
    );
  }

  // Mark notification as read
  async markAsRead(notificationId) {
    try {
      await Notification.update(
        { read: true, read_at: new Date() },
        { where: { id: notificationId } }
      );
      return await Notification.findByPk(notificationId);
    } catch (error) {
      logger.error('Mark as read error:', error);
      throw error;
    }
  }

  // Mark all notifications as read for a user
  async markAllAsRead(userId) {
    try {
      await Notification.update(
        { read: true, read_at: new Date() },
        { where: { user_id: userId, read: false } }
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
      await Notification.destroy({ where: { id: notificationId } });
      return true;
    } catch (error) {
      logger.error('Delete notification error:', error);
      throw error;
    }
  }

  // Get unread count
  async getUnreadCount(userId) {
    try {
      const count = await Notification.count({
        where: { user_id: userId, read: false }
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

      const notifications = await Notification.findAll({
        where: filter,
        order: [['created_at', 'DESC']],
        limit: parseInt(limit),
        offset: parseInt(skip)
      });

      const total = await Notification.count({ where: filter });
      const unreadCount = await Notification.count({
        where: { user_id: userId, read: false }
      });

      return {
        notifications,
        unread_count: unreadCount,
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
