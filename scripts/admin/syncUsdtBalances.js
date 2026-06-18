require('dotenv').config();

const { sequelize } = require('../../models');
const { syncUserUsdtBalances } = require('../../utils/balanceSync');

async function main() {
  try {
    await sequelize.authenticate();
    const result = await syncUserUsdtBalances();
    console.log(JSON.stringify(result, null, 2));
  } finally {
    await sequelize.close();
  }
}

main().catch((error) => {
  console.error('USDT balance sync failed:', error);
  process.exit(1);
});
