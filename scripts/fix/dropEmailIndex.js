const mongoose = require('mongoose');
const dotenv = require('dotenv');

dotenv.config();

const dropBadIndexes = async () => {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('Connected to MongoDB');

    const db = mongoose.connection.db;

    // Drop old referralCode index (camelCase - wrong one)
    try {
      await db.collection('users').dropIndex('referralCode_1');
      console.log('✅ Old referralCode index dropped successfully');
    } catch (error) {
      if (error.code === 27) {
        console.log('ℹ️  referralCode index does not exist');
      } else {
        console.error('Error dropping referralCode index:', error.message);
      }
    }

    // Try to drop the email index
    try {
      await db.collection('users').dropIndex('email_1');
      console.log('✅ Email index dropped successfully');
    } catch (error) {
      if (error.code === 27) {
        console.log('ℹ️  Email index does not exist (already dropped)');
      } else {
        console.error('Error dropping email index:', error.message);
      }
    }

    await mongoose.connection.close();
    console.log('Database connection closed');
    process.exit(0);
  } catch (error) {
    console.error('Error:', error.message);
    process.exit(1);
  }
};

dropBadIndexes();
