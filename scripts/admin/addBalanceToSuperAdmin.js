const { sequelize } = require('../../config/database');
const User = require('../../models/User');
require('dotenv').config();

async function addBalanceToSuperAdmin() {
  try {
    // Connect to MySQL via Sequelize
    await sequelize.authenticate();

    console.log('Connected to MySQL');

    // Find super admin by phone
    const superAdmin = await User.findOne({ where: { phone: '+232777777777' } });

    if (!superAdmin) {
      console.log('Super admin not found with phone +232777777777');
      await sequelize.close();
      process.exit(1);
    }

    console.log('\nCurrent Super Admin Details:');
    console.log(`   Phone: ${superAdmin.phone}`);
    console.log(`   Username: ${superAdmin.username}`);
    console.log(`   Current Balance NSL: ${superAdmin.balance_NSL.toLocaleString()}`);
    console.log(`   Current Balance USDT: ${superAdmin.balance_usdt.toLocaleString()}`);
    console.log(`   Current VIP Level: ${superAdmin.vip_level}`);

    // Update balance and VIP level
    superAdmin.balance_NSL = 10000;
    superAdmin.balance_usdt = (10000 / 25); // Convert using NSL to USDT rate
    superAdmin.vip_level = 'VIP8'; // VIP 9 doesn't exist, setting to VIP8 (highest)

    await superAdmin.save();

    console.log('\nBalance Updated Successfully!');
    console.log('-'.repeat(50));
    console.log(`   New Balance NSL: ${superAdmin.balance_NSL.toLocaleString()} NSL`);
    console.log(`   New Balance USDT: ${superAdmin.balance_usdt.toLocaleString()} USDT`);
    console.log(`   New VIP Level: ${superAdmin.vip_level}`);
    console.log('-'.repeat(50));

    await sequelize.close();
    console.log('\nDatabase connection closed');
    process.exit(0);
  } catch (error) {
    console.error('Error updating balance:', error);
    await sequelize.close();
    process.exit(1);
  }
}

// Run the function
addBalanceToSuperAdmin();
