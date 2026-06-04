const express = require('express');
const { Op } = require('sequelize');
const { sequelize } = require('../models');
const User = require('../models/User');
const { FEE } = require('../config/constants');
const Transaction = require('../models/Transaction');
const Referral = require('../models/Referral');
const Product = require('../models/Product');
const UserProduct = require('../models/UserProduct');
const { authenticate } = require('../middleware/auth');
const logger = require('../utils/logger');
const { profileUpload, paymentUpload, kycUpload } = require('../middleware/upload');
const path = require('path');
const fs = require('fs');

// Validation and Security Middleware
const {
  validateRecharge,
  validateWithdraw,
  validateUpdateProfile
} = require('../middleware/validation');

const { transactionLimiter } = require('../middleware/security');

const router = express.Router();

// Get user dashboard
router.get('/dashboard', authenticate, async (req, res) => {
  try {
    const user = await User.findByPk(req.user.id);

    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    const userProducts = await UserProduct.findAll({
      where: { user_id: user.id, is_active: true },
      include: [{ model: Product, as: 'product' }]
    });

    const referralCount = await Referral.count({ where: { referrer_id: user.id } });
    const totalReferralEarnings = await Referral.sum('bonus_NSL', {
      where: { referrer_id: user.id, status: 'paid' }
    });

    res.json({
      user: {
        id: user.id,
        phone: user.phone,
        username: user.username,
        role: user.role,
        balance_NSL: user.balance_NSL,
        balance_usdt: user.balance_usdt,
        vip_level: user.vip_level,
        referral_code: user.referral_code,
        referred_by: user.referred_by,
        status: user.status,
        kyc_verified: user.kyc_verified,
        created_at: user.created_at,
        profile_photo: user.profile_photo
      },
      products: userProducts,
      referrals: {
        count: referralCount,
        total_earnings_NSL: totalReferralEarnings || 0
      }
    });
  } catch (error) {
    logger.error('Dashboard error:', error);
    res.status(500).json({ message: 'Error fetching dashboard', error: error.message });
  }
});

// Get transactions
router.get('/transactions', authenticate, async (req, res) => {
  try {
    const { type, status, limit = 20, skip = 0 } = req.query;
    const where = { user_id: req.user.id };

    if (type) where.type = type;
    if (status) where.status = status;

    const { count: total, rows: transactions } = await Transaction.findAndCountAll({
      where,
      order: [['timestamp', 'DESC']],
      limit: parseInt(limit),
      offset: parseInt(skip),
      include: [{ model: User, as: 'approver', attributes: ['phone'] }]
    });

    res.json({
      transactions,
      pagination: {
        total,
        limit: parseInt(limit),
        skip: parseInt(skip)
      }
    });
  } catch (error) {
    logger.error('Transaction fetch error:', error);
    res.status(500).json({ message: 'Error fetching transactions', error: error.message });
  }
});


// Request recharge
router.post('/recharge', authenticate, transactionLimiter, validateRecharge, async (req, res) => {
  try {
    const { amount_NSL, payment_method, deposit_address, tx_hash } = req.body;
    const user = await User.findByPk(req.user.id);

    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    // Ensure amount_NSL is a valid number
    const amountNSL = Number(amount_NSL);
    if (isNaN(amountNSL) || amountNSL <= 0) {
      return res.status(400).json({ message: 'Invalid amount' });
    }

    if (amountNSL < 100) {
      return res.status(400).json({ message: 'Minimum recharge amount is 100 NSL' });
    }

    // Calculate amount_usdt as a number, not string
    const conversionRate = parseInt(process.env.NSL_TO_USDT_RECHARGE || 25);
    const amount_usdt = parseFloat((amountNSL / conversionRate).toFixed(2));

    const transaction = await Transaction.create({
      user_id: user.id,
      type: 'recharge',
      amount_NSL: amountNSL,
      amount_usdt,
      status: 'pending',
      payment_method: payment_method || 'binance',
      deposit_address,
      binance_tx_id: tx_hash,
      notes: `Recharge request for ${amountNSL} NSL via ${payment_method || 'Binance'}`
    });

    logger.info(`Recharge requested: ${user.phone || user.id} - ${amountNSL} NSL via ${payment_method}`);

    res.status(201).json({
      message: 'Recharge request submitted successfully! Finance admin will verify and approve your payment.',
      transaction: {
        id: transaction.id,
        amount_NSL: amountNSL,
        amount_usdt,
        status: 'pending',
        payment_method,
        timestamp: transaction.timestamp
      }
    });
  } catch (error) {
    logger.error('Recharge error:', error);
    res.status(500).json({ message: 'Error processing recharge', error: error.message });
  }
});

// Calculate withdrawal fees (preview)
router.post('/withdraw/calculate-fee', authenticate, async (req, res) => {
  try {
    const { amount_NSL } = req.body;
    const user = await User.findByPk(req.user.id);

    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    if (!amount_NSL || amount_NSL <= 0) {
      return res.status(400).json({ message: 'Invalid amount' });
    }

    const minWithdrawal = parseInt(process.env.MIN_WITHDRAWAL_AMOUNT_NSL || 100);

    if (amount_NSL < minWithdrawal) {
      return res.status(400).json({
        message: `Minimum withdrawal amount is ${minWithdrawal} NSL`,
        min_withdrawal: minWithdrawal
      });
    }

    // Calculate fee: 15% for standard users, 0% for super admin
    let withdrawalFee = 0;
    let netAmount = amount_NSL;

    if (user.role !== 'superadmin') {
      withdrawalFee = (amount_NSL * FEE.WITHDRAWAL_FEE_PERCENTAGE) / 100;
      netAmount = amount_NSL - withdrawalFee;
    }

    const amount_usdt = (netAmount / parseInt(process.env.USDT_TO_NSL_WITHDRAWAL || 25)).toFixed(2);

    res.json({
      requested_amount_NSL: amount_NSL,
      user_role: user.role,
      fee_breakdown: {
        fee_percentage: user.role === 'superadmin' ? '0%' : `${FEE.WITHDRAWAL_FEE_PERCENTAGE}%`,
        fee_amount: withdrawalFee.toFixed(2),
        is_exempt: user.role === 'superadmin'
      },
      net_amount_NSL: netAmount.toFixed(2),
      net_amount_usdt: amount_usdt,
      conversion_rate: `1 NSL = ${(1 / parseInt(process.env.USDT_TO_NSL_WITHDRAWAL || 25)).toFixed(4)} USDT`
    });
  } catch (error) {
    logger.error('Fee calculation error:', error);
    res.status(500).json({ message: 'Error calculating fees', error: error.message });
  }
});

// Request withdrawal
router.post('/withdraw', authenticate, transactionLimiter, validateWithdraw, async (req, res) => {
  try {
    const { amount_NSL, withdrawal_address, network } = req.body;
    const user = await User.findByPk(req.user.id);

    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    if (!withdrawal_address) {
      return res.status(400).json({ message: 'Withdrawal address is required' });
    }

    const minWithdrawal = parseInt(process.env.MIN_WITHDRAWAL_AMOUNT_NSL || 100);
    if (amount_NSL < minWithdrawal) {
      return res.status(400).json({ message: `Minimum withdrawal amount is ${minWithdrawal} NSL` });
    }

    // Calculate withdrawal fee (15% for standard users, 0% for super admin)
    let withdrawalFee = 0;
    let netAmount = amount_NSL;

    if (user.role !== 'superadmin') {
      withdrawalFee = (amount_NSL * FEE.WITHDRAWAL_FEE_PERCENTAGE) / 100;
      netAmount = amount_NSL - withdrawalFee;
    }

    const totalDeduction = amount_NSL;

    // Check if user has sufficient balance
    if (totalDeduction > user.balance_NSL) {
      return res.status(400).json({
        message: 'Insufficient balance to cover withdrawal amount and fees',
        required_balance: totalDeduction,
        current_balance: user.balance_NSL,
        fee_breakdown: {
          withdrawal_amount: amount_NSL,
          fee_percentage: user.role === 'superadmin' ? '0%' : `${FEE.WITHDRAWAL_FEE_PERCENTAGE}%`,
          fee_amount: withdrawalFee.toFixed(2),
          net_amount: netAmount.toFixed(2)
        }
      });
    }

    if (netAmount <= 0) {
      return res.status(400).json({ message: 'Withdrawal amount too small to cover fees' });
    }

    const amount_usdt = (netAmount / parseInt(process.env.USDT_TO_NSL_WITHDRAWAL || 25)).toFixed(2);

    const transaction = await Transaction.create({
      user_id: user.id,
      type: 'withdrawal',
      amount_NSL: netAmount,
      amount_usdt,
      status: 'pending',
      withdrawal_address,
      withdrawal_network: network || 'BSC',
      payment_method: 'binance',
      notes: `Withdrawal: ${amount_NSL} NSL (Fee: ${withdrawalFee.toFixed(2)} NSL, Net: ${netAmount.toFixed(2)} NSL) to ${withdrawal_address}`
    });

    logger.info(`Withdrawal requested: ${user.phone || user.id} - ${amount_NSL} NSL (Net: ${netAmount} NSL, Fee: ${withdrawalFee.toFixed(2)} NSL) to ${withdrawal_address}`);

    res.status(201).json({
      message: 'Withdrawal request submitted! Finance admin will process your withdrawal within 24 hours.',
      transaction: {
        id: transaction.id,
        requested_amount_NSL: amount_NSL,
        fee_NSL: withdrawalFee.toFixed(2),
        net_amount_NSL: netAmount.toFixed(2),
        amount_usdt,
        withdrawal_address,
        network: network || 'BSC',
        status: 'pending',
        timestamp: transaction.timestamp
      },
      fee_breakdown: {
        percentage: `${FEE.WITHDRAWAL_FEE_PERCENTAGE}%`,
        fee_amount: withdrawalFee.toFixed(2),
        is_exempt: user.role === 'superadmin'
      }
    });
  } catch (error) {
    logger.error('Withdrawal error:', error);
    res.status(500).json({ message: 'Error processing withdrawal', error: error.message });
  }
});

// Get referrals
router.get('/referrals', authenticate, async (req, res) => {
  try {
    const referrals = await Referral.findAll({
      where: { referrer_id: req.user.id },
      include: [{ model: User, as: 'referred', attributes: ['phone', 'balance_NSL', 'created_at'] }],
      order: [['timestamp', 'DESC']]
    });

    const pendingCount = await Referral.count({
      where: { referrer_id: req.user.id, status: 'pending' }
    });

    const totalEarned = referrals.reduce((sum, ref) => sum + (ref.status === 'paid' ? ref.bonus_NSL : 0), 0);

    const stats = {
      total_referrals: referrals.length,
      pending_bonuses: pendingCount,
      total_earned_NSL: totalEarned
    };

    res.json({
      referrals,
      stats
    });
  } catch (error) {
    logger.error('Referrals fetch error:', error);
    res.status(500).json({ message: 'Error fetching referrals', error: error.message });
  }
});

// Get referral leaderboard
router.get('/referrals/leaderboard', authenticate, async (req, res) => {
  try {
    const { period = 'all', limit = 50 } = req.query;

    // Calculate date filter based on period
    let dateFilter = {};
    const now = new Date();

    if (period === 'today') {
      dateFilter = { [Op.gte]: new Date(now.getFullYear(), now.getMonth(), now.getDate()) };
    } else if (period === 'week') {
      dateFilter = { [Op.gte]: new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000) };
    } else if (period === 'month') {
      dateFilter = { [Op.gte]: new Date(now.getFullYear(), now.getMonth(), 1) };
    }

    const whereClause = { status: 'paid' };
    if (period !== 'all') {
      whereClause.timestamp = dateFilter;
    }

    // Get top referrers using Sequelize grouping
    const leaderboardData = await Referral.findAll({
      where: whereClause,
      attributes: [
        'referrer_id',
        [sequelize.fn('COUNT', sequelize.col('Referral.id')), 'total_referrals'],
        [sequelize.fn('SUM', sequelize.col('bonus_NSL')), 'total_earnings']
      ],
      include: [{
        model: User,
        as: 'referrer',
        attributes: ['username', 'vip_level']
      }],
      group: ['referrer_id', 'referrer.id'],
      order: [[sequelize.fn('SUM', sequelize.col('bonus_NSL')), 'DESC']],
      limit: parseInt(limit)
    });

    const rankedLeaderboard = leaderboardData.map((entry, index) => ({
      rank: index + 1,
      user_id: entry.referrer_id,
      username: entry.referrer?.username,
      vip_level: entry.referrer?.vip_level,
      total_referrals: parseInt(entry.getDataValue('total_referrals')) || 0,
      total_earnings: parseFloat(entry.getDataValue('total_earnings')) || 0
    }));

    // Find current user's stats
    const userStats = await Referral.findOne({
      where: { ...whereClause, referrer_id: req.user.id },
      attributes: [
        [sequelize.fn('COUNT', sequelize.col('id')), 'total_referrals'],
        [sequelize.fn('SUM', sequelize.col('bonus_NSL')), 'total_earnings']
      ]
    });

    const userTotalEarnings = parseFloat(userStats?.getDataValue('total_earnings')) || 0;
    const userTotalReferrals = parseInt(userStats?.getDataValue('total_referrals')) || 0;

    // Calculate user's rank
    const usersAbove = await Referral.count({
      where: whereClause,
      attributes: ['referrer_id'],
      group: ['referrer_id'],
      having: sequelize.where(
        sequelize.fn('SUM', sequelize.col('bonus_NSL')),
        { [Op.gt]: userTotalEarnings }
      )
    });

    const userRank = (Array.isArray(usersAbove) ? usersAbove.length : 0) + 1;

    res.json({
      period,
      leaderboard: rankedLeaderboard,
      current_user: {
        rank: userRank,
        total_referrals: userTotalReferrals,
        total_earnings: userTotalEarnings
      }
    });
  } catch (error) {
    logger.error('Leaderboard fetch error:', error);
    res.status(500).json({ message: 'Error fetching leaderboard', error: error.message });
  }
});

// Update user profile
router.put('/profile', authenticate, validateUpdateProfile, async (req, res) => {
  try {
    const { username, email, phone } = req.body;
    const user = await User.findByPk(req.user.id);

    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    // Validate and update fields
    if (username && username !== user.username) {
      const existingUser = await User.findOne({ where: { username } });
      if (existingUser && existingUser.id !== user.id) {
        return res.status(400).json({ message: 'Username already taken' });
      }
      user.username = username;
    }

    if (email && email !== user.email) {
      const existingUser = await User.findOne({ where: { email } });
      if (existingUser && existingUser.id !== user.id) {
        return res.status(400).json({ message: 'Email already in use' });
      }
      user.email = email;
      user.emailVerified = false;
    }

    if (phone && phone !== user.phone) {
      const existingUser = await User.findOne({ where: { phone } });
      if (existingUser && existingUser.id !== user.id) {
        return res.status(400).json({ message: 'Phone number already in use' });
      }
      user.phone = phone;
    }

    await user.save();

    logger.info(`Profile updated for user ${user.id}`);
    res.json({
      message: 'Profile updated successfully',
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        phone: user.phone,
        profile_photo: user.profile_photo,
        updated_at: user.updated_at
      }
    });
  } catch (error) {
    logger.error('Profile update error:', error);
    res.status(500).json({ message: 'Error updating profile', error: error.message });
  }
});

// Upload profile photo
router.post('/upload-profile-photo', authenticate, profileUpload.single('profile_photo'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ message: 'No file uploaded' });
    }

    const user = await User.findByPk(req.user.id);
    if (!user) {
      fs.unlinkSync(req.file.path);
      return res.status(404).json({ message: 'User not found' });
    }

    // Delete old profile photo if exists
    if (user.profile_photo) {
      const oldPhotoPath = path.join(__dirname, '../', user.profile_photo);
      if (fs.existsSync(oldPhotoPath)) {
        fs.unlinkSync(oldPhotoPath);
      }
    }

    // Save new profile photo path
    const photoUrl = `/uploads/profiles/${req.file.filename}`;
    user.profile_photo = photoUrl;
    await user.save();

    logger.info(`Profile photo uploaded for user ${user.id}`);
    res.json({
      message: 'Profile photo uploaded successfully',
      profile_photo: photoUrl
    });
  } catch (error) {
    if (req.file) {
      fs.unlinkSync(req.file.path);
    }
    logger.error('Profile photo upload error:', error);
    res.status(500).json({ message: 'Error uploading profile photo', error: error.message });
  }
});

// Upload payment proof for transaction
router.post('/transactions/:id/upload-payment-proof', authenticate, paymentUpload.single('payment_proof'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ message: 'No file uploaded' });
    }

    const transaction = await Transaction.findByPk(req.params.id);

    if (!transaction) {
      fs.unlinkSync(req.file.path);
      return res.status(404).json({ message: 'Transaction not found' });
    }

    // Verify the transaction belongs to the user
    if (transaction.user_id !== parseInt(req.user.id)) {
      fs.unlinkSync(req.file.path);
      return res.status(403).json({ message: 'Unauthorized access to transaction' });
    }

    // Only allow upload for pending transactions
    if (transaction.status !== 'pending') {
      fs.unlinkSync(req.file.path);
      return res.status(400).json({ message: 'Can only upload payment proof for pending transactions' });
    }

    // Delete old payment proof if exists
    if (transaction.payment_proof) {
      const oldProofPath = path.join(__dirname, '../', transaction.payment_proof);
      if (fs.existsSync(oldProofPath)) {
        fs.unlinkSync(oldProofPath);
      }
    }

    // Save new payment proof path
    const proofUrl = `/uploads/payments/${req.file.filename}`;
    transaction.payment_proof = proofUrl;
    await transaction.save();

    logger.info(`Payment proof uploaded for transaction ${transaction.id} by user ${req.user.id}`);
    res.json({
      message: 'Payment proof uploaded successfully',
      transaction: {
        id: transaction.id,
        payment_proof: proofUrl,
        status: transaction.status
      }
    });
  } catch (error) {
    if (req.file) {
      fs.unlinkSync(req.file.path);
    }
    logger.error('Payment proof upload error:', error);
    res.status(500).json({ message: 'Error uploading payment proof', error: error.message });
  }
});

// Upload KYC documents (supports multiple documents)
router.post('/kyc/upload', authenticate, kycUpload.fields([
  { name: 'id_front', maxCount: 1 },
  { name: 'id_back', maxCount: 1 },
  { name: 'selfie', maxCount: 1 },
  { name: 'additional', maxCount: 1 }
]), async (req, res) => {
  try {
    if (!req.files || Object.keys(req.files).length === 0) {
      return res.status(400).json({ message: 'No files uploaded' });
    }

    const user = await User.findByPk(req.user.id);

    if (!user) {
      Object.values(req.files).forEach(fileArray => {
        fileArray.forEach(file => fs.unlinkSync(file.path));
      });
      return res.status(404).json({ message: 'User not found' });
    }

    const uploadedDocs = {};

    // Process each uploaded document
    for (const [fieldName, fileArray] of Object.entries(req.files)) {
      if (fileArray && fileArray.length > 0) {
        const file = fileArray[0];
        const kycField = `kyc_${fieldName}`;

        // Delete old document if exists
        if (user[kycField]) {
          const oldDocPath = path.join(__dirname, '../', user[kycField]);
          if (fs.existsSync(oldDocPath)) {
            fs.unlinkSync(oldDocPath);
          }
        }

        // Save new document path
        const docUrl = `/uploads/kyc/${file.filename}`;
        user[kycField] = docUrl;
        uploadedDocs[fieldName] = docUrl;
      }
    }

    await user.save();

    logger.info(`KYC documents uploaded for user ${user.id}: ${Object.keys(uploadedDocs).join(', ')}`);

    res.json({
      message: 'KYC documents uploaded successfully',
      uploaded_documents: uploadedDocs,
      kyc_documents: {
        id_front: user.kyc_id_front,
        id_back: user.kyc_id_back,
        selfie: user.kyc_selfie,
        additional: user.kyc_additional
      },
      kyc_verified: user.kyc_verified
    });
  } catch (error) {
    if (req.files) {
      Object.values(req.files).forEach(fileArray => {
        fileArray.forEach(file => {
          try {
            fs.unlinkSync(file.path);
          } catch (err) {
            logger.error('Error deleting file:', err);
          }
        });
      });
    }
    logger.error('KYC upload error:', error);
    res.status(500).json({ message: 'Error uploading KYC documents', error: error.message });
  }
});

// Get KYC status
router.get('/kyc/status', authenticate, async (req, res) => {
  try {
    const user = await User.findByPk(req.user.id, {
      attributes: ['kyc_verified', 'kyc_id_front', 'kyc_id_back', 'kyc_selfie', 'kyc_additional']
    });

    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    const uploadedDocs = {
      id_front: !!user.kyc_id_front,
      id_back: !!user.kyc_id_back,
      selfie: !!user.kyc_selfie,
      additional: !!user.kyc_additional
    };

    const requiredDocs = ['id_front', 'id_back', 'selfie'];
    const allRequiredUploaded = requiredDocs.every(doc => uploadedDocs[doc]);

    res.json({
      kyc_verified: user.kyc_verified,
      documents_uploaded: uploadedDocs,
      all_required_uploaded: allRequiredUploaded,
      message: user.kyc_verified
        ? 'KYC verified'
        : allRequiredUploaded
          ? 'Documents uploaded, pending verification'
          : 'Please upload all required documents (ID front, ID back, and selfie)'
    });
  } catch (error) {
    logger.error('KYC status fetch error:', error);
    res.status(500).json({ message: 'Error fetching KYC status', error: error.message });
  }
});

module.exports = router;
