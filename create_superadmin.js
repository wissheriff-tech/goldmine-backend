const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
require('dotenv').config();

// Connect to MongoDB
mongoose.connect(process.env.MONGODB_URI)
  .then(() => console.log('✅ Connected to MongoDB'))
  .catch(err => {
    console.error('❌ MongoDB connection error:', err);
    process.exit(1);
  });

// User Schema (simplified)
const userSchema = new mongoose.Schema({
  username: String,
  phone: String,
  password_hash: String,
  role: String,
  referral_code: String,
  referred_by: String,
  balance_NSL: { type: Number, default: 0 },
  balance_usdt: { type: Number, default: 0 },
  vip_level: { type: String, default: 'none' },
  products: { type: Array, default: [] },
  status: { type: String, default: 'active' },
  kyc_verified: { type: Boolean, default: true },
  email: String,
  emailVerified: { type: Boolean, default: true },
  twoFactorEnabled: { type: Boolean, default: false },
  authProvider: { type: String, default: 'local' },
  binance_wallet_verified: { type: Boolean, default: false },
  withdrawal_addresses: { type: Array, default: [] },
  preferred_currency: { type: String, default: 'USD' }
}, { timestamps: true });

const User = mongoose.model('User', userSchema);

async function createSuperAdmin() {
  try {
    // Check if user exists
    const existingUser = await User.findOne({ username: 'wisrado' });

    if (existingUser) {
      console.log('⚠️  User "wisrado" already exists. Updating password...');

      // Hash the password
      const salt = await bcrypt.genSalt(10);
      const hashedPassword = await bcrypt.hash('Makeni@2025?.', salt);

      // Update password
      existingUser.password_hash = hashedPassword;
      existingUser.role = 'superadmin';
      existingUser.status = 'active';
      existingUser.kyc_verified = true;
      existingUser.emailVerified = true;

      await existingUser.save();
      console.log('✅ Password updated successfully!');
    } else {
      console.log('Creating new SuperAdmin user...');

      // Hash the password
      const salt = await bcrypt.genSalt(10);
      const hashedPassword = await bcrypt.hash('Makeni@2025?.', salt);

      // Create user
      const superAdmin = new User({
        username: 'wisrado',
        phone: '+23273001412',
        password_hash: hashedPassword,
        role: 'superadmin',
        referral_code: 'WISRADO2025',
        referred_by: null,
        balance_NSL: 0,
        balance_usdt: 0,
        vip_level: 'none',
        products: [],
        status: 'active',
        kyc_verified: true,
        email: 'admin@salonmoney.com',
        emailVerified: true,
        twoFactorEnabled: false,
        authProvider: 'local',
        binance_wallet_verified: false,
        withdrawal_addresses: [],
        preferred_currency: 'USD'
      });

      await superAdmin.save();
      console.log('✅ SuperAdmin created successfully!');
    }

    console.log('\n📋 Login Credentials:');
    console.log('Username: wisrado');
    console.log('Password: Makeni@2025?.');
    console.log('\n✅ Database setup complete!');

    process.exit(0);
  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  }
}

createSuperAdmin();
