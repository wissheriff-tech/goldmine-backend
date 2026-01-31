/**
 * Database Configuration
 * MySQL connection via Sequelize
 */

const { Sequelize } = require('sequelize');
const logger = require('../utils/logger');

const databaseUrl = process.env.DATABASE_URL || 'mysql://root:password@localhost:3306/salonmoney';

const sequelize = new Sequelize(databaseUrl, {
  dialect: 'mysql',
  logging: (msg) => logger.debug(msg),
  pool: {
    max: 10,
    min: 2,
    acquire: 30000,
    idle: 10000
  },
  dialectOptions: {
    connectTimeout: 10000
  },
  define: {
    timestamps: true,
    underscored: false
  }
});

const connectDatabase = async () => {
  try {
    await sequelize.authenticate();
    logger.info(`MySQL Connected: ${sequelize.config.host}`);
    logger.info(`Database Name: ${sequelize.config.database}`);
    return sequelize;
  } catch (error) {
    logger.error('MySQL connection failed:', error.message);
    process.exit(1);
  }
};

// Graceful shutdown
process.on('SIGINT', async () => {
  await sequelize.close();
  logger.info('MySQL connection closed through app termination');
  process.exit(0);
});

module.exports = { sequelize, connectDatabase };
