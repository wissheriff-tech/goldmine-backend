const express = require('express');
const { authenticate, authorizeRoles } = require('../middleware/auth');
const User = require('../models/User');
const ExchangeRate = require('../models/ExchangeRate');
const Transaction = require('../models/Transaction');
const binanceService = require('../services/binanceService');
const logger = require('../utils/logger');
const { getIO } = require('../config/socket');

const router = express.Router();

// ============================================
// USER WALLET MANAGEMENT
// ============================================

/**
 * Submit Binance account ID or wallet address
 * POST /api/binance/wallet/submit
 */
router.post('/wallet/submit', authenticate, async (req, res) => {
  try {
    const { binance_account_id, wallet_address } = req.body;

    if (!binance_account_id && !wallet_address) {
      return res.status(400).json({
        message: 'Please provide either Binance account ID or wallet address'
      });
    }

    const user = await User.findById(req.user.userId);

    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    // Update user with submitted information
    if (binance_account_id) {
      user.binance_account_id = binance_account_id;
    }

    if (wallet_address) {
      user.binance_wallet_address = wallet_address;
      // Reset verification when address changes
      user.binance_wallet_verified = false;
      user.binance_wallet_verified_by = null;
      user.binance_wallet_verified_at = null;
    }

    await user.save();

    // Notify admins via socket
    try {
      const io = getIO();
      io.to('admin-room').emit('new-wallet-submission', {
        userId: user._id,
        username: user.username,
        binance_account_id: user.binance_account_id,
        wallet_address: user.binance_wallet_address
      });
    } catch (socketError) {
      logger.warn('Socket notification failed:', socketError);
    }

    logger.info(`User ${user.username} submitted wallet information`);

    res.json({
      message: 'Wallet information submitted successfully. Awaiting admin verification.',
      wallet: {
        binance_account_id: user.binance_account_id,
        binance_wallet_address: user.binance_wallet_address,
        verified: user.binance_wallet_verified
      }
    });
  } catch (error) {
    logger.error('Submit wallet error:', error);
    res.status(500).json({ message: 'Failed to submit wallet information', error: error.message });
  }
});

/**
 * Add withdrawal address
 * POST /api/binance/wallet/withdrawal-address
 */
router.post('/wallet/withdrawal-address', authenticate, async (req, res) => {
  try {
    const { address, network, currency, label } = req.body;

    if (!address || !network || !currency) {
      return res.status(400).json({
        message: 'Address, network, and currency are required'
      });
    }

    // Verify address with Binance (if configured)
    if (binanceService.isConfigured) {
      const verification = await binanceService.verifyAddress(currency, network, address);
      if (!verification.valid) {
        return res.status(400).json({
          message: `Invalid address: ${verification.reason}`
        });
      }
    }

    const user = await User.findById(req.user.userId);

    // Check if address already exists
    const existingAddress = user.withdrawal_addresses.find(a => a.address === address);
    if (existingAddress) {
      return res.status(400).json({
        message: 'This withdrawal address has already been added'
      });
    }

    // Add new address
    user.withdrawal_addresses.push({
      address,
      network,
      currency,
      label: label || `${currency} Address`,
      verified: false
    });

    await user.save();

    // Notify admins
    try {
      const io = getIO();
      io.to('admin-room').emit('new-withdrawal-address', {
        userId: user._id,
        username: user.username,
        address,
        currency,
        network
      });
    } catch (socketError) {
      logger.warn('Socket notification failed:', socketError);
    }

    logger.info(`User ${user.username} added withdrawal address for ${currency}`);

    res.json({
      message: 'Withdrawal address added successfully. Awaiting Super Admin verification.',
      address: user.withdrawal_addresses[user.withdrawal_addresses.length - 1]
    });
  } catch (error) {
    logger.error('Add withdrawal address error:', error);
    res.status(500).json({ message: 'Failed to add withdrawal address', error: error.message });
  }
});

/**
 * Get user's wallet information
 * GET /api/binance/wallet/my-wallet
 */
router.get('/wallet/my-wallet', authenticate, async (req, res) => {
  try {
    const user = await User.findById(req.user.userId)
      .populate('binance_wallet_verified_by', 'username role')
      .populate('withdrawal_addresses.verified_by', 'username role');

    res.json({
      wallet: {
        binance_account_id: user.binance_account_id,
        binance_wallet_address: user.binance_wallet_address,
        verified: user.binance_wallet_verified,
        verified_by: user.binance_wallet_verified_by,
        verified_at: user.binance_wallet_verified_at,
        withdrawal_addresses: user.withdrawal_addresses,
        preferred_currency: user.preferred_currency
      }
    });
  } catch (error) {
    logger.error('Get wallet error:', error);
    res.status(500).json({ message: 'Failed to get wallet information', error: error.message });
  }
});

// ============================================
// ADMIN WALLET VERIFICATION
// ============================================

/**
 * Get all pending wallet verifications (Finance Admin, Super Admin)
 * GET /api/binance/wallet/pending
 */
router.get('/wallet/pending', authenticate, authorizeRoles('finance', 'superadmin'), async (req, res) => {
  try {
    const pendingWallets = await User.find({
      $or: [
        { binance_wallet_address: { $ne: null }, binance_wallet_verified: false },
        { binance_account_id: { $ne: null }, binance_wallet_verified: false }
      ]
    }).select('username phone email binance_account_id binance_wallet_address binance_wallet_verified created_at');

    const pendingAddresses = await User.find({
      'withdrawal_addresses.verified': false
    }).select('username phone withdrawal_addresses');

    res.json({
      pendingWallets,
      pendingAddresses: pendingAddresses.flatMap(user =>
        user.withdrawal_addresses
          .filter(addr => !addr.verified)
          .map(addr => ({
            userId: user._id,
            username: user.username,
            ...addr.toObject()
          }))
      )
    });
  } catch (error) {
    logger.error('Get pending wallets error:', error);
    res.status(500).json({ message: 'Failed to get pending wallets', error: error.message });
  }
});

/**
 * Verify user's Binance wallet (Super Admin only)
 * POST /api/binance/wallet/verify/:userId
 */
router.post('/wallet/verify/:userId', authenticate, authorizeRoles('superadmin'), async (req, res) => {
  try {
    const { userId } = req.params;
    const { approved, reason } = req.body;

    const user = await User.findById(userId);

    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    if (!user.binance_wallet_address && !user.binance_account_id) {
      return res.status(400).json({ message: 'User has not submitted wallet information' });
    }

    if (approved) {
      user.binance_wallet_verified = true;
      user.binance_wallet_verified_by = req.user.userId;
      user.binance_wallet_verified_at = new Date();
    } else {
      // Rejected - clear wallet info
      user.binance_wallet_address = null;
      user.binance_account_id = null;
      user.binance_wallet_verified = false;
    }

    await user.save();

    // Notify user via socket
    try {
      const io = getIO();
      io.to(`user-${userId}`).emit('wallet-verification-status', {
        approved,
        reason,
        verified: user.binance_wallet_verified
      });
    } catch (socketError) {
      logger.warn('Socket notification failed:', socketError);
    }

    logger.info(`Super Admin ${req.user.userId} ${approved ? 'approved' : 'rejected'} wallet for user ${user.username}`);

    res.json({
      message: `Wallet ${approved ? 'verified' : 'rejected'} successfully`,
      wallet: {
        binance_account_id: user.binance_account_id,
        binance_wallet_address: user.binance_wallet_address,
        verified: user.binance_wallet_verified
      }
    });
  } catch (error) {
    logger.error('Verify wallet error:', error);
    res.status(500).json({ message: 'Failed to verify wallet', error: error.message });
  }
});

/**
 * Verify withdrawal address (Super Admin only)
 * POST /api/binance/wallet/verify-address/:userId/:addressId
 */
router.post('/wallet/verify-address/:userId/:addressId', authenticate, authorizeRoles('superadmin'), async (req, res) => {
  try {
    const { userId, addressId } = req.params;
    const { approved, reason } = req.body;

    const user = await User.findById(userId);

    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    const address = user.withdrawal_addresses.id(addressId);

    if (!address) {
      return res.status(404).json({ message: 'Withdrawal address not found' });
    }

    if (approved) {
      address.verified = true;
      address.verified_by = req.user.userId;
      address.verified_at = new Date();
    } else {
      // Remove rejected address
      user.withdrawal_addresses.pull(addressId);
    }

    await user.save();

    // Notify user
    try {
      const io = getIO();
      io.to(`user-${userId}`).emit('address-verification-status', {
        addressId,
        approved,
        reason,
        address: approved ? address : null
      });
    } catch (socketError) {
      logger.warn('Socket notification failed:', socketError);
    }

    logger.info(`Super Admin verified withdrawal address for user ${user.username}: ${approved ? 'approved' : 'rejected'}`);

    res.json({
      message: `Withdrawal address ${approved ? 'verified' : 'rejected'} successfully`,
      address: approved ? address : null
    });
  } catch (error) {
    logger.error('Verify address error:', error);
    res.status(500).json({ message: 'Failed to verify address', error: error.message });
  }
});

// ============================================
// CURRENCY EXCHANGE RATES
// ============================================

/**
 * Get all exchange rates
 * GET /api/binance/exchange-rates
 */
router.get('/exchange-rates', authenticate, async (req, res) => {
  try {
    const rates = await ExchangeRate.find({ enabled: true })
      .populate('override_set_by', 'username role')
      .sort({ currency_code: 1 });

    const formattedRates = rates.map(rate => {
      const activeRate = rate.getActiveRate();
      return {
        currency_code: rate.currency_code,
        currency_name: rate.currency_name,
        currency_symbol: rate.currency_symbol,
        rate_to_usd: activeRate.rate,
        usd_per_unit: activeRate.usd_per_unit,
        source: activeRate.source,
        binance_rate: rate.binance_rate,
        admin_override_rate: rate.admin_override_rate,
        last_update: rate.last_binance_update,
        country: rate.country
      };
    });

    res.json({ rates: formattedRates });
  } catch (error) {
    logger.error('Get exchange rates error:', error);
    res.status(500).json({ message: 'Failed to get exchange rates', error: error.message });
  }
});

/**
 * Get specific exchange rate
 * GET /api/binance/exchange-rates/:currency
 */
router.get('/exchange-rates/:currency', authenticate, async (req, res) => {
  try {
    const { currency } = req.params;

    const rate = await ExchangeRate.findOne({
      currency_code: currency.toUpperCase(),
      enabled: true
    }).populate('override_set_by', 'username role');

    if (!rate) {
      return res.status(404).json({ message: 'Currency not found' });
    }

    const activeRate = rate.getActiveRate();

    res.json({
      currency_code: rate.currency_code,
      currency_name: rate.currency_name,
      currency_symbol: rate.currency_symbol,
      rate_to_usd: activeRate.rate,
      usd_per_unit: activeRate.usd_per_unit,
      source: activeRate.source,
      binance_rate: rate.binance_rate,
      admin_override_rate: rate.admin_override_rate,
      override_set_by: rate.override_set_by,
      override_reason: rate.override_reason,
      last_update: rate.last_binance_update
    });
  } catch (error) {
    logger.error('Get exchange rate error:', error);
    res.status(500).json({ message: 'Failed to get exchange rate', error: error.message });
  }
});

/**
 * Convert currency
 * POST /api/binance/exchange-rates/convert
 */
router.post('/exchange-rates/convert', authenticate, async (req, res) => {
  try {
    const { amount, from_currency, to_currency } = req.body;

    if (!amount || !from_currency || !to_currency) {
      return res.status(400).json({
        message: 'Amount, from_currency, and to_currency are required'
      });
    }

    const convertedAmount = await ExchangeRate.convert(
      parseFloat(amount),
      from_currency,
      to_currency
    );

    res.json({
      from: {
        amount: parseFloat(amount),
        currency: from_currency.toUpperCase()
      },
      to: {
        amount: convertedAmount,
        currency: to_currency.toUpperCase()
      },
      timestamp: new Date()
    });
  } catch (error) {
    logger.error('Currency conversion error:', error);
    res.status(500).json({ message: 'Currency conversion failed', error: error.message });
  }
});

/**
 * Update exchange rates from Binance (Admin only)
 * POST /api/binance/exchange-rates/update
 */
router.post('/exchange-rates/update', authenticate, authorizeRoles('admin', 'superadmin'), async (req, res) => {
  try {
    const result = await binanceService.updateExchangeRates();

    res.json({
      message: 'Exchange rates updated successfully',
      ...result
    });
  } catch (error) {
    logger.error('Update exchange rates error:', error);
    res.status(500).json({ message: 'Failed to update exchange rates', error: error.message });
  }
});

/**
 * Set admin override rate (Small Admin, Super Admin)
 * POST /api/binance/exchange-rates/:currency/override
 */
router.post('/exchange-rates/:currency/override', authenticate, authorizeRoles('admin', 'superadmin'), async (req, res) => {
  try {
    const { currency } = req.params;
    const { rate, reason, use_override } = req.body;

    if (use_override && (!rate || rate <= 0)) {
      return res.status(400).json({ message: 'Valid rate is required when setting override' });
    }

    const exchangeRate = await ExchangeRate.findOne({
      currency_code: currency.toUpperCase()
    });

    if (!exchangeRate) {
      return res.status(404).json({ message: 'Currency not found' });
    }

    if (use_override) {
      exchangeRate.admin_override_rate = parseFloat(rate);
      exchangeRate.active_rate_source = 'admin';
      exchangeRate.override_set_by = req.user.userId;
      exchangeRate.override_reason = reason || 'Manual rate adjustment';
      exchangeRate.override_set_at = new Date();

      // Update active rates
      exchangeRate.rate_to_usd = parseFloat(rate);
      exchangeRate.usd_per_unit = 1 / parseFloat(rate);
    } else {
      // Remove override, use Binance rate
      exchangeRate.active_rate_source = 'binance';
      if (exchangeRate.binance_rate) {
        exchangeRate.rate_to_usd = exchangeRate.binance_rate;
        exchangeRate.usd_per_unit = 1 / exchangeRate.binance_rate;
      }
    }

    await exchangeRate.save();

    logger.info(`Admin ${req.user.userId} ${use_override ? 'set' : 'removed'} override for ${currency}: ${rate}`);

    res.json({
      message: use_override ? 'Exchange rate override set successfully' : 'Override removed, using Binance rate',
      rate: exchangeRate.getActiveRate()
    });
  } catch (error) {
    logger.error('Set override rate error:', error);
    res.status(500).json({ message: 'Failed to set override rate', error: error.message });
  }
});

/**
 * Add new currency (Super Admin only)
 * POST /api/binance/exchange-rates/add
 */
router.post('/exchange-rates/add', authenticate, authorizeRoles('superadmin'), async (req, res) => {
  try {
    const {
      currency_code,
      currency_name,
      currency_symbol,
      country,
      initial_rate
    } = req.body;

    if (!currency_code || !currency_name) {
      return res.status(400).json({
        message: 'Currency code and name are required'
      });
    }

    // Check if currency already exists
    const existing = await ExchangeRate.findOne({
      currency_code: currency_code.toUpperCase()
    });

    if (existing) {
      return res.status(400).json({ message: 'Currency already exists' });
    }

    // Try to get rate from Binance
    let rate_to_usd = initial_rate || 1;
    let binance_rate = null;

    if (binanceService.isConfigured) {
      const binanceRateData = await binanceService.getExchangeRate(currency_code);
      if (binanceRateData && binanceRateData.success) {
        rate_to_usd = binanceRateData.rate_to_usd;
        binance_rate = binanceRateData.rate_to_usd;
      }
    }

    const newRate = new ExchangeRate({
      currency_code: currency_code.toUpperCase(),
      currency_name,
      currency_symbol: currency_symbol || '$',
      country,
      rate_to_usd,
      usd_per_unit: 1 / rate_to_usd,
      binance_rate,
      last_binance_update: binance_rate ? new Date() : null
    });

    await newRate.save();

    logger.info(`New currency added: ${currency_code} by admin ${req.user.userId}`);

    res.status(201).json({
      message: 'Currency added successfully',
      currency: newRate
    });
  } catch (error) {
    logger.error('Add currency error:', error);
    res.status(500).json({ message: 'Failed to add currency', error: error.message });
  }
});

// ============================================
// BINANCE ACCOUNT OPERATIONS
// ============================================

/**
 * Get Binance account balance (Super Admin, Finance)
 * GET /api/binance/account/balance
 */
router.get('/account/balance', authenticate, authorizeRoles('finance', 'superadmin'), async (req, res) => {
  try {
    const { asset } = req.query;

    if (asset) {
      const balance = await binanceService.getAssetBalance(asset);
      res.json({ balance });
    } else {
      const balances = await binanceService.getBalances();
      res.json({ balances });
    }
  } catch (error) {
    logger.error('Get balance error:', error);
    res.status(500).json({ message: 'Failed to get balance', error: error.message });
  }
});

/**
 * Get deposit address (Admin)
 * GET /api/binance/deposit/address
 */
router.get('/deposit/address', authenticate, authorizeRoles('finance', 'superadmin'), async (req, res) => {
  try {
    const { coin, network } = req.query;

    if (!coin || !network) {
      return res.status(400).json({
        message: 'Coin and network are required'
      });
    }

    const depositAddress = await binanceService.getDepositAddress(coin, network);

    res.json({ depositAddress });
  } catch (error) {
    logger.error('Get deposit address error:', error);
    res.status(500).json({ message: 'Failed to get deposit address', error: error.message });
  }
});

module.exports = router;
