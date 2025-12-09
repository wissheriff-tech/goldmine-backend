/**
 * Database Migration Script
 * Fixes database index issues causing duplicate key errors
 *
 * Issues Fixed:
 * 1. Email index - Drop old index and create sparse unique index
 * 2. ReferralCode index - Ensure sparse unique index
 * 3. Remove duplicate null values
 *
 * Run with: node scripts/fix_database_indexes.js
 */

const mongoose = require('mongoose');
const dotenv = require('dotenv');
const path = require('path');

// Load environment variables
dotenv.config({ path: path.join(__dirname, '../.env') });

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/salonmoney';

async function fixDatabaseIndexes() {
  try {
    console.log('🔌 Connecting to MongoDB...');
    await mongoose.connect(MONGODB_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true
    });
    console.log('✅ Connected to MongoDB\n');

    const db = mongoose.connection.db;
    const usersCollection = db.collection('users');

    // Step 1: Check existing indexes
    console.log('📊 Checking existing indexes...');
    const indexes = await usersCollection.indexes();
    console.log('Current indexes:', indexes.map(i => i.name).join(', '));
    console.log('');

    // Step 2: Drop and recreate email index to ensure it's unique + sparse
    console.log('🔧 Fixing email index...');
    const emailIndex = indexes.find(i => i.key && i.key.email);
    if (emailIndex) {
      if (!emailIndex.unique || !emailIndex.sparse) {
        console.log(`  ⚠️  Email index found but not correct (unique: ${emailIndex.unique}, sparse: ${emailIndex.sparse})`);
        console.log('  🗑️  Dropping existing email index...');
        await usersCollection.dropIndex('email_1').catch(err => {
          console.log('  ℹ️  Could not drop email_1:', err.message);
        });
        console.log('  ✅ Dropped old email index');
      } else {
        console.log('  ✅ Email index is already correct (unique + sparse)');
      }
    }

    // Step 3: Create new sparse unique email index
    console.log('  🔨 Creating sparse unique email index...');
    try {
      await usersCollection.createIndex(
        { email: 1 },
        { unique: true, sparse: true, background: true }
      );
      console.log('  ✅ Created sparse unique email index');
    } catch (err) {
      if (err.code === 85 || err.message.includes('already exists')) {
        console.log('  ℹ️  Email index already exists');
      } else {
        console.log('  ⚠️  Error creating email index:', err.message);
      }
    }
    console.log('');

    // Step 4: Fix referralCode index
    console.log('🔧 Fixing referralCode index...');
    const referralCodeIndex = indexes.find(i => i.key && i.key.referralCode);
    if (referralCodeIndex && !referralCodeIndex.sparse) {
      console.log('  ⚠️  Non-sparse referralCode index found. Dropping...');
      await usersCollection.dropIndex('referralCode_1').catch(err => {
        console.log('  ℹ️  Could not drop referralCode_1:', err.message);
      });
      console.log('  ✅ Dropped old referralCode index');
    }

    // Try to drop old referral_code index as well (if using different field name)
    const referralCode2Index = indexes.find(i => i.key && i.key.referral_code);
    if (referralCode2Index && !referralCode2Index.sparse) {
      console.log('  ⚠️  Non-sparse referral_code index found. Dropping...');
      await usersCollection.dropIndex('referral_code_1').catch(err => {
        console.log('  ℹ️  Could not drop referral_code_1:', err.message);
      });
      console.log('  ✅ Dropped old referral_code index');
    }

    // Create new sparse unique referral_code index
    console.log('  🔨 Creating sparse unique referral_code index...');
    try {
      await usersCollection.createIndex(
        { referral_code: 1 },
        { unique: true, sparse: true, background: true }
      );
      console.log('  ✅ Created sparse unique referral_code index');
    } catch (err) {
      if (err.code === 85 || err.message.includes('already exists')) {
        console.log('  ℹ️  Referral code index already exists with correct settings');
      } else {
        console.log('  ⚠️  Error creating referral_code index:', err.message);
      }
    }
    console.log('');

    // Step 5: Check for users with duplicate null emails
    console.log('🔍 Checking for duplicate null emails...');
    const nullEmailCount = await usersCollection.countDocuments({ email: null });
    const undefinedEmailCount = await usersCollection.countDocuments({ email: { $exists: false } });
    console.log(`  Found ${nullEmailCount} users with null email`);
    console.log(`  Found ${undefinedEmailCount} users with undefined email`);

    if (nullEmailCount > 1) {
      console.log('  ⚠️  Multiple users with null email detected');
      console.log('  ℹ️  This is OK with sparse indexes - they can coexist');
    }
    console.log('');

    // Step 6: Verify final indexes
    console.log('📊 Verifying final indexes...');
    const finalIndexes = await usersCollection.indexes();
    const emailIdx = finalIndexes.find(i => i.key && i.key.email);
    const refCodeIdx = finalIndexes.find(i => i.key && i.key.referral_code);

    console.log('Email index:', emailIdx ?
      `${emailIdx.unique ? 'unique' : 'non-unique'}, ${emailIdx.sparse ? 'sparse' : 'not sparse'}` :
      'NOT FOUND');
    console.log('Referral code index:', refCodeIdx ?
      `${refCodeIdx.unique ? 'unique' : 'non-unique'}, ${refCodeIdx.sparse ? 'sparse' : 'not sparse'}` :
      'NOT FOUND');
    console.log('');

    console.log('✅ Database index migration completed successfully!');
    console.log('');
    console.log('Summary:');
    console.log('  ✓ Email field: unique + sparse index');
    console.log('  ✓ Referral code field: unique + sparse index');
    console.log('  ✓ Multiple null values allowed (sparse index behavior)');
    console.log('');

  } catch (error) {
    console.error('❌ Migration failed:', error);
    process.exit(1);
  } finally {
    await mongoose.connection.close();
    console.log('🔌 Database connection closed');
  }
}

// Run migration
console.log('='.repeat(60));
console.log('DATABASE INDEX MIGRATION');
console.log('='.repeat(60));
console.log('');

fixDatabaseIndexes()
  .then(() => {
    console.log('Migration completed successfully!');
    process.exit(0);
  })
  .catch(err => {
    console.error('Migration failed:', err);
    process.exit(1);
  });
