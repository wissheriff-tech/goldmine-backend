const express = require('express');
const { User } = require('../models');
const { authenticate, authorize } = require('../middleware/auth');
const logger = require('../utils/logger');

const router = express.Router();

// Approval Admin: Get pending users
router.get('/users/pending', authenticate, authorize(['superadmin', 'approval']), async (req, res) => {
  try {
    const users = await User.findAll({
      where: { status: 'pending' },
      attributes: { exclude: ['password_hash'] },
      order: [['created_at', 'DESC']]
    });

    res.json(users);
  } catch (error) {
    logger.error('Pending users fetch error:', error);
    res.status(500).json({ message: 'Error fetching pending users', error: error.message });
  }
});

// Approval Admin: Approve user
router.patch('/users/:id/approve', authenticate, authorize(['superadmin', 'approval']), async (req, res) => {
  try {
    const user = await User.findByPk(req.params.id);

    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    user.status = 'active';
    await user.save();

    logger.info(`User approved: ${user.phone}`);

    res.json({
      message: 'User account approved',
      user: {
        id: user.id,
        phone: user.phone,
        status: user.status
      }
    });
  } catch (error) {
    logger.error('User approval error:', error);
    res.status(500).json({ message: 'Error approving user', error: error.message });
  }
});

// Approval Admin: Reject user
router.patch('/users/:id/reject', authenticate, authorize(['superadmin', 'approval']), async (req, res) => {
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

    logger.warn(`User approval rejected: ${user.phone} - Reason: ${reason}`);

    res.json({
      message: 'User approval rejected',
      user: {
        id: user.id,
        phone: user.phone,
        status: user.status
      }
    });
  } catch (error) {
    logger.error('Approval rejection error:', error);
    res.status(500).json({ message: 'Error rejecting user approval', error: error.message });
  }
});

module.exports = router;
