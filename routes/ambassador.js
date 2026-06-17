const express = require('express');
const { Op } = require('sequelize');
const { User, Transaction } = require('../models');
const { authenticate, authorize } = require('../middleware/auth');
const logger = require('../utils/logger');

const router = express.Router();

router.get('/overview', authenticate, authorize(['superadmin', 'ambassador']), async (req, res) => {
  try {
    const requestedAmbassadorId = req.query.ambassador_id;
    const ambassadorId = req.user.role === 'superadmin' && requestedAmbassadorId
      ? requestedAmbassadorId
      : req.user.id;

    const ambassador = await User.findByPk(ambassadorId, {
      attributes: ['id', 'username', 'phone', 'role', 'referral_code', 'ambassador_region', 'ambassador_sector']
    });

    if (!ambassador || ambassador.role !== 'ambassador') {
      return res.status(404).json({ message: 'Ambassador not found' });
    }

    const invitedWhere = { referred_by: ambassador.referral_code };
    const users = await User.findAll({
      where: invitedWhere,
      attributes: ['id', 'username', 'phone', 'status', 'vip_level', 'balance_NSL', 'created_at'],
      order: [['created_at', 'DESC']],
      limit: 100
    });

    const userIds = users.map(user => user.id);
    const [totalUsers, activeUsers, pendingUsers, totalPurchases] = await Promise.all([
      User.count({ where: invitedWhere }),
      User.count({ where: { ...invitedWhere, status: 'active' } }),
      User.count({ where: { ...invitedWhere, status: 'pending' } }),
      userIds.length
        ? Transaction.sum('amount_NSL', {
            where: {
              user_id: { [Op.in]: userIds },
              type: 'purchase',
              status: 'approved'
            }
          })
        : 0
    ]);

    res.json({
      ambassador,
      stats: {
        total_users: totalUsers,
        active_users: activeUsers,
        pending_users: pendingUsers,
        total_purchase_NSL: totalPurchases || 0
      },
      users
    });
  } catch (error) {
    logger.error('Ambassador overview error:', error);
    res.status(500).json({ message: 'Error loading ambassador overview', error: error.message });
  }
});

module.exports = router;
