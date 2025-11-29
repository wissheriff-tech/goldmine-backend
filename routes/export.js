const express = require('express');
const Transaction = require('../models/Transaction');
const User = require('../models/User');
const Referral = require('../models/Referral');
const { authenticate, authorize } = require('../middleware/auth');
const logger = require('../utils/logger');

const router = express.Router();

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

    const filter = {};
    if (type) filter.type = type;
    if (status) filter.status = status;
    if (user_id) filter.user_id = user_id;
    if (start_date || end_date) {
      filter.timestamp = {};
      if (start_date) filter.timestamp.$gte = new Date(start_date);
      if (end_date) filter.timestamp.$lte = new Date(end_date);
    }

    const transactions = await Transaction.find(filter)
      .populate('user_id', 'phone username email')
      .populate('approved_by', 'phone username')
      .populate('product_id', 'name')
      .sort({ timestamp: -1 })
      .lean();

    // Format data for CSV
    const formattedData = transactions.map(t => ({
      Transaction_ID: t._id.toString(),
      Date: new Date(t.timestamp).toISOString(),
      Type: t.type,
      User_Phone: t.user_id?.phone || 'N/A',
      User_Name: t.user_id?.username || 'N/A',
      Amount_NSL: t.amount_NSL,
      Amount_USDT: t.amount_usdt,
      Status: t.status,
      Payment_Method: t.payment_method || 'N/A',
      Withdrawal_Address: t.withdrawal_address || 'N/A',
      Approved_By: t.approved_by?.phone || 'N/A',
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

    const filter = {};
    if (status) filter.status = status;
    if (vip_level) filter.vip_level = vip_level;
    if (start_date || end_date) {
      filter.created_at = {};
      if (start_date) filter.created_at.$gte = new Date(start_date);
      if (end_date) filter.created_at.$lte = new Date(end_date);
    }

    const users = await User.find(filter)
      .select('-password_hash')
      .sort({ created_at: -1 })
      .lean();

    const formattedData = users.map(u => ({
      User_ID: u._id.toString(),
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

    const filter = {};
    if (status) filter.status = status;
    if (start_date || end_date) {
      filter.timestamp = {};
      if (start_date) filter.timestamp.$gte = new Date(start_date);
      if (end_date) filter.timestamp.$lte = new Date(end_date);
    }

    const referrals = await Referral.find(filter)
      .populate('referrer_id', 'phone username')
      .populate('referred_id', 'phone username')
      .sort({ timestamp: -1 })
      .lean();

    const formattedData = referrals.map(r => ({
      Referral_ID: r._id.toString(),
      Referrer_Phone: r.referrer_id?.phone || 'N/A',
      Referrer_Name: r.referrer_id?.username || 'N/A',
      Referred_Phone: r.referred_id?.phone || 'N/A',
      Referred_Name: r.referred_id?.username || 'N/A',
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
    const transactions = await Transaction.find({ user_id: req.user.id })
      .populate('product_id', 'name')
      .sort({ timestamp: -1 })
      .lean();

    const formattedData = transactions.map(t => ({
      Transaction_ID: t._id.toString(),
      Date: new Date(t.timestamp).toISOString(),
      Type: t.type,
      Amount_NSL: t.amount_NSL,
      Amount_USDT: t.amount_usdt,
      Status: t.status,
      Product: t.product_id?.name || 'N/A',
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
