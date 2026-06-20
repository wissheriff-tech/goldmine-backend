const { Op } = require('sequelize');
const { User } = require('../models');
const logger = require('./logger');
const notificationService = require('./notificationService');
const { formatAmountLabel, providerLabel } = require('./depositReceiptParser');

async function notifyDepositReviewers(summary = {}) {
  try {
    const reviewers = await User.findAll({
      where: {
        role: { [Op.in]: ['superadmin', 'finance'] },
        status: 'active',
      },
      attributes: ['id', 'role'],
    });

    const amountLabel = formatAmountLabel(summary.amount, summary.currency || 'NSL');
    const provider = summary.providerLabel || providerLabel(summary.provider);

    const tasks = reviewers.map((reviewer) => notificationService.notifyDepositPendingReviewer(
      reviewer.id,
      {
        providerLabel: provider,
        amountLabel,
        referenceId: summary.referenceId || null,
        actionUrl: reviewer.role === 'finance' ? '/finance?tab=transactions' : '/admin?tab=Deposits',
        data: {
          provider: summary.provider || null,
          deposit_type: summary.depositType || null,
          deposit_id: summary.depositId || null,
          transaction_id: summary.transactionId || null,
          reference_id: summary.referenceId || null,
          amount: summary.amount || null,
          currency: summary.currency || null,
        },
      }
    ));

    const results = await Promise.allSettled(tasks);
    const failed = results.filter(result => result.status === 'rejected').length;
    if (failed) logger.warn(`Deposit reviewer notification failures: ${failed}`);
  } catch (error) {
    logger.error('Deposit reviewer notification error:', error);
  }
}

module.exports = {
  notifyDepositReviewers,
};
