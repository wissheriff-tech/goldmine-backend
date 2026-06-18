const { User } = require('../models');
const { getNslPerUsdt, nslToUsdt } = require('./currencyConversion');

async function syncUserUsdtBalances({ batchSize = 200 } = {}) {
  const rate = await getNslPerUsdt();
  const limit = Math.max(1, Math.min(Number(batchSize) || 200, 1000));
  let offset = 0;
  let scanned = 0;
  let updated = 0;
  const samples = [];

  while (true) {
    const users = await User.findAll({
      attributes: ['id', 'username', 'phone', 'balance_NSL', 'balance_usdt'],
      order: [['id', 'ASC']],
      limit,
      offset,
    });

    if (users.length === 0) break;

    for (const user of users) {
      scanned++;
      const previousUsdt = Number(user.balance_usdt || 0);
      const expectedUsdt = nslToUsdt(user.balance_NSL, rate);

      if (Math.abs(previousUsdt - expectedUsdt) >= 0.0001) {
        user.balance_usdt = expectedUsdt;
        await user.save();
        updated++;

        if (samples.length < 10) {
          samples.push({
            id: user.id,
            phone: user.phone,
            balance_NSL: Number(user.balance_NSL || 0),
            old_balance_usdt: previousUsdt,
            new_balance_usdt: expectedUsdt,
          });
        }
      }
    }

    offset += users.length;
  }

  return {
    scanned,
    updated,
    exchange_rate_nsl_per_usdt: rate,
    samples,
  };
}

module.exports = { syncUserUsdtBalances };
