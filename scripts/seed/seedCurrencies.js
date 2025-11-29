const mongoose = require('mongoose');
const dotenv = require('dotenv');
const ExchangeRate = require('../../models/ExchangeRate');
const binanceService = require('../../services/binanceService');

dotenv.config();

const currencies = [
  {
    currency_code: 'USD',
    currency_name: 'US Dollar',
    currency_symbol: '$',
    country: 'United States',
    rate_to_usd: 1,
    usd_per_unit: 1,
    enabled: true
  },
  {
    currency_code: 'NGN',
    currency_name: 'Nigerian Naira',
    currency_symbol: '₦',
    country: 'Nigeria',
    rate_to_usd: 1650, // Approximate, will be updated from Binance
    usd_per_unit: 0.000606,
    enabled: true
  },
  {
    currency_code: 'GBP',
    currency_name: 'British Pound',
    currency_symbol: '£',
    country: 'United Kingdom',
    rate_to_usd: 0.79,
    usd_per_unit: 1.27,
    enabled: true
  },
  {
    currency_code: 'EUR',
    currency_name: 'Euro',
    currency_symbol: '€',
    country: 'European Union',
    rate_to_usd: 0.92,
    usd_per_unit: 1.09,
    enabled: true
  },
  {
    currency_code: 'GHS',
    currency_name: 'Ghanaian Cedi',
    currency_symbol: 'GH₵',
    country: 'Ghana',
    rate_to_usd: 15.5,
    usd_per_unit: 0.065,
    enabled: true
  },
  {
    currency_code: 'ZAR',
    currency_name: 'South African Rand',
    currency_symbol: 'R',
    country: 'South Africa',
    rate_to_usd: 18.5,
    usd_per_unit: 0.054,
    enabled: true
  },
  {
    currency_code: 'KES',
    currency_name: 'Kenyan Shilling',
    currency_symbol: 'KSh',
    country: 'Kenya',
    rate_to_usd: 155,
    usd_per_unit: 0.0065,
    enabled: true
  },
  {
    currency_code: 'JPY',
    currency_name: 'Japanese Yen',
    currency_symbol: '¥',
    country: 'Japan',
    rate_to_usd: 150,
    usd_per_unit: 0.0067,
    enabled: true
  },
  {
    currency_code: 'CNY',
    currency_name: 'Chinese Yuan',
    currency_symbol: '¥',
    country: 'China',
    rate_to_usd: 7.2,
    usd_per_unit: 0.139,
    enabled: true
  },
  {
    currency_code: 'INR',
    currency_name: 'Indian Rupee',
    currency_symbol: '₹',
    country: 'India',
    rate_to_usd: 83,
    usd_per_unit: 0.012,
    enabled: true
  }
];

async function seedCurrencies() {
  try {
    // Connect to MongoDB
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/salonmoney', {
      useNewUrlParser: true,
      useUnifiedTopology: true
    });

    console.log('Connected to MongoDB');

    // Clear existing currencies
    await ExchangeRate.deleteMany({});
    console.log('Cleared existing currencies');

    // Insert currencies
    const insertedCurrencies = await ExchangeRate.insertMany(currencies);
    console.log(`Inserted ${insertedCurrencies.length} currencies`);

    // Try to update rates from Binance if configured
    if (binanceService.isConfigured) {
      console.log('\nUpdating exchange rates from Binance...');
      const result = await binanceService.updateExchangeRates();
      console.log(`✓ Updated ${result.updated} rates from Binance`);
      console.log(`✗ Failed to update ${result.failed} rates`);
    } else {
      console.log('\n⚠ Binance API not configured. Using default rates.');
      console.log('To enable live rates, set BINANCE_API_KEY and BINANCE_SECRET_KEY in your .env file');
    }

    // Display inserted currencies
    console.log('\n=== Seeded Currencies ===');
    const allCurrencies = await ExchangeRate.find({}).sort({ currency_code: 1 });
    allCurrencies.forEach(curr => {
      const activeRate = curr.getActiveRate();
      console.log(`${curr.currency_code.padEnd(5)} ${curr.currency_symbol.padEnd(3)} | 1 USD = ${activeRate.rate.toFixed(2)} ${curr.currency_code} | ${curr.currency_name}`);
    });

    console.log('\n✓ Currency seeding completed successfully!');

    await mongoose.connection.close();
    process.exit(0);
  } catch (error) {
    console.error('Error seeding currencies:', error);
    await mongoose.connection.close();
    process.exit(1);
  }
}

seedCurrencies();
