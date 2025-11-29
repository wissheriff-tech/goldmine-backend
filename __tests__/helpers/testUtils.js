const jwt = require('jsonwebtoken');
const User = require('../../models/User');
const Product = require('../../models/Product');
const bcrypt = require('bcryptjs');

/**
 * Generate JWT token for testing
 */
const generateToken = (userId, role = 'user') => {
  return jwt.sign(
    { userId, role },
    process.env.JWT_SECRET || 'test-secret-key',
    { expiresIn: '1h' }
  );
};

/**
 * Create a test user
 */
const createTestUser = async (overrides = {}) => {
  const hashedPassword = await bcrypt.hash('Test123!@#', 10);

  const userData = {
    username: `testuser${Date.now()}`,
    phone: `+1234567${Math.floor(Math.random() * 10000)}`,
    password_hash: hashedPassword,
    email: `test${Date.now()}@test.com`,
    role: 'user',
    status: 'active',
    balance_NSL: 1000,
    balance_usdt: 100,
    vip_level: 'VIP1',
    referral_code: `REF${Date.now()}`,
    emailVerified: true,
    kyc_verified: false,
    ...overrides
  };

  const user = await User.create(userData);
  return user;
};

/**
 * Create a test admin user
 */
const createTestAdmin = async (role = 'admin') => {
  return createTestUser({
    role,
    username: `admin${Date.now()}`,
  });
};

/**
 * Create a test product
 */
const createTestProduct = async (overrides = {}) => {
  const productData = {
    name: `VIP${Math.floor(Math.random() * 9) + 1}`,
    price_NSL: 500,
    price_usdt: 20,
    daily_income_NSL: 10,
    validity_days: 60,
    benefits: ['Daily income', 'Priority support'],
    active: true,
    ...overrides
  };

  const product = await Product.create(productData);
  return product;
};

/**
 * Create authorization header with token
 */
const authHeader = (token) => {
  return { Authorization: `Bearer ${token}` };
};

/**
 * Mock request object
 */
const mockRequest = (body = {}, user = null, params = {}, query = {}) => {
  return {
    body,
    user,
    params,
    query,
    headers: {},
    get: jest.fn(),
  };
};

/**
 * Mock response object
 */
const mockResponse = () => {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  res.send = jest.fn().mockReturnValue(res);
  return res;
};

/**
 * Mock next function
 */
const mockNext = () => jest.fn();

module.exports = {
  generateToken,
  createTestUser,
  createTestAdmin,
  createTestProduct,
  authHeader,
  mockRequest,
  mockResponse,
  mockNext,
};
