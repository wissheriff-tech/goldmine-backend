const dotenv = require('dotenv');
const { Op } = require('sequelize');

dotenv.config();

const { sequelize } = require('../../config/database');
const User = require('../../models/User');

const createSuperAdmin = async () => {
  try {
    // Authenticate the Sequelize connection
    await sequelize.authenticate();
    console.log('Connected to MySQL');

    // Sync the User model (creates table if it doesn't exist)
    await User.sync();

    // Super admin credentials from .env
    const superAdminUsername = process.env.SUPER_ADMIN_USERNAME || 'superadmin';
    const superAdminEmail = process.env.SUPER_ADMIN_EMAIL || 'admin@salonmoney.com';
    const superAdminPhone = process.env.SUPER_ADMIN_PHONE || '+232777777777';
    const superAdminPassword = process.env.SUPER_ADMIN_PASSWORD || 'Admin@SuperSecure2024!';

    // Check if super admin already exists
    const existingSuperAdmin = await User.findOne({
      where: {
        [Op.or]: [
          { phone: superAdminPhone },
          { username: superAdminUsername.toLowerCase() },
          { email: superAdminEmail.toLowerCase() }
        ]
      }
    });

    if (existingSuperAdmin) {
      console.log('\n⚠️  Super admin already exists!');
      console.log('Username:', existingSuperAdmin.username);

      // Update to ensure they have all privileges
      await existingSuperAdmin.update({
        role: 'superadmin',
        status: 'active',
        kyc_verified: true,
        emailVerified: true,
        authProvider: 'local',
        password_hash: superAdminPassword,
        username: existingSuperAdmin.username || superAdminUsername.toLowerCase(),
        email: existingSuperAdmin.email || superAdminEmail.toLowerCase()
      });

      console.log('\n✅ Super admin updated successfully with all privileges AND password reset!');
    } else {
      // Generate referral code
      const referralCode = 'ADMIN' + Math.floor(Math.random() * 10000);

      // Create new super admin
      const superAdmin = await User.create({
        username: superAdminUsername.toLowerCase(),
        email: superAdminEmail.toLowerCase(),
        phone: superAdminPhone,
        password_hash: superAdminPassword, // Will be hashed by beforeCreate hook
        role: 'superadmin',
        status: 'active',
        kyc_verified: true,
        emailVerified: true,
        authProvider: 'local',
        balance_NSL: 0,
        balance_usdt: 0,
        vip_level: 'VIP8',
        twoFactorEnabled: false,
        referral_code: referralCode
      });

      console.log('\n✅ Super Admin Created Successfully!');
    }

    console.log('=====================================');
    console.log('\n🔐 Login Credentials:');
    console.log('Username:', superAdminUsername);
    console.log('Password:', superAdminPassword);
    console.log('\nYou can login at: http://localhost:3000/login');

    // Close connection
    await sequelize.close();
    console.log('\nDatabase connection closed');
    process.exit(0);

  } catch (error) {
    console.error('Error creating super admin:', error);
    process.exit(1);
  }
};

createSuperAdmin();
