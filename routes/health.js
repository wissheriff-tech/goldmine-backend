const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const logger = require('../utils/logger');

/**
 * @route   GET /api/health
 * @desc    Health check endpoint with database connectivity check
 * @access  Public
 */
router.get('/', async (req, res) => {
  try {
    // Quick database connectivity check
    const dbState = mongoose.connection.readyState;
    const dbStatus = {
      0: 'disconnected',
      1: 'connected',
      2: 'connecting',
      3: 'disconnecting'
    };

    // Check if database is connected
    if (dbState === 1) {
      // Perform a quick ping to verify DB is responsive
      await mongoose.connection.db.admin().ping();

      res.status(200).json({
        status: 'ok',
        timestamp: new Date().toISOString(),
        service: 'backend',
        database: {
          status: 'connected',
          name: mongoose.connection.name
        },
        uptime: process.uptime(),
        version: process.env.npm_package_version || '1.0.0'
      });
    } else {
      // Database not connected
      res.status(503).json({
        status: 'error',
        timestamp: new Date().toISOString(),
        service: 'backend',
        database: {
          status: dbStatus[dbState] || 'unknown',
          name: mongoose.connection.name
        },
        message: 'Database not connected'
      });
    }
  } catch (error) {
    logger.error('Health check error:', error);
    res.status(503).json({
      status: 'error',
      timestamp: new Date().toISOString(),
      service: 'backend',
      message: error.message
    });
  }
});

module.exports = router;
