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
    name: process.env.EMAIL_FROM || 'Gold Mine',
    address: process.env.EMAIL_USER || 'noreply@salonmoney.com'
  },

  templates: {
    passwordReset: {
      subject: 'Password Reset Request - Gold Mine',
      priority: 'high'
    },
    emailVerification: {
      subject: 'Verify Your Email - Gold Mine',
      priority: 'high'
    },
    twoFactor: {
      subject: 'Your Two-Factor Authentication Code - Gold Mine',
      priority: 'high'
    },
    welcome: {
      subject: 'Welcome to Gold Mine',
      priority: 'normal'
    },
    transactionApproved: {
      subject: 'Transaction Approved - Gold Mine',
      priority: 'normal'
    },
    transactionRejected: {
      subject: 'Transaction Rejected - Gold Mine',
      priority: 'normal'
    },
    accountActivated: {
      subject: 'Account Activated - Gold Mine',
      priority: 'normal'
    },
    referralBonus: {
      subject: 'You Earned a Referral Bonus! - Gold Mine',
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
