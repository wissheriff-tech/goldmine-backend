const Transaction = require('../../models/Transaction');
const { createTestUser, createTestProduct } = require('../helpers/testUtils');

describe('Transaction Model', () => {
  let testUser;
  let testProduct;

  beforeEach(async () => {
    testUser = await createTestUser();
    testProduct = await createTestProduct();
  });

  describe('creation and defaults', () => {
    it('creates a transaction with valid SQL references', async () => {
      const transaction = await Transaction.create({
        user_id: testUser.id,
        product_id: testProduct.id,
        type: 'recharge',
        amount_NSL: 1000,
        amount_usdt: 40,
        status: 'pending'
      });

      expect(transaction.id).toBeDefined();
      expect(transaction.user_id).toBe(testUser.id);
      expect(transaction.product_id).toBe(testProduct.id);
      expect(transaction.type).toBe('recharge');
      expect(transaction.amount_NSL).toBe(1000);
      expect(transaction.status).toBe('pending');
    });

    it('rejects missing required fields', async () => {
      await expect(Transaction.create({})).rejects.toThrow();
      await expect(Transaction.create({ type: 'recharge', amount_NSL: 1000 })).rejects.toThrow();
      await expect(Transaction.create({ user_id: testUser.id, amount_NSL: 1000 })).rejects.toThrow();
    });

    it('sets default payment and confirmation fields', async () => {
      const transaction = await Transaction.create({
        user_id: testUser.id,
        type: 'withdrawal',
        amount_usdt: 50
      });

      expect(transaction.payment_method).toBe('binance');
      expect(transaction.deposit_network).toBe('BSC');
      expect(transaction.withdrawal_network).toBe('BSC');
      expect(transaction.confirmations).toBe(0);
      expect(transaction.timestamp).toBeDefined();
    });
  });

  describe('transaction values', () => {
    it.each(['recharge', 'withdrawal', 'income', 'referral_bonus', 'purchase', 'renewal'])(
      'stores valid type: %s',
      async (type) => {
        const transaction = await Transaction.create({
          user_id: testUser.id,
          type,
          amount_NSL: 100
        });

        expect(transaction.type).toBe(type);
      }
    );

    it.each(['pending', 'approved', 'rejected', 'completed'])(
      'stores valid status: %s',
      async (status) => {
        const transaction = await Transaction.create({
          user_id: testUser.id,
          type: 'recharge',
          amount_NSL: 100,
          status
        });

        expect(transaction.status).toBe(status);
      }
    );
  });

  describe('admin and payment fields', () => {
    it('stores approval details', async () => {
      const admin = await createTestUser({ role: 'admin', username: 'admin1', phone: '+1234567899' });

      const transaction = await Transaction.create({
        user_id: testUser.id,
        type: 'recharge',
        amount_NSL: 1000,
        status: 'approved',
        approved_by: admin.id,
        approved_at: new Date(),
        admin_notes: 'Approved after review'
      });

      expect(transaction.approved_by).toBe(admin.id);
      expect(transaction.approved_at).toBeDefined();
      expect(transaction.admin_notes).toBe('Approved after review');
    });

    it('stores transfer details and proof', async () => {
      const transaction = await Transaction.create({
        user_id: testUser.id,
        type: 'withdrawal',
        amount_usdt: 100,
        binance_tx_id: 'tx-123',
        binance_withdraw_id: 'withdraw-123',
        withdrawal_address: 'wallet-address',
        payment_proof: '/uploads/proof.jpg'
      });

      expect(transaction.binance_tx_id).toBe('tx-123');
      expect(transaction.binance_withdraw_id).toBe('withdraw-123');
      expect(transaction.withdrawal_address).toBe('wallet-address');
      expect(transaction.payment_proof).toBe('/uploads/proof.jpg');
    });
  });

  describe('queries', () => {
    beforeEach(async () => {
      await Transaction.bulkCreate([
        { user_id: testUser.id, type: 'recharge', amount_NSL: 1000, status: 'pending' },
        { user_id: testUser.id, type: 'withdrawal', amount_NSL: 500, status: 'approved' },
        { user_id: testUser.id, type: 'income', amount_NSL: 50, status: 'completed' }
      ]);
    });

    it('finds transactions by user_id', async () => {
      const transactions = await Transaction.findAll({ where: { user_id: testUser.id } });

      expect(transactions).toHaveLength(3);
    });

    it('finds transactions by type and status', async () => {
      const transactions = await Transaction.findAll({
        where: { user_id: testUser.id, type: 'withdrawal', status: 'approved' }
      });

      expect(transactions).toHaveLength(1);
      expect(transactions[0].amount_NSL).toBe(500);
    });
  });
});
