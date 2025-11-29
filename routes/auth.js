const express = require('express');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const User = require('../models/User');
const { authenticate } = require('../middleware/auth');
const logger = require('../utils/logger');
const emailService = require('../utils/emailService');

// Validation and Security Middleware
const {
  validateSignup,
  validateLogin,
  validateChangePassword,
  validateResetPassword
} = require('../middleware/validation');

const {
  authLimiter,
  passwordResetLimiter
} = require('../middleware/security');

const router = express.Router();

// Generate referral code
const generateReferralCode = () => {
  return Math.random().toString(36).substring(2, 12).toUpperCase();
};

// Sign up
router.post('/signup', validateSignup, async (req, res) => {
  try {
    const { username, phone, password, referred_by, email } = req.body;

    const userExists = await User.findOne({ $or: [{ phone }, { username }] });
    if (userExists) {
      return res.status(400).json({ message: 'User with this phone or username already exists' });
    }

    if (email) {
      const emailExists = await User.findOne({ email: email.toLowerCase() });
      if (emailExists) {
        return res.status(400).json({ message: 'Email already registered' });
      }
    }

    const referral_code = generateReferralCode();
    const user = new User({
      username,
      phone,
      password_hash: password,
      referral_code,
      referred_by: referred_by || null,
      status: 'pending',
      email: email ? email.toLowerCase() : null,
      authProvider: 'local'
    });

    // Generate email verification token if email provided
    if (email) {
      const verificationToken = crypto.randomBytes(32).toString('hex');
      user.emailVerificationToken = verificationToken;
      user.emailVerificationExpires = Date.now() + 24 * 60 * 60 * 1000; // 24 hours

      await user.save();

      // Send verification email
      await emailService.sendVerificationEmail(email, username, verificationToken);

      logger.info(`New user registered: ${username} (${phone}) - verification email sent`);

      return res.status(201).json({
        message: 'User registered successfully! Please check your email to verify your account.',
        requiresEmailVerification: true,
        user: {
          id: user._id,
          username: user.username,
          phone: user.phone,
          email: user.email,
          referral_code: user.referral_code,
          status: user.status
        }
      });
    } else {
      await user.save();
      logger.info(`New user registered: ${username} (${phone})`);

      res.status(201).json({
        message: 'User registered successfully. Awaiting admin verification.',
        user: {
          id: user._id,
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

    const user = await User.findOne({ username: username.toLowerCase() }).select('+twoFactorCode +twoFactorExpires');
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

    if (user.status === 'pending' && user.role === 'user') {
      return res.status(403).json({ message: 'Your account is pending approval' });
    }

    // Check if 2FA is enabled
    if (user.twoFactorEnabled && user.email) {
      // Generate 6-digit code
      const code = Math.floor(100000 + Math.random() * 900000).toString();
      user.twoFactorCode = code;
      user.twoFactorExpires = Date.now() + 10 * 60 * 1000; // 10 minutes
      await user.save();

      // Send 2FA code via email
      await emailService.send2FACode(user.email, user.username, code);

      return res.json({
        message: '2FA code sent to your email',
        requiresTwoFactor: true,
        userId: user._id
      });
    }

    user.last_login = new Date();
    await user.save();

    // Determine token expiry based on rememberMe
    const tokenExpiry = rememberMe ? '30d' : (process.env.JWT_EXPIRE || '24h');
    const refreshTokenExpiry = rememberMe ? '90d' : (process.env.REFRESH_TOKEN_EXPIRE || '7d');

    const token = jwt.sign(
      { id: user._id, username: user.username, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: tokenExpiry }
    );

    const refreshToken = jwt.sign(
      { id: user._id },
      process.env.REFRESH_TOKEN_SECRET,
      { expiresIn: refreshTokenExpiry }
    );

    logger.info(`User logged in: ${username} (${user.role})`);

    // Determine redirect path based on role
    let redirectTo = '/dashboard';
    if (user.role === 'superadmin') {
      redirectTo = '/admin';
    } else if (user.role === 'admin' || user.role === 'finance') {
      redirectTo = '/admin';
    }

    res.json({
      message: 'Login successful',
      token,
      refreshToken,
      redirectTo,
      user: {
        id: user._id,
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
router.post('/refresh', (req, res) => {
  try {
    const { refreshToken } = req.body;

    if (!refreshToken) {
      return res.status(400).json({ message: 'Refresh token is required' });
    }

    const decoded = jwt.verify(refreshToken, process.env.REFRESH_TOKEN_SECRET);
    const token = jwt.sign(
      { id: decoded.id },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRE || '24h' }
    );

    res.json({ token });
  } catch (error) {
    logger.error('Token refresh error:', error);
    res.status(401).json({ message: 'Invalid refresh token' });
  }
});

// Change password
router.post('/change-password', authenticate, validateChangePassword, async (req, res) => {
  try {
    const { oldPassword, newPassword } = req.body;
    const user = await User.findById(req.user.id);

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
router.post('/verify-2fa', async (req, res) => {
  try {
    const { userId, code } = req.body;

    if (!userId || !code) {
      return res.status(400).json({ message: 'User ID and code are required' });
    }

    const user = await User.findById(userId).select('+twoFactorCode +twoFactorExpires');

    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    if (!user.twoFactorCode || !user.twoFactorExpires) {
      return res.status(400).json({ message: 'No 2FA code found. Please login again.' });
    }

    if (Date.now() > user.twoFactorExpires) {
      return res.status(400).json({ message: '2FA code has expired. Please login again.' });
    }

    if (user.twoFactorCode !== code) {
      return res.status(401).json({ message: 'Invalid 2FA code' });
    }

    // Clear 2FA code
    user.twoFactorCode = undefined;
    user.twoFactorExpires = undefined;
    user.last_login = new Date();
    await user.save();

    // Generate tokens
    const token = jwt.sign(
      { id: user._id, username: user.username, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRE || '24h' }
    );

    const refreshToken = jwt.sign(
      { id: user._id },
      process.env.REFRESH_TOKEN_SECRET,
      { expiresIn: process.env.REFRESH_TOKEN_EXPIRE || '7d' }
    );

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
        id: user._id,
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

// @route   POST /api/auth/forgot-password
// @desc    Request password reset
// @access  Public
router.post('/forgot-password', passwordResetLimiter, async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({ message: 'Email is required' });
    }

    const user = await User.findOne({ email: email.toLowerCase() });

    if (!user) {
      // Don't reveal if email exists or not
      return res.json({ message: 'If that email exists, a password reset link has been sent.' });
    }

    // Generate reset token
    const resetToken = crypto.randomBytes(32).toString('hex');
    user.resetPasswordToken = resetToken;
    user.resetPasswordExpires = Date.now() + 60 * 60 * 1000; // 1 hour
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

    const user = await User.findOne({
      resetPasswordToken: token,
      resetPasswordExpires: { $gt: Date.now() }
    }).select('+resetPasswordToken +resetPasswordExpires');

    if (!user) {
      return res.status(400).json({ message: 'Invalid or expired reset token' });
    }

    // Set new password
    user.password_hash = password;
    user.resetPasswordToken = undefined;
    user.resetPasswordExpires = undefined;
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
    const user = await User.findById(req.user.id);

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

    const user = await User.findOne({
      emailVerificationToken: token,
      emailVerificationExpires: { $gt: Date.now() }
    }).select('+emailVerificationToken +emailVerificationExpires');

    if (!user) {
      return res.status(400).json({
        success: false,
        message: 'Invalid or expired verification token'
      });
    }

    user.emailVerified = true;
    user.emailVerificationToken = undefined;
    user.emailVerificationExpires = undefined;
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
router.post('/resend-verification', async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({ message: 'Email is required' });
    }

    const user = await User.findOne({ email: email.toLowerCase() });

    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    if (user.emailVerified) {
      return res.status(400).json({ message: 'Email already verified' });
    }

    // Generate new verification token
    const verificationToken = crypto.randomBytes(32).toString('hex');
    user.emailVerificationToken = verificationToken;
    user.emailVerificationExpires = Date.now() + 24 * 60 * 60 * 1000;
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

// @route   POST /api/auth/google
// @desc    Google OAuth login/signup
// @access  Public
router.post('/google', async (req, res) => {
  try {
    const { googleId, email, name, profilePicture } = req.body;

    if (!googleId || !email) {
      return res.status(400).json({ message: 'Google ID and email are required' });
    }

    // Check if user exists with Google ID
    let user = await User.findOne({ googleId });

    if (!user) {
      // Check if user exists with email
      user = await User.findOne({ email: email.toLowerCase() });

      if (user) {
        // Link Google account to existing user
        user.googleId = googleId;
        user.authProvider = 'google';
        user.emailVerified = true; // Google emails are pre-verified
        await user.save();
      } else {
        // Create new user
        const username = email.split('@')[0] + '_' + Math.random().toString(36).substring(7);
        const referral_code = generateReferralCode();

        user = new User({
          username,
          email: email.toLowerCase(),
          googleId,
          authProvider: 'google',
          emailVerified: true,
          referral_code,
          status: 'active',
          phone: 'google_' + googleId, // Placeholder phone
          password_hash: crypto.randomBytes(32).toString('hex') // Random password
        });

        await user.save();
        logger.info(`New user registered via Google: ${username}`);
      }
    }

    // Generate tokens
    const token = jwt.sign(
      { id: user._id, username: user.username, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRE || '24h' }
    );

    const refreshToken = jwt.sign(
      { id: user._id },
      process.env.REFRESH_TOKEN_SECRET,
      { expiresIn: process.env.REFRESH_TOKEN_EXPIRE || '7d' }
    );

    user.last_login = new Date();
    await user.save();

    logger.info(`User logged in via Google: ${user.username}`);

    // Determine redirect path
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
        id: user._id,
        username: user.username,
        email: user.email,
        role: user.role,
        balance_NSL: user.balance_NSL,
        balance_usdt: user.balance_usdt,
        vip_level: user.vip_level,
        referral_code: user.referral_code,
        emailVerified: user.emailVerified
      }
    });
  } catch (error) {
    logger.error('Google auth error:', error);
    res.status(500).json({ message: 'Error during Google authentication', error: error.message });
  }
});

// @route   POST /api/auth/facebook
// @desc    Facebook OAuth login/signup
// @access  Public
router.post('/facebook', async (req, res) => {
  try {
    const { facebookId, email, name, profilePicture } = req.body;

    if (!facebookId) {
      return res.status(400).json({ message: 'Facebook ID is required' });
    }

    // Check if user exists with Facebook ID
    let user = await User.findOne({ facebookId });

    if (!user) {
      // Check if user exists with email (if provided)
      if (email) {
        user = await User.findOne({ email: email.toLowerCase() });
      }

      if (user) {
        // Link Facebook account to existing user
        user.facebookId = facebookId;
        user.authProvider = 'facebook';
        if (email) {
          user.emailVerified = true;
        }
        await user.save();
      } else {
        // Create new user
        const username = name ? name.toLowerCase().replace(/\s+/g, '_') + '_' + Math.random().toString(36).substring(7)
                               : 'fb_' + facebookId;
        const referral_code = generateReferralCode();

        user = new User({
          username,
          email: email ? email.toLowerCase() : null,
          facebookId,
          authProvider: 'facebook',
          emailVerified: email ? true : false,
          referral_code,
          status: 'active',
          phone: 'facebook_' + facebookId, // Placeholder phone
          password_hash: crypto.randomBytes(32).toString('hex') // Random password
        });

        await user.save();
        logger.info(`New user registered via Facebook: ${username}`);
      }
    }

    // Generate tokens
    const token = jwt.sign(
      { id: user._id, username: user.username, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRE || '24h' }
    );

    const refreshToken = jwt.sign(
      { id: user._id },
      process.env.REFRESH_TOKEN_SECRET,
      { expiresIn: process.env.REFRESH_TOKEN_EXPIRE || '7d' }
    );

    user.last_login = new Date();
    await user.save();

    logger.info(`User logged in via Facebook: ${user.username}`);

    // Determine redirect path
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
        id: user._id,
        username: user.username,
        email: user.email,
        role: user.role,
        balance_NSL: user.balance_NSL,
        balance_usdt: user.balance_usdt,
        vip_level: user.vip_level,
        referral_code: user.referral_code,
        emailVerified: user.emailVerified
      }
    });
  } catch (error) {
    logger.error('Facebook auth error:', error);
    res.status(500).json({ message: 'Error during Facebook authentication', error: error.message });
  }
});

module.exports = router;
