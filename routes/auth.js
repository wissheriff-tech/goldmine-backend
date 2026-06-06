const express = require('express');
const crypto = require('crypto');
const { Op } = require('sequelize');
const { User } = require('../models');
const Session = require('../models/Session');
const { authenticate } = require('../middleware/auth');
const logger = require('../utils/logger');
const emailService = require('../utils/emailService');

const ACCESS_TOKEN_TTL_MS  = parseInt(process.env.ACCESS_TOKEN_TTL_MS  || String(24 * 60 * 60 * 1000));
const REFRESH_TOKEN_TTL_MS = parseInt(process.env.REFRESH_TOKEN_TTL_MS || String(7  * 24 * 60 * 60 * 1000));
const REMEMBER_ME_ACCESS_TTL_MS  = 30 * 24 * 60 * 60 * 1000;
const REMEMBER_ME_REFRESH_TTL_MS = 90 * 24 * 60 * 60 * 1000;

const hashToken = (token) => crypto.createHash('sha256').update(token).digest('hex');

const IS_PROD = process.env.NODE_ENV === 'production';
const setCookies = (res, accessToken, refreshToken, rememberMe = false) => {
  const accessMaxAge  = rememberMe ? 30 * 24 * 60 * 60 * 1000 : 24 * 60 * 60 * 1000;
  const refreshMaxAge = rememberMe ? 90 * 24 * 60 * 60 * 1000 :  7 * 24 * 60 * 60 * 1000;
  const base = { httpOnly: true, secure: IS_PROD, sameSite: IS_PROD ? 'none' : 'lax' };
  res.cookie('access_token',  accessToken,  { ...base, maxAge: accessMaxAge });
  res.cookie('refresh_token', refreshToken, { ...base, maxAge: refreshMaxAge, path: '/api/auth/refresh' });
};

const issueTokens = async (user, rememberMe = false, deviceInfo = null) => {
  const accessToken  = crypto.randomBytes(48).toString('hex');
  const refreshToken = crypto.randomBytes(48).toString('hex');
  const now = Date.now();
  const accessTtl  = rememberMe ? REMEMBER_ME_ACCESS_TTL_MS  : ACCESS_TOKEN_TTL_MS;
  const refreshTtl = rememberMe ? REMEMBER_ME_REFRESH_TTL_MS : REFRESH_TOKEN_TTL_MS;

  await Session.create({
    user_id:           user.id,
    access_token:      hashToken(accessToken),
    refresh_token:     hashToken(refreshToken),
    is_active:         true,
    last_activity:     new Date(now),
    access_expires_at: new Date(now + accessTtl),
    expires_at:        new Date(now + refreshTtl),
    device_info:       deviceInfo
  });

  return { token: accessToken, refreshToken, accessExpiresAt: new Date(now + accessTtl) };
};

// Validation Middleware
const {
  validateSignup,
  validateLogin,
  validateChangePassword,
  validateResetPassword
} = require('../middleware/validation');

// Security Middleware
const {
  authLimiter,
  signupLimiter,
  passwordResetLimiter
} = require('../middleware/security');

const router = express.Router();

// Generate referral code
const generateReferralCode = () => {
  const LETTERS = "ABCDEFGHJKLMNPQRSTUVWXYZ"; // no I/O
  const DIGITS  = "23456789";                 // no 0/1
  const SYMBOLS = "-_";
  const rand = (pool) => pool[Math.floor(Math.random() * pool.length)];
  // Format: 3 letters + 3 digits + symbol + 3 letters + 2 digits  e.g. KBX729-PMX34
  return (
    rand(LETTERS) + rand(LETTERS) + rand(LETTERS) +
    rand(DIGITS)  + rand(DIGITS)  + rand(DIGITS)  +
    rand(SYMBOLS) +
    rand(LETTERS) + rand(LETTERS) + rand(LETTERS) +
    rand(DIGITS)  + rand(DIGITS)
  );
};

// Sign up
// HIGH FIX: signupLimiter prevents account-creation spam
router.post('/signup', signupLimiter, validateSignup, async (req, res) => {
  try {
    const { phone, password, referred_by, email } = req.body;
    // Phone is the primary identifier — username is optional display name
    const username = (req.body.username || '').trim() || phone.trim();

    // Referral code is mandatory
    if (!referred_by || !referred_by.trim()) {
      return res.status(400).json({ message: 'An invite code is required to sign up' });
    }
    const referrer = await User.findOne({ where: { referral_code: referred_by.trim().toUpperCase() } });
    if (!referrer) {
      return res.status(400).json({ message: 'Invalid invite code. Please check and try again.' });
    }

    const userExists = await User.findOne({
      where: { [Op.or]: [{ phone }, { username }] }
    });
    if (userExists) {
      return res.status(400).json({ message: 'Phone number or username already registered.' });
    }

    if (email) {
      const emailExists = await User.findOne({ where: { email: email.toLowerCase() } });
      if (emailExists) {
        return res.status(400).json({ message: 'Email already registered' });
      }
    }

    const referral_code = generateReferralCode();

    // Generate email verification token if email provided
    if (email) {
      const verificationToken = crypto.randomBytes(32).toString('hex');

      const user = await User.create({
        username,
        phone,
        password_hash: password,
        referral_code,
        referred_by: referred_by || null,
        status: 'pending',
        email: email ? email.toLowerCase() : null,
        emailVerificationToken: verificationToken,
        emailVerificationExpires: new Date(Date.now() + 24 * 60 * 60 * 1000) // 24 hours
      });

      // Send verification email
      await emailService.sendVerificationEmail(email, username, verificationToken);

      logger.info(`New user registered: ${username} (${phone}) - verification email sent`);

      return res.status(201).json({
        message: 'User registered successfully! Please check your email to verify your account.',
        requiresEmailVerification: true,
        user: {
          id: user.id,
          username: user.username,
          phone: user.phone,
          email: user.email,
          referral_code: user.referral_code,
          status: user.status
        }
      });
    } else {
      const user = await User.create({
        username,
        phone,
        password_hash: password,
        referral_code,
        referred_by: referred_by || null,
        status: 'pending',
        email: null,
        authProvider: 'local'
      });

      logger.info(`New user registered: ${username} (${phone})`);

      res.status(201).json({
        message: 'User registered successfully. Awaiting admin verification.',
        user: {
          id: user.id,
          username: user.username,
          phone: user.phone,
          referral_code: user.referral_code,
          status: user.status
        }
      });
    }
  } catch (error) {
    logger.error('Signup error:', error);
    res.status(500).json({ message: 'Error registering user', error: error.message });
  }
});

// Login
router.post('/login', authLimiter, validateLogin, async (req, res) => {
  try {
    const { username, password, rememberMe } = req.body;

    const identifier = username.trim();
    const user = await User.scope('withSecrets').findOne({
      where: {
        [Op.or]: [
          { username: identifier.toLowerCase() },
          { phone: identifier },
        ]
      }
    });
    if (!user) {
      return res.status(401).json({ message: 'Invalid username or password' });
    }

    const isPasswordValid = await user.comparePassword(password);
    if (!isPasswordValid) {
      return res.status(401).json({ message: 'Invalid username or password' });
    }

    if (user.status === 'frozen') {
      return res.status(403).json({ message: 'Your account has been frozen' });
    }

    if (user.status === 'pending') {
      return res.status(403).json({ message: 'Your account is pending approval' });
    }

    // Check if 2FA is enabled
    if (user.twoFactorEnabled && user.email) {
      // Generate 6-digit code
      const code = Math.floor(100000 + Math.random() * 900000).toString();
      user.twoFactorCode = code;
      user.twoFactorExpires = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes
      await user.save();

      // Send 2FA code via email
      await emailService.send2FACode(user.email, user.username, code);

      return res.json({
        message: '2FA code sent to your email',
        requiresTwoFactor: true,
        userId: user.id
      });
    }

    user.last_login = new Date();
    await user.save();

    const { token, refreshToken } = await issueTokens(user, rememberMe, req.headers['user-agent']);
    setCookies(res, token, refreshToken, rememberMe);

    logger.info(`User logged in: ${username} (${user.role})`);

    let redirectTo = '/dashboard';
    if (user.role === 'superadmin' || user.role === 'admin' || user.role === 'finance') redirectTo = '/admin';

    res.json({
      message: 'Login successful',
      token,
      refreshToken,
      redirectTo,
      user: {
        id: user.id,
        username: user.username,
        phone: user.phone,
        email: user.email,
        role: user.role,
        balance_NSL: user.balance_NSL,
        balance_usdt: user.balance_usdt,
        vip_level: user.vip_level,
        referral_code: user.referral_code,
        twoFactorEnabled: user.twoFactorEnabled,
        profile_photo: user.profile_photo
      }
    });
  } catch (error) {
    logger.error('Login error:', error);
    res.status(500).json({ message: 'Error during login', error: error.message });
  }
});

// Refresh token
router.post('/refresh', async (req, res) => {
  try {
    const { refreshToken } = req.body;

    if (!refreshToken) {
      return res.status(400).json({ message: 'Refresh token is required' });
    }

    const session = await Session.findOne({
      where: { refresh_token: hashToken(refreshToken), is_active: true }
    });

    if (!session || new Date() > session.expires_at) {
      if (session) await session.update({ is_active: false });
      return res.status(401).json({ message: 'Invalid or expired refresh token' });
    }

    const newAccessToken = crypto.randomBytes(48).toString('hex');
    const accessTtl = ACCESS_TOKEN_TTL_MS;
    await session.update({
      access_token:      hashToken(newAccessToken),
      access_expires_at: new Date(Date.now() + accessTtl),
      last_activity:     new Date()
    });

    const base = { httpOnly: true, secure: IS_PROD, sameSite: IS_PROD ? 'none' : 'lax' };
    res.cookie('access_token', newAccessToken, { ...base, maxAge: accessTtl });
    res.json({ token: newAccessToken });
  } catch (error) {
    logger.error('Token refresh error:', error);
    res.status(401).json({ message: 'Invalid refresh token' });
  }
});

// Change password
router.post('/change-password', authenticate, validateChangePassword, async (req, res) => {
  try {
    const { oldPassword, newPassword } = req.body;
    const user = await User.scope('withSecrets').findByPk(req.user.id);

    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    const isPasswordValid = await user.comparePassword(oldPassword);
    if (!isPasswordValid) {
      return res.status(401).json({ message: 'Old password is incorrect' });
    }

    user.password_hash = newPassword;
    await user.save();

    logger.info(`Password changed for user: ${user.phone}`);
    res.json({ message: 'Password changed successfully' });
  } catch (error) {
    logger.error('Change password error:', error);
    res.status(500).json({ message: 'Error changing password', error: error.message });
  }
});

// @route   POST /api/auth/verify-2fa
// @desc    Verify 2FA code
// @access  Public
// FIX: Added authLimiter to prevent brute force
router.post('/verify-2fa', authLimiter, async (req, res) => {
  try {
    const { userId, code } = req.body;

    if (!userId || !code) {
      return res.status(400).json({ message: 'User ID and code are required' });
    }

    const user = await User.scope('withSecrets').findByPk(userId);

    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    if (!user.twoFactorCode || !user.twoFactorExpires) {
      return res.status(400).json({ message: 'No 2FA code found. Please login again.' });
    }

    if (Date.now() > new Date(user.twoFactorExpires).getTime()) {
      return res.status(400).json({ message: '2FA code has expired. Please login again.' });
    }

    if (user.twoFactorCode !== code) {
      return res.status(401).json({ message: 'Invalid 2FA code' });
    }

    // Clear 2FA code
    user.twoFactorCode = null;
    user.twoFactorExpires = null;
    user.last_login = new Date();
    await user.save();

    const { token, refreshToken } = await issueTokens(user, false, req.headers['user-agent']);

    logger.info(`User completed 2FA login: ${user.username}`);

    // Determine redirect path based on role
    let redirectTo = '/dashboard';
    if (user.role === 'superadmin' || user.role === 'admin' || user.role === 'finance') {
      redirectTo = '/admin';
    }

    res.json({
      message: 'Login successful',
      token,
      refreshToken,
      redirectTo,
      user: {
        id: user.id,
        username: user.username,
        phone: user.phone,
        email: user.email,
        role: user.role,
        balance_NSL: user.balance_NSL,
        balance_usdt: user.balance_usdt,
        vip_level: user.vip_level,
        referral_code: user.referral_code,
        twoFactorEnabled: user.twoFactorEnabled,
        profile_photo: user.profile_photo
      }
    });
  } catch (error) {
    logger.error('2FA verification error:', error);
    res.status(500).json({ message: 'Error verifying 2FA code', error: error.message });
  }
});

// @route   POST /api/auth/resend-2fa
// @desc    Resend login 2FA code
// @access  Public
router.post('/resend-2fa', authLimiter, async (req, res) => {
  try {
    const { userId } = req.body;

    if (!userId) {
      return res.status(400).json({ message: 'User ID is required' });
    }

    const user = await User.scope('withSecrets').findByPk(userId);

    if (!user || !user.twoFactorEnabled) {
      return res.status(400).json({ message: 'Invalid request' });
    }

    if (!user.email) {
      return res.status(400).json({ message: 'No email on file for this account' });
    }

    const code = Math.floor(100000 + Math.random() * 900000).toString();
    user.twoFactorCode = code;
    user.twoFactorExpires = new Date(Date.now() + 10 * 60 * 1000);
    await user.save();

    await emailService.send2FACode(user.email, user.username, code);

    logger.info(`2FA code resent for user ${user.username}`);
    res.json({ message: '2FA code resent to your email' });
  } catch (error) {
    logger.error('Resend 2FA error:', error);
    res.status(500).json({ message: 'Error resending 2FA code' });
  }
});

// @route   POST /api/auth/forgot-password
// @desc    Request password reset
// @access  Public
router.post('/forgot-password', passwordResetLimiter, async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({ message: 'Email is required' });
    }

    const user = await User.findOne({ where: { email: email.toLowerCase() } });

    if (!user) {
      // Don't reveal if email exists or not
      return res.json({ message: 'If that email exists, a password reset link has been sent.' });
    }

    // Generate reset token
    const resetToken = crypto.randomBytes(32).toString('hex');
    user.resetPasswordToken = resetToken;
    user.resetPasswordExpires = new Date(Date.now() + 60 * 60 * 1000); // 1 hour
    await user.save();

    // Send reset email
    await emailService.sendPasswordResetEmail(email, user.username, resetToken);

    logger.info(`Password reset requested for: ${email}`);
    res.json({ message: 'If that email exists, a password reset link has been sent.' });
  } catch (error) {
    logger.error('Forgot password error:', error);
    res.status(500).json({ message: 'Error processing request', error: error.message });
  }
});

// @route   POST /api/auth/reset-password/:token
// @desc    Reset password with token
// @access  Public
router.post('/reset-password/:token', validateResetPassword, async (req, res) => {
  try {
    const { token } = req.params;
    const { password } = req.body;

    if (!password) {
      return res.status(400).json({ message: 'Password is required' });
    }

    if (password.length < 6) {
      return res.status(400).json({ message: 'Password must be at least 6 characters' });
    }

    const user = await User.scope('withSecrets').findOne({
      where: {
        resetPasswordToken: token,
        resetPasswordExpires: { [Op.gt]: new Date() }
      }
    });

    if (!user) {
      return res.status(400).json({ message: 'Invalid or expired reset token' });
    }

    // Set new password
    user.password_hash = password;
    user.resetPasswordToken = null;
    user.resetPasswordExpires = null;
    await user.save();

    logger.info(`Password reset successful for user: ${user.username}`);
    res.json({ message: 'Password reset successful. You can now login.' });
  } catch (error) {
    logger.error('Reset password error:', error);
    res.status(500).json({ message: 'Error resetting password', error: error.message });
  }
});

// @route   POST /api/auth/toggle-2fa
// @desc    Enable/disable 2FA
// @access  Private
router.post('/toggle-2fa', authenticate, async (req, res) => {
  try {
    const { enable, email } = req.body;
    const user = await User.findByPk(req.user.id);

    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    if (enable && !email) {
      return res.status(400).json({ message: 'Email is required to enable 2FA' });
    }

    user.twoFactorEnabled = enable;
    if (enable) {
      user.email = email.toLowerCase();
    }
    await user.save();

    logger.info(`2FA ${enable ? 'enabled' : 'disabled'} for user: ${user.username}`);
    res.json({
      message: `Two-factor authentication ${enable ? 'enabled' : 'disabled'} successfully`,
      twoFactorEnabled: user.twoFactorEnabled
    });
  } catch (error) {
    logger.error('Toggle 2FA error:', error);
    res.status(500).json({ message: 'Error toggling 2FA', error: error.message });
  }
});

// @route   GET /api/auth/verify-email/:token
// @desc    Verify email address
// @access  Public
router.get('/verify-email/:token', async (req, res) => {
  try {
    const { token } = req.params;

    const user = await User.scope('withSecrets').findOne({
      where: {
        emailVerificationToken: token,
        emailVerificationExpires: { [Op.gt]: new Date() }
      }
    });

    if (!user) {
      return res.status(400).json({
        success: false,
        message: 'Invalid or expired verification token'
      });
    }

    user.emailVerified = true;
    user.emailVerificationToken = null;
    user.emailVerificationExpires = null;
    await user.save();

    logger.info(`Email verified for user: ${user.username}`);

    res.status(200).json({
      success: true,
      message: 'Email verified successfully! You can now login.'
    });
  } catch (error) {
    logger.error('Email verification error:', error);
    res.status(500).json({
      success: false,
      message: 'Error verifying email'
    });
  }
});

// @route   POST /api/auth/resend-verification
// @desc    Resend email verification
// @access  Public
// FIX: Added passwordResetLimiter to prevent email spam
router.post('/resend-verification', passwordResetLimiter, async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({ message: 'Email is required' });
    }

    const user = await User.findOne({ where: { email: email.toLowerCase() } });

    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    if (user.emailVerified) {
      return res.status(400).json({ message: 'Email already verified' });
    }

    // Generate new verification token
    const verificationToken = crypto.randomBytes(32).toString('hex');
    user.emailVerificationToken = verificationToken;
    user.emailVerificationExpires = new Date(Date.now() + 24 * 60 * 60 * 1000);
    await user.save();

    // Send verification email
    await emailService.sendVerificationEmail(email, user.username, verificationToken);

    logger.info(`Verification email resent to: ${email}`);
    res.json({ message: 'Verification email sent successfully' });
  } catch (error) {
    logger.error('Resend verification error:', error);
    res.status(500).json({ message: 'Error sending verification email' });
  }
});

// Logout — invalidate current session
// HIGH FIX: Read token from cookie first (primary auth path), fall back to Bearer header.
// This ensures the session is always invalidated regardless of which transport was used.
router.post('/logout', authenticate, async (req, res) => {
  try {
    // Cookie takes priority (same logic as authenticate middleware)
    let token = req.cookies?.access_token;
    if (!token && req.headers.authorization?.startsWith('Bearer ')) {
      token = req.headers.authorization.split(' ')[1];
    }
    if (token) {
      await Session.update({ is_active: false }, { where: { access_token: hashToken(token) } });
    }
    const IS_PROD_COOKIE = process.env.NODE_ENV === 'production';
    const base = { httpOnly: true, secure: IS_PROD_COOKIE, sameSite: IS_PROD_COOKIE ? 'none' : 'lax' };
    res.clearCookie('access_token', base);
    res.clearCookie('refresh_token', { ...base, path: '/api/auth/refresh' });
    logger.info(`User logged out: ${req.user.username}`);
    res.json({ message: 'Logged out successfully' });
  } catch (error) {
    logger.error('Logout error:', error);
    res.status(500).json({ message: 'Error during logout' });
  }
});

// Logout all devices — invalidate every session for this user
router.post('/logout-all', authenticate, async (req, res) => {
  try {
    await Session.update({ is_active: false }, { where: { user_id: req.user.id } });
    logger.info(`All sessions revoked for user: ${req.user.username}`);
    res.json({ message: 'Logged out from all devices' });
  } catch (error) {
    logger.error('Logout-all error:', error);
    res.status(500).json({ message: 'Error during logout' });
  }
});

module.exports = router;
