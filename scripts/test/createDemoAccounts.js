const mongoose = require('mongoose');
const dotenv = require('dotenv');
const User = require('../models/User');

dotenv.config();

const demoAccounts = [
  {
    username: 'wisrado001',
    phone: '+232777777777',
    password: 'Rado123',
    role: 'superadmin',
    status: 'active',
    kyc_verified: true,
    description: 'Super Admin Account'
  },
  {
    username: 'financeadmin001',
    phone: '+232777777001',
    password: 'Finance123',
    role: 'finance',
    status: 'active',
    kyc_verified: true,
    description: 'Finance Admin Account 1'
  },
  {
    username: 'financeadmin002',
    phone: '+232777777002',
    password: 'Finance123',
    role: 'finance',
    status: 'active',
    kyc_verified: true,
    description: 'Finance Admin Account 2'
  },
  {
    username: 'admin001',
    phone: '+232777777003',
    password: 'Admin123',
    role: 'admin',
    status: 'active',
    kyc_verified: true,
    description: 'Regular Admin Account 1'
  },
  {
    username: 'admin002',
    phone: '+232777777004',
    password: 'Admin123',
    role: 'admin',
    status: 'active',
    kyc_verified: true,
    description: 'Regular Admin Account 2'
  },
  {
    username: 'admin003',
    phone: '+232777777005',
    password: 'Admin123',
    role: 'admin',
    status: 'active',
    kyc_verified: true,
    description: 'Regular Admin Account 3'
  },
  {
    username: 'user001',
    phone: '+232777777006',
    password: 'User123',
    role: 'user',
    status: 'active',
    kyc_verified: true,
    description: 'Regular User Account'
  }
];

const generateReferralCode = () => {
  return Math.random().toString(36).substring(2, 12).toUpperCase();
};

const createDemoAccounts = async () => {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('Connected to MongoDB');
    console.log('');

    for (const account of demoAccounts) {
      try {
        // Check if user already exists
        const existingUser = await User.findOne({
          $or: [{ username: account.username }, { phone: account.phone }]
        });

        if (existingUser) {
          console.log(`⚠️  User ${account.username} already exists - skipping`);
          continue;
        }

        // Create new user
        const referral_code = generateReferralCode();
        const user = new User({
          username: account.username,
          phone: account.phone,
          password_hash: account.password,
          role: account.role,
          status: account.status,
          kyc_verified: account.kyc_verified,
          referral_code,
          balance_NSL: 0,
          balance_usdt: 0,
          vip_level: 'none'
        });

        await user.save();
        console.log(`✅ Created: ${account.description}`);
        console.log(`   Username: ${account.username}`);
        console.log(`   Password: ${account.password}`);
        console.log(`   Role: ${account.role}`);
        console.log(`   Phone: ${account.phone}`);
        console.log('');
      } catch (error) {
        console.error(`❌ Error creating ${account.username}:`, error.message);
      }
    }

    console.log('═══════════════════════════════════════════════════');
    console.log('DEMO ACCOUNTS CREATED SUCCESSFULLY');
    console.log('═══════════════════════════════════════════════════');
    console.log('');
    console.log('🔐 SUPER ADMIN:');
    console.log('   Username: wisrado001');
    console.log('   Password: Rado123');
    console.log('');
    console.log('💰 FINANCE ADMINS:');
    console.log('   Username: financeadmin001 | Password: Finance123');
    console.log('   Username: financeadmin002 | Password: Finance123');
    console.log('');
    console.log('👨‍💼 REGULAR ADMINS:');
    console.log('   Username: admin001 | Password: Admin123');
    console.log('   Username: admin002 | Password: Admin123');
    console.log('   Username: admin003 | Password: Admin123');
    console.log('');
    console.log('👤 REGULAR USER:');
    console.log('   Username: user001 | Password: User123');
    console.log('');
    console.log('═══════════════════════════════════════════════════');

    await mongoose.connection.close();
    console.log('Database connection closed');
    process.exit(0);
  } catch (error) {
    console.error('Error:', error.message);
    process.exit(1);
  }
};

createDemoAccounts();
