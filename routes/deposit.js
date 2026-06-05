const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { authenticate, authorizeRoles } = require('../middleware/auth');
const { DepositProof, User, Transaction } = require('../models');
const logger = require('../utils/logger');
const emailService = require('../utils/emailService');

const router = express.Router();

// Multer storage for deposit proof images
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = 'uploads/deposits';
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `deposit_${req.user.id}_${Date.now()}${ext}`);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowedExts = ['.jpg', '.jpeg', '.png', '.gif', '.webp'];
    const ext = path.extname(file.originalname).toLowerCase();
    if (!file.mimetype.startsWith('image/') || !allowedExts.includes(ext)) {
      return cb(new Error('Only image files (jpg, jpeg, png, gif, webp) are allowed'));
    }
    cb(null, true);
  }
});

// GET /api/deposit/wallet-info — returns admin wallet address and QR code path
router.get('/wallet-info', authenticate, (req, res) => {
  res.json({
    success: true,
    data: {
      wallet_address: process.env.DEPOSIT_WALLET_ADDRESS || '',
      network: process.env.DEPOSIT_NETWORK || 'TRC20 (USDT)',
      qr_code: process.env.DEPOSIT_QR_URL || null,
      instructions: 'Send USDT to the address above, then upload your transaction proof below.'
    }
  });
});

// POST /api/deposit/submit — user submits deposit proof
router.post('/submit', authenticate, upload.single('receipt'), async (req, res) => {
  try {
    const { amount, txid, notes } = req.body;

    if (!req.file) {
      return res.status(400).json({ message: 'Receipt image is required' });
    }

    if (!amount || isNaN(parseFloat(amount)) || parseFloat(amount) <= 0) {
      return res.status(400).json({ message: 'Valid amount is required' });
    }

    const proof = await DepositProof.create({
      user_id: req.user.id,
      receipt_image: req.file.path,
      original_filename: req.file.originalname,
      user_submitted_amount: parseFloat(amount),
      user_submitted_currency: 'USDT',
      user_submitted_txid: txid || null,
      user_notes: notes || null,
      deposit_type: 'crypto_wallet',
      ip_address: req.ip,
      status: 'pending'
    });

    logger.info(`Deposit proof submitted by user ${req.user.id}: $${amount} USDT`);

    res.status(201).json({
      success: true,
      message: 'Deposit proof submitted. An admin will review and credit your account shortly.',
      data: { id: proof.id, status: proof.status, amount: proof.user_submitted_amount }
    });
  } catch (error) {
    logger.error('Deposit submit error:', error);
    res.status(500).json({ message: 'Error submitting deposit proof', error: error.message });
  }
});

// GET /api/deposit/my — user views their own deposit history
router.get('/my', authenticate, async (req, res) => {
  try {
    const proofs = await DepositProof.findAll({
      where: { user_id: req.user.id },
      order: [['created_at', 'DESC']],
      limit: 20
    });
    res.json({ success: true, data: proofs });
  } catch (error) {
    logger.error('Deposit history error:', error);
    res.status(500).json({ message: 'Error fetching deposit history' });
  }
});

// GET /api/deposit/pending — admin views all pending proofs
router.get('/pending', authenticate, authorizeRoles('admin', 'superadmin', 'finance'), async (req, res) => {
  try {
    const proofs = await DepositProof.findAll({
      where: { status: 'pending' },
      include: [{ model: User, as: 'user', attributes: ['id', 'username', 'phone', 'balance_NSL', 'balance_usdt'] }],
      order: [['created_at', 'ASC']]
    });
    res.json({ success: true, data: proofs });
  } catch (error) {
    logger.error('Pending deposits fetch error:', error);
    res.status(500).json({ message: 'Error fetching pending deposits' });
  }
});

// PATCH /api/deposit/:id/approve — admin approves deposit
router.patch('/:id/approve', authenticate, authorizeRoles('admin', 'superadmin', 'finance'), async (req, res) => {
  try {
    const { approved_amount, notes } = req.body;
    const proof = await DepositProof.findByPk(req.params.id);

    if (!proof) return res.status(404).json({ message: 'Deposit proof not found' });
    if (proof.status !== 'pending') return res.status(400).json({ message: 'Deposit already processed' });

    const amount = parseFloat(approved_amount || proof.user_submitted_amount);
    const nslRate = parseFloat(process.env.NSL_TO_USDT_RECHARGE || 23);
    const feePercent = parseFloat(process.env.RECHARGE_FEE_PERCENTAGE || 10);
    const amountAfterFee = amount * (1 - feePercent / 100);
    const nslAmount = amountAfterFee * nslRate;

    const user = await User.findByPk(proof.user_id);
    if (!user) return res.status(404).json({ message: 'User not found' });

    await proof.approve(req.user.id, { amount, currency: 'USDT', transaction_id: `DEP-${proof.id}` });
    proof.admin_notes = notes || null;
    await proof.save();

    user.balance_NSL = parseFloat(user.balance_NSL) + nslAmount;
    await user.save();

    await Transaction.create({
      user_id: user.id,
      type: 'recharge',
      amount_NSL: nslAmount,
      amount_usdt: amount,
      status: 'approved',
      notes: `Deposit approved. ${amount} USDT → ${nslAmount.toFixed(4)} NSL (${feePercent}% fee)`
    });

    logger.info(`Deposit ${proof.id} approved for user ${user.username}: ${amount} USDT → ${nslAmount} NSL`);

    if (user.email) {
      emailService.sendTransactionApproved(user.email, user.username, 'deposit', nslAmount, amount, user.balance_NSL)
        .catch(err => logger.error('Deposit approval email failed:', err));
    }

    res.json({ success: true, message: 'Deposit approved and balance credited', nsl_credited: nslAmount });
  } catch (error) {
    logger.error('Deposit approve error:', error);
    res.status(500).json({ message: 'Error approving deposit', error: error.message });
  }
});

// PATCH /api/deposit/:id/reject — admin rejects deposit
router.patch('/:id/reject', authenticate, authorizeRoles('admin', 'superadmin', 'finance'), async (req, res) => {
  try {
    const { reason } = req.body;
    if (!reason) return res.status(400).json({ message: 'Rejection reason is required' });

    const proof = await DepositProof.findByPk(req.params.id);
    if (!proof) return res.status(404).json({ message: 'Deposit proof not found' });
    if (proof.status !== 'pending') return res.status(400).json({ message: 'Deposit already processed' });

    await proof.reject(req.user.id, reason);

    const user = await User.findByPk(proof.user_id, { attributes: ['email', 'username'] });
    if (user?.email) {
      emailService.sendTransactionRejected(user.email, user.username, 'deposit', proof.user_submitted_amount, reason)
        .catch(err => logger.error('Deposit rejection email failed:', err));
    }

    logger.info(`Deposit ${proof.id} rejected: ${reason}`);
    res.json({ success: true, message: 'Deposit rejected' });
  } catch (error) {
    logger.error('Deposit reject error:', error);
    res.status(500).json({ message: 'Error rejecting deposit', error: error.message });
  }
});

module.exports = router;
