const express = require('express');
const { CurrencyRate, User } = require('../models');
const { authenticate, authorize } = require('../middleware/auth');
const logger = require('../utils/logger');

const router = express.Router();

// Get all currency rates (public)
router.get('/rates', async (req, res) => {
  try {
    const rates = await CurrencyRate.findAll({
      where: { enabled: true },
      order: [['currency_code', 'ASC']]
    });
    res.json({ rates });
  } catch (error) {
    logger.error('Currency rates fetch error:', error);
    res.status(500).json({ message: 'Error fetching currency rates', error: error.message });
  }
});

// Get all currency rates (admin - including disabled)
router.get('/rates/all', authenticate, authorize(['superadmin', 'admin', 'finance']), async (req, res) => {
  try {
    const rates = await CurrencyRate.findAll({
      order: [['currency_code', 'ASC']],
      include: [{ model: User, as: 'updatedBy', attributes: ['username'] }]
    });
    res.json({ rates });
  } catch (error) {
    logger.error('Currency rates fetch error:', error);
    res.status(500).json({ message: 'Error fetching currency rates', error: error.message });
  }
});

// Create or update currency rate
router.post('/rates', authenticate, authorize(['superadmin']), async (req, res) => {
  try {
    const { currency_code, currency_name, rate_to_usd, enabled } = req.body;

    if (!currency_code || !currency_name || rate_to_usd === undefined) {
      return res.status(400).json({ message: 'Currency code, name and rate_to_usd are required' });
    }

    const existingRate = await CurrencyRate.findOne({
      where: { currency_code: currency_code.toUpperCase() }
    });

    if (existingRate) {
      // Update existing
      await existingRate.update({
        currency_name,
        rate_to_usd,
        enabled: enabled !== undefined ? enabled : existingRate.enabled,
        updated_by: req.user.id
      });

      logger.info(`Currency rate updated: ${currency_code} by ${req.user.username}`);
      return res.json({
        message: 'Currency rate updated successfully',
        rate: existingRate
      });
    }

    // Create new
    const rate = await CurrencyRate.create({
      currency_code: currency_code.toUpperCase(),
      currency_name,
      rate_to_usd,
      enabled: enabled !== undefined ? enabled : true,
      updated_by: req.user.id
    });

    logger.info(`Currency rate created: ${currency_code} by ${req.user.username}`);

    res.status(201).json({
      message: 'Currency rate created successfully',
      rate
    });
  } catch (error) {
    logger.error('Currency rate creation error:', error);
    res.status(500).json({ message: 'Error creating currency rate', error: error.message });
  }
});

// Delete currency rate
router.delete('/rates/:code', authenticate, authorize(['superadmin']), async (req, res) => {
  try {
    const deleted = await CurrencyRate.destroy({
      where: { currency_code: req.params.code.toUpperCase() }
    });

    if (!deleted) {
      return res.status(404).json({ message: 'Currency rate not found' });
    }

    logger.info(`Currency rate deleted: ${req.params.code} by ${req.user.username}`);
    res.json({ message: 'Currency rate deleted successfully' });
  } catch (error) {
    logger.error('Currency rate deletion error:', error);
    res.status(500).json({ message: 'Error deleting currency rate', error: error.message });
  }
});

module.exports = router;
