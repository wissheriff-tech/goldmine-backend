const path = require('path');

process.env.SQLITE_PATH = path.join(__dirname, 'test.sqlite');

const { sequelize } = require('../config/database');

async function withSqliteForeignKeysDisabled(fn) {
  if (sequelize.getDialect() !== 'sqlite') return fn();
  await sequelize.query('PRAGMA foreign_keys = OFF');
  try {
    return await fn();
  } finally {
    await sequelize.query('PRAGMA foreign_keys = ON');
  }
}

// Setup before all tests
beforeAll(async () => {
  await withSqliteForeignKeysDisabled(() => sequelize.sync({ force: true }));
});

// Cleanup after each test
afterEach(async () => {
  await withSqliteForeignKeysDisabled(() => sequelize.truncate({ cascade: true, restartIdentity: true }));
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
