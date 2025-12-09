/**
 * Complete MongoDB Database Seeding Script
 * This script initializes the entire database with:
 * - Collections and indexes
 * - Super admin user
 * - VIP products (VIP0-VIP9)
 * - Currency rates
 *
 * Usage: node seed_all.js
 */

const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
require('dotenv').config({ path: '../../.env' });

// Import models
const User = require('../../models/User');
const Product = require('../../models/Product');
const CurrencyRate = require('../../models/CurrencyRate');

const seedDatabase = async () => {
  try {
    console.log('🚀 Starting Complete Database Seeding...\n');

    // Connect to MongoDB
    console.log('🔄 Connecting to MongoDB...');
    await mongoose.connect(process.env.MONGODB_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true
    });
    console.log('✅ Connected to MongoDB!\n');

    // ============================================
    // STEP 1: Create Indexes
    // ============================================
    console.log('📋 STEP 1: Creating Collections and Indexes\n');

    await User.createIndexes();
    console.log('✅ User indexes created');

    await Product.createIndexes();
    console.log('✅ Product indexes created');

    await CurrencyRate.createIndexes();
    console.log('✅ CurrencyRate indexes created');

    // ============================================
    // STEP 2: Create Super Admin User
    // ============================================
    console.log('\n📋 STEP 2: Creating Super Admin User\n');

    const adminUsername = process.env.SUPER_ADMIN_USERNAME || 'superadmin';
    const adminEmail = process.env.SUPER_ADMIN_EMAIL || 'admin@salonmoney.com';
    const adminPhone = process.env.SUPER_ADMIN_PHONE || '+232777777777';
    const adminPassword = process.env.SUPER_ADMIN_PASSWORD || 'Admin@123456';

    // Check if admin already exists
    const existingAdmin = await User.findOne({
      $or: [
        { username: adminUsername },
        { email: adminEmail },
        { phone: adminPhone }
      ]
    });

    if (existingAdmin) {
      console.log('⚠️  Super Admin already exists!');
      console.log(`   Username: ${existingAdmin.username}`);
      console.log(`   Email: ${existingAdmin.email}`);
      console.log(`   Phone: ${existingAdmin.phone}`);
    } else {
      // Create super admin
      const referralCode = Math.random().toString(36).substring(2, 12).toUpperCase();

      const admin = new User({
        username: adminUsername,
        phone: adminPhone,
        email: adminEmail,
        password_hash: adminPassword, // Will be hashed by pre-save hook
        role: 'superadmin',
        status: 'active',
        kyc_verified: true,
        emailVerified: true,
        referral_code: referralCode,
        balance_NSL: 0,
        balance_usdt: 0
      });

      await admin.save();
      console.log('✅ Super Admin created successfully!');
      console.log(`   Username: ${adminUsername}`);
      console.log(`   Email: ${adminEmail}`);
      console.log(`   Phone: ${adminPhone}`);
      console.log(`   Password: ${adminPassword}`);
      console.log(`   Referral Code: ${referralCode}`);
      console.log('\n⚠️  IMPORTANT: Change the password after first login!');
    }

    // ============================================
    // STEP 3: Create VIP Products
    // ============================================
    console.log('\n📋 STEP 3: Creating VIP Products\n');

    const products = [
      {
        name: 'VIP1',
        description: 'Entry Level VIP - Start your journey',
        price_NSL: 100,
        price_usdt: 4.35,
        daily_income_NSL: 5,
        validity_days: 60,
        benefits: ['Daily income: 5 NSL', 'Valid for 60 days', 'Auto-renewal option', 'Basic support']
      },
      {
        name: 'VIP2',
        description: 'Silver VIP - Enhanced benefits',
        price_NSL: 500,
        price_usdt: 21.74,
        daily_income_NSL: 28,
        validity_days: 60,
        benefits: ['Daily income: 28 NSL', 'Valid for 60 days', 'Auto-renewal option', 'Priority support', '5% bonus on recharge']
      },
      {
        name: 'VIP3',
        description: 'Gold VIP - Premium experience',
        price_NSL: 1500,
        price_usdt: 65.22,
        daily_income_NSL: 90,
        validity_days: 60,
        benefits: ['Daily income: 90 NSL', 'Valid for 60 days', 'Auto-renewal option', 'VIP support', '10% bonus on recharge', 'Exclusive features']
      },
      {
        name: 'VIP4',
        description: 'Platinum VIP - Elite status',
        price_NSL: 3500,
        price_usdt: 152.17,
        daily_income_NSL: 220,
        validity_days: 60,
        benefits: ['Daily income: 220 NSL', 'Valid for 60 days', 'Auto-renewal option', 'Dedicated support', '15% bonus on recharge', 'Early access to features']
      },
      {
        name: 'VIP5',
        description: 'Diamond VIP - Luxury tier',
        price_NSL: 8000,
        price_usdt: 347.83,
        daily_income_NSL: 520,
        validity_days: 60,
        benefits: ['Daily income: 520 NSL', 'Valid for 60 days', 'Auto-renewal option', '24/7 support', '20% bonus on recharge', 'Premium features']
      },
      {
        name: 'VIP6',
        description: 'Crown VIP - Supreme benefits',
        price_NSL: 15000,
        price_usdt: 652.17,
        daily_income_NSL: 1050,
        validity_days: 60,
        benefits: ['Daily income: 1050 NSL', 'Valid for 60 days', 'Auto-renewal option', 'Personal account manager', '25% bonus on recharge', 'All premium features']
      },
      {
        name: 'VIP7',
        description: 'Royal VIP - Exclusive privileges',
        price_NSL: 30000,
        price_usdt: 1304.35,
        daily_income_NSL: 2250,
        validity_days: 60,
        benefits: ['Daily income: 2250 NSL', 'Valid for 60 days', 'Auto-renewal option', 'VIP account manager', '30% bonus on recharge', 'Beta features access', 'Priority withdrawals']
      },
      {
        name: 'VIP8',
        description: 'Imperial VIP - Ultimate experience',
        price_NSL: 60000,
        price_usdt: 2608.70,
        daily_income_NSL: 4800,
        validity_days: 60,
        benefits: ['Daily income: 4800 NSL', 'Valid for 60 days', 'Auto-renewal option', 'Dedicated VIP team', '35% bonus on recharge', 'All features unlocked', 'Instant withdrawals', 'Custom limits']
      }
    ];

    let createdCount = 0;
    let existingCount = 0;

    for (const productData of products) {
      const existing = await Product.findOne({ name: productData.name });
      if (existing) {
        existingCount++;
        console.log(`⚠️  ${productData.name} already exists - skipping`);
      } else {
        await Product.create(productData);
        createdCount++;
        console.log(`✅ ${productData.name} created - ${productData.daily_income_NSL} NSL/day`);
      }
    }

    console.log(`\n✅ Products Summary:`);
    console.log(`   Created: ${createdCount}`);
    console.log(`   Already Existed: ${existingCount}`);
    console.log(`   Total: ${products.length}`);

    // ============================================
    // STEP 4: Create Currency Rates
    // ============================================
    console.log('\n📋 STEP 4: Creating Currency Rates\n');

    const currencies = [
      { currency_code: 'USD', currency_name: 'US Dollar', rate_to_usd: 1.0 },
      { currency_code: 'EUR', currency_name: 'Euro', rate_to_usd: 1.08 },
      { currency_code: 'GBP', currency_name: 'British Pound', rate_to_usd: 1.27 },
      { currency_code: 'JPY', currency_name: 'Japanese Yen', rate_to_usd: 0.0067 },
      { currency_code: 'CNY', currency_name: 'Chinese Yuan', rate_to_usd: 0.14 },
      { currency_code: 'AED', currency_name: 'UAE Dirham', rate_to_usd: 0.27 },
      { currency_code: 'CAD', currency_name: 'Canadian Dollar', rate_to_usd: 0.71 },
      { currency_code: 'AUD', currency_name: 'Australian Dollar', rate_to_usd: 0.63 },
      { currency_code: 'INR', currency_name: 'Indian Rupee', rate_to_usd: 0.012 },
      { currency_code: 'NGN', currency_name: 'Nigerian Naira', rate_to_usd: 0.00063 },
      { currency_code: 'ZAR', currency_name: 'South African Rand', rate_to_usd: 0.054 },
      { currency_code: 'SLL', currency_name: 'Sierra Leonean Leone', rate_to_usd: 0.000048 }
    ];

    let currencyCreated = 0;
    let currencyExisting = 0;

    for (const currencyData of currencies) {
      const existing = await CurrencyRate.findOne({ currency_code: currencyData.currency_code });
      if (existing) {
        currencyExisting++;
        console.log(`⚠️  ${currencyData.currency_code} already exists - skipping`);
      } else {
        await CurrencyRate.create(currencyData);
        currencyCreated++;
        console.log(`✅ ${currencyData.currency_code} (${currencyData.currency_name}) created`);
      }
    }

    console.log(`\n✅ Currency Rates Summary:`);
    console.log(`   Created: ${currencyCreated}`);
    console.log(`   Already Existed: ${currencyExisting}`);
    console.log(`   Total: ${currencies.length}`);

    // ============================================
    // SUMMARY
    // ============================================
    console.log('\n' + '='.repeat(60));
    console.log('🎉 DATABASE SEEDING COMPLETE!');
    console.log('='.repeat(60));

    console.log('\n📊 Summary:');
    console.log(`   ✅ Collections and Indexes created`);
    console.log(`   ✅ Super Admin: ${existingAdmin ? 'Already existed' : 'Created'}`);
    console.log(`   ✅ VIP Products: ${createdCount} created, ${existingCount} existed`);
    console.log(`   ✅ Currency Rates: ${currencyCreated} created, ${currencyExisting} existed`);

    console.log('\n📌 Login Credentials:');
    console.log(`   Username: ${adminUsername}`);
    console.log(`   Email: ${adminEmail}`);
    console.log(`   Phone: ${adminPhone}`);
    console.log(`   Password: ${adminPassword}`);

    console.log('\n⚠️  SECURITY REMINDERS:');
    console.log('   1. Change the super admin password immediately');
    console.log('   2. Update JWT_SECRET and REFRESH_TOKEN_SECRET in .env');
    console.log('   3. Configure email service for notifications');
    console.log('   4. Review and adjust VIP product prices if needed');

    console.log('\n🚀 Your SalonMoney database is ready to use!');

  } catch (error) {
    console.error('\n❌ Error seeding database:', error);
    process.exit(1);
  } finally {
    await mongoose.disconnect();
    console.log('\n🔌 Disconnected from MongoDB\n');
  }
};

// Run seeding
seedDatabase();
