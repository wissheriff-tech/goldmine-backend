const nodemailer = require('nodemailer');
const logger = require('./logger');

class EmailService {
  constructor() {
    this.transporter = nodemailer.createTransport({
      service: process.env.EMAIL_SERVICE || 'gmail',
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASSWORD
      }
    });
  }

  async sendPasswordResetEmail(email, username, resetToken) {
    const resetUrl = `${process.env.FRONTEND_URL}/reset-password/${resetToken}`;

    const mailOptions = {
      from: process.env.EMAIL_FROM || process.env.EMAIL_USER,
      to: email,
      subject: 'Password Reset Request - SalonMoney',
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; background-color: #f5f5f5;">
          <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 30px; border-radius: 10px 10px 0 0;">
            <h1 style="color: white; margin: 0; font-size: 28px;">SalonMoney</h1>
          </div>

          <div style="background: white; padding: 30px; border-radius: 0 0 10px 10px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
            <h2 style="color: #333; margin-top: 0;">Password Reset Request</h2>
            <p style="color: #666; font-size: 16px;">Hi ${username},</p>
            <p style="color: #666; font-size: 16px;">
              You requested to reset your password. Click the button below to proceed:
            </p>

            <div style="text-align: center; margin: 30px 0;">
              <a href="${resetUrl}"
                 style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                        color: white; padding: 15px 40px; text-decoration: none;
                        border-radius: 5px; display: inline-block; font-weight: bold;
                        box-shadow: 0 4px 6px rgba(0,0,0,0.1);">
                Reset Password
              </a>
            </div>

            <p style="color: #666; font-size: 14px;">Or copy and paste this link into your browser:</p>
            <p style="word-break: break-all; color: #667eea; font-size: 12px; background: #f5f5f5; padding: 10px; border-radius: 5px;">
              ${resetUrl}
            </p>

            <div style="margin-top: 30px; padding-top: 20px; border-top: 1px solid #eee;">
              <p style="color: #999; font-size: 12px; margin: 5px 0;">
                This link will expire in 1 hour.
              </p>
              <p style="color: #999; font-size: 12px; margin: 5px 0;">
                If you didn't request this, please ignore this email and your password will remain unchanged.
              </p>
            </div>
          </div>
        </div>
      `
    };

    try {
      await this.transporter.sendMail(mailOptions);
      logger.info(`Password reset email sent to ${email}`);
      return { success: true };
    } catch (error) {
      logger.error('Email send error:', error);
      return { success: false, error: error.message };
    }
  }

  async sendVerificationEmail(email, username, verificationToken) {
    const verificationUrl = `${process.env.FRONTEND_URL}/verify-email/${verificationToken}`;

    const mailOptions = {
      from: process.env.EMAIL_FROM || process.env.EMAIL_USER,
      to: email,
      subject: 'Verify Your Email - SalonMoney',
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; background-color: #f5f5f5;">
          <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 30px; border-radius: 10px 10px 0 0;">
            <h1 style="color: white; margin: 0; font-size: 28px;">SalonMoney</h1>
          </div>

          <div style="background: white; padding: 30px; border-radius: 0 0 10px 10px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
            <h2 style="color: #333; margin-top: 0;">Welcome to SalonMoney!</h2>
            <p style="color: #666; font-size: 16px;">Hi ${username},</p>
            <p style="color: #666; font-size: 16px;">
              Thank you for signing up! Please verify your email address to complete your registration.
            </p>

            <div style="text-align: center; margin: 30px 0;">
              <a href="${verificationUrl}"
                 style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                        color: white; padding: 15px 40px; text-decoration: none;
                        border-radius: 5px; display: inline-block; font-weight: bold;
                        box-shadow: 0 4px 6px rgba(0,0,0,0.1);">
                Verify Email Address
              </a>
            </div>

            <p style="color: #666; font-size: 14px;">Or copy and paste this link into your browser:</p>
            <p style="word-break: break-all; color: #667eea; font-size: 12px; background: #f5f5f5; padding: 10px; border-radius: 5px;">
              ${verificationUrl}
            </p>

            <div style="margin-top: 30px; padding-top: 20px; border-top: 1px solid #eee;">
              <p style="color: #999; font-size: 12px; margin: 5px 0;">
                This link will expire in 24 hours.
              </p>
              <p style="color: #999; font-size: 12px; margin: 5px 0;">
                If you didn't create an account, please ignore this email.
              </p>
            </div>
          </div>
        </div>
      `
    };

    try {
      await this.transporter.sendMail(mailOptions);
      logger.info(`Verification email sent to ${email}`);
      return { success: true };
    } catch (error) {
      logger.error('Email send error:', error);
      return { success: false, error: error.message };
    }
  }

  async send2FACode(email, username, code) {
    const mailOptions = {
      from: process.env.EMAIL_FROM || process.env.EMAIL_USER,
      to: email,
      subject: 'Your Two-Factor Authentication Code - SalonMoney',
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; background-color: #f5f5f5;">
          <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 30px; border-radius: 10px 10px 0 0;">
            <h1 style="color: white; margin: 0; font-size: 28px;">SalonMoney</h1>
          </div>

          <div style="background: white; padding: 30px; border-radius: 0 0 10px 10px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
            <h2 style="color: #333; margin-top: 0;">Two-Factor Authentication</h2>
            <p style="color: #666; font-size: 16px;">Hi ${username},</p>
            <p style="color: #666; font-size: 16px;">
              Your verification code is:
            </p>

            <div style="text-align: center; margin: 30px 0;">
              <div style="background: #f5f5f5; padding: 20px; border-radius: 10px; display: inline-block;">
                <span style="font-size: 32px; font-weight: bold; color: #667eea; letter-spacing: 8px; font-family: 'Courier New', monospace;">
                  ${code}
                </span>
              </div>
            </div>

            <p style="color: #666; font-size: 14px; text-align: center;">
              Enter this code to complete your login.
            </p>

            <div style="margin-top: 30px; padding-top: 20px; border-top: 1px solid #eee;">
              <p style="color: #999; font-size: 12px; margin: 5px 0;">
                This code will expire in 10 minutes.
              </p>
              <p style="color: #999; font-size: 12px; margin: 5px 0;">
                If you didn't request this code, please secure your account immediately.
              </p>
            </div>
          </div>
        </div>
      `
    };

    try {
      await this.transporter.sendMail(mailOptions);
      logger.info(`2FA code sent to ${email}`);
      return { success: true };
    } catch (error) {
      logger.error('2FA email send error:', error);
      return { success: false, error: error.message };
    }
  }

  // Transaction Approved Notification
  async sendTransactionApproved(email, username, transaction) {
    const mailOptions = {
      from: process.env.EMAIL_FROM || process.env.EMAIL_USER,
      to: email,
      subject: `Transaction Approved - ${transaction.type.toUpperCase()} - SalonMoney`,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; background-color: #f5f5f5;">
          <div style="background: linear-gradient(135deg, #10b981 0%, #059669 100%); padding: 30px; border-radius: 10px 10px 0 0;">
            <h1 style="color: white; margin: 0; font-size: 28px;">✅ Transaction Approved</h1>
          </div>

          <div style="background: white; padding: 30px; border-radius: 0 0 10px 10px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
            <p style="color: #666; font-size: 16px;">Hi ${username},</p>
            <p style="color: #666; font-size: 16px;">
              Your ${transaction.type} request has been approved!
            </p>

            <div style="background: #f0fdf4; padding: 20px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #10b981;">
              <p style="margin: 5px 0; color: #333;"><strong>Amount:</strong> ${transaction.amount_NSL} NSL (${transaction.amount_usdt} USDT)</p>
              <p style="margin: 5px 0; color: #333;"><strong>Transaction ID:</strong> ${transaction._id}</p>
              <p style="margin: 5px 0; color: #333;"><strong>Status:</strong> <span style="color: #10b981; font-weight: bold;">Approved</span></p>
            </div>

            ${transaction.type === 'withdrawal' ? `
              <p style="color: #666; font-size: 14px;">
                Funds will be sent to your withdrawal address within 24 hours.
              </p>
            ` : `
              <p style="color: #666; font-size: 14px;">
                Your balance has been updated. Log in to view your new balance.
              </p>
            `}

            <div style="text-align: center; margin: 30px 0;">
              <a href="${process.env.FRONTEND_URL}/transactions"
                 style="background: linear-gradient(135deg, #10b981 0%, #059669 100%);
                        color: white; padding: 15px 40px; text-decoration: none;
                        border-radius: 5px; display: inline-block; font-weight: bold;">
                View Transaction History
              </a>
            </div>
          </div>
        </div>
      `
    };

    try {
      await this.transporter.sendMail(mailOptions);
      logger.info(`Transaction approved email sent to ${email}`);
      return { success: true };
    } catch (error) {
      logger.error('Email send error:', error);
      return { success: false, error: error.message };
    }
  }

  // Transaction Rejected Notification
  async sendTransactionRejected(email, username, transaction, reason) {
    const mailOptions = {
      from: process.env.EMAIL_FROM || process.env.EMAIL_USER,
      to: email,
      subject: `Transaction Rejected - ${transaction.type.toUpperCase()} - SalonMoney`,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; background-color: #f5f5f5;">
          <div style="background: linear-gradient(135deg, #ef4444 0%, #dc2626 100%); padding: 30px; border-radius: 10px 10px 0 0;">
            <h1 style="color: white; margin: 0; font-size: 28px;">❌ Transaction Rejected</h1>
          </div>

          <div style="background: white; padding: 30px; border-radius: 0 0 10px 10px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
            <p style="color: #666; font-size: 16px;">Hi ${username},</p>
            <p style="color: #666; font-size: 16px;">
              Unfortunately, your ${transaction.type} request has been rejected.
            </p>

            <div style="background: #fef2f2; padding: 20px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #ef4444;">
              <p style="margin: 5px 0; color: #333;"><strong>Amount:</strong> ${transaction.amount_NSL} NSL</p>
              <p style="margin: 5px 0; color: #333;"><strong>Reason:</strong> ${reason || 'No reason provided'}</p>
            </div>

            <p style="color: #666; font-size: 14px;">
              If you believe this is an error, please contact our support team.
            </p>

            <div style="text-align: center; margin: 30px 0;">
              <a href="${process.env.FRONTEND_URL}/contact"
                 style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                        color: white; padding: 15px 40px; text-decoration: none;
                        border-radius: 5px; display: inline-block; font-weight: bold;">
                Contact Support
              </a>
            </div>
          </div>
        </div>
      `
    };

    try {
      await this.transporter.sendMail(mailOptions);
      logger.info(`Transaction rejected email sent to ${email}`);
      return { success: true };
    } catch (error) {
      logger.error('Email send error:', error);
      return { success: false, error: error.message };
    }
  }

  // Account Approved Notification
  async sendAccountApproved(email, username) {
    const mailOptions = {
      from: process.env.EMAIL_FROM || process.env.EMAIL_USER,
      to: email,
      subject: 'Your Account Has Been Approved! - SalonMoney',
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; background-color: #f5f5f5;">
          <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 30px; border-radius: 10px 10px 0 0;">
            <h1 style="color: white; margin: 0; font-size: 28px;">🎉 Account Approved!</h1>
          </div>

          <div style="background: white; padding: 30px; border-radius: 0 0 10px 10px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
            <p style="color: #666; font-size: 16px;">Hi ${username},</p>
            <p style="color: #666; font-size: 16px;">
              Great news! Your SalonMoney account has been approved and is now active.
            </p>

            <p style="color: #666; font-size: 16px;">
              You can now access all platform features including:
            </p>

            <ul style="color: #666; font-size: 15px; line-height: 1.8;">
              <li>Recharge your account</li>
              <li>Purchase VIP packages</li>
              <li>Earn daily income</li>
              <li>Refer friends and earn bonuses</li>
              <li>Withdraw your earnings</li>
            </ul>

            <div style="text-align: center; margin: 30px 0;">
              <a href="${process.env.FRONTEND_URL}/login"
                 style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                        color: white; padding: 15px 40px; text-decoration: none;
                        border-radius: 5px; display: inline-block; font-weight: bold;">
                Login to Dashboard
              </a>
            </div>
          </div>
        </div>
      `
    };

    try {
      await this.transporter.sendMail(mailOptions);
      logger.info(`Account approved email sent to ${email}`);
      return { success: true };
    } catch (error) {
      logger.error('Email send error:', error);
      return { success: false, error: error.message };
    }
  }

  // Product Expiring Soon Notification
  async sendProductExpiring(email, username, product, daysLeft) {
    const mailOptions = {
      from: process.env.EMAIL_FROM || process.env.EMAIL_USER,
      to: email,
      subject: `Your ${product.name} Package Expires in ${daysLeft} Days - SalonMoney`,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; background-color: #f5f5f5;">
          <div style="background: linear-gradient(135deg, #f59e0b 0%, #d97706 100%); padding: 30px; border-radius: 10px 10px 0 0;">
            <h1 style="color: white; margin: 0; font-size: 28px;">⏰ Product Expiring Soon</h1>
          </div>

          <div style="background: white; padding: 30px; border-radius: 0 0 10px 10px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
            <p style="color: #666; font-size: 16px;">Hi ${username},</p>
            <p style="color: #666; font-size: 16px;">
              Your <strong>${product.name}</strong> package will expire in <strong>${daysLeft} days</strong>.
            </p>

            <div style="background: #fef3c7; padding: 20px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #f59e0b;">
              <p style="margin: 5px 0; color: #333;"><strong>Product:</strong> ${product.name}</p>
              <p style="margin: 5px 0; color: #333;"><strong>Daily Income:</strong> ${product.daily_income_NSL} NSL</p>
              <p style="margin: 5px 0; color: #333;"><strong>Renewal Price:</strong> ${product.price_NSL} NSL</p>
            </div>

            <p style="color: #666; font-size: 14px;">
              Make sure you have sufficient balance for auto-renewal, or you can disable auto-renewal in your dashboard.
            </p>

            <div style="text-align: center; margin: 30px 0;">
              <a href="${process.env.FRONTEND_URL}/dashboard"
                 style="background: linear-gradient(135deg, #f59e0b 0%, #d97706 100%);
                        color: white; padding: 15px 40px; text-decoration: none;
                        border-radius: 5px; display: inline-block; font-weight: bold;">
                Manage Products
              </a>
            </div>
          </div>
        </div>
      `
    };

    try {
      await this.transporter.sendMail(mailOptions);
      logger.info(`Product expiring email sent to ${email}`);
      return { success: true };
    } catch (error) {
      logger.error('Email send error:', error);
      return { success: false, error: error.message };
    }
  }

  // Daily Income Summary
  async sendDailyIncomeSummary(email, username, totalIncome, activeProducts) {
    const mailOptions = {
      from: process.env.EMAIL_FROM || process.env.EMAIL_USER,
      to: email,
      subject: `Daily Income: ${totalIncome} NSL Earned! - SalonMoney`,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; background-color: #f5f5f5;">
          <div style="background: linear-gradient(135deg, #10b981 0%, #059669 100%); padding: 30px; border-radius: 10px 10px 0 0;">
            <h1 style="color: white; margin: 0; font-size: 28px;">💰 Daily Income Summary</h1>
          </div>

          <div style="background: white; padding: 30px; border-radius: 0 0 10px 10px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
            <p style="color: #666; font-size: 16px;">Hi ${username},</p>
            <p style="color: #666; font-size: 16px;">
              You earned <strong style="color: #10b981; font-size: 20px;">${totalIncome} NSL</strong> today!
            </p>

            <div style="background: #f0fdf4; padding: 20px; border-radius: 8px; margin: 20px 0;">
              <p style="margin: 10px 0; color: #333; font-size: 18px; text-align: center;">
                <strong>Total Earned Today:</strong><br>
                <span style="color: #10b981; font-size: 32px; font-weight: bold;">${totalIncome} NSL</span>
              </p>
              <p style="margin: 10px 0; color: #666; text-align: center;">
                From ${activeProducts} active product${activeProducts > 1 ? 's' : ''}
              </p>
            </div>

            <p style="color: #666; font-size: 14px; text-align: center;">
              Keep your products active to continue earning daily income!
            </p>

            <div style="text-align: center; margin: 30px 0;">
              <a href="${process.env.FRONTEND_URL}/dashboard"
                 style="background: linear-gradient(135deg, #10b981 0%, #059669 100%);
                        color: white; padding: 15px 40px; text-decoration: none;
                        border-radius: 5px; display: inline-block; font-weight: bold;">
                View Dashboard
              </a>
            </div>
          </div>
        </div>
      `
    };

    try {
      await this.transporter.sendMail(mailOptions);
      logger.info(`Daily income summary sent to ${email}`);
      return { success: true };
    } catch (error) {
      logger.error('Email send error:', error);
      return { success: false, error: error.message };
    }
  }

  // New Referral Notification
  async sendNewReferral(email, username, referredUsername, bonusAmount) {
    const mailOptions = {
      from: process.env.EMAIL_FROM || process.env.EMAIL_USER,
      to: email,
      subject: `New Referral Bonus: ${bonusAmount} NSL! - SalonMoney`,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; background-color: #f5f5f5;">
          <div style="background: linear-gradient(135deg, #8b5cf6 0%, #7c3aed 100%); padding: 30px; border-radius: 10px 10px 0 0;">
            <h1 style="color: white; margin: 0; font-size: 28px;">🎁 New Referral Bonus!</h1>
          </div>

          <div style="background: white; padding: 30px; border-radius: 0 0 10px 10px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
            <p style="color: #666; font-size: 16px;">Hi ${username},</p>
            <p style="color: #666; font-size: 16px;">
              Great news! Your referral <strong>${referredUsername}</strong> just made their first purchase.
            </p>

            <div style="background: #f5f3ff; padding: 20px; border-radius: 8px; margin: 20px 0; text-align: center;">
              <p style="margin: 5px 0; color: #666;">You earned a referral bonus of:</p>
              <p style="margin: 10px 0;">
                <span style="color: #8b5cf6; font-size: 36px; font-weight: bold;">${bonusAmount} NSL</span>
              </p>
            </div>

            <p style="color: #666; font-size: 14px; text-align: center;">
              Keep referring friends to earn more bonuses!
            </p>

            <div style="text-align: center; margin: 30px 0;">
              <a href="${process.env.FRONTEND_URL}/referrals"
                 style="background: linear-gradient(135deg, #8b5cf6 0%, #7c3aed 100%);
                        color: white; padding: 15px 40px; text-decoration: none;
                        border-radius: 5px; display: inline-block; font-weight: bold;">
                View Referrals
              </a>
            </div>
          </div>
        </div>
      `
    };

    try {
      await this.transporter.sendMail(mailOptions);
      logger.info(`New referral email sent to ${email}`);
      return { success: true };
    } catch (error) {
      logger.error('Email send error:', error);
      return { success: false, error: error.message };
    }
  }
}

module.exports = new EmailService();
