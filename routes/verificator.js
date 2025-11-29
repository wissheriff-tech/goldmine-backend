const express = require('express');
const User = require('../models/User');
const { authenticate, authorize } = require('../middleware/auth');
const logger = require('../utils/logger');

const router = express.Router();

// Verificator: Get pending users
router.get('/users/pending', authenticate, authorize(['superadmin', 'verificator']), async (req, res) => {
  try {
    const users = await User.find({ status: 'pending' })
      .select('-password_hash')
      .sort({ created_at: -1 });

    res.json(users);
  } catch (error) {
    logger.error('Pending users fetch error:', error);
    res.status(500).json({ message: 'Error fetching pending users', error: error.message });
  }
});

// Verificator: Verify user
router.patch('/users/:id/verify', authenticate, authorize(['superadmin', 'verificator']), async (req, res) => {
  try {
    const user = await User.findById(req.params.id);

    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    user.kyc_verified = true;
    user.status = 'active';
    await user.save();

    logger.info(`User verified: ${user.phone}`);

    res.json({
      message: 'User verified and activated',
      user: {
        id: user._id,
        phone: user.phone,
        status: user.status,
        kyc_verified: user.kyc_verified
      }
    });
  } catch (error) {
    logger.error('User verification error:', error);
    res.status(500).json({ message: 'Error verifying user', error: error.message });
  }
});

// Verificator: Reject user
router.patch('/users/:id/reject', authenticate, authorize(['superadmin', 'verificator']), async (req, res) => {
  try {
    const { reason } = req.body;
    const user = await User.findByIdAndUpdate(
      req.params.id,
      { status: 'frozen' },
      { new: true }
    );

    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    logger.warn(`User rejected: ${user.phone} - Reason: ${reason}`);

    res.json({
      message: 'User rejected',
      user: {
        id: user._id,
        phone: user.phone,
        status: user.status
      }
    });
  } catch (error) {
    logger.error('User rejection error:', error);
    res.status(500).json({ message: 'Error rejecting user', error: error.message });
  }
});

module.exports = router;
