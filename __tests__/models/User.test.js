const bcrypt = require('bcryptjs');
const User = require('../../models/User');
const { createTestUser } = require('../helpers/testUtils');

describe('User Model', () => {
  describe('creation and defaults', () => {
    it('creates a user with valid data', async () => {
      const user = await createTestUser({
        username: 'testuser123',
        phone: '+1234567890',
        email: 'test@example.com'
      });

      expect(user.id).toBeDefined();
      expect(user.username).toBe('testuser123');
      expect(user.phone).toBe('+1234567890');
      expect(user.email).toBe('test@example.com');
      expect(user.role).toBe('user');
      expect(user.status).toBe('active');
    });

    it('normalizes username and email', async () => {
      const user = await createTestUser({
        username: ' MixedCaseUser ',
        email: ' USER@Example.COM '
      });

      expect(user.username).toBe('mixedcaseuser');
      expect(user.email).toBe('user@example.com');
    });

    it('uses current Sequelize defaults when optional fields are omitted', async () => {
      const user = await User.create({
        username: 'defaultuser',
        phone: '+1234567890',
        password_hash: 'Test123!@#'
      });

      expect(user.balance_NSL).toBe(0);
      expect(user.balance_usdt).toBe(0);
      expect(user.vip_level).toBe('none');
      expect(user.status).toBe('pending');
      expect(user.preferred_currency).toBe('USD');
      expect(user.kyc_verified).toBe(false);
    });
  });

  describe('constraints', () => {
    it('rejects duplicate username', async () => {
      await createTestUser({ username: 'duplicate' });

      await expect(createTestUser({ username: 'duplicate' })).rejects.toThrow();
    });

    it('rejects duplicate phone', async () => {
      const phone = '+1234567890';
      await createTestUser({ phone });

      await expect(createTestUser({ phone })).rejects.toThrow();
    });

    it('rejects missing required fields', async () => {
      await expect(User.create({})).rejects.toThrow();
    });
  });

  describe('password handling', () => {
    it('hashes password before storing', async () => {
      const password = 'SecurePass123!';
      const user = await createTestUser({ password_hash: password });

      expect(user.password_hash).not.toBe(password);
      await expect(bcrypt.compare(password, user.password_hash)).resolves.toBe(true);
    });

    it('compares passwords through the instance method', async () => {
      const password = 'SecurePass123!';
      const user = await createTestUser({ password_hash: password });

      await expect(user.comparePassword(password)).resolves.toBe(true);
      await expect(user.comparePassword('WrongPass123!')).resolves.toBe(false);
    });
  });

  describe('updates', () => {
    it('persists balance updates by SQL id', async () => {
      const user = await createTestUser({ balance_NSL: 1000 });

      user.balance_NSL = 1500;
      await user.save();

      const updatedUser = await User.findByPk(user.id);
      expect(updatedUser.balance_NSL).toBe(1500);
    });

    it('stores KYC document fields', async () => {
      const user = await createTestUser({
        kyc_id_front: 'path/to/id_front.jpg',
        kyc_id_back: 'path/to/id_back.jpg',
        kyc_selfie: 'path/to/selfie.jpg',
        kyc_verified: true
      });

      expect(user.kyc_id_front).toBe('path/to/id_front.jpg');
      expect(user.kyc_id_back).toBe('path/to/id_back.jpg');
      expect(user.kyc_selfie).toBe('path/to/selfie.jpg');
      expect(user.kyc_verified).toBe(true);
    });

    it('stores last_login', async () => {
      const loginTime = new Date();
      const user = await createTestUser({ last_login: loginTime });

      const updatedUser = await User.findByPk(user.id);
      expect(updatedUser.last_login).toBeDefined();
      expect(updatedUser.last_login.getTime()).toBe(loginTime.getTime());
    });
  });
});
