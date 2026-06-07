const { Sequelize } = require('sequelize');
const logger = require('../utils/logger');

const isProd = process.env.NODE_ENV === 'production';

let sequelize;

if (isProd) {
  const dbUrl = process.env.DATABASE_URL || '';
  const isMysql = dbUrl.startsWith('mysql://') || dbUrl.startsWith('mysql2://');
  const dialect = isMysql ? 'mysql' : 'postgres';

  sequelize = new Sequelize(dbUrl, {
    dialect,
    logging: false,
    define: { timestamps: true, underscored: false },
    // Pass dialect modules explicitly to avoid Lambda module-resolution issues
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
