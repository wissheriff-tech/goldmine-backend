const express = require('express');
const { Op } = require('sequelize');
const { User } = require('../models');
const { authenticate, authorize } = require('../middleware/auth');
const logger = require('../utils/logger');

const router = express.Router();

// Verificator: Get users with uploaded KYC docs pending review
router.get('/users/pending', authenticate, authorize(['superadmin', 'verificator']), async (req, res) => {
  try {
    const users = await User.findAll({
      where: {
        kyc_verified: false,
        [Op.or]: [
          { kyc_id_front: { [Op.ne]: null } },
          { kyc_selfie: { [Op.ne]: null } }
        ]
      },
      attributes: { exclude: ['password_hash'] },
      order: [['created_at', 'ASC']]
    });

    res.json(users);
  } catch (error) {
    logger.error('Pending users fetch error:', error);
    res.status(500).json({ message: 'Error fetching pending users', error: error.message });
  }
});

// Verificator: Verify user
router.patch('/users/:id/verify', authenticate, authorize(['superadmin', 'verificator']), async (req, res) => {
  try {
    const user = await User.findByPk(req.params.id);

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
        id: user.id,
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

    const [affectedRows] = await User.update(
      { status: 'frozen' },
      { where: { id: req.params.id } }
    );

    if (affectedRows === 0) {
      return res.status(404).json({ message: 'User not found' });
    }

    const user = await User.findByPk(req.params.id);

    logger.warn(`User rejected: ${user.phone} - Reason: ${reason}`);

    res.json({
      message: 'User rejected',
      user: {
        id: user.id,
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
