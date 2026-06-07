const express = require('express');
const { User, Transaction, Referral, Product } = require('../models');
const { Op } = require('sequelize');
const { authenticate, authorize } = require('../middleware/auth');
const logger = require('../utils/logger');

const router = express.Router();

const ADMIN_EXPORT_LIMIT = parseInt(process.env.MAX_EXPORT_ROWS || 10000);
const USER_EXPORT_LIMIT  = 1000;

// Helper function to convert to CSV
function convertToCSV(data, headers) {
  if (!data || data.length === 0) return headers.join(',');

  const headerLine = headers.join(',');
  const dataLines = data.map(row => {
    return headers.map(header => {
      let value = row[header];
      if (value === null || value === undefined) value = '';
      if (typeof value === 'object') value = JSON.stringify(value);
      value = String(value).replace(/"/g, '""'); // Escape quotes
      return `"${value}"`;
    }).join(',');
  });

  return [headerLine, ...dataLines].join('\n');
}

// Export transactions (CSV)
router.get('/transactions/csv', authenticate, authorize(['superadmin', 'admin', 'finance']), async (req, res) => {
  try {
    const {
      type,
      status,
      start_date,
      end_date,
      user_id
    } = req.query;

    const where = {};
    if (type) where.type = type;
    if (status) where.status = status;
    if (user_id) where.user_id = user_id;
    if (start_date || end_date) {
      where.timestamp = {};
      if (start_date) where.timestamp[Op.gte] = new Date(start_date);
      if (end_date) where.timestamp[Op.lte] = new Date(end_date);
    }

    const transactions = await Transaction.findAll({
      where,
      include: [
        { model: User, as: 'user', attributes: ['phone', 'username', 'email'] },
        { model: User, as: 'approver', attributes: ['phone', 'username'] },
        { model: Product, as: 'product', attributes: ['name'] }
      ],
      order: [['timestamp', 'DESC']],
      limit: ADMIN_EXPORT_LIMIT,
      raw: true,
      nest: true
    });

    if (transactions.length === ADMIN_EXPORT_LIMIT) {
      res.setHeader('X-Export-Truncated', 'true');
      res.setHeader('X-Export-Limit', String(ADMIN_EXPORT_LIMIT));
    }

    // Format data for CSV
    const formattedData = transactions.map(t => ({
      Transaction_ID: t.id.toString(),
      Date: new Date(t.timestamp).toISOString(),
      Type: t.type,
      User_Phone: t.user?.phone || 'N/A',
      User_Name: t.user?.username || 'N/A',
      Amount_NSL: t.amount_NSL,
      Amount_USDT: t.amount_usdt,
      Status: t.status,
      Payment_Method: t.payment_method || 'N/A',
      Withdrawal_Address: t.withdrawal_address || 'N/A',
      Approved_By: t.approver?.phone || 'N/A',
      Notes: t.notes || '',
      Completed_At: t.completed_at ? new Date(t.completed_at).toISOString() : 'N/A'
    }));

    const headers = [
      'Transaction_ID',
      'Date',
      'Type',
      'User_Phone',
      'User_Name',
      'Amount_NSL',
      'Amount_USDT',
      'Status',
      'Payment_Method',
      'Withdrawal_Address',
      'Approved_By',
      'Notes',
      'Completed_At'
    ];

    const csv = convertToCSV(formattedData, headers);

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename=transactions_${Date.now()}.csv`);
    res.send(csv);

    logger.info(`Transaction export by ${req.user.phone}: ${transactions.length} records`);
  } catch (error) {
    logger.error('Transaction export error:', error);
    res.status(500).json({ message: 'Error exporting transactions', error: error.message });
  }
});

// Export users (CSV)
router.get('/users/csv', authenticate, authorize(['superadmin', 'admin']), async (req, res) => {
  try {
    const { status, vip_level, start_date, end_date } = req.query;

    const where = {};
    if (status) where.status = status;
    if (vip_level) where.vip_level = vip_level;
    if (start_date || end_date) {
      where.created_at = {};
      if (start_date) where.created_at[Op.gte] = new Date(start_date);
      if (end_date) where.created_at[Op.lte] = new Date(end_date);
    }

    const users = await User.findAll({
      where,
      attributes: { exclude: ['password_hash'] },
      order: [['created_at', 'DESC']],
      limit: ADMIN_EXPORT_LIMIT,
      raw: true
    });

    if (users.length === ADMIN_EXPORT_LIMIT) {
      res.setHeader('X-Export-Truncated', 'true');
      res.setHeader('X-Export-Limit', String(ADMIN_EXPORT_LIMIT));
    }

    const formattedData = users.map(u => ({
      User_ID: u.id.toString(),
      Username: u.username,
      Phone: u.phone,
      Email: u.email || 'N/A',
      Balance_NSL: u.balance_NSL,
      Balance_USDT: u.balance_usdt,
      VIP_Level: u.vip_level,
      Status: u.status,
      Role: u.role,
      Referral_Code: u.referral_code,
      Referred_By: u.referred_by || 'N/A',
      KYC_Verified: u.kyc_verified ? 'Yes' : 'No',
      Created_At: new Date(u.created_at).toISOString(),
      Last_Login: u.last_login ? new Date(u.last_login).toISOString() : 'Never'
    }));

    const headers = [
      'User_ID',
      'Username',
      'Phone',
      'Email',
      'Balance_NSL',
      'Balance_USDT',
      'VIP_Level',
      'Status',
      'Role',
      'Referral_Code',
      'Referred_By',
      'KYC_Verified',
      'Created_At',
      'Last_Login'
    ];

    const csv = convertToCSV(formattedData, headers);

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename=users_${Date.now()}.csv`);
    res.send(csv);

    logger.info(`User export by ${req.user.phone}: ${users.length} records`);
  } catch (error) {
    logger.error('User export error:', error);
    res.status(500).json({ message: 'Error exporting users', error: error.message });
  }
});

// Export referrals (CSV)
router.get('/referrals/csv', authenticate, authorize(['superadmin', 'admin']), async (req, res) => {
  try {
    const { status, start_date, end_date } = req.query;

    const where = {};
    if (status) where.status = status;
    if (start_date || end_date) {
      where.timestamp = {};
      if (start_date) where.timestamp[Op.gte] = new Date(start_date);
      if (end_date) where.timestamp[Op.lte] = new Date(end_date);
    }

    const referrals = await Referral.findAll({
      where,
      include: [
        { model: User, as: 'referrer', attributes: ['phone', 'username'] },
        { model: User, as: 'referred', attributes: ['phone', 'username'] }
      ],
      order: [['timestamp', 'DESC']],
      limit: ADMIN_EXPORT_LIMIT,
      raw: true,
      nest: true
    });

    if (referrals.length === ADMIN_EXPORT_LIMIT) {
      res.setHeader('X-Export-Truncated', 'true');
      res.setHeader('X-Export-Limit', String(ADMIN_EXPORT_LIMIT));
    }

    const formattedData = referrals.map(r => ({
      Referral_ID: r.id.toString(),
      Referrer_Phone: r.referrer?.phone || 'N/A',
      Referrer_Name: r.referrer?.username || 'N/A',
      Referred_Phone: r.referred?.phone || 'N/A',
      Referred_Name: r.referred?.username || 'N/A',
      Bonus_NSL: r.bonus_NSL,
      Recharge_Amount_NSL: r.recharge_amount_NSL,
      Bonus_Percentage: r.bonus_percentage,
      Status: r.status,
      Date: new Date(r.timestamp).toISOString()
    }));

    const headers = [
      'Referral_ID',
      'Referrer_Phone',
      'Referrer_Name',
      'Referred_Phone',
      'Referred_Name',
      'Bonus_NSL',
      'Recharge_Amount_NSL',
      'Bonus_Percentage',
      'Status',
      'Date'
    ];

    const csv = convertToCSV(formattedData, headers);

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename=referrals_${Date.now()}.csv`);
    res.send(csv);

    logger.info(`Referral export by ${req.user.phone}: ${referrals.length} records`);
  } catch (error) {
    logger.error('Referral export error:', error);
    res.status(500).json({ message: 'Error exporting referrals', error: error.message });
  }
});

// Export user's own transactions
router.get('/my-transactions/csv', authenticate, async (req, res) => {
  try {
    const transactions = await Transaction.findAll({
      where: { user_id: req.user.id },
      include: [
        { model: Product, as: 'product', attributes: ['name'] }
      ],
      order: [['timestamp', 'DESC']],
      limit: USER_EXPORT_LIMIT,
      raw: true,
      nest: true
    });

    if (transactions.length === USER_EXPORT_LIMIT) {
      res.setHeader('X-Export-Truncated', 'true');
      res.setHeader('X-Export-Limit', String(USER_EXPORT_LIMIT));
    }

    const formattedData = transactions.map(t => ({
      Transaction_ID: t.id.toString(),
      Date: new Date(t.timestamp).toISOString(),
      Type: t.type,
      Amount_NSL: t.amount_NSL,
      Amount_USDT: t.amount_usdt,
      Status: t.status,
      Product: t.product?.name || 'N/A',
      Notes: t.notes || '',
      Completed_At: t.completed_at ? new Date(t.completed_at).toISOString() : 'Pending'
    }));

    const headers = [
      'Transaction_ID',
      'Date',
      'Type',
      'Amount_NSL',
      'Amount_USDT',
      'Status',
      'Product',
      'Notes',
      'Completed_At'
    ];

    const csv = convertToCSV(formattedData, headers);

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename=my_transactions_${Date.now()}.csv`);
    res.send(csv);

    logger.info(`Personal transaction export by user ${req.user.id}: ${transactions.length} records`);
  } catch (error) {
    logger.error('Personal transaction export error:', error);
    res.status(500).json({ message: 'Error exporting transactions', error: error.message });
  }
});

module.exports = router;
