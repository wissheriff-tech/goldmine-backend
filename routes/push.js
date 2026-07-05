const express = require('express');
const router = express.Router();
const PushSubscription = require('../models/PushSubscription');
const { authenticate } = require('../middleware/auth');
const logger = require('../utils/logger');

// GET /api/push/vapid-public-key — public, no auth
router.get('/vapid-public-key', (req, res) => {
  const key = process.env.VAPID_PUBLIC_KEY;
  if (!key) return res.status(503).json({ success: false, error: 'Push notifications not configured' });
  res.json({ success: true, data: { publicKey: key } });
});

// POST /api/push/subscribe
router.post('/subscribe', authenticate, async (req, res) => {
  const { endpoint, keys } = req.body || {};
  const userId = req.user.id;

  if (!endpoint || !keys?.p256dh || !keys?.auth) {
    return res.status(400).json({ success: false, error: 'Invalid subscription payload' });
  }

  try {
    await PushSubscription.upsert({
      user_id: userId,
      endpoint,
      p256dh: keys.p256dh,
      auth: keys.auth
    }, { conflictFields: ['endpoint'] });

    res.json({ success: true });
  } catch (err) {
    logger.error('Push subscribe error:', err);
    res.status(500).json({ success: false, error: 'Failed to save subscription' });
  }
});

// DELETE /api/push/unsubscribe
router.delete('/unsubscribe', authenticate, async (req, res) => {
  const { endpoint } = req.body || {};
  const userId = req.user.id;

  if (!endpoint) return res.status(400).json({ success: false, error: 'endpoint required' });

  try {
    await PushSubscription.destroy({ where: { endpoint, user_id: userId } });
    res.json({ success: true });
  } catch (err) {
    logger.error('Push unsubscribe error:', err);
    res.status(500).json({ success: false, error: 'Failed to remove subscription' });
  }
});

module.exports = router;
