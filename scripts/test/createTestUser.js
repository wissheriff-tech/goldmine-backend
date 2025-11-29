const mongoose = require('mongoose');
const User = require('../models/User');
require('dotenv').config();

async function createTestUser() {
  try {
    // Connect to MongoDB
    await mongoose.connect(process.env.MONGODB_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true
    });

    console.log('📡 Connected to MongoDB');
    console.log('👤 Creating test user account...\n');

    // Check if user already exists
    const existingUser = await User.findOne({ phone: '+232111111111' });

    if (existingUser) {
      console.log('⚠️  User already exists. Updating...');

      existingUser.username = 'testuser';
      existingUser.password_hash = 'Test@1234';
      existingUser.balance_NSL = 5000;
      existingUser.balance_usdt = 200;
      existingUser.vip_level = 'VIP2';
      existingUser.status = 'active';
      existingUser.kyc_verified = true;
      existingUser.emailVerified = true;

      await existingUser.save();
      console.log('✅ Test user updated successfully!');
    } else {
      // Create new test user
      const referralCode = Math.random().toString(36).substring(2, 12).toUpperCase();

      const testUser = new User({
        username: 'testuser',
        phone: '+232111111111',
        password_hash: 'Test@1234', // Will be hashed by pre-save hook
        role: 'user',
        referral_code: referralCode,
        referred_by: null,
        balance_NSL: 5000,
        balance_usdt: 200,
        vip_level: 'VIP2',
        status: 'active',
        kyc_verified: true,
        emailVerified: true,
        email: 'testuser@example.com'
      });

      await testUser.save();
      console.log('🆕 Test user created successfully!');
    }

    const user = await User.findOne({ phone: '+232111111111' });

    console.log('\n📋 Test User Account Details:');
    console.log('─'.repeat(50));
    console.log(`   Username: ${user.username}`);
    console.log(`   Phone: ${user.phone}`);
    console.log(`   Password: Test@1234`);
    console.log(`   Email: ${user.email}`);
    console.log('─'.repeat(50));
    console.log(`   Role: ${user.role}`);
    console.log(`   Status: ${user.status}`);
    console.log(`   VIP Level: ${user.vip_level}`);
    console.log(`   Balance NSL: ${user.balance_NSL.toLocaleString()}`);
    console.log(`   Balance USDT: ${user.balance_usdt.toLocaleString()}`);
    console.log(`   Referral Code: ${user.referral_code}`);
    console.log(`   KYC Verified: ${user.kyc_verified ? 'Yes' : 'No'}`);
    console.log('─'.repeat(50));
    console.log('\n✨ You can now login with:');
    console.log('   Phone: +232111111111');
    console.log('   Password: Test@1234');
    console.log('\n');

    await mongoose.connection.close();
    console.log('✅ Database connection closed');
    process.exit(0);
  } catch (error) {
    console.error('❌ Error creating test user:', error);
    await mongoose.connection.close();
    process.exit(1);
  }
}

// Run the function
createTestUser();
