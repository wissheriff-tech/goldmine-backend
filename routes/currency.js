const express = require('express');
const CurrencyRate = require('../models/CurrencyRate');
const { authenticate, authorize } = require('../middleware/auth');
const logger = require('../utils/logger');

const router = express.Router();

// Get all currency rates (public)
router.get('/rates', async (req, res) => {
  try {
    const rates = await CurrencyRate.find({ enabled: true }).sort({ currency_code: 1 });
    res.json({ rates });
  } catch (error) {
    logger.error('Currency rates fetch error:', error);
    res.status(500).json({ message: 'Error fetching currency rates', error: error.message });
  }
});

// Get all currency rates (admin - including disabled)
router.get('/rates/all', authenticate, authorize(['superadmin', 'admin', 'finance']), async (req, res) => {
  try {
    const rates = await CurrencyRate.find().sort({ currency_code: 1 }).populate('updated_by', 'username');
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

    const existingRate = await CurrencyRate.findOne({ currency_code: currency_code.toUpperCase() });

    if (existingRate) {
      // Update existing
      existingRate.currency_name = currency_name;
      existingRate.rate_to_usd = rate_to_usd;
      existingRate.enabled = enabled !== undefined ? enabled : existingRate.enabled;
      existingRate.updated_by = req.user.id;
      await existingRate.save();

      logger.info(`Currency rate updated: ${currency_code} by ${req.user.username}`);
      return res.json({
        message: 'Currency rate updated successfully',
        rate: existingRate
      });
    }

    // Create new
    const rate = new CurrencyRate({
      currency_code: currency_code.toUpperCase(),
      currency_name,
      rate_to_usd,
      enabled: enabled !== undefined ? enabled : true,
      updated_by: req.user.id
    });

    await rate.save();
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
    const rate = await CurrencyRate.findOneAndDelete({ currency_code: req.params.code.toUpperCase() });

    if (!rate) {
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
