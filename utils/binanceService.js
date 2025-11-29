const axios = require('axios');
const crypto = require('crypto');
const logger = require('./logger');

class BinanceService {
  constructor() {
    this.apiKey = process.env.BINANCE_API_KEY;
    this.apiSecret = process.env.BINANCE_API_SECRET;
    this.baseURL = process.env.BINANCE_TESTNET === 'true'
      ? 'https://testnet.binance.vision/api'
      : 'https://api.binance.com/api';
  }

  // Generate signature for Binance API
  generateSignature(queryString) {
    return crypto
      .createHmac('sha256', this.apiSecret)
      .update(queryString)
      .digest('hex');
  }

  // Get current USDT price
  async getUSDTPrice() {
    try {
      const response = await axios.get(`${this.baseURL}/v3/ticker/price`, {
        params: { symbol: 'USDTUSDT' }
      });
      return parseFloat(response.data.price || 1);
    } catch (error) {
      logger.error('Binance price fetch error:', error.message);
      return 1; // Default to 1:1 if error
    }
  }

  // Create deposit address for user
  async createDepositAddress(userId, currency = 'USDT') {
    try {
      // Check if API keys are configured
      if (!this.apiKey || !this.apiSecret || this.apiKey === 'your_binance_api_key') {
        logger.warn('Binance API keys not configured, using mock address');
        const mockAddress = `0x${crypto.randomBytes(20).toString('hex')}`;
        logger.info(`Mock deposit address generated for user ${userId}: ${mockAddress}`);
        return {
          address: mockAddress,
          tag: null,
          network: 'BSC',
          currency: currency,
          isMock: true
        };
      }

      const timestamp = Date.now();
      const params = {
        coin: currency,
        network: 'BSC', // Binance Smart Chain (cheaper fees)
        timestamp,
        recvWindow: 5000
      };

      const queryString = Object.entries(params)
        .map(([key, value]) => `${key}=${value}`)
        .join('&');

      const signature = this.generateSignature(queryString);

      const response = await axios.post(
        `${this.baseURL}/v1/capital/deposit/address`,
        null,
        {
          params: { ...params, signature },
          headers: {
            'X-MBX-APIKEY': this.apiKey
          }
        }
      );

      logger.info(`Deposit address created for user ${userId}: ${response.data.address}`);

      return {
        address: response.data.address,
        tag: response.data.tag,
        network: 'BSC',
        currency: currency
      };
    } catch (error) {
      logger.error('Binance deposit address error:', error.response?.data || error.message);

      // Always return a mock address for development/testing or if API fails
      const mockAddress = `0x${crypto.randomBytes(20).toString('hex')}`;
      logger.warn(`Using mock address due to error: ${mockAddress}`);
      return {
        address: mockAddress,
        tag: null,
        network: 'BSC',
        currency: currency,
        isMock: true
      };
    }
  }

  // Check deposit status
  async checkDeposit(address, txId) {
    try {
      const timestamp = Date.now();
      const params = {
        coin: 'USDT',
        timestamp,
        recvWindow: 5000
      };

      if (txId) {
        params.txId = txId;
      }

      const queryString = Object.entries(params)
        .map(([key, value]) => `${key}=${value}`)
        .join('&');

      const signature = this.generateSignature(queryString);

      const response = await axios.get(
        `${this.baseURL}/v1/capital/deposit/hisrec`,
        {
          params: { ...params, signature },
          headers: {
            'X-MBX-APIKEY': this.apiKey
          }
        }
      );

      // Find deposits to the specified address
      const deposits = response.data.filter(dep =>
        dep.address === address &&
        dep.status === 1 // 1 = success
      );

      return deposits;
    } catch (error) {
      logger.error('Binance deposit check error:', error.response?.data || error.message);
      return [];
    }
  }

  // Process withdrawal to user's wallet
  async processWithdrawal(address, amount, network = 'BSC') {
    try {
      const timestamp = Date.now();
      const params = {
        coin: 'USDT',
        address,
        amount,
        network,
        timestamp,
        recvWindow: 5000
      };

      const queryString = Object.entries(params)
        .map(([key, value]) => `${key}=${value}`)
        .join('&');

      const signature = this.generateSignature(queryString);

      const response = await axios.post(
        `${this.baseURL}/v1/capital/withdraw/apply`,
        null,
        {
          params: { ...params, signature },
          headers: {
            'X-MBX-APIKEY': this.apiKey
          }
        }
      );

      logger.info(`Withdrawal processed: ${response.data.id} - ${amount} USDT to ${address}`);

      return {
        id: response.data.id,
        status: 'processing',
        amount,
        address,
        network
      };
    } catch (error) {
      logger.error('Binance withdrawal error:', error.response?.data || error.message);

      // Mock withdrawal for development
      if (process.env.NODE_ENV === 'development') {
        const mockId = `MOCK_${crypto.randomBytes(16).toString('hex')}`;
        logger.warn(`Using mock withdrawal: ${mockId}`);
        return {
          id: mockId,
          status: 'processing',
          amount,
          address,
          network,
          isMock: true
        };
      }

      throw error;
    }
  }

  // Check withdrawal status
  async checkWithdrawalStatus(withdrawId) {
    try {
      const timestamp = Date.now();
      const params = {
        timestamp,
        recvWindow: 5000
      };

      const queryString = Object.entries(params)
        .map(([key, value]) => `${key}=${value}`)
        .join('&');

      const signature = this.generateSignature(queryString);

      const response = await axios.get(
        `${this.baseURL}/v1/capital/withdraw/history`,
        {
          params: { ...params, signature },
          headers: {
            'X-MBX-APIKEY': this.apiKey
          }
        }
      );

      const withdrawal = response.data.find(w => w.id === withdrawId);

      if (withdrawal) {
        return {
          status: withdrawal.status, // 0=pending, 1=success, 2=rejected
          amount: withdrawal.amount,
          txId: withdrawal.txId
        };
      }

      return null;
    } catch (error) {
      logger.error('Binance withdrawal status error:', error.response?.data || error.message);
      return null;
    }
  }

  // Get account balance
  async getAccountBalance() {
    try {
      const timestamp = Date.now();
      const params = {
        timestamp,
        recvWindow: 5000
      };

      const queryString = Object.entries(params)
        .map(([key, value]) => `${key}=${value}`)
        .join('&');

      const signature = this.generateSignature(queryString);

      const response = await axios.get(
        `${this.baseURL}/v3/account`,
        {
          params: { ...params, signature },
          headers: {
            'X-MBX-APIKEY': this.apiKey
          }
        }
      );

      const usdtBalance = response.data.balances.find(b => b.asset === 'USDT');

      return {
        free: parseFloat(usdtBalance?.free || 0),
        locked: parseFloat(usdtBalance?.locked || 0),
        total: parseFloat(usdtBalance?.free || 0) + parseFloat(usdtBalance?.locked || 0)
      };
    } catch (error) {
      logger.error('Binance balance error:', error.response?.data || error.message);
      return { free: 0, locked: 0, total: 0 };
    }
  }

  // Verify transaction on blockchain
  async verifyTransaction(txHash, network = 'BSC') {
    try {
      // This would integrate with BSC scan or blockchain explorer
      // For now, return mock verification
      logger.info(`Verifying transaction: ${txHash} on ${network}`);

      return {
        verified: true,
        confirmations: 12,
        status: 'confirmed'
      };
    } catch (error) {
      logger.error('Transaction verification error:', error.message);
      return {
        verified: false,
        confirmations: 0,
        status: 'pending'
      };
    }
  }
}

module.exports = new BinanceService();
