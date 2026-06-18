require('dotenv').config();
const { sequelize } = require('../../config/database');
const Product = require('../../models/Product');
const ps = require('../../utils/platformSettings');
const { getNslPerUsdt } = require('../../utils/currencyConversion');
const { VIP_PRODUCT_PLANS, planToProductSeed, buildVipBusinessSummary } = require('../../utils/productPlans');

async function seedProducts() {
  try {
    await sequelize.authenticate();
    await Product.sync();

    const settings = await ps.getAll();
    const rate = await getNslPerUsdt();
    const validityDays = Number(settings.dur_week) || 7;
    let created = 0;
    let updated = 0;

    console.log(`Connected to database. Seeding VIP products at ${rate} NSL per USDT.\n`);

    for (const plan of VIP_PRODUCT_PLANS) {
      const productData = planToProductSeed(plan, rate, validityDays);
      const [, wasCreated] = await Product.upsert(productData);
      wasCreated ? created++ : updated++;

      console.log(`${wasCreated ? 'Created' : 'Updated'} ${plan.name}`);
      console.log(`   Price: ${plan.price_NSL.toLocaleString()} NSL (${productData.price_usdt} USDT)`);
      console.log(`   Daily Income: ${plan.daily_income_NSL.toLocaleString()} NSL\n`);
    }

    const summary = buildVipBusinessSummary(settings, rate);
    console.log('Business summary for default 1 week duration:');
    console.log('Level | Price NSL | Daily NSL | User 7-day reward | Company benefit');
    console.log('-'.repeat(78));
    for (const plan of summary.plans) {
      const week = plan.by_duration.week;
      console.log(
        `${plan.name.padEnd(6)}| ${String(week.price_NSL).padEnd(10)}| ` +
        `${String(week.daily_income_NSL).padEnd(10)}| ${String(week.total_reward_NSL).padEnd(17)}| ` +
        `${week.company_total_benefit_NSL}`
      );
    }

    console.log(`\nSeeding completed. Created: ${created}, Updated: ${updated}, Total: ${created + updated}`);
    await sequelize.close();
    process.exit(0);
  } catch (error) {
    console.error('Error seeding products:', error);
    await sequelize.close();
    process.exit(1);
  }
}

seedProducts();
