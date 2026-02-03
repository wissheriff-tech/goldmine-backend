/**
 * Database Initialization Script for Railway MySQL
 *
 * This script initializes the database with:
 * - All required tables
 * - Super Admin account (Wisradom)
 * - Default VIP products
 * - Exchange rates and currency rates
 *
 * Usage: node database/init-database.js
 */

const bcrypt = require('bcryptjs');
const { Sequelize, DataTypes } = require('sequelize');

// Railway Database URL
const DATABASE_URL = process.env.DATABASE_URL || 'mysql://root:CdcnQNLfAuXzpZEiaBeNjAbRuECldnQU@yamanote.proxy.rlwy.net:41765/railway';

// Super Admin credentials
const SUPER_ADMIN = {
  username: 'wisradom',
  phone: '+1000000000',
  password: 'Norman@1995?.',
  email: 'superadmin@salonmoney.com',
  role: 'superadmin',
  referral_code: 'SUPERADMIN01'
};

// VIP Products
const VIP_PRODUCTS = [
  { name: 'VIP0', description: 'Entry Level VIP Package', price_NSL: 0, price_usdt: 0, daily_income_NSL: 0, validity_days: 60, benefits: ['Basic features', 'Standard support'] },
  { name: 'VIP1', description: 'Bronze VIP Package', price_NSL: 575, price_usdt: 25, daily_income_NSL: 2.875, validity_days: 60, benefits: ['Enhanced features', 'Priority support', '5% daily income'] },
  { name: 'VIP2', description: 'Silver VIP Package', price_NSL: 2300, price_usdt: 100, daily_income_NSL: 13.8, validity_days: 60, benefits: ['Premium features', 'VIP support', '6% daily income'] },
  { name: 'VIP3', description: 'Gold VIP Package', price_NSL: 5750, price_usdt: 250, daily_income_NSL: 40.25, validity_days: 60, benefits: ['Gold features', 'Dedicated support', '7% daily income'] },
  { name: 'VIP4', description: 'Platinum VIP Package', price_NSL: 11500, price_usdt: 500, daily_income_NSL: 92, validity_days: 60, benefits: ['Platinum features', 'Personal manager', '8% daily income'] },
  { name: 'VIP5', description: 'Diamond VIP Package', price_NSL: 23000, price_usdt: 1000, daily_income_NSL: 207, validity_days: 60, benefits: ['Diamond features', 'Exclusive support', '9% daily income'] },
  { name: 'VIP6', description: 'Elite VIP Package', price_NSL: 57500, price_usdt: 2500, daily_income_NSL: 575, validity_days: 60, benefits: ['Elite features', '24/7 support', '10% daily income'] },
  { name: 'VIP7', description: 'Master VIP Package', price_NSL: 115000, price_usdt: 5000, daily_income_NSL: 1265, validity_days: 60, benefits: ['Master features', 'Premium manager', '11% daily income'] },
  { name: 'VIP8', description: 'Champion VIP Package', price_NSL: 230000, price_usdt: 10000, daily_income_NSL: 2760, validity_days: 60, benefits: ['Champion features', 'Elite support', '12% daily income'] },
  { name: 'VIP9', description: 'Legend VIP Package', price_NSL: 575000, price_usdt: 25000, daily_income_NSL: 7475, validity_days: 60, benefits: ['All features unlocked', 'Concierge service', '13% daily income'] }
];

// Exchange Rates
const EXCHANGE_RATES = [
  { currency_code: 'USD', currency_name: 'US Dollar', currency_symbol: '$', rate_to_usd: 1, usd_per_unit: 1, country: 'United States' },
  { currency_code: 'EUR', currency_name: 'Euro', currency_symbol: '€', rate_to_usd: 0.92, usd_per_unit: 1.086957, country: 'European Union' },
  { currency_code: 'GBP', currency_name: 'British Pound', currency_symbol: '£', rate_to_usd: 0.79, usd_per_unit: 1.265823, country: 'United Kingdom' },
  { currency_code: 'NGN', currency_name: 'Nigerian Naira', currency_symbol: '₦', rate_to_usd: 1550, usd_per_unit: 0.000645, country: 'Nigeria' },
  { currency_code: 'KES', currency_name: 'Kenyan Shilling', currency_symbol: 'KSh', rate_to_usd: 153, usd_per_unit: 0.006536, country: 'Kenya' },
  { currency_code: 'GHS', currency_name: 'Ghanaian Cedi', currency_symbol: 'GH₵', rate_to_usd: 15.5, usd_per_unit: 0.064516, country: 'Ghana' },
  { currency_code: 'ZAR', currency_name: 'South African Rand', currency_symbol: 'R', rate_to_usd: 18.5, usd_per_unit: 0.054054, country: 'South Africa' },
  { currency_code: 'INR', currency_name: 'Indian Rupee', currency_symbol: '₹', rate_to_usd: 83, usd_per_unit: 0.012048, country: 'India' },
  { currency_code: 'CNY', currency_name: 'Chinese Yuan', currency_symbol: '¥', rate_to_usd: 7.25, usd_per_unit: 0.137931, country: 'China' },
  { currency_code: 'JPY', currency_name: 'Japanese Yen', currency_symbol: '¥', rate_to_usd: 150, usd_per_unit: 0.006667, country: 'Japan' }
];

// Currency Rates (NSL conversion - 1 USDT = 23 NSL)
const NSL_PER_USDT = 23;
const CURRENCY_RATES = [
  { currency_code: 'USD', currency_name: 'US Dollar', rate_to_usd: 1 },
  { currency_code: 'USDT', currency_name: 'Tether USD', rate_to_usd: 1 },
  { currency_code: 'EUR', currency_name: 'Euro', rate_to_usd: 0.92 },
  { currency_code: 'GBP', currency_name: 'British Pound', rate_to_usd: 0.79 },
  { currency_code: 'NGN', currency_name: 'Nigerian Naira', rate_to_usd: 1550 },
  { currency_code: 'KES', currency_name: 'Kenyan Shilling', rate_to_usd: 153 },
  { currency_code: 'GHS', currency_name: 'Ghanaian Cedi', rate_to_usd: 15.5 },
  { currency_code: 'ZAR', currency_name: 'South African Rand', rate_to_usd: 18.5 }
];

async function initDatabase() {
  console.log('========================================');
  console.log('SalonMoney Database Initialization');
  console.log('========================================\n');

  // Connect to database
  console.log('Connecting to Railway MySQL database...');
  console.log(`URL: ${DATABASE_URL.replace(/:[^:@]+@/, ':****@')}\n`);

  const sequelize = new Sequelize(DATABASE_URL, {
    dialect: 'mysql',
    logging: false,
    pool: {
      max: 5,
      min: 0,
      acquire: 60000,
      idle: 10000
    },
    dialectOptions: {
      connectTimeout: 60000
    }
  });

  try {
    await sequelize.authenticate();
    console.log('✓ Database connection established\n');

    // Define models inline for initialization
    console.log('Defining models...');

    // User Model
    const User = sequelize.define('User', {
      id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
      username: { type: DataTypes.STRING, allowNull: false, unique: true },
      phone: { type: DataTypes.STRING(50), allowNull: false, unique: true },
      password_hash: { type: DataTypes.STRING, allowNull: false },
      role: { type: DataTypes.ENUM('user', 'admin', 'superadmin', 'finance', 'verificator', 'approval'), defaultValue: 'user' },
      referral_code: { type: DataTypes.STRING(50), unique: true, allowNull: true },
      referred_by: { type: DataTypes.STRING(50), allowNull: true },
      balance_NSL: { type: DataTypes.DECIMAL(18, 4), defaultValue: 0 },
      balance_usdt: { type: DataTypes.DECIMAL(18, 4), defaultValue: 0 },
      vip_level: { type: DataTypes.ENUM('VIP0', 'VIP1', 'VIP2', 'VIP3', 'VIP4', 'VIP5', 'VIP6', 'VIP7', 'VIP8', 'VIP9', 'none'), defaultValue: 'none' },
      status: { type: DataTypes.ENUM('active', 'frozen', 'pending'), defaultValue: 'pending' },
      kyc_verified: { type: DataTypes.BOOLEAN, defaultValue: false },
      kyc_id_front: { type: DataTypes.STRING(500), allowNull: true },
      kyc_id_back: { type: DataTypes.STRING(500), allowNull: true },
      kyc_selfie: { type: DataTypes.STRING(500), allowNull: true },
      kyc_additional: { type: DataTypes.STRING(500), allowNull: true },
      email: { type: DataTypes.STRING, unique: true, allowNull: true },
      resetPasswordToken: { type: DataTypes.STRING, allowNull: true },
      resetPasswordExpires: { type: DataTypes.DATE, allowNull: true },
      twoFactorEnabled: { type: DataTypes.BOOLEAN, defaultValue: false },
      twoFactorCode: { type: DataTypes.STRING(10), allowNull: true },
      twoFactorExpires: { type: DataTypes.DATE, allowNull: true },
      emailVerified: { type: DataTypes.BOOLEAN, defaultValue: false },
      emailVerificationToken: { type: DataTypes.STRING, allowNull: true },
      emailVerificationExpires: { type: DataTypes.DATE, allowNull: true },
      googleId: { type: DataTypes.STRING, allowNull: true },
      facebookId: { type: DataTypes.STRING, allowNull: true },
      authProvider: { type: DataTypes.ENUM('local', 'google', 'facebook'), defaultValue: 'local' },
      profile_photo: { type: DataTypes.STRING(500), allowNull: true },
      binance_account_id: { type: DataTypes.STRING, allowNull: true },
      binance_wallet_address: { type: DataTypes.STRING, allowNull: true },
      binance_wallet_verified: { type: DataTypes.BOOLEAN, defaultValue: false },
      binance_wallet_verified_by: { type: DataTypes.INTEGER, allowNull: true },
      binance_wallet_verified_at: { type: DataTypes.DATE, allowNull: true },
      preferred_currency: { type: DataTypes.STRING(10), defaultValue: 'USD' },
      last_login: { type: DataTypes.DATE, allowNull: true }
    }, { tableName: 'users', timestamps: true, createdAt: 'created_at', updatedAt: 'updated_at' });

    // Product Model
    const Product = sequelize.define('Product', {
      id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
      name: { type: DataTypes.ENUM('VIP0', 'VIP1', 'VIP2', 'VIP3', 'VIP4', 'VIP5', 'VIP6', 'VIP7', 'VIP8', 'VIP9'), allowNull: false, unique: true },
      description: { type: DataTypes.TEXT, allowNull: true },
      price_NSL: { type: DataTypes.DECIMAL(18, 4), allowNull: false },
      price_usdt: { type: DataTypes.DECIMAL(18, 4), allowNull: false },
      daily_income_NSL: { type: DataTypes.DECIMAL(18, 4), allowNull: false },
      validity_days: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 60 },
      benefits: { type: DataTypes.JSON, defaultValue: [] },
      active: { type: DataTypes.BOOLEAN, defaultValue: true }
    }, { tableName: 'products', timestamps: true, createdAt: 'created_at', updatedAt: 'updated_at' });

    // UserProduct Model
    const UserProduct = sequelize.define('UserProduct', {
      id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
      user_id: { type: DataTypes.INTEGER, allowNull: false },
      product_id: { type: DataTypes.INTEGER, allowNull: false },
      purchase_date: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
      expires_at: { type: DataTypes.DATE, allowNull: false },
      auto_renew: { type: DataTypes.BOOLEAN, defaultValue: true },
      is_active: { type: DataTypes.BOOLEAN, defaultValue: true }
    }, { tableName: 'user_products', timestamps: true, createdAt: 'created_at', updatedAt: 'updated_at' });

    // Transaction Model
    const Transaction = sequelize.define('Transaction', {
      id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
      user_id: { type: DataTypes.INTEGER, allowNull: false },
      type: { type: DataTypes.ENUM('recharge', 'withdrawal', 'income', 'referral_bonus', 'purchase', 'renewal'), allowNull: false },
      product_id: { type: DataTypes.INTEGER, allowNull: true },
      amount_NSL: { type: DataTypes.DECIMAL(18, 4), defaultValue: 0 },
      amount_usdt: { type: DataTypes.DECIMAL(18, 4), defaultValue: 0 },
      status: { type: DataTypes.ENUM('pending', 'approved', 'rejected', 'completed'), defaultValue: 'pending' },
      approved_by: { type: DataTypes.INTEGER, allowNull: true },
      notes: { type: DataTypes.TEXT, allowNull: true },
      binance_tx_id: { type: DataTypes.STRING, allowNull: true },
      binance_withdraw_id: { type: DataTypes.STRING, allowNull: true },
      deposit_address: { type: DataTypes.STRING, allowNull: true },
      deposit_network: { type: DataTypes.STRING(50), defaultValue: 'BSC' },
      withdrawal_address: { type: DataTypes.STRING, allowNull: true },
      withdrawal_network: { type: DataTypes.STRING(50), defaultValue: 'BSC' },
      payment_method: { type: DataTypes.ENUM('binance', 'manual', 'crypto_wallet'), defaultValue: 'binance' },
      payment_proof: { type: DataTypes.STRING(500), allowNull: true },
      admin_notes: { type: DataTypes.TEXT, allowNull: true },
      timestamp: { type: DataTypes.DATE, defaultValue: DataTypes.NOW },
      completed_at: { type: DataTypes.DATE, allowNull: true },
      rejected_at: { type: DataTypes.DATE, allowNull: true },
      confirmations: { type: DataTypes.INTEGER, defaultValue: 0 }
    }, { tableName: 'transactions', timestamps: true, createdAt: 'created_at', updatedAt: 'updated_at' });

    // WithdrawalAddress Model
    const WithdrawalAddress = sequelize.define('WithdrawalAddress', {
      id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
      user_id: { type: DataTypes.INTEGER, allowNull: false },
      address: { type: DataTypes.STRING, allowNull: false },
      network: { type: DataTypes.STRING(50), allowNull: false, defaultValue: 'BSC' },
      currency: { type: DataTypes.STRING(50), allowNull: false, defaultValue: 'USDT' },
      label: { type: DataTypes.STRING, allowNull: true },
      verified: { type: DataTypes.BOOLEAN, defaultValue: false },
      verified_by: { type: DataTypes.INTEGER, allowNull: true },
      verified_at: { type: DataTypes.DATE, allowNull: true },
      added_at: { type: DataTypes.DATE, defaultValue: DataTypes.NOW }
    }, { tableName: 'withdrawal_addresses', timestamps: true, createdAt: 'created_at', updatedAt: 'updated_at' });

    // Session Model
    const Session = sequelize.define('Session', {
      id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
      user_id: { type: DataTypes.INTEGER, allowNull: false },
      refresh_token: { type: DataTypes.STRING(500), allowNull: false, unique: true },
      device_info: { type: DataTypes.JSON, allowNull: true },
      is_active: { type: DataTypes.BOOLEAN, defaultValue: true },
      last_activity: { type: DataTypes.DATE, defaultValue: DataTypes.NOW },
      expires_at: { type: DataTypes.DATE, allowNull: false }
    }, { tableName: 'sessions', timestamps: true, createdAt: 'created_at', updatedAt: 'updated_at' });

    // Chat Model
    const Chat = sequelize.define('Chat', {
      id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
      user_id: { type: DataTypes.INTEGER, allowNull: false },
      admin_id: { type: DataTypes.INTEGER, allowNull: true },
      status: { type: DataTypes.ENUM('open', 'assigned', 'resolved', 'closed'), defaultValue: 'open' },
      priority: { type: DataTypes.ENUM('low', 'medium', 'high', 'urgent'), defaultValue: 'medium' },
      category: { type: DataTypes.ENUM('general', 'transaction', 'technical', 'account', 'vip', 'kyc'), defaultValue: 'general' },
      subject: { type: DataTypes.STRING(200), allowNull: true },
      last_message_at: { type: DataTypes.DATE, defaultValue: DataTypes.NOW },
      resolved_at: { type: DataTypes.DATE, allowNull: true },
      closed_at: { type: DataTypes.DATE, allowNull: true },
      user_typing: { type: DataTypes.BOOLEAN, defaultValue: false },
      admin_typing: { type: DataTypes.BOOLEAN, defaultValue: false },
      rating: { type: DataTypes.INTEGER, allowNull: true },
      feedback: { type: DataTypes.TEXT, allowNull: true },
      tags: { type: DataTypes.JSON, defaultValue: [] }
    }, { tableName: 'chats', timestamps: true, createdAt: 'created_at', updatedAt: 'updated_at' });

    // ChatMessage Model
    const ChatMessage = sequelize.define('ChatMessage', {
      id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
      chat_id: { type: DataTypes.INTEGER, allowNull: false },
      sender_id: { type: DataTypes.INTEGER, allowNull: false },
      sender_role: { type: DataTypes.ENUM('user', 'admin', 'superadmin', 'finance', 'support'), allowNull: false },
      message: { type: DataTypes.TEXT, allowNull: false },
      message_type: { type: DataTypes.ENUM('text', 'image', 'file', 'system'), defaultValue: 'text' },
      attachment_url: { type: DataTypes.STRING(500), allowNull: true },
      read: { type: DataTypes.BOOLEAN, defaultValue: false },
      read_at: { type: DataTypes.DATE, allowNull: true }
    }, { tableName: 'chat_messages', timestamps: true, createdAt: 'created_at', updatedAt: false });

    // Notification Model
    const Notification = sequelize.define('Notification', {
      id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
      user_id: { type: DataTypes.INTEGER, allowNull: false },
      type: { type: DataTypes.ENUM('transaction_approved', 'transaction_rejected', 'product_purchased', 'product_expiring', 'product_expired', 'daily_income', 'referral_bonus', 'account_approved', 'account_suspended', 'kyc_verified', 'kyc_rejected', 'withdrawal_approved', 'withdrawal_rejected', 'recharge_approved', 'recharge_rejected', 'system_announcement', 'security_alert', 'vip_upgrade'), allowNull: false },
      title: { type: DataTypes.STRING(200), allowNull: false },
      message: { type: DataTypes.STRING(1000), allowNull: false },
      data: { type: DataTypes.JSON, defaultValue: {} },
      read: { type: DataTypes.BOOLEAN, defaultValue: false },
      priority: { type: DataTypes.ENUM('low', 'medium', 'high', 'urgent'), defaultValue: 'medium' },
      action_url: { type: DataTypes.STRING, allowNull: true },
      icon: { type: DataTypes.STRING, allowNull: true },
      read_at: { type: DataTypes.DATE, allowNull: true },
      expires_at: { type: DataTypes.DATE, allowNull: true }
    }, { tableName: 'notifications', timestamps: true, createdAt: 'created_at', updatedAt: 'updated_at' });

    // Referral Model
    const Referral = sequelize.define('Referral', {
      id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
      referrer_id: { type: DataTypes.INTEGER, allowNull: false },
      referred_id: { type: DataTypes.INTEGER, allowNull: false },
      bonus_NSL: { type: DataTypes.DECIMAL(18, 4), defaultValue: 0 },
      recharge_amount_NSL: { type: DataTypes.DECIMAL(18, 4), defaultValue: 0 },
      bonus_percentage: { type: DataTypes.DECIMAL(5, 2), defaultValue: 35 },
      status: { type: DataTypes.ENUM('pending', 'approved', 'paid'), defaultValue: 'pending' },
      timestamp: { type: DataTypes.DATE, defaultValue: DataTypes.NOW }
    }, { tableName: 'referrals', timestamps: true, createdAt: 'created_at', updatedAt: 'updated_at' });

    // TwoFactorAuth Model
    const TwoFactorAuth = sequelize.define('TwoFactorAuth', {
      id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
      user_id: { type: DataTypes.INTEGER, allowNull: false, unique: true },
      secret: { type: DataTypes.STRING, allowNull: false },
      backup_codes: { type: DataTypes.JSON, defaultValue: [] },
      enabled: { type: DataTypes.BOOLEAN, defaultValue: false },
      method: { type: DataTypes.ENUM('app', 'sms', 'email'), defaultValue: 'app' },
      verified_at: { type: DataTypes.DATE, allowNull: true },
      last_used: { type: DataTypes.DATE, allowNull: true }
    }, { tableName: 'two_factor_auth', timestamps: true, createdAt: 'created_at', updatedAt: 'updated_at' });

    // ExchangeRate Model
    const ExchangeRate = sequelize.define('ExchangeRate', {
      id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
      currency_code: { type: DataTypes.STRING(10), allowNull: false, unique: true },
      currency_name: { type: DataTypes.STRING, allowNull: false },
      currency_symbol: { type: DataTypes.STRING(10), defaultValue: '$' },
      rate_to_usd: { type: DataTypes.DECIMAL(18, 8), allowNull: false },
      usd_per_unit: { type: DataTypes.DECIMAL(18, 8), allowNull: false },
      binance_rate: { type: DataTypes.DECIMAL(18, 8), allowNull: true },
      admin_override_rate: { type: DataTypes.DECIMAL(18, 8), allowNull: true },
      active_rate_source: { type: DataTypes.ENUM('binance', 'admin'), defaultValue: 'binance' },
      override_set_by: { type: DataTypes.INTEGER, allowNull: true },
      override_reason: { type: DataTypes.STRING, allowNull: true },
      override_set_at: { type: DataTypes.DATE, allowNull: true },
      last_binance_update: { type: DataTypes.DATE, allowNull: true },
      enabled: { type: DataTypes.BOOLEAN, defaultValue: true },
      country: { type: DataTypes.STRING, allowNull: true },
      notes: { type: DataTypes.TEXT, allowNull: true }
    }, { tableName: 'exchange_rates', timestamps: true, createdAt: 'created_at', updatedAt: 'updated_at' });

    // CurrencyRate Model
    const CurrencyRate = sequelize.define('CurrencyRate', {
      id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
      currency_code: { type: DataTypes.STRING(10), allowNull: false, unique: true },
      currency_name: { type: DataTypes.STRING, allowNull: false },
      rate_to_usd: { type: DataTypes.DECIMAL(18, 8), allowNull: false },
      rate_to_nsl: { type: DataTypes.DECIMAL(18, 8), allowNull: false },
      enabled: { type: DataTypes.BOOLEAN, defaultValue: true },
      updated_by: { type: DataTypes.INTEGER, allowNull: true }
    }, { tableName: 'currency_rates', timestamps: true, createdAt: 'created_at', updatedAt: 'updated_at' });

    // DepositProof Model
    const DepositProof = sequelize.define('DepositProof', {
      id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
      user_id: { type: DataTypes.INTEGER, allowNull: false },
      receipt_image: { type: DataTypes.STRING(500), allowNull: false },
      original_filename: { type: DataTypes.STRING, allowNull: true },
      ocr_extracted_data: { type: DataTypes.JSON, allowNull: true },
      user_submitted_amount: { type: DataTypes.DECIMAL(18, 4), allowNull: false },
      user_submitted_currency: { type: DataTypes.STRING(20), defaultValue: 'USDT' },
      user_submitted_txid: { type: DataTypes.STRING, allowNull: true },
      user_notes: { type: DataTypes.TEXT, allowNull: true },
      status: { type: DataTypes.ENUM('pending', 'reviewing', 'approved', 'rejected'), defaultValue: 'pending' },
      reviewed_by: { type: DataTypes.INTEGER, allowNull: true },
      reviewed_at: { type: DataTypes.DATE, allowNull: true },
      admin_notes: { type: DataTypes.TEXT, allowNull: true },
      rejection_reason: { type: DataTypes.TEXT, allowNull: true },
      approved_amount: { type: DataTypes.DECIMAL(18, 4), allowNull: true },
      approved_currency: { type: DataTypes.STRING(20), allowNull: true },
      approved_transaction_id: { type: DataTypes.STRING, allowNull: true },
      transaction_id: { type: DataTypes.INTEGER, allowNull: true },
      ocr_processed: { type: DataTypes.BOOLEAN, defaultValue: false },
      ocr_failed: { type: DataTypes.BOOLEAN, defaultValue: false },
      ocr_error: { type: DataTypes.TEXT, allowNull: true },
      deposit_type: { type: DataTypes.ENUM('binance', 'crypto_wallet', 'bank_transfer', 'other'), defaultValue: 'binance' },
      ip_address: { type: DataTypes.STRING(45), allowNull: true },
      device_info: { type: DataTypes.STRING, allowNull: true }
    }, { tableName: 'deposit_proofs', timestamps: true, createdAt: 'created_at', updatedAt: 'updated_at' });

    console.log('✓ Models defined\n');

    // Sync database (create tables)
    console.log('Creating database tables...');
    await sequelize.sync({ force: true });
    console.log('✓ All tables created\n');

    // Create Super Admin
    console.log('Creating Super Admin account...');
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(SUPER_ADMIN.password, salt);

    const superAdmin = await User.create({
      username: SUPER_ADMIN.username,
      phone: SUPER_ADMIN.phone,
      password_hash: hashedPassword,
      role: SUPER_ADMIN.role,
      referral_code: SUPER_ADMIN.referral_code,
      email: SUPER_ADMIN.email,
      balance_NSL: 100000,
      balance_usdt: 10000,
      vip_level: 'VIP9',
      status: 'active',
      kyc_verified: true,
      emailVerified: true,
      authProvider: 'local',
      preferred_currency: 'USD'
    });
    console.log(`✓ Super Admin created: ${superAdmin.username} (ID: ${superAdmin.id})`);
    console.log(`  Username: ${SUPER_ADMIN.username}`);
    console.log(`  Password: ${SUPER_ADMIN.password}`);
    console.log(`  Role: ${SUPER_ADMIN.role}\n`);

    // Create VIP Products
    console.log('Creating VIP products...');
    for (const product of VIP_PRODUCTS) {
      await Product.create({
        name: product.name,
        description: product.description,
        price_NSL: product.price_NSL,
        price_usdt: product.price_usdt,
        daily_income_NSL: product.daily_income_NSL,
        validity_days: product.validity_days,
        benefits: product.benefits,
        active: true
      });
      console.log(`  ✓ ${product.name} - ${product.description}`);
    }
    console.log('✓ All VIP products created\n');

    // Create Exchange Rates
    console.log('Creating exchange rates...');
    for (const rate of EXCHANGE_RATES) {
      await ExchangeRate.create({
        currency_code: rate.currency_code,
        currency_name: rate.currency_name,
        currency_symbol: rate.currency_symbol,
        rate_to_usd: rate.rate_to_usd,
        usd_per_unit: rate.usd_per_unit,
        country: rate.country,
        enabled: true
      });
      console.log(`  ✓ ${rate.currency_code} - ${rate.currency_name}`);
    }
    console.log('✓ All exchange rates created\n');

    // Create Currency Rates
    console.log('Creating currency rates...');
    for (const rate of CURRENCY_RATES) {
      await CurrencyRate.create({
        currency_code: rate.currency_code,
        currency_name: rate.currency_name,
        rate_to_usd: rate.rate_to_usd,
        rate_to_nsl: rate.rate_to_usd * NSL_PER_USDT,
        enabled: true
      });
      console.log(`  ✓ ${rate.currency_code} - Rate to NSL: ${rate.rate_to_usd * NSL_PER_USDT}`);
    }
    console.log('✓ All currency rates created\n');

    // Create welcome notification for Super Admin
    console.log('Creating welcome notification...');
    await Notification.create({
      user_id: superAdmin.id,
      type: 'system_announcement',
      title: 'Welcome to SalonMoney Admin',
      message: 'Your superadmin account has been created successfully. You can now manage the platform.',
      data: { action: 'welcome' },
      priority: 'high'
    });
    console.log('✓ Welcome notification created\n');

    // Summary
    console.log('========================================');
    console.log('Database Initialization Complete!');
    console.log('========================================\n');

    const userCount = await User.count();
    const productCount = await Product.count();
    const exchangeRateCount = await ExchangeRate.count();
    const currencyRateCount = await CurrencyRate.count();

    console.log('Summary:');
    console.log(`  - Users: ${userCount}`);
    console.log(`  - Products: ${productCount}`);
    console.log(`  - Exchange Rates: ${exchangeRateCount}`);
    console.log(`  - Currency Rates: ${currencyRateCount}`);
    console.log('\n========================================');
    console.log('SUPER ADMIN CREDENTIALS');
    console.log('========================================');
    console.log(`Username: ${SUPER_ADMIN.username}`);
    console.log(`Password: ${SUPER_ADMIN.password}`);
    console.log('========================================\n');

    await sequelize.close();
    console.log('Database connection closed.');
    process.exit(0);

  } catch (error) {
    console.error('\n✗ Error initializing database:', error.message);
    console.error(error);
    try {
      await sequelize.close();
    } catch (e) {}
    process.exit(1);
  }
}

// Run initialization
initDatabase();
