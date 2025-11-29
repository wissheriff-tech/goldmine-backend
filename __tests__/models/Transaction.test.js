const Transaction = require('../../models/Transaction');
const { createTestUser, createTestProduct } = require('../helpers/testUtils');

describe('Transaction Model', () => {
  let testUser;
  let testProduct;

  beforeEach(async () => {
    testUser = await createTestUser();
    testProduct = await createTestProduct();
  });

  describe('Transaction Creation', () => {
    it('should create a transaction with valid data', async () => {
      const transaction = await Transaction.create({
        user_id: testUser._id,
        type: 'recharge',
        amount_NSL: 1000,
        amount_usdt: 40,
        status: 'pending'
      });

      expect(transaction).toBeDefined();
      expect(transaction.user_id.toString()).toBe(testUser._id.toString());
      expect(transaction.type).toBe('recharge');
      expect(transaction.amount_NSL).toBe(1000);
      expect(transaction.status).toBe('pending');
    });

    it('should not create transaction without required fields', async () => {
      const transaction = new Transaction({});

      await expect(transaction.save()).rejects.toThrow();
    });

    it('should not create transaction without user_id', async () => {
      const transaction = new Transaction({
        type: 'recharge',
        amount_NSL: 1000
      });

      await expect(transaction.save()).rejects.toThrow();
    });

    it('should not create transaction without type', async () => {
      const transaction = new Transaction({
        user_id: testUser._id,
        amount_NSL: 1000
      });

      await expect(transaction.save()).rejects.toThrow();
    });
  });

  describe('Transaction Types', () => {
    const validTypes = ['recharge', 'withdrawal', 'income', 'referral_bonus', 'purchase', 'renewal'];

    it.each(validTypes)('should accept valid type: %s', async (type) => {
      const transaction = await Transaction.create({
        user_id: testUser._id,
        type,
        amount_NSL: 100
      });

      expect(transaction.type).toBe(type);
    });

    it('should not accept invalid type', async () => {
      const transaction = new Transaction({
        user_id: testUser._id,
        type: 'invalid_type',
        amount_NSL: 100
      });

      await expect(transaction.save()).rejects.toThrow();
    });
  });

  describe('Transaction Status', () => {
    const validStatuses = ['pending', 'approved', 'rejected', 'completed'];

    it.each(validStatuses)('should accept valid status: %s', async (status) => {
      const transaction = await Transaction.create({
        user_id: testUser._id,
        type: 'recharge',
        amount_NSL: 100,
        status
      });

      expect(transaction.status).toBe(status);
    });

    it('should have default status of "pending"', async () => {
      const transaction = await Transaction.create({
        user_id: testUser._id,
        type: 'recharge',
        amount_NSL: 100
      });

      expect(transaction.status).toBe('pending');
    });

    it('should not accept invalid status', async () => {
      const transaction = new Transaction({
        user_id: testUser._id,
        type: 'recharge',
        amount_NSL: 100,
        status: 'invalid_status'
      });

      await expect(transaction.save()).rejects.toThrow();
    });
  });

  describe('Amount Validation', () => {
    it('should not allow negative amount_NSL', async () => {
      const transaction = new Transaction({
        user_id: testUser._id,
        type: 'recharge',
        amount_NSL: -100
      });

      await expect(transaction.save()).rejects.toThrow();
    });

    it('should not allow negative amount_usdt', async () => {
      const transaction = new Transaction({
        user_id: testUser._id,
        type: 'recharge',
        amount_usdt: -50
      });

      await expect(transaction.save()).rejects.toThrow();
    });

    it('should allow zero amounts', async () => {
      const transaction = await Transaction.create({
        user_id: testUser._id,
        type: 'recharge',
        amount_NSL: 0,
        amount_usdt: 0
      });

      expect(transaction.amount_NSL).toBe(0);
      expect(transaction.amount_usdt).toBe(0);
    });
  });

  describe('Payment Methods', () => {
    const validMethods = ['binance', 'manual', 'crypto_wallet'];

    it.each(validMethods)('should accept valid payment method: %s', async (method) => {
      const transaction = await Transaction.create({
        user_id: testUser._id,
        type: 'recharge',
        amount_NSL: 100,
        payment_method: method
      });

      expect(transaction.payment_method).toBe(method);
    });

    it('should have default payment_method of "binance"', async () => {
      const transaction = await Transaction.create({
        user_id: testUser._id,
        type: 'recharge',
        amount_NSL: 100
      });

      expect(transaction.payment_method).toBe('binance');
    });

    it('should not accept invalid payment method', async () => {
      const transaction = new Transaction({
        user_id: testUser._id,
        type: 'recharge',
        amount_NSL: 100,
        payment_method: 'invalid_method'
      });

      await expect(transaction.save()).rejects.toThrow();
    });
  });

  describe('Product Reference', () => {
    it('should allow product_id for purchase transactions', async () => {
      const transaction = await Transaction.create({
        user_id: testUser._id,
        type: 'purchase',
        product_id: testProduct._id,
        amount_NSL: 500
      });

      expect(transaction.product_id.toString()).toBe(testProduct._id.toString());
    });

    it('should allow null product_id', async () => {
      const transaction = await Transaction.create({
        user_id: testUser._id,
        type: 'recharge',
        amount_NSL: 100
      });

      expect(transaction.product_id).toBeNull();
    });
  });

  describe('Binance Fields', () => {
    it('should store Binance transaction details', async () => {
      const transaction = await Transaction.create({
        user_id: testUser._id,
        type: 'recharge',
        amount_usdt: 50,
        payment_method: 'binance',
        binance_tx_id: 'TXN123456',
        deposit_address: '0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb',
        deposit_network: 'BSC'
      });

      expect(transaction.binance_tx_id).toBe('TXN123456');
      expect(transaction.deposit_address).toBe('0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb');
      expect(transaction.deposit_network).toBe('BSC');
    });

    it('should store withdrawal details', async () => {
      const transaction = await Transaction.create({
        user_id: testUser._id,
        type: 'withdrawal',
        amount_usdt: 100,
        binance_withdraw_id: 'WD123456',
        withdrawal_address: '0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb',
        withdrawal_network: 'BSC'
      });

      expect(transaction.binance_withdraw_id).toBe('WD123456');
      expect(transaction.withdrawal_address).toBe('0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb');
      expect(transaction.withdrawal_network).toBe('BSC');
    });

    it('should have default network of "BSC"', async () => {
      const transaction = await Transaction.create({
        user_id: testUser._id,
        type: 'withdrawal',
        amount_usdt: 50
      });

      expect(transaction.deposit_network).toBe('BSC');
      expect(transaction.withdrawal_network).toBe('BSC');
    });
  });

  describe('Transaction Approval', () => {
    it('should store approved_by admin reference', async () => {
      const admin = await createTestUser({ role: 'admin', username: 'admin1' });

      const transaction = await Transaction.create({
        user_id: testUser._id,
        type: 'recharge',
        amount_NSL: 1000,
        status: 'approved',
        approved_by: admin._id
      });

      expect(transaction.approved_by.toString()).toBe(admin._id.toString());
    });

    it('should store admin notes', async () => {
      const transaction = await Transaction.create({
        user_id: testUser._id,
        type: 'withdrawal',
        amount_NSL: 500,
        status: 'rejected',
        admin_notes: 'Insufficient verification'
      });

      expect(transaction.admin_notes).toBe('Insufficient verification');
    });
  });

  describe('Timestamps', () => {
    it('should have default timestamp', async () => {
      const transaction = await Transaction.create({
        user_id: testUser._id,
        type: 'recharge',
        amount_NSL: 100
      });

      expect(transaction.timestamp).toBeDefined();
      expect(transaction.timestamp).toBeInstanceOf(Date);
    });

    it('should store completed_at when completed', async () => {
      const completedDate = new Date();
      const transaction = await Transaction.create({
        user_id: testUser._id,
        type: 'recharge',
        amount_NSL: 100,
        status: 'completed',
        completed_at: completedDate
      });

      expect(transaction.completed_at).toBeDefined();
      expect(transaction.completed_at.getTime()).toBe(completedDate.getTime());
    });

    it('should store rejected_at when rejected', async () => {
      const rejectedDate = new Date();
      const transaction = await Transaction.create({
        user_id: testUser._id,
        type: 'withdrawal',
        amount_NSL: 100,
        status: 'rejected',
        rejected_at: rejectedDate
      });

      expect(transaction.rejected_at).toBeDefined();
      expect(transaction.rejected_at.getTime()).toBe(rejectedDate.getTime());
    });
  });

  describe('Confirmations', () => {
    it('should have default confirmations of 0', async () => {
      const transaction = await Transaction.create({
        user_id: testUser._id,
        type: 'recharge',
        amount_usdt: 50
      });

      expect(transaction.confirmations).toBe(0);
    });

    it('should update confirmations count', async () => {
      const transaction = await Transaction.create({
        user_id: testUser._id,
        type: 'recharge',
        amount_usdt: 50
      });

      transaction.confirmations = 12;
      await transaction.save();

      const updated = await Transaction.findById(transaction._id);
      expect(updated.confirmations).toBe(12);
    });
  });

  describe('Payment Proof', () => {
    it('should store payment proof URL', async () => {
      const transaction = await Transaction.create({
        user_id: testUser._id,
        type: 'recharge',
        amount_NSL: 1000,
        payment_method: 'manual',
        payment_proof: 'https://example.com/uploads/proof123.jpg'
      });

      expect(transaction.payment_proof).toBe('https://example.com/uploads/proof123.jpg');
    });
  });

  describe('Query Operations', () => {
    beforeEach(async () => {
      await Transaction.create({
        user_id: testUser._id,
        type: 'recharge',
        amount_NSL: 1000,
        status: 'approved'
      });

      await Transaction.create({
        user_id: testUser._id,
        type: 'withdrawal',
        amount_NSL: 500,
        status: 'pending'
      });

      await Transaction.create({
        user_id: testUser._id,
        type: 'income',
        amount_NSL: 10,
        status: 'completed'
      });
    });

    it('should find transactions by user_id', async () => {
      const transactions = await Transaction.find({ user_id: testUser._id });

      expect(transactions).toHaveLength(3);
    });

    it('should find transactions by type', async () => {
      const transactions = await Transaction.find({ type: 'recharge' });

      expect(transactions).toHaveLength(1);
      expect(transactions[0].type).toBe('recharge');
    });

    it('should find transactions by status', async () => {
      const transactions = await Transaction.find({ status: 'pending' });

      expect(transactions).toHaveLength(1);
      expect(transactions[0].status).toBe('pending');
    });

    it('should find transactions with multiple filters', async () => {
      const transactions = await Transaction.find({
        user_id: testUser._id,
        type: 'withdrawal',
        status: 'pending'
      });

      expect(transactions).toHaveLength(1);
      expect(transactions[0].type).toBe('withdrawal');
      expect(transactions[0].status).toBe('pending');
    });
  });
});
