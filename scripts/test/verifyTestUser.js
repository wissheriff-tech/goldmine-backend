const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const User = require('../models/User');
require('dotenv').config();

async function verifyAndFixUser() {
  try {
    await mongoose.connect(process.env.MONGODB_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true
    });

    console.log('📡 Connected to MongoDB\n');

    // Find the test user
    const user = await User.findOne({ phone: '+232111111111' });

    if (!user) {
      console.log('❌ User not found! Creating new user...\n');

      // Create new user with properly hashed password
      const salt = await bcrypt.genSalt(10);
      const hashedPassword = await bcrypt.hash('Test@1234', salt);

      const newUser = new User({
        username: 'testuser',
        phone: '+232111111111',
        password_hash: hashedPassword,
        role: 'user',
        referral_code: Math.random().toString(36).substring(2, 12).toUpperCase(),
        balance_NSL: 5000,
        balance_usdt: 200,
        vip_level: 'VIP2',
        status: 'active',
        kyc_verified: true,
        emailVerified: true,
        email: 'testuser@example.com'
      });

      await newUser.save({ validateBeforeSave: false });
      console.log('✅ User created successfully!');
    } else {
      console.log('✅ User found! Updating password...\n');

      // Update password with proper hashing
      const salt = await bcrypt.genSalt(10);
      const hashedPassword = await bcrypt.hash('Test@1234', salt);

      user.password_hash = hashedPassword;
      user.status = 'active';
      user.balance_NSL = 5000;
      user.balance_usdt = 200;
      user.vip_level = 'VIP2';

      await user.save({ validateBeforeSave: false });
      console.log('✅ User updated successfully!');
    }

    // Verify the user
    const verifiedUser = await User.findOne({ phone: '+232111111111' });

    console.log('\n📋 User Details:');
    console.log('─'.repeat(50));
    console.log(`   Phone: ${verifiedUser.phone}`);
    console.log(`   Username: ${verifiedUser.username}`);
    console.log(`   Role: ${verifiedUser.role}`);
    console.log(`   Status: ${verifiedUser.status}`);
    console.log(`   VIP Level: ${verifiedUser.vip_level}`);
    console.log(`   Balance NSL: ${verifiedUser.balance_NSL}`);
    console.log(`   Balance USDT: ${verifiedUser.balance_usdt}`);
    console.log('─'.repeat(50));

    // Test password verification
    const isPasswordCorrect = await bcrypt.compare('Test@1234', verifiedUser.password_hash);
    console.log('\n🔐 Password Test:');
    console.log(`   Password 'Test@1234' matches: ${isPasswordCorrect ? '✅ YES' : '❌ NO'}`);

    if (isPasswordCorrect) {
      console.log('\n✨ Login credentials:');
      console.log('   Phone: +232111111111');
      console.log('   Password: Test@1234');
      console.log('\n🎉 User is ready to login!\n');
    } else {
      console.log('\n❌ Password verification failed! Something went wrong.\n');
    }

    await mongoose.connection.close();
    console.log('✅ Database connection closed');
    process.exit(0);
  } catch (error) {
    console.error('❌ Error:', error);
    await mongoose.connection.close();
    process.exit(1);
  }
}

verifyAndFixUser();
