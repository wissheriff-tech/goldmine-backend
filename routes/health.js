const express = require('express');
const router = express.Router();
const { sequelize } = require('../models');
const logger = require('../utils/logger');

/**
 * @route   GET /api/health
 * @desc    Health check endpoint with database connectivity check
 * @access  Public
 */
router.get('/', async (req, res) => {
  try {
    // Quick database connectivity check
    await sequelize.authenticate();

    res.status(200).json({
      status: 'ok',
      timestamp: new Date().toISOString(),
      service: 'backend',
      database: {
        status: 'connected',
        name: sequelize.getDatabaseName()
      },
      uptime: process.uptime(),
      version: process.env.npm_package_version || '1.0.0'
    });
  } catch (error) {
    logger.error('Health check error:', error);
    res.status(503).json({
      status: 'error',
      timestamp: new Date().toISOString(),
      service: 'backend',
      database: {
        status: 'disconnected'
      },
      message: error.message
    });
  }
});

module.exports = router;
