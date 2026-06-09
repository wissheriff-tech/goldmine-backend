const { Sequelize } = require('sequelize');
const logger = require('../utils/logger');

const isProd = process.env.NODE_ENV === 'production';
const dbUrl = process.env.DATABASE_URL || '';

let sequelize;

if (isProd || dbUrl) {
  if (!dbUrl) {
    logger.error('DATABASE_URL is not set. Set it in your Vercel environment variables.');
    process.exit(1);
  }
  const isMysql = dbUrl.startsWith('mysql://') || dbUrl.startsWith('mysql2://');
  const dialect = isMysql ? 'mysql' : 'postgres';

  sequelize = new Sequelize(dbUrl, {
    dialect,
    logging: false,
    define: { timestamps: true, underscored: false },
    dialectModule: isMysql ? require('mysql2') : require('pg'),
    dialectOptions: isMysql
      ? { connectTimeout: 20000 }
      : { ssl: { require: true, rejectUnauthorized: false } },
  });
  logger.info(`Production DB: dialect=${dialect}`);
} else {
  const path = require('path');
  const dbPath = process.env.SQLITE_PATH || path.join(__dirname, '..', 'data', 'salonmoney.db');
  sequelize = new Sequelize({
    dialect: 'sqlite',
    storage: dbPath,
    logging: false,
    define: { timestamps: true, underscored: false },
  });
  logger.info(`SQLite database: ${dbPath}`);
}

module.exports = { sequelize };
