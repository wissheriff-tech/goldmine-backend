const path = require('path');

process.env.SQLITE_PATH = path.join(__dirname, 'test.sqlite');

const { sequelize } = require('../config/database');

// Setup before all tests
beforeAll(async () => {
  await sequelize.sync({ force: true });
});

// Cleanup after each test
afterEach(async () => {
  await sequelize.truncate({ cascade: true, restartIdentity: true });
});

// Cleanup after all tests
afterAll(async () => {
  await sequelize.close();
});

// Suppress console errors during tests
global.console = {
  ...console,
  error: jest.fn(),
  warn: jest.fn(),
};
