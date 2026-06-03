const { Sequelize } = require('sequelize');
const logger = require('../utils/logger');

const isProd = process.env.NODE_ENV === 'production';

let sequelize;

if (isProd) {
  // Production: always PostgreSQL — never load sqlite3 on Vercel
  const dbUrl = process.env.DATABASE_URL || '';
  sequelize = new Sequelize(dbUrl, {
    dialect: 'postgres',
    protocol: 'postgres',
    logging: false,
    dialectOptions: {
      ssl: { require: true, rejectUnauthorized: false },
    },
    define: { timestamps: true, underscored: false },
    pool: {
      afterCreate: (conn, done) => {
        conn.query('SET search_path TO backend;', (err) => done(err, conn));
      },
    },
  });
} else {
  // Development: SQLite (zero config, file-based)
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

const connectDatabase = async () => {
  try {
    await sequelize.authenticate();
    await sequelize.sync({ alter: true });
    logger.info('Database connected and synced');
    return sequelize;
  } catch (error) {
    logger.error('Database connection failed:', error.message);
    process.exit(1);
  }
};

process.on('SIGINT', async () => {
  await sequelize.close();
  logger.info('Database connection closed');
  process.exit(0);
});

module.exports = { sequelize, connectDatabase };
