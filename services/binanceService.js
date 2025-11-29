const axios = require('axios');
const crypto = require('crypto');
const logger = require('../utils/logger');
const ExchangeRate = require('../models/ExchangeRate');

class BinanceService {
  constructor() {
    this.apiKey = process.env.BINANCE_API_KEY || '';
    this.apiSecret = process.env.BINANCE_SECRET_KEY || '';
    this.baseURL = process.env.BINANCE_TESTNET === 'true'
      ? 'https://testnet.binance.vision/api'
      : 'https://api.binance.com/api';
    this.isConfigured = !!this.apiKey && !!this.apiSecret;

    if (!this.isConfigured) {
      logger.warn('Binance API credentials not configured. Some features will be limited.');
    }
  }

  /**
   * Create HMAC SHA256 signature for Binance API
   */
  createSignature(queryString) {
    return crypto
      .createHmac('sha256', this.apiSecret)
      .update(queryString)
      .digest('hex');
  }

  /**
   * Make authenticated request to Binance API
   */
  async makeRequest(endpoint, params = {}, method = 'GET') {
    if (!this.isConfigured) {
      throw new Error('Binance API not configured. Please set BINANCE_API_KEY and BINANCE_SECRET_KEY');
    }

    try {
      params.timestamp = Date.now();
      params.recvWindow = 60000; // 60 seconds

      const queryString = Object.keys(params)
        .map(key => `${key}=${encodeURIComponent(params[key])}`)
        .join('&');

      const signature = this.createSignature(queryString);
      const url = `${this.baseURL}${endpoint}?${queryString}&signature=${signature}`;

      const response = await axios({
        method,
        url,
        headers: {
          'X-MBX-APIKEY': this.apiKey
        }
      });

      return response.data;
    } catch (error) {
      logger.error('Binance API error:', error.response?.data || error.message);
      throw new Error(error.response?.data?.msg || 'Binance API request failed');
    }
  }

  /**
   * Get account information
   */
  async getAccountInfo() {
    return await this.makeRequest('/v3/account');
  }

  /**
   * Get account balances
   */
  async getBalances() {
    const accountInfo = await this.getAccountInfo();
    return accountInfo.balances.filter(b => parseFloat(b.free) > 0 || parseFloat(b.locked) > 0);
  }

  /**
   * Get balance for specific asset
   */
  async getAssetBalance(asset = 'USDT') {
    const balances = await this.getBalances();
    const balance = balances.find(b => b.asset === asset);

    return {
      asset,
      free: parseFloat(balance?.free || 0),
      locked: parseFloat(balance?.locked || 0),
      total: parseFloat(balance?.free || 0) + parseFloat(balance?.locked || 0)
    };
  }

  /**
   * Generate deposit address for a coin/network
   */
  async getDepositAddress(coin = 'USDT', network = 'BSC') {
    try {
      const data = await this.makeRequest('/v1/capital/deposit/address', {
        coin,
        network
      });

      return {
        address: data.address,
        tag: data.tag || null,
        coin,
        network
      };
    } catch (error) {
      logger.error('Get deposit address error:', error);
      throw new Error('Failed to generate deposit address');
    }
  }

  /**
   * Get deposit history
   */
  async getDepositHistory(coin = null, limit = 100) {
    const params = { limit };
    if (coin) params.coin = coin;

    return await this.makeRequest('/v1/capital/deposit/hisrec', params);
  }

  /**
   * Withdraw funds to external address
   */
  async withdraw(coin, network, address, amount, addressTag = null) {
    try {
      const params = {
        coin,
        network,
        address,
        amount
      };

      if (addressTag) {
        params.addressTag = addressTag;
      }

      const result = await this.makeRequest('/v1/capital/withdraw/apply', params, 'POST');

      return {
        success: true,
        withdrawId: result.id,
        coin,
        network,
        address,
        amount,
        fee: result.transactionFee || 0
      };
    } catch (error) {
      logger.error('Withdrawal error:', error);
      throw new Error(error.message || 'Withdrawal failed');
    }
  }

  /**
   * Get withdrawal history
   */
  async getWithdrawalHistory(coin = null, limit = 100) {
    const params = { limit };
    if (coin) params.coin = coin;

    return await this.makeRequest('/v1/capital/withdraw/history', params);
  }

  /**
   * Get current price for a trading pair
   */
  async getPrice(symbol = 'USDTNGN') {
    try {
      // No signature needed for public endpoint
      const response = await axios.get(`${this.baseURL}/v3/ticker/price`, {
        params: { symbol }
      });

      return {
        symbol: response.data.symbol,
        price: parseFloat(response.data.price)
      };
    } catch (error) {
      logger.error(`Error fetching price for ${symbol}:`, error.message);
      return null;
    }
  }

  /**
   * Get all trading pair prices
   */
  async getAllPrices() {
    try {
      const response = await axios.get(`${this.baseURL}/v3/ticker/price`);
      return response.data.map(item => ({
        symbol: item.symbol,
        price: parseFloat(item.price)
      }));
    } catch (error) {
      logger.error('Error fetching all prices:', error.message);
      return [];
    }
  }

  /**
   * Get exchange rate for a currency vs USD
   * Tries multiple symbol combinations
   */
  async getExchangeRate(currencyCode) {
    try {
      // Try direct pair first (e.g., USDTNGN, BUSDNGN)
      const symbols = [
        `USDT${currencyCode}`,
        `BUSD${currencyCode}`,
        `${currencyCode}USDT`,
        `${currencyCode}BUSD`
      ];

      for (const symbol of symbols) {
        const priceData = await this.getPrice(symbol);
        if (priceData) {
          // If symbol is USD_XXX format, rate is direct
          // If symbol is XXX_USD format, rate is inverse
          const rate = symbol.startsWith('USDT') || symbol.startsWith('BUSD')
            ? priceData.price
            : 1 / priceData.price;

          return {
            currency: currencyCode,
            rate_to_usd: rate,
            usd_per_unit: 1 / rate,
            symbol: priceData.symbol,
            success: true
          };
        }
      }

      logger.warn(`No exchange rate found for ${currencyCode} on Binance`);
      return null;
    } catch (error) {
      logger.error(`Error getting exchange rate for ${currencyCode}:`, error.message);
      return null;
    }
  }

  /**
   * Update all exchange rates in database from Binance
   */
  async updateExchangeRates() {
    try {
      logger.info('Updating exchange rates from Binance...');

      const currencies = await ExchangeRate.find({ enabled: true });
      let updated = 0;
      let failed = 0;

      for (const currency of currencies) {
        // Skip USD (base currency)
        if (currency.currency_code === 'USD') continue;

        try {
          const rateData = await this.getExchangeRate(currency.currency_code);

          if (rateData && rateData.success) {
            currency.binance_rate = rateData.rate_to_usd;
            currency.last_binance_update = new Date();

            // If not using admin override, update the active rate
            if (currency.active_rate_source === 'binance') {
              currency.rate_to_usd = rateData.rate_to_usd;
              currency.usd_per_unit = rateData.usd_per_unit;
            }

            await currency.save();
            updated++;
            logger.info(`Updated ${currency.currency_code}: 1 USD = ${rateData.rate_to_usd.toFixed(2)} ${currency.currency_code}`);
          } else {
            failed++;
            logger.warn(`Failed to update ${currency.currency_code}`);
          }
        } catch (error) {
          failed++;
          logger.error(`Error updating ${currency.currency_code}:`, error.message);
        }

        // Rate limit: Wait 100ms between requests
        await new Promise(resolve => setTimeout(resolve, 100));
      }

      logger.info(`Exchange rate update complete: ${updated} updated, ${failed} failed`);

      return {
        success: true,
        updated,
        failed,
        total: currencies.length
      };
    } catch (error) {
      logger.error('Error updating exchange rates:', error);
      throw error;
    }
  }

  /**
   * Get supported coins and networks
   */
  async getSupportedCoins() {
    try {
      return await this.makeRequest('/v1/capital/config/getall');
    } catch (error) {
      logger.error('Error fetching supported coins:', error);
      return [];
    }
  }

  /**
   * Verify if an address is valid for withdrawal
   */
  async verifyAddress(coin, network, address) {
    try {
      // Binance doesn't have a direct verification endpoint
      // We'll check if the coin and network are supported
      const coins = await this.getSupportedCoins();
      const coinData = coins.find(c => c.coin === coin);

      if (!coinData) {
        return { valid: false, reason: 'Coin not supported' };
      }

      const networkData = coinData.networkList.find(n => n.network === network);

      if (!networkData) {
        return { valid: false, reason: 'Network not supported for this coin' };
      }

      if (!networkData.withdrawEnable) {
        return { valid: false, reason: 'Withdrawals disabled for this network' };
      }

      return {
        valid: true,
        coin,
        network,
        withdrawMin: networkData.withdrawMin,
        withdrawMax: networkData.withdrawMax,
        withdrawFee: networkData.withdrawFee
      };
    } catch (error) {
      logger.error('Address verification error:', error);
      return { valid: false, reason: 'Verification failed' };
    }
  }
}

// Create singleton instance
const binanceService = new BinanceService();

module.exports = binanceService;
