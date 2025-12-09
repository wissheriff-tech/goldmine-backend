/**
 * Verify SuperAdmin Account
 * This script checks if the superadmin account exists and shows the details
 */

const mongoose = require('mongoose');
const dotenv = require('dotenv');
const bcrypt = require('bcryptjs');
const User = require('../models/User');

dotenv.config();

async function verifySuperAdmin() {
  try {
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/salonmoney', {
      useNewUrlParser: true,
      useUnifiedTopology: true
    });

    console.log('🔌 Connected to MongoDB\n');

    const username = process.env.SUPER_ADMIN_USERNAME || 'superadmin';
    const password = process.env.SUPER_ADMIN_PASSWORD || 'Admin@SuperSecure2024!';

    // Find superadmin by username
    const superadmin = await User.findOne({ username: username.toLowerCase() });

    if (!superadmin) {
      console.log('❌ SuperAdmin account NOT found!');
      console.log('\nPlease run: npm run seed:admin');
      process.exit(1);
    }

    console.log('✅ SuperAdmin Account Found!\n');
    console.log('═══════════════════════════════════════');
    console.log('📋 Account Details:');
    console.log('═══════════════════════════════════════');
    console.log('Username:', superadmin.username);
    console.log('Phone:', superadmin.phone);
    console.log('Email:', superadmin.email || 'Not set');
    console.log('Role:', superadmin.role);
    console.log('Status:', superadmin.status);
    console.log('VIP Level:', superadmin.vip_level);
    console.log('KYC Verified:', superadmin.kyc_verified);
    console.log('Email Verified:', superadmin.emailVerified);
    console.log('2FA Enabled:', superadmin.twoFactorEnabled);
    console.log('Balance NSL:', superadmin.balance_NSL);
    console.log('Balance USDT:', superadmin.balance_usdt);
    console.log('Created:', superadmin.created_at);
    console.log('Last Login:', superadmin.last_login || 'Never');
    console.log('═══════════════════════════════════════\n');

    // Test password
    console.log('🔐 Testing Password...');
    const isPasswordValid = await superadmin.comparePassword(password);

    if (isPasswordValid) {
      console.log('✅ Password is CORRECT!\n');
    } else {
      console.log('❌ Password is INCORRECT!\n');
      console.log('⚠️  The password in .env does not match the stored password.');
      console.log('📝 To fix: Run npm run seed:admin to reset the password\n');
    }

    console.log('🔑 Login Credentials:');
    console.log('═══════════════════════════════════════');
    console.log('URL: http://localhost:3000/login');
    console.log('Username:', username);
    console.log('Password:', password);
    console.log('═══════════════════════════════════════\n');

    if (superadmin.status !== 'active') {
      console.log('⚠️  WARNING: Account status is not "active"');
      console.log('   Current status:', superadmin.status);
      console.log('   Run npm run seed:admin to activate\n');
    }

    if (superadmin.role !== 'superadmin') {
      console.log('⚠️  WARNING: Role is not "superadmin"');
      console.log('   Current role:', superadmin.role);
      console.log('   Run npm run seed:admin to fix\n');
    }

    await mongoose.connection.close();
    console.log('✅ Verification Complete!\n');

  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  }
}

verifySuperAdmin();
