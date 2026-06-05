const express = require('express');
const crypto = require('crypto');
const { User, TwoFactorAuth, Session } = require('../models');
const { Op } = require('sequelize');
const { authenticate } = require('../middleware/auth');
const logger = require('../utils/logger');
const notificationService = require('../utils/notificationService');

const emailService = require('../utils/emailService');

const router = express.Router();

// Generate backup codes
function generateBackupCodes(count = 10) {
  const codes = [];
  for (let i = 0; i < count; i++) {
    codes.push({
      code: crypto.randomBytes(4).toString('hex').toUpperCase(),
      used: false
    });
  }
  return codes;
}

function generate2FASecret() {
  return crypto.randomBytes(16).toString('base64');
}

// Generate 6-digit code
function generate6DigitCode() {
  return crypto.randomInt(100000, 999999).toString();
}

// Enable 2FA
router.post('/2fa/enable', authenticate, async (req, res) => {
  try {
    const { method = 'app', email } = req.body;
    const user = await User.findByPk(req.user.id);

    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    if (user.twoFactorEnabled) {
      return res.status(400).json({ message: '2FA is already enabled' });
    }

    if (!['app', 'email'].includes(method)) {
      return res.status(400).json({ message: 'Invalid 2FA method. Supported: email.' });
    }

    if (method === 'email' && !(user.email || email)) {
      return res.status(400).json({ message: 'Email required for 2FA' });
    }

    if (method === 'email' && email && !user.email) {
      await user.update({ email: email.toLowerCase() });
    }

    const secret = generate2FASecret();
    const backupCodes = generateBackupCodes();

    // Create or update 2FA record
    let twoFA = await TwoFactorAuth.findOne({ where: { user_id: user.id } });
    if (!twoFA) {
      twoFA = await TwoFactorAuth.create({
        user_id: user.id,
        secret,
        backup_codes: backupCodes,
        method,
        enabled: false
      });
    } else {
      await twoFA.update({
        secret,
        backup_codes: backupCodes,
        method,
        enabled: false
      });
    }

    if (method === 'app') {
      res.json({
        message: '2FA setup initiated. Please scan the QR code with your authenticator app.',
        secret: secret,
        backup_codes: backupCodes.map(c => c.code),
        qr_code_url: `otpauth://totp/SalonMoney:${user.username}?secret=${secret}&issuer=SalonMoney`
      });
    } else {
      // Generate and send verification code
      const code = generate6DigitCode();
      await user.update({
        twoFactorCode: code,
        twoFactorExpires: new Date(Date.now() + 10 * 60 * 1000) // 10 minutes
      });

      const recipientEmail = user.email || email;
      await emailService.send2FACode(recipientEmail, user.username, code);
      logger.info(`2FA setup code sent to ${recipientEmail}`);

      res.json({
        message: 'Verification code sent to your email',
        backup_codes: backupCodes.map(c => c.code)
      });
    }
  } catch (error) {
    logger.error('2FA enable error:', error);
    res.status(500).json({ message: 'Error enabling 2FA', error: error.message });
  }
});

// Verify and activate 2FA
router.post('/2fa/verify', authenticate, async (req, res) => {
  try {
    const { code } = req.body;
    const user = await User.scope('withSecrets').findByPk(req.user.id);

    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    const twoFA = await TwoFactorAuth.findOne({ where: { user_id: user.id } });

    if (!twoFA) {
      return res.status(404).json({ message: '2FA not initialized' });
    }

    // Verify the code
    let isValid = false;

    if (twoFA.method === 'app') {
      return res.status(400).json({ message: 'App-based 2FA is not yet supported. Please use email.' });
    } else {
      if (!user.twoFactorCode || !user.twoFactorExpires) {
        return res.status(400).json({ message: 'No verification code found. Please request a new one.' });
      }

      if (user.twoFactorExpires < new Date()) {
        return res.status(400).json({ message: 'Verification code expired' });
      }

      isValid = user.twoFactorCode === code;
    }

    if (!isValid) {
      return res.status(400).json({ message: 'Invalid verification code' });
    }

    // Activate 2FA
    await twoFA.update({
      enabled: true,
      verified_at: new Date()
    });

    await user.update({
      twoFactorEnabled: true,
      twoFactorCode: null,
      twoFactorExpires: null
    });

    // Send security notification
    await notificationService.notifySecurityAlert(
      user.id,
      'Two-Factor Authentication has been enabled on your account.'
    );

    logger.info(`2FA enabled for user ${user.phone || user.id}`);

    res.json({
      message: '2FA successfully enabled',
      enabled: true
    });
  } catch (error) {
    logger.error('2FA verification error:', error);
    res.status(500).json({ message: 'Error verifying 2FA', error: error.message });
  }
});

// Disable 2FA
router.post('/2fa/disable', authenticate, async (req, res) => {
  try {
    const { password, code } = req.body;
    const user = await User.scope('withSecrets').findByPk(req.user.id);

    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    if (!user.twoFactorEnabled) {
      return res.status(400).json({ message: '2FA is not enabled' });
    }

    // Verify password
    const isPasswordValid = await user.comparePassword(password);
    if (!isPasswordValid) {
      return res.status(401).json({ message: 'Invalid password' });
    }

    // Verify 2FA code or backup code
    const twoFA = await TwoFactorAuth.findOne({ where: { user_id: user.id } });
    if (!twoFA) {
      return res.status(404).json({ message: '2FA record not found' });
    }

    // Check backup code
    const backupCode = twoFA.backup_codes.find(bc => bc.code === code && !bc.used);
    if (!backupCode) {
      return res.status(401).json({ message: 'Invalid 2FA or backup code' });
    }

    // Disable 2FA
    await twoFA.update({ enabled: false });

    await user.update({ twoFactorEnabled: false });

    // Send security notification
    await notificationService.notifySecurityAlert(
      user.id,
      'Two-Factor Authentication has been disabled on your account. If this wasn\'t you, please contact support immediately.'
    );

    logger.warn(`2FA disabled for user ${user.phone || user.id}`);

    res.json({
      message: '2FA successfully disabled',
      enabled: false
    });
  } catch (error) {
    logger.error('2FA disable error:', error);
    res.status(500).json({ message: 'Error disabling 2FA', error: error.message });
  }
});

// Get 2FA status
router.get('/2fa/status', authenticate, async (req, res) => {
  try {
    const user = await User.findByPk(req.user.id);
    const twoFA = await TwoFactorAuth.findOne({
      where: { user_id: user.id },
      attributes: { exclude: ['secret', 'backup_codes'] }
    });

    res.json({
      enabled: user.twoFactorEnabled,
      method: twoFA?.method || null,
      verified_at: twoFA?.verified_at || null,
      last_used: twoFA?.last_used || null
    });
  } catch (error) {
    logger.error('2FA status error:', error);
    res.status(500).json({ message: 'Error fetching 2FA status', error: error.message });
  }
});

// Get active sessions
router.get('/sessions', authenticate, async (req, res) => {
  try {
    const sessions = await Session.findAll({
      where: {
        user_id: req.user.id,
        is_active: true
      },
      attributes: { exclude: ['refresh_token'] },
      order: [['last_activity', 'DESC']]
    });

    res.json({
      sessions,
      total: sessions.length
    });
  } catch (error) {
    logger.error('Sessions fetch error:', error);
    res.status(500).json({ message: 'Error fetching sessions', error: error.message });
  }
});

// Terminate session
router.delete('/sessions/:sessionId', authenticate, async (req, res) => {
  try {
    const session = await Session.findByPk(req.params.sessionId);

    if (!session) {
      return res.status(404).json({ message: 'Session not found' });
    }

    // Verify session belongs to user
    if (String(session.user_id) !== String(req.user.id)) {
      return res.status(403).json({ message: 'Unauthorized' });
    }

    await session.update({ is_active: false });

    logger.info(`Session terminated: ${req.params.sessionId} for user ${req.user.id}`);

    res.json({ message: 'Session terminated successfully' });
  } catch (error) {
    logger.error('Session termination error:', error);
    res.status(500).json({ message: 'Error terminating session', error: error.message });
  }
});

// Terminate all other sessions
router.delete('/sessions', authenticate, async (req, res) => {
  try {
    const { current_session_id } = req.body;

    const [terminatedCount] = await Session.update(
      { is_active: false },
      {
        where: {
          user_id: req.user.id,
          is_active: true,
          id: { [Op.ne]: current_session_id }
        }
      }
    );

    logger.info(`All sessions terminated for user ${req.user.id} except ${current_session_id}`);

    res.json({
      message: 'All other sessions terminated successfully',
      terminated_count: terminatedCount
    });
  } catch (error) {
    logger.error('Bulk session termination error:', error);
    res.status(500).json({ message: 'Error terminating sessions', error: error.message });
  }
});

// Change password
router.post('/change-password', authenticate, async (req, res) => {
  try {
    const { current_password, new_password } = req.body;
    const user = await User.scope('withSecrets').findByPk(req.user.id);

    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    // Verify current password
    const isValid = await user.comparePassword(current_password);
    if (!isValid) {
      return res.status(401).json({ message: 'Current password is incorrect' });
    }

    // Update password
    user.password_hash = new_password; // Will be hashed by beforeUpdate hook
    await user.save();

    // Terminate all other sessions
    await Session.update(
      { is_active: false },
      { where: { user_id: user.id, is_active: true } }
    );

    // Send security notification
    await notificationService.notifySecurityAlert(
      user.id,
      'Your password was changed successfully. All active sessions have been terminated.'
    );

    logger.info(`Password changed for user ${user.phone || user.id}`);

    res.json({ message: 'Password changed successfully. Please login again.' });
  } catch (error) {
    logger.error('Password change error:', error);
    res.status(500).json({ message: 'Error changing password', error: error.message });
  }
});

module.exports = router;
