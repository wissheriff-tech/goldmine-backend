const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
require('dotenv').config();

// Import User model
const User = require('./models/User');

const updateSuperAdmin = async () => {
  try {
    // Connect to MongoDB
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ Connected to MongoDB');

    // New super admin credentials
    const newCredentials = {
      username: 'Wisrado',
      phone: '+23273001412',
      password: 'Makeni@2025?.',
      email: 'admin@salonmoney.com'
    };

    // Hash the new password
    const hashedPassword = await bcrypt.hash(newCredentials.password, 10);

    // Find existing superadmin
    let superAdmin = await User.findOne({ role: 'superadmin' });

    if (!superAdmin) {
      // Try to find by old username
      superAdmin = await User.findOne({ username: 'superadmin' });
    }

    // Check if the new phone number belongs to a different user
    const phoneUser = await User.findOne({ phone: newCredentials.phone });

    if (phoneUser && superAdmin && phoneUser._id.toString() !== superAdmin._id.toString()) {
      console.log(`⚠️  Phone ${newCredentials.phone} belongs to another user: ${phoneUser.username}`);
      console.log('   Deleting duplicate user...');
      await User.deleteOne({ _id: phoneUser._id });
      console.log('   ✅ Duplicate user deleted');
    }

    if (!superAdmin) {
      console.log('❌ No existing super admin found. Creating new one...');

      // Create new super admin
      superAdmin = new User({
        username: newCredentials.username,
        phone: newCredentials.phone,
        email: newCredentials.email,
        password: hashedPassword,
        role: 'superadmin',
        status: 'active',
        email_verified: true,
        phone_verified: true,
        balance_NSL: 0,
        balance_usdt: 0
      });

      await superAdmin.save();
      console.log('✅ New super admin created successfully!');
    } else {
      console.log(`📝 Found existing super admin: ${superAdmin.username} (${superAdmin.phone})`);

      // Update the super admin
      superAdmin.username = newCredentials.username;
      superAdmin.phone = newCredentials.phone;
      superAdmin.email = newCredentials.email;
      superAdmin.password = hashedPassword;
      superAdmin.role = 'superadmin';
      superAdmin.status = 'active';
      superAdmin.email_verified = true;
      superAdmin.phone_verified = true;

      await superAdmin.save();
      console.log('✅ Super admin updated successfully!');
    }

    console.log('\n📋 Updated Super Admin Details:');
    console.log(`   Username: ${superAdmin.username}`);
    console.log(`   Phone: ${superAdmin.phone}`);
    console.log(`   Email: ${superAdmin.email}`);
    console.log(`   Role: ${superAdmin.role}`);
    console.log(`   Status: ${superAdmin.status}`);

    console.log('\n✅ You can now login with:');
    console.log(`   Username or Phone: ${newCredentials.username} or ${newCredentials.phone}`);
    console.log(`   Password: ${newCredentials.password}`);

    await mongoose.connection.close();
    console.log('\n✅ Database connection closed');
    process.exit(0);
  } catch (error) {
    console.error('❌ Error updating super admin:', error.message);
    process.exit(1);
  }
};

// Run the update
updateSuperAdmin();
