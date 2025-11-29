const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const User = require('../models/User');
require('dotenv').config();

async function fixPassword() {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('📡 Connected to MongoDB\n');

    // Hash the password
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash('Test@1234', salt);

    // Update user directly without triggering pre-save hook
    await User.updateOne(
      { phone: '+232111111111' },
      {
        $set: {
          password_hash: hashedPassword,
          status: 'active',
          balance_NSL: 5000,
          balance_usdt: 200,
          vip_level: 'VIP2'
        }
      }
    );

    console.log('✅ Password updated successfully!\n');

    // Verify the password
    const user = await User.findOne({ phone: '+232111111111' });
    const isMatch = await bcrypt.compare('Test@1234', user.password_hash);

    console.log('🔐 Password Verification Test:');
    console.log(`   Result: ${isMatch ? '✅ SUCCESS' : '❌ FAILED'}\n`);

    if (isMatch) {
      console.log('✨ Login Credentials:');
      console.log('   Phone: +232111111111');
      console.log('   Password: Test@1234');
      console.log('\n🎉 You can now login!\n');
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

fixPassword();
