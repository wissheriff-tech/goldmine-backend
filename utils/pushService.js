const webpush = require('web-push');
const logger = require('./logger');
const PushSubscription = require('../models/PushSubscription');

const { VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT } = process.env;

if (VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY && VAPID_SUBJECT) {
  webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
}

async function sendToSubscription(sub, payload) {
  try {
    await webpush.sendNotification({
      endpoint: sub.endpoint,
      keys: { p256dh: sub.p256dh, auth: sub.auth }
    }, JSON.stringify(payload));
  } catch (err) {
    if (err.statusCode === 410 || err.statusCode === 404) {
      await sub.destroy().catch(() => null);
    } else {
      logger.warn(`Push send failed for sub ${sub.id}: ${err.message}`);
    }
  }
}

async function sendToUser(userId, payload) {
  if (!VAPID_PUBLIC_KEY) return;
  try {
    const subs = await PushSubscription.findAll({ where: { user_id: userId } });
    await Promise.all(subs.map(sub => sendToSubscription(sub, payload)));
  } catch (err) {
    logger.error('pushService.sendToUser error:', err);
  }
}

async function sendToUsers(userIds, payload) {
  if (!VAPID_PUBLIC_KEY || !userIds.length) return;
  try {
    const { Op } = require('sequelize');
    const subs = await PushSubscription.findAll({ where: { user_id: { [Op.in]: userIds } } });
    await Promise.all(subs.map(sub => sendToSubscription(sub, payload)));
  } catch (err) {
    logger.error('pushService.sendToUsers error:', err);
  }
}

module.exports = { sendToUser, sendToUsers };
