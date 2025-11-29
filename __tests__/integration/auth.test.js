const request = require('supertest');
const express = require('express');
const mongoose = require('mongoose');
const User = require('../../models/User');
const authRouter = require('../../routes/auth');
const { createTestUser, generateToken } = require('../helpers/testUtils');

// Create test app
const createTestApp = () => {
  const app = express();
  app.use(express.json());
  app.use('/api/auth', authRouter);
  return app;
};

describe('Auth Integration Tests', () => {
  let app;

  beforeAll(() => {
    app = createTestApp();
  });

  describe('POST /api/auth/signup', () => {
    it('should register a new user successfully', async () => {
      const response = await request(app)
        .post('/api/auth/signup')
        .send({
          username: 'newuser123',
          phone: '+1234567890',
          password: 'StrongPass123!@#'
        });

      expect(response.status).toBe(201);
      expect(response.body).toHaveProperty('message');
      expect(response.body).toHaveProperty('user');
      expect(response.body.user.username).toBe('newuser123');
      expect(response.body.user.phone).toBe('+1234567890');
      expect(response.body.user).toHaveProperty('referral_code');
    });

    it('should register user with email and require verification', async () => {
      const response = await request(app)
        .post('/api/auth/signup')
        .send({
          username: 'emailuser',
          phone: '+1987654321',
          password: 'StrongPass123!@#',
          email: 'test@example.com'
        });

      expect(response.status).toBe(201);
      expect(response.body.requiresEmailVerification).toBe(true);
      expect(response.body.user.email).toBe('test@example.com');
    });

    it('should register user with referral code', async () => {
      const referrer = await createTestUser({ referral_code: 'REFCODE123' });

      const response = await request(app)
        .post('/api/auth/signup')
        .send({
          username: 'referreduser',
          phone: '+1555555555',
          password: 'StrongPass123!@#',
          referred_by: 'REFCODE123'
        });

      expect(response.status).toBe(201);
      expect(response.body.user).toBeDefined();

      const user = await User.findOne({ username: 'referreduser' });
      expect(user.referred_by).toBe('REFCODE123');
    });

    it('should not register user with existing username', async () => {
      await createTestUser({ username: 'existinguser' });

      const response = await request(app)
        .post('/api/auth/signup')
        .send({
          username: 'existinguser',
          phone: '+1111111111',
          password: 'StrongPass123!@#'
        });

      expect(response.status).toBe(400);
      expect(response.body.message).toContain('already exists');
    });

    it('should not register user with existing phone', async () => {
      await createTestUser({ phone: '+1222222222' });

      const response = await request(app)
        .post('/api/auth/signup')
        .send({
          username: 'newuser456',
          phone: '+1222222222',
          password: 'StrongPass123!@#'
        });

      expect(response.status).toBe(400);
      expect(response.body.message).toContain('already exists');
    });

    it('should not register user with existing email', async () => {
      await createTestUser({ email: 'existing@example.com' });

      const response = await request(app)
        .post('/api/auth/signup')
        .send({
          username: 'newuser789',
          phone: '+1333333333',
          password: 'StrongPass123!@#',
          email: 'existing@example.com'
        });

      expect(response.status).toBe(400);
      expect(response.body.message).toContain('Email already registered');
    });

    it('should handle missing required fields', async () => {
      const response = await request(app)
        .post('/api/auth/signup')
        .send({
          username: 'incompleteuser'
        });

      expect(response.status).toBe(400);
    });
  });

  describe('POST /api/auth/login', () => {
    let testUser;
    const testPassword = 'TestPass123!@#';

    beforeEach(async () => {
      const bcrypt = require('bcryptjs');
      const hashedPassword = await bcrypt.hash(testPassword, 10);
      testUser = await createTestUser({
        username: 'loginuser',
        phone: '+1444444444',
        password_hash: hashedPassword,
        status: 'active'
      });
    });

    it('should login with valid phone and password', async () => {
      const response = await request(app)
        .post('/api/auth/login')
        .send({
          phone: '+1444444444',
          password: testPassword
        });

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('token');
      expect(response.body).toHaveProperty('user');
      expect(response.body.user.phone).toBe('+1444444444');
    });

    it('should login with valid username and password', async () => {
      const response = await request(app)
        .post('/api/auth/login')
        .send({
          username: 'loginuser',
          password: testPassword
        });

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('token');
      expect(response.body.user.username).toBe('loginuser');
    });

    it('should not login with incorrect password', async () => {
      const response = await request(app)
        .post('/api/auth/login')
        .send({
          phone: '+1444444444',
          password: 'WrongPassword123'
        });

      expect(response.status).toBe(401);
      expect(response.body.message).toContain('Invalid');
    });

    it('should not login non-existent user', async () => {
      const response = await request(app)
        .post('/api/auth/login')
        .send({
          phone: '+1999999999',
          password: testPassword
        });

      expect(response.status).toBe(401);
      expect(response.body.message).toContain('Invalid');
    });

    it('should not login frozen account', async () => {
      testUser.status = 'frozen';
      await testUser.save();

      const response = await request(app)
        .post('/api/auth/login')
        .send({
          phone: '+1444444444',
          password: testPassword
        });

      expect(response.status).toBe(403);
      expect(response.body.message).toContain('frozen');
    });

    it('should not login pending account', async () => {
      testUser.status = 'pending';
      await testUser.save();

      const response = await request(app)
        .post('/api/auth/login')
        .send({
          phone: '+1444444444',
          password: testPassword
        });

      expect(response.status).toBe(403);
      expect(response.body.message).toContain('pending');
    });

    it('should update last_login on successful login', async () => {
      const response = await request(app)
        .post('/api/auth/login')
        .send({
          phone: '+1444444444',
          password: testPassword
        });

      expect(response.status).toBe(200);

      const updatedUser = await User.findById(testUser._id);
      expect(updatedUser.last_login).toBeDefined();
      expect(updatedUser.last_login).toBeInstanceOf(Date);
    });
  });

  describe('POST /api/auth/change-password', () => {
    let testUser;
    let token;
    const oldPassword = 'OldPass123!@#';
    const newPassword = 'NewPass456!@#';

    beforeEach(async () => {
      const bcrypt = require('bcryptjs');
      const hashedPassword = await bcrypt.hash(oldPassword, 10);
      testUser = await createTestUser({
        password_hash: hashedPassword,
        status: 'active'
      });
      token = generateToken(testUser._id, testUser.role);
    });

    it('should change password with valid credentials', async () => {
      const response = await request(app)
        .post('/api/auth/change-password')
        .set('Authorization', `Bearer ${token}`)
        .send({
          currentPassword: oldPassword,
          newPassword: newPassword
        });

      expect(response.status).toBe(200);
      expect(response.body.message).toContain('successful');

      // Verify password changed
      const updatedUser = await User.findById(testUser._id);
      const bcrypt = require('bcryptjs');
      const isMatch = await bcrypt.compare(newPassword, updatedUser.password_hash);
      expect(isMatch).toBe(true);
    });

    it('should not change password with incorrect current password', async () => {
      const response = await request(app)
        .post('/api/auth/change-password')
        .set('Authorization', `Bearer ${token}`)
        .send({
          currentPassword: 'WrongOldPass123',
          newPassword: newPassword
        });

      expect(response.status).toBe(401);
      expect(response.body.message).toContain('incorrect');
    });

    it('should not change password without authentication', async () => {
      const response = await request(app)
        .post('/api/auth/change-password')
        .send({
          currentPassword: oldPassword,
          newPassword: newPassword
        });

      expect(response.status).toBe(401);
    });

    it('should not accept weak new password', async () => {
      const response = await request(app)
        .post('/api/auth/change-password')
        .set('Authorization', `Bearer ${token}`)
        .send({
          currentPassword: oldPassword,
          newPassword: '123'
        });

      expect(response.status).toBe(400);
    });
  });

  describe('POST /api/auth/forgot-password', () => {
    let testUser;

    beforeEach(async () => {
      testUser = await createTestUser({
        email: 'reset@example.com',
        status: 'active'
      });
    });

    it('should send password reset email for valid email', async () => {
      const response = await request(app)
        .post('/api/auth/forgot-password')
        .send({
          email: 'reset@example.com'
        });

      expect(response.status).toBe(200);
      expect(response.body.message).toContain('sent');

      // Verify reset token was created
      const updatedUser = await User.findById(testUser._id);
      expect(updatedUser.passwordResetToken).toBeDefined();
      expect(updatedUser.passwordResetExpires).toBeDefined();
    });

    it('should return success even for non-existent email (security)', async () => {
      const response = await request(app)
        .post('/api/auth/forgot-password')
        .send({
          email: 'nonexistent@example.com'
        });

      // Should return 200 to prevent email enumeration
      expect(response.status).toBe(200);
    });

    it('should not accept invalid email format', async () => {
      const response = await request(app)
        .post('/api/auth/forgot-password')
        .send({
          email: 'invalid-email'
        });

      expect(response.status).toBe(400);
    });
  });

  describe('POST /api/auth/reset-password/:token', () => {
    let testUser;
    let resetToken;

    beforeEach(async () => {
      const crypto = require('crypto');
      resetToken = crypto.randomBytes(32).toString('hex');

      testUser = await createTestUser({
        email: 'resetuser@example.com',
        passwordResetToken: resetToken,
        passwordResetExpires: Date.now() + 3600000, // 1 hour
        status: 'active'
      });
    });

    it('should reset password with valid token', async () => {
      const newPassword = 'NewSecurePass123!@#';

      const response = await request(app)
        .post(`/api/auth/reset-password/${resetToken}`)
        .send({
          password: newPassword
        });

      expect(response.status).toBe(200);
      expect(response.body.message).toContain('successful');

      // Verify password changed
      const updatedUser = await User.findById(testUser._id);
      const bcrypt = require('bcryptjs');
      const isMatch = await bcrypt.compare(newPassword, updatedUser.password_hash);
      expect(isMatch).toBe(true);

      // Verify reset token cleared
      expect(updatedUser.passwordResetToken).toBeUndefined();
      expect(updatedUser.passwordResetExpires).toBeUndefined();
    });

    it('should not reset password with invalid token', async () => {
      const response = await request(app)
        .post('/api/auth/reset-password/invalidtoken123')
        .send({
          password: 'NewPass123!@#'
        });

      expect(response.status).toBe(400);
      expect(response.body.message).toContain('Invalid');
    });

    it('should not reset password with expired token', async () => {
      testUser.passwordResetExpires = Date.now() - 1000; // Expired
      await testUser.save();

      const response = await request(app)
        .post(`/api/auth/reset-password/${resetToken}`)
        .send({
          password: 'NewPass123!@#'
        });

      expect(response.status).toBe(400);
      expect(response.body.message).toContain('expired');
    });

    it('should not accept weak password for reset', async () => {
      const response = await request(app)
        .post(`/api/auth/reset-password/${resetToken}`)
        .send({
          password: 'weak'
        });

      expect(response.status).toBe(400);
    });
  });

  describe('GET /api/auth/verify-email/:token', () => {
    let testUser;
    let verificationToken;

    beforeEach(async () => {
      const crypto = require('crypto');
      verificationToken = crypto.randomBytes(32).toString('hex');

      testUser = await createTestUser({
        email: 'verify@example.com',
        emailVerified: false,
        emailVerificationToken: verificationToken,
        emailVerificationExpires: Date.now() + 24 * 60 * 60 * 1000,
        status: 'pending'
      });
    });

    it('should verify email with valid token', async () => {
      const response = await request(app)
        .get(`/api/auth/verify-email/${verificationToken}`);

      expect(response.status).toBe(200);
      expect(response.body.message).toContain('verified');

      // Verify email marked as verified
      const updatedUser = await User.findById(testUser._id);
      expect(updatedUser.emailVerified).toBe(true);
      expect(updatedUser.emailVerificationToken).toBeUndefined();
    });

    it('should not verify with invalid token', async () => {
      const response = await request(app)
        .get('/api/auth/verify-email/invalidtoken123');

      expect(response.status).toBe(400);
      expect(response.body.message).toContain('Invalid');
    });

    it('should not verify with expired token', async () => {
      testUser.emailVerificationExpires = Date.now() - 1000;
      await testUser.save();

      const response = await request(app)
        .get(`/api/auth/verify-email/${verificationToken}`);

      expect(response.status).toBe(400);
      expect(response.body.message).toContain('expired');
    });
  });
});
