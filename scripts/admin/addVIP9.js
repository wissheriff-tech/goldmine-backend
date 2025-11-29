const mongoose = require('mongoose');
const Product = require('../models/Product');
const User = require('../models/User');
require('dotenv').config();

async function addVIP9() {
  try {
    // Connect to MongoDB
    await mongoose.connect(process.env.MONGODB_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true
    });

    console.log('📡 Connected to MongoDB');
    console.log('🌟 Adding VIP9 - Ultimate Elite Package...\n');

    // Get NSL to USDT conversion rate
    const nslToUsdt = parseInt(process.env.NSL_TO_USDT_RECHARGE || 25);

    // VIP9 Product Definition - Ultimate Elite Package
    const vip9Data = {
      name: 'VIP9',
      description: 'Ultimate Elite VIP package - The absolute pinnacle of investment excellence. Reserved for the most distinguished investors.',
      price_NSL: 1000000, // 1 Million NSL
      daily_income_NSL: 90000, // 90,000 NSL per day
      validity_days: 60,
      benefits: [
        'All VIP8 benefits',
        'Ultimate lifetime premium support',
        'Dedicated wealth management team',
        'Custom VIP9 diamond badge',
        'Exclusive billionaire networking events',
        'Private investment opportunities',
        'Priority access to everything',
        'Annual performance bonus (10%)',
        'Personal concierge service',
        'VIP9-only investment products',
        'Zero fees on all transactions',
        'Instant withdrawals (no waiting)',
        'Custom investment strategies',
        'Quarterly luxury rewards'
      ]
    };

    const price_usdt = (vip9Data.price_NSL / nslToUsdt).toFixed(2);
    const roiDays = Math.ceil(vip9Data.price_NSL / vip9Data.daily_income_NSL);
    const monthlyIncome = vip9Data.daily_income_NSL * 30;

    // Check if VIP9 already exists
    const existingVIP9 = await Product.findOne({ name: 'VIP9' });

    if (existingVIP9) {
      // Update existing VIP9
      existingVIP9.description = vip9Data.description;
      existingVIP9.price_NSL = vip9Data.price_NSL;
      existingVIP9.price_usdt = price_usdt;
      existingVIP9.daily_income_NSL = vip9Data.daily_income_NSL;
      existingVIP9.validity_days = vip9Data.validity_days;
      existingVIP9.benefits = vip9Data.benefits;
      existingVIP9.active = true;

      await existingVIP9.save();

      console.log('✅ Updated existing VIP9');
    } else {
      // Create new VIP9
      const vip9Product = await Product.create({
        name: vip9Data.name,
        description: vip9Data.description,
        price_NSL: vip9Data.price_NSL,
        price_usdt: price_usdt,
        daily_income_NSL: vip9Data.daily_income_NSL,
        validity_days: vip9Data.validity_days,
        benefits: vip9Data.benefits,
        active: true
      });

      console.log('🆕 Created new VIP9');
    }

    console.log('\n📊 VIP9 Product Details:');
    console.log('─'.repeat(60));
    console.log(`   Name: ${vip9Data.name}`);
    console.log(`   Price: ${vip9Data.price_NSL.toLocaleString()} NSL (${price_usdt} USDT)`);
    console.log(`   Daily Income: ${vip9Data.daily_income_NSL.toLocaleString()} NSL`);
    console.log(`   ROI Period: ${roiDays} days`);
    console.log(`   Monthly Income: ${monthlyIncome.toLocaleString()} NSL`);
    console.log(`   Benefits: ${vip9Data.benefits.length} premium features`);
    console.log('─'.repeat(60));

    // Update super admin to VIP9
    console.log('\n🔄 Updating super admin to VIP9...');
    const superAdmin = await User.findOne({ phone: '+232777777777' });

    if (superAdmin) {
      superAdmin.vip_level = 'VIP9';
      await superAdmin.save();
      console.log(`✅ Super admin (${superAdmin.phone}) updated to VIP9`);
    } else {
      console.log('⚠️  Super admin not found');
    }

    // Display all products
    console.log('\n📈 All VIP Products:');
    console.log('─'.repeat(80));
    console.log('Level | Price (NSL)  | Daily Income | ROI Days | Monthly Income');
    console.log('─'.repeat(80));

    const products = await Product.find().sort({ price_NSL: 1 });
    products.forEach(p => {
      const monthly = p.daily_income_NSL * 30;
      const roi = Math.ceil(p.price_NSL / p.daily_income_NSL);
      console.log(
        `${p.name.padEnd(6)}| ${p.price_NSL.toLocaleString().padEnd(13)}| ` +
        `${p.daily_income_NSL.toLocaleString().padEnd(13)}| ` +
        `${roi.toString().padEnd(9)}| ${monthly.toLocaleString()}`
      );
    });
    console.log('─'.repeat(80));

    console.log('\n✨ VIP9 added successfully!');
    console.log(`📊 Total VIP Products: ${products.length}`);

    await mongoose.connection.close();
    console.log('\n✅ Database connection closed');
    process.exit(0);
  } catch (error) {
    console.error('❌ Error adding VIP9:', error);
    await mongoose.connection.close();
    process.exit(1);
  }
}

// Run the function
addVIP9();
