/**
 * MongoDB Database Initialization Script
 * This script creates all required collections with proper indexes
 * Run this after connecting to MongoDB for the first time
 *
 * Usage: node init_database.js
 */

const mongoose = require('mongoose');
require('dotenv').config({ path: '../../.env' });

// Import all models to create collections
const User = require('../../models/User');
const Product = require('../../models/Product');
const Transaction = require('../../models/Transaction');
const Referral = require('../../models/Referral');
const CurrencyRate = require('../../models/CurrencyRate');
const Notification = require('../../models/Notification');
const Chat = require('../../models/Chat');

const initializeDatabase = async () => {
  try {
    console.log('🔄 Connecting to MongoDB...');
    await mongoose.connect(process.env.MONGODB_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true
    });
    console.log('✅ Connected to MongoDB successfully!');

    console.log('\n🔄 Creating collections and indexes...\n');

    // Create indexes for User collection
    console.log('📝 Creating User collection indexes...');
    await User.createIndexes();
    console.log('✅ User indexes created');

    // Create indexes for Product collection
    console.log('📝 Creating Product collection indexes...');
    await Product.createIndexes();
    console.log('✅ Product indexes created');

    // Create indexes for Transaction collection
    console.log('📝 Creating Transaction collection indexes...');
    await Transaction.createIndexes();
    console.log('✅ Transaction indexes created');

    // Create indexes for Referral collection
    console.log('📝 Creating Referral collection indexes...');
    await Referral.createIndexes();
    console.log('✅ Referral indexes created');

    // Create indexes for CurrencyRate collection
    console.log('📝 Creating CurrencyRate collection indexes...');
    await CurrencyRate.createIndexes();
    console.log('✅ CurrencyRate indexes created');

    // Create indexes for Notification collection
    console.log('📝 Creating Notification collection indexes...');
    await Notification.createIndexes();
    console.log('✅ Notification indexes created');

    // Create indexes for Chat collection
    console.log('📝 Creating Chat collection indexes...');
    await Chat.createIndexes();
    console.log('✅ Chat indexes created');

    console.log('\n✅ All collections and indexes created successfully!\n');

    // Display collection stats
    console.log('📊 Database Statistics:');
    const collections = await mongoose.connection.db.listCollections().toArray();
    console.log(`Total Collections: ${collections.length}`);
    collections.forEach(col => {
      console.log(`  - ${col.name}`);
    });

    console.log('\n✅ Database initialization complete!');
    console.log('\n📌 Next steps:');
    console.log('   1. Run: node seed_products.js (to create VIP products)');
    console.log('   2. Run: node ../admin/createSuperAdmin.js (to create admin user)');
    console.log('   3. Run: node seed_currencies.js (to add currency rates)');

  } catch (error) {
    console.error('❌ Error initializing database:', error);
    process.exit(1);
  } finally {
    await mongoose.disconnect();
    console.log('\n🔌 Disconnected from MongoDB');
  }
};

// Run initialization
initializeDatabase();
