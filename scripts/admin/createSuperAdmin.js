const mongoose = require('mongoose');
const dotenv = require('dotenv');
// FIX 1: Corrected path from '../models/User' to '../../models/User'
const User = require('../../models/User');

dotenv.config();

const createSuperAdmin = async () => {
  try {
    // Connect to MongoDB
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/salonmoney', {
      useNewUrlParser: true,
      useUnifiedTopology: true
    });

    console.log('Connected to MongoDB');

    // Super admin credentials from .env
    const superAdminUsername = process.env.SUPER_ADMIN_USERNAME || 'superadmin';
    const superAdminEmail = process.env.SUPER_ADMIN_EMAIL || 'admin@salonmoney.com';
    const superAdminPhone = process.env.SUPER_ADMIN_PHONE || '+232777777777';
    const superAdminPassword = process.env.SUPER_ADMIN_PASSWORD || 'Admin@SuperSecure2024!';

    // Check if super admin already exists
    const existingSuperAdmin = await User.findOne({
      $or: [
        { phone: superAdminPhone },
        { username: superAdminUsername.toLowerCase() },
        { email: superAdminEmail.toLowerCase() }
      ]
    });

    if (existingSuperAdmin) {
      console.log('\n⚠️  Super admin already exists!');
      console.log('Username:', existingSuperAdmin.username);
      
      // Update to ensure they have all privileges
      existingSuperAdmin.role = 'superadmin';
      existingSuperAdmin.status = 'active';
      existingSuperAdmin.kyc_verified = true;
      existingSuperAdmin.emailVerified = true;
      existingSuperAdmin.authProvider = 'local';
      
      // FIX 2: Force password update (This fixes your login issue)
      // This triggers the pre-save hook in the User model which hashes the password
      existingSuperAdmin.password_hash = superAdminPassword;

      // Update email and username if they don't have them
      if (!existingSuperAdmin.username) {
        existingSuperAdmin.username = superAdminUsername.toLowerCase();
      }
      if (!existingSuperAdmin.email) {
        existingSuperAdmin.email = superAdminEmail.toLowerCase();
      }

      await existingSuperAdmin.save();

      console.log('\n✅ Super admin updated successfully with all privileges AND password reset!');
    } else {
      // Create new super admin
      const superAdmin = new User({
        username: superAdminUsername.toLowerCase(),
        email: superAdminEmail.toLowerCase(),
        phone: superAdminPhone,
        password_hash: superAdminPassword, // Will be hashed by pre-save hook
        role: 'superadmin',
        status: 'active',
        kyc_verified: true,
        emailVerified: true,
        authProvider: 'local',
        balance_NSL: 0,
        balance_usdt: 0,
        vip_level: 'VIP8',
        twoFactorEnabled: false
      });

      // Generate referral code safely
      if (typeof superAdmin.generateReferralCode === 'function') {
         superAdmin.referral_code = superAdmin.generateReferralCode();
      } else {
         superAdmin.referral_code = 'ADMIN' + Math.floor(Math.random() * 10000);
      }

      await superAdmin.save();

      console.log('\n✅ Super Admin Created Successfully!');
    }

    console.log('=====================================');
    console.log('\n🔐 Login Credentials:');
    console.log('Username:', superAdminUsername);
    console.log('Password:', superAdminPassword);
    console.log('\nYou can login at: http://localhost:3000/login');

    // Close connection
    await mongoose.connection.close();
    console.log('\nDatabase connection closed');
    process.exit(0);

  } catch (error) {
    console.error('Error creating super admin:', error);
    process.exit(1);
  }
};

createSuperAdmin();