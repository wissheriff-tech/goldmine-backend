const axios = require('axios');
const logger = require('./logger');

const FROM = process.env.EMAIL_FROM || 'SalonMoney <noreply@salonmoney.com>';
const FRONTEND = process.env.FRONTEND_URL || 'https://frontend-smoky-eight-43.vercel.app';

const header = `<div style="background:linear-gradient(135deg,#667eea,#764ba2);padding:24px 30px;border-radius:10px 10px 0 0">
  <h1 style="color:#fff;margin:0;font-size:24px;font-weight:700">SalonMoney</h1></div>`;
const footer = `<div style="padding:16px 30px;background:#f9f9f9;border-top:1px solid #eee;border-radius:0 0 10px 10px">
  <p style="color:#999;font-size:12px;margin:0">© 2026 SalonMoney. This is an automated message.</p></div>`;
const wrap = (body) => `<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;background:#f5f5f5;border-radius:10px;overflow:hidden">${header}
  <div style="background:#fff;padding:30px">${body}</div>${footer}</div>`;
const btn = (url, label) => `<div style="text-align:center;margin:24px 0">
  <a href="${url}" style="background:linear-gradient(135deg,#667eea,#764ba2);color:#fff;padding:14px 36px;text-decoration:none;border-radius:6px;display:inline-block;font-weight:700">${label}</a></div>`;

class EmailService {
  constructor() {
    this.apiKey = process.env.RESEND_API_KEY || null;
    if (!this.apiKey) logger.warn('RESEND_API_KEY not set — emails disabled');
  }

  async send(to, subject, html) {
    if (!this.apiKey) {
      logger.warn(`Email skipped (no API key): ${subject} → ${to}`);
      return;
    }
    try {
      await axios.post('https://api.resend.com/emails', { from: FROM, to, subject, html }, {
        headers: { Authorization: `Bearer ${this.apiKey}`, 'Content-Type': 'application/json' },
        timeout: 10000
      });
      logger.info(`Email sent: ${subject} → ${to}`);
    } catch (err) {
      logger.error(`Email failed: ${subject} → ${to}:`, err.response?.data || err.message);
    }
  }

  async sendPasswordResetEmail(email, username, resetToken) {
    const url = `${FRONTEND}/reset-password/${resetToken}`;
    await this.send(email, 'Password Reset Request — SalonMoney', wrap(`
      <h2 style="color:#333;margin-top:0">Password Reset</h2>
      <p style="color:#555">Hi ${username},</p>
      <p style="color:#555">Click below to reset your password. This link expires in 1 hour.</p>
      ${btn(url, 'Reset Password')}
      <p style="color:#999;font-size:12px">Or copy: <span style="word-break:break-all">${url}</span></p>
      <p style="color:#999;font-size:12px;margin-top:16px">If you didn't request this, ignore this email.</p>
    `));
  }

  async sendVerificationEmail(email, username, verificationToken) {
    const url = `${FRONTEND}/verify-email/${verificationToken}`;
    await this.send(email, 'Verify Your Email — SalonMoney', wrap(`
      <h2 style="color:#333;margin-top:0">Verify Your Email</h2>
      <p style="color:#555">Hi ${username}, welcome to SalonMoney!</p>
      <p style="color:#555">Click below to verify your email address. Link expires in 24 hours.</p>
      ${btn(url, 'Verify Email')}
    `));
  }

  async send2FACode(email, username, code) {
    await this.send(email, 'Your 2FA Code — SalonMoney', wrap(`
      <h2 style="color:#333;margin-top:0">Two-Factor Authentication</h2>
      <p style="color:#555">Hi ${username},</p>
      <p style="color:#555">Your login code is:</p>
      <div style="text-align:center;margin:24px 0">
        <span style="font-size:36px;font-weight:700;letter-spacing:8px;color:#667eea;background:#f0f0ff;padding:16px 24px;border-radius:8px">${code}</span>
      </div>
      <p style="color:#999;font-size:12px">This code expires in 10 minutes. If you didn't try to login, please secure your account.</p>
    `));
  }

  async sendTransactionApproved(email, username, type, amount_NSL, amount_usdt, balance_NSL) {
    await this.send(email, `Transaction Approved — SalonMoney`, wrap(`
      <h2 style="color:#333;margin-top:0">✅ Transaction Approved</h2>
      <p style="color:#555">Hi ${username}, your <strong>${type}</strong> has been approved.</p>
      <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px;padding:16px;margin:16px 0">
        <p style="margin:4px 0;color:#166534">Amount: <strong>${parseFloat(amount_NSL||0).toFixed(2)} NSL</strong></p>
        <p style="margin:4px 0;color:#166534">USDT Value: <strong>$${parseFloat(amount_usdt||0).toFixed(2)}</strong></p>
        <p style="margin:4px 0;color:#166534">New Balance: <strong>${parseFloat(balance_NSL||0).toFixed(2)} NSL</strong></p>
      </div>
      ${btn(`${FRONTEND}/transactions`, 'View Transactions')}
    `));
  }

  async sendTransactionRejected(email, username, type, amount_NSL, reason) {
    await this.send(email, `Transaction Rejected — SalonMoney`, wrap(`
      <h2 style="color:#333;margin-top:0">❌ Transaction Rejected</h2>
      <p style="color:#555">Hi ${username}, your <strong>${type}</strong> of <strong>${parseFloat(amount_NSL||0).toFixed(2)} NSL</strong> was rejected.</p>
      ${reason ? `<div style="background:#fef2f2;border:1px solid #fecaca;border-radius:8px;padding:12px;margin:16px 0"><p style="color:#991b1b;margin:0">Reason: ${reason}</p></div>` : ''}
      ${btn(`${FRONTEND}/dashboard`, 'Go to Dashboard')}
    `));
  }

  async sendAccountApproved(email, username) {
    await this.send(email, 'Account Approved — SalonMoney', wrap(`
      <h2 style="color:#333;margin-top:0">🎉 Account Approved!</h2>
      <p style="color:#555">Hi ${username}, your SalonMoney account has been approved.</p>
      <p style="color:#555">You can now login and start investing.</p>
      ${btn(`${FRONTEND}/login`, 'Login Now')}
    `));
  }

  async sendNewReferral(email, username, referredUsername, bonusAmount) {
    await this.send(email, 'You Earned a Referral Bonus! — SalonMoney', wrap(`
      <h2 style="color:#333;margin-top:0">💰 Referral Bonus Earned!</h2>
      <p style="color:#555">Hi ${username},</p>
      <p style="color:#555"><strong>${referredUsername}</strong> just made their first purchase using your referral code.</p>
      <div style="background:#faf5ff;border:1px solid #e9d5ff;border-radius:8px;padding:16px;margin:16px 0;text-align:center">
        <p style="color:#7c3aed;font-size:24px;font-weight:700;margin:0">+${parseFloat(bonusAmount||0).toFixed(2)} NSL</p>
        <p style="color:#7c3aed;font-size:14px;margin:4px 0">Referral bonus credited to your account</p>
      </div>
      ${btn(`${FRONTEND}/referrals`, 'View Referrals')}
    `));
  }

  async sendKYCApproved(email, username) {
    await this.send(email, 'KYC Verified — SalonMoney', wrap(`
      <h2 style="color:#333;margin-top:0">✅ Identity Verified</h2>
      <p style="color:#555">Hi ${username},</p>
      <p style="color:#555">Your identity documents have been reviewed and your KYC verification is complete.</p>
      <p style="color:#555">You now have full access to all SalonMoney features.</p>
      ${btn(`${FRONTEND}/dashboard`, 'Go to Dashboard')}
    `));
  }

  async sendKYCRejected(email, username, reason) {
    await this.send(email, 'KYC Verification Failed — SalonMoney', wrap(`
      <h2 style="color:#333;margin-top:0">❌ KYC Verification Failed</h2>
      <p style="color:#555">Hi ${username},</p>
      <p style="color:#555">We were unable to verify your identity documents.</p>
      ${reason ? `<div style="background:#fef2f2;border:1px solid #fecaca;border-radius:8px;padding:12px;margin:16px 0"><p style="color:#991b1b;margin:0"><strong>Reason:</strong> ${reason}</p></div>` : ''}
      <p style="color:#555">Please resubmit clear, valid documents and try again.</p>
      ${btn(`${FRONTEND}/account/security`, 'Resubmit Documents')}
    `));
  }

  async sendDailyIncomeSummary(email, username, incomeNSL, newBalanceNSL) {
    await this.send(email, 'Daily Income Credited — SalonMoney', wrap(`
      <h2 style="color:#333;margin-top:0">💰 Daily Income Credited</h2>
      <p style="color:#555">Hi ${username},</p>
      <p style="color:#555">Your daily investment income has been credited to your account.</p>
      <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px;padding:16px;margin:16px 0">
        <p style="margin:4px 0;color:#166534">Today's Income: <strong>+${parseFloat(incomeNSL).toFixed(2)} NSL</strong></p>
        <p style="margin:4px 0;color:#166534">New Balance: <strong>${parseFloat(newBalanceNSL).toFixed(2)} NSL</strong></p>
      </div>
      ${btn(`${FRONTEND}/dashboard`, 'View Dashboard')}
    `));
  }

  async sendProductExpiring(email, username, productName, expiresAt, balanceNSL, requiredNSL) {
    const expiry = new Date(expiresAt).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
    const shortfall = (parseFloat(requiredNSL) - parseFloat(balanceNSL)).toFixed(2);
    await this.send(email, `Product Expired — SalonMoney`, wrap(`
      <h2 style="color:#333;margin-top:0">⚠️ Product Expired</h2>
      <p style="color:#555">Hi ${username},</p>
      <p style="color:#555">Your product <strong>${productName}</strong> expired on ${expiry} and could not be auto-renewed due to insufficient balance.</p>
      <div style="background:#fef2f2;border:1px solid #fecaca;border-radius:8px;padding:16px;margin:16px 0">
        <p style="margin:4px 0;color:#991b1b">Your Balance: <strong>${parseFloat(balanceNSL).toFixed(2)} NSL</strong></p>
        <p style="margin:4px 0;color:#991b1b">Required: <strong>${parseFloat(requiredNSL).toFixed(2)} NSL</strong></p>
        <p style="margin:4px 0;color:#991b1b">Shortfall: <strong>${shortfall} NSL</strong></p>
      </div>
      <p style="color:#555">Top up your account and reactivate the product to resume earning daily income.</p>
      ${btn(`${FRONTEND}/wallet`, 'Top Up Now')}
    `));
  }
}

module.exports = new EmailService();
