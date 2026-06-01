const path = require('path');
const { Sequelize } = require('sequelize');
const logger = require('../utils/logger');

const isProd = process.env.NODE_ENV === 'production';

let sequelize;

if (isProd && process.env.DATABASE_URL && process.env.DATABASE_URL.startsWith('postgres')) {
  // Production: PostgreSQL (Neon, Supabase, Railway, etc.)
  sequelize = new Sequelize(process.env.DATABASE_URL, {
    dialect: 'postgres',
    protocol: 'postgres',
    logging: false,
    dialectOptions: {
      ssl: { require: true, rejectUnauthorized: false }
    },
    define: { timestamps: true, underscored: false }
  });
} else {
  // Development: SQLite (zero config, file-based)
  const dbPath = process.env.SQLITE_PATH || path.join(__dirname, '..', 'data', 'salonmoney.db');
  sequelize = new Sequelize({
    dialect: 'sqlite',
    storage: dbPath,
    logging: false,
    define: { timestamps: true, underscored: false }
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
