const mongoose = require('mongoose');
const Product = require('../models/Product');
require('dotenv').config();

// VIP Product definitions with progressive benefits
const vipProducts = [
  {
    name: 'VIP1',
    description: 'Entry-level VIP package perfect for beginners. Start your investment journey with daily returns.',
    price_NSL: 1000,
    daily_income_NSL: 40,
    validity_days: 60,
    benefits: [
      'Priority customer support',
      'Basic analytics dashboard',
      'Email notifications',
      'Transaction history access'
    ]
  },
  {
    name: 'VIP2',
    description: 'Enhanced VIP package with better returns and faster processing. Ideal for growing investors.',
    price_NSL: 3000,
    daily_income_NSL: 150,
    validity_days: 60,
    benefits: [
      'All VIP1 benefits',
      'Faster withdrawal processing (12 hours)',
      'Dedicated email support',
      'Advanced analytics dashboard',
      'Priority recharge approval'
    ]
  },
  {
    name: 'VIP3',
    description: 'Premium VIP package with dedicated support. Take your earnings to the next level.',
    price_NSL: 8000,
    daily_income_NSL: 450,
    validity_days: 60,
    benefits: [
      'All VIP2 benefits',
      'Dedicated account manager',
      'WhatsApp support channel',
      'Weekly performance reports',
      '5% referral bonus boost'
    ]
  },
  {
    name: 'VIP4',
    description: 'Elite VIP package with reduced fees and premium features. Serious investors choice.',
    price_NSL: 20000,
    daily_income_NSL: 1200,
    validity_days: 60,
    benefits: [
      'All VIP3 benefits',
      'Reduced transaction fees (50% off)',
      'Express withdrawals (6 hours)',
      'Exclusive investment opportunities',
      'Monthly strategy calls'
    ]
  },
  {
    name: 'VIP5',
    description: 'Platinum VIP package with exclusive promotions. Maximize your investment potential.',
    price_NSL: 50000,
    daily_income_NSL: 3200,
    validity_days: 60,
    benefits: [
      'All VIP4 benefits',
      'Exclusive promotional bonuses',
      'VIP-only investment products',
      'Priority customer service 24/7',
      'Custom investment strategies'
    ]
  },
  {
    name: 'VIP6',
    description: 'Diamond VIP package with premium perks. For high-value investors seeking excellence.',
    price_NSL: 100000,
    daily_income_NSL: 6800,
    validity_days: 60,
    benefits: [
      'All VIP5 benefits',
      'Instant recharge approval',
      'Zero withdrawal fees',
      'Personal investment consultant',
      'VIP badge and recognition',
      'Early access to new products'
    ]
  },
  {
    name: 'VIP7',
    description: 'Royal VIP package with custom badge and premium support. Elite tier for serious wealth builders.',
    price_NSL: 250000,
    daily_income_NSL: 18000,
    validity_days: 60,
    benefits: [
      'All VIP6 benefits',
      'Custom VIP7 badge with gold accent',
      'Concierge investment service',
      'Quarterly business reviews',
      'VIP events invitation',
      'White-glove support'
    ]
  },
  {
    name: 'VIP8',
    description: 'Ultimate VIP package with lifetime premium support. The pinnacle of investment excellence.',
    price_NSL: 500000,
    daily_income_NSL: 40000,
    validity_days: 60,
    benefits: [
      'All VIP7 benefits',
      'Lifetime premium support',
      'Personal portfolio manager',
      'Custom VIP8 platinum badge',
      'Exclusive networking events',
      'Private investment opportunities',
      'Priority access to everything',
      'Annual performance bonus'
    ]
  }
];

async function seedProducts() {
  try {
    // Connect to MongoDB
    await mongoose.connect(process.env.MONGODB_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true
    });

    console.log('📡 Connected to MongoDB');
    console.log('🌱 Starting product seeding...\n');

    // Get NSL to USDT conversion rate from environment
    const nslToUsdt = parseInt(process.env.NSL_TO_USDT_RECHARGE || 25);

    let created = 0;
    let updated = 0;
    let skipped = 0;

    for (const productData of vipProducts) {
      // Calculate USDT price
      const price_usdt = (productData.price_NSL / nslToUsdt).toFixed(2);

      // Calculate ROI days for display
      const roiDays = Math.ceil(productData.price_NSL / productData.daily_income_NSL);

      // Check if product already exists
      const existingProduct = await Product.findOne({ name: productData.name });

      if (existingProduct) {
        // Update existing product
        existingProduct.description = productData.description;
        existingProduct.price_NSL = productData.price_NSL;
        existingProduct.price_usdt = price_usdt;
        existingProduct.daily_income_NSL = productData.daily_income_NSL;
        existingProduct.validity_days = productData.validity_days;
        existingProduct.benefits = productData.benefits;
        existingProduct.active = true;

        await existingProduct.save();

        console.log(`✅ Updated ${productData.name}`);
        console.log(`   Price: ${productData.price_NSL.toLocaleString()} NSL (${price_usdt} USDT)`);
        console.log(`   Daily Income: ${productData.daily_income_NSL.toLocaleString()} NSL`);
        console.log(`   ROI Period: ${roiDays} days`);
        console.log(`   Benefits: ${productData.benefits.length} items\n`);
        updated++;
      } else {
        // Create new product
        const newProduct = await Product.create({
          name: productData.name,
          description: productData.description,
          price_NSL: productData.price_NSL,
          price_usdt: price_usdt,
          daily_income_NSL: productData.daily_income_NSL,
          validity_days: productData.validity_days,
          benefits: productData.benefits,
          active: true
        });

        console.log(`🆕 Created ${productData.name}`);
        console.log(`   Price: ${productData.price_NSL.toLocaleString()} NSL (${price_usdt} USDT)`);
        console.log(`   Daily Income: ${productData.daily_income_NSL.toLocaleString()} NSL`);
        console.log(`   ROI Period: ${roiDays} days`);
        console.log(`   Benefits: ${productData.benefits.length} items\n`);
        created++;
      }
    }

    console.log('\n✨ Seeding completed successfully!');
    console.log(`📊 Summary:`);
    console.log(`   Created: ${created} products`);
    console.log(`   Updated: ${updated} products`);
    console.log(`   Total: ${created + updated} products in database\n`);

    // Display product comparison table
    console.log('📈 VIP Products Comparison:');
    console.log('─'.repeat(80));
    console.log('Level | Price (NSL) | Daily Income | ROI Days | Monthly Income');
    console.log('─'.repeat(80));

    const products = await Product.find().sort({ price_NSL: 1 });
    products.forEach(p => {
      const monthlyIncome = p.daily_income_NSL * 30;
      const roiDays = Math.ceil(p.price_NSL / p.daily_income_NSL);
      console.log(
        `${p.name.padEnd(6)}| ${p.price_NSL.toLocaleString().padEnd(12)}| ` +
        `${p.daily_income_NSL.toLocaleString().padEnd(13)}| ` +
        `${roiDays.toString().padEnd(9)}| ${monthlyIncome.toLocaleString()}`
      );
    });
    console.log('─'.repeat(80));

    await mongoose.connection.close();
    console.log('\n✅ Database connection closed');
    process.exit(0);
  } catch (error) {
    console.error('❌ Error seeding products:', error);
    await mongoose.connection.close();
    process.exit(1);
  }
}

// Run the seeding function
seedProducts();
