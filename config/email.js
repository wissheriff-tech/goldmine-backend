/**
 * Email Configuration
 * Nodemailer transport settings and email templates
 */

const nodemailer = require('nodemailer');
const logger = require('../utils/logger');

/**
 * Create email transporter
 */
const createTransporter = () => {
  const config = {
    service: process.env.EMAIL_SERVICE || 'gmail',
    auth: {
      user: process.env.EMAIL_USER,
      pass: process.env.EMAIL_PASSWORD
    }
  };

  if (!config.auth.user || !config.auth.pass) {
    logger.warn('Email credentials not configured. Email functionality will be limited.');
  }

  return nodemailer.createTransporter(config);
};

/**
 * Email template configuration
 */
const emailConfig = {
  from: {
    name: process.env.EMAIL_FROM || 'SalonMoney',
    address: process.env.EMAIL_USER || 'noreply@salonmoney.com'
  },

  templates: {
    passwordReset: {
      subject: 'Password Reset Request - SalonMoney',
      priority: 'high'
    },
    emailVerification: {
      subject: 'Verify Your Email - SalonMoney',
      priority: 'high'
    },
    twoFactor: {
      subject: 'Your Two-Factor Authentication Code - SalonMoney',
      priority: 'high'
    },
    welcome: {
      subject: 'Welcome to SalonMoney',
      priority: 'normal'
    },
    transactionApproved: {
      subject: 'Transaction Approved - SalonMoney',
      priority: 'normal'
    },
    transactionRejected: {
      subject: 'Transaction Rejected - SalonMoney',
      priority: 'normal'
    },
    accountActivated: {
      subject: 'Account Activated - SalonMoney',
      priority: 'normal'
    },
    referralBonus: {
      subject: 'You Earned a Referral Bonus! - SalonMoney',
      priority: 'normal'
    }
  },

  // Email styling
  styles: {
    primaryColor: '#8b5cf6',
    secondaryColor: '#d946ef',
    backgroundColor: '#ffffff',
    textColor: '#333333',
    footerColor: '#666666'
  }
};

module.exports = {
  createTransporter,
  emailConfig
};
