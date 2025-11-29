const User = require('../../models/User');
const bcrypt = require('bcryptjs');
const { createTestUser } = require('../helpers/testUtils');

describe('User Model', () => {
  describe('User Creation', () => {
    it('should create a user with valid data', async () => {
      const user = await createTestUser({
        username: 'testuser123',
        phone: '+1234567890',
        email: 'test@example.com'
      });

      expect(user).toBeDefined();
      expect(user.username).toBe('testuser123');
      expect(user.phone).toBe('+1234567890');
      expect(user.email).toBe('test@example.com');
      expect(user.role).toBe('user');
      expect(user.status).toBe('active');
    });

    it('should not create user with duplicate username', async () => {
      await createTestUser({ username: 'duplicate' });

      await expect(
        createTestUser({ username: 'duplicate' })
      ).rejects.toThrow();
    });

    it('should not create user with duplicate phone', async () => {
      const phone = '+1234567890';
      await createTestUser({ phone });

      await expect(
        createTestUser({ phone })
      ).rejects.toThrow();
    });

    it('should not create user without required fields', async () => {
      const user = new User({});

      await expect(user.save()).rejects.toThrow();
    });
  });

  describe('User Fields', () => {
    it('should have default balance of 0', async () => {
      const user = await createTestUser({ balance_NSL: undefined, balance_usdt: undefined });

      expect(user.balance_NSL).toBe(0);
      expect(user.balance_usdt).toBe(0);
    });

    it('should have default vip_level of "none"', async () => {
      const user = await createTestUser({ vip_level: undefined });

      expect(user.vip_level).toBe('none');
    });

    it('should have default status of "pending"', async () => {
      const user = await createTestUser({ status: undefined });

      expect(user.status).toBe('pending');
    });

    it('should accept valid roles', async () => {
      const roles = ['user', 'admin', 'superadmin', 'finance', 'verificator', 'approval'];

      for (const role of roles) {
        const user = await createTestUser({ role, username: `user_${role}` });
        expect(user.role).toBe(role);
      }
    });

    it('should not accept invalid role', async () => {
      const user = new User({
        username: 'testuser',
        phone: '+1234567890',
        password_hash: 'hashedpass',
        role: 'invalid_role'
      });

      await expect(user.save()).rejects.toThrow();
    });
  });

  describe('Password Handling', () => {
    it('should store hashed password', async () => {
      const password = 'MyPassword123!';
      const hashedPassword = await bcrypt.hash(password, 10);

      const user = await createTestUser({ password_hash: hashedPassword });

      expect(user.password_hash).not.toBe(password);
      expect(user.password_hash).toBe(hashedPassword);
    });

    it('should verify correct password', async () => {
      const password = 'MyPassword123!';
      const hashedPassword = await bcrypt.hash(password, 10);

      const user = await createTestUser({ password_hash: hashedPassword });

      const isMatch = await bcrypt.compare(password, user.password_hash);
      expect(isMatch).toBe(true);
    });

    it('should not verify incorrect password', async () => {
      const password = 'MyPassword123!';
      const hashedPassword = await bcrypt.hash(password, 10);

      const user = await createTestUser({ password_hash: hashedPassword });

      const isMatch = await bcrypt.compare('WrongPassword', user.password_hash);
      expect(isMatch).toBe(false);
    });
  });

  describe('Balance Management', () => {
    it('should not allow negative balance_NSL', async () => {
      const user = new User({
        username: 'testuser',
        phone: '+1234567890',
        password_hash: 'hashedpass',
        balance_NSL: -100
      });

      await expect(user.save()).rejects.toThrow();
    });

    it('should not allow negative balance_usdt', async () => {
      const user = new User({
        username: 'testuser',
        phone: '+1234567890',
        password_hash: 'hashedpass',
        balance_usdt: -50
      });

      await expect(user.save()).rejects.toThrow();
    });

    it('should update balance correctly', async () => {
      const user = await createTestUser({ balance_NSL: 1000 });

      user.balance_NSL += 500;
      await user.save();

      const updatedUser = await User.findById(user._id);
      expect(updatedUser.balance_NSL).toBe(1500);
    });
  });

  describe('VIP Level', () => {
    it('should accept valid VIP levels', async () => {
      const vipLevels = ['VIP1', 'VIP2', 'VIP3', 'VIP4', 'VIP5', 'VIP6', 'VIP7', 'VIP8', 'VIP9', 'none'];

      for (const level of vipLevels) {
        const user = await createTestUser({ vip_level: level, username: `user_${level}` });
        expect(user.vip_level).toBe(level);
      }
    });

    it('should not accept invalid VIP level', async () => {
      const user = new User({
        username: 'testuser',
        phone: '+1234567890',
        password_hash: 'hashedpass',
        vip_level: 'VIP10'
      });

      await expect(user.save()).rejects.toThrow();
    });
  });

  describe('Products Array', () => {
    it('should add product to user', async () => {
      const user = await createTestUser();
      const productId = '507f1f77bcf86cd799439011';

      user.products.push({
        product_id: productId,
        purchase_date: new Date(),
        expires_at: new Date(Date.now() + 60 * 24 * 60 * 60 * 1000),
        auto_renew: true,
        is_active: true
      });

      await user.save();

      const updatedUser = await User.findById(user._id);
      expect(updatedUser.products).toHaveLength(1);
      expect(updatedUser.products[0].product_id.toString()).toBe(productId);
      expect(updatedUser.products[0].is_active).toBe(true);
      expect(updatedUser.products[0].auto_renew).toBe(true);
    });

    it('should handle multiple products', async () => {
      const user = await createTestUser();

      user.products.push({
        product_id: '507f1f77bcf86cd799439011',
        expires_at: new Date(Date.now() + 60 * 24 * 60 * 60 * 1000)
      });

      user.products.push({
        product_id: '507f1f77bcf86cd799439012',
        expires_at: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000)
      });

      await user.save();

      const updatedUser = await User.findById(user._id);
      expect(updatedUser.products).toHaveLength(2);
    });
  });

  describe('KYC Fields', () => {
    it('should have default kyc_verified as false', async () => {
      const user = await createTestUser();

      expect(user.kyc_verified).toBe(false);
    });

    it('should store KYC documents', async () => {
      const user = await createTestUser({
        kyc_documents: {
          id_front: 'path/to/id_front.jpg',
          id_back: 'path/to/id_back.jpg',
          selfie: 'path/to/selfie.jpg'
        }
      });

      expect(user.kyc_documents.id_front).toBe('path/to/id_front.jpg');
      expect(user.kyc_documents.id_back).toBe('path/to/id_back.jpg');
      expect(user.kyc_documents.selfie).toBe('path/to/selfie.jpg');
    });

    it('should update kyc_verified status', async () => {
      const user = await createTestUser();

      user.kyc_verified = true;
      await user.save();

      const updatedUser = await User.findById(user._id);
      expect(updatedUser.kyc_verified).toBe(true);
    });
  });

  describe('Referral System', () => {
    it('should generate unique referral code', async () => {
      const user1 = await createTestUser({ referral_code: 'REF001' });
      const user2 = await createTestUser({ referral_code: 'REF002' });

      expect(user1.referral_code).toBe('REF001');
      expect(user2.referral_code).toBe('REF002');
      expect(user1.referral_code).not.toBe(user2.referral_code);
    });

    it('should track referrer', async () => {
      const user = await createTestUser({ referred_by: 'REF001' });

      expect(user.referred_by).toBe('REF001');
    });

    it('should allow null referred_by for users without referrer', async () => {
      const user = await createTestUser({ referred_by: null });

      expect(user.referred_by).toBeNull();
    });
  });

  describe('Timestamps', () => {
    it('should have created_at timestamp', async () => {
      const user = await createTestUser();

      expect(user.created_at).toBeDefined();
      expect(user.created_at).toBeInstanceOf(Date);
    });

    it('should have null last_login by default', async () => {
      const user = await createTestUser();

      expect(user.last_login).toBeNull();
    });

    it('should update last_login', async () => {
      const user = await createTestUser();
      const loginTime = new Date();

      user.last_login = loginTime;
      await user.save();

      const updatedUser = await User.findById(user._id);
      expect(updatedUser.last_login).toBeDefined();
      expect(updatedUser.last_login.getTime()).toBe(loginTime.getTime());
    });
  });
});
