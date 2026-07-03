const express = require('express');
const { Testimonial, PaymentSetting } = require('../models');
const { authenticate, authorize } = require('../middleware/auth');
const { adminLimiter } = require('../middleware/security');

const ACTIVITY_FEED_KEY = 'activity_feed_visible';

async function getActivityFeedEnabled() {
  try {
    const setting = await PaymentSetting.findByPk(ACTIVITY_FEED_KEY);
    if (!setting) return true;
    return setting.value !== 'false';
  } catch {
    return true;
  }
}

const router = express.Router();

const VALID_ACTIVITY_TYPES = ['withdrawal', 'earning', 'deposit'];
const ACTIVITY_TYPES = ['withdrawal', 'earning', 'deposit', 'withdrawal', 'earning', 'deposit'];

const COUNTRY_CONFIG = [
  {
    country: 'Sierra Leone',
    flag: '🇸🇱',
    currency_code: 'NSL',
    currency_symbol: 'NSL',
    currency_name: 'NSL credit',
    phonePrefix: '+232',
    mobilePrefixes: ['76', '77', '78', '79', '30', '33'],
    firstNames: ['Mohamed', 'Fatmata', 'Ibrahim', 'Aminata', 'Abdul', 'Kadiatu', 'Alhaji', 'Mariama', 'Sorie', 'Hawa'],
    lastNames: ['Bangura', 'Kamara', 'Koroma', 'Sesay', 'Conteh', 'Kargbo', 'Mansaray', 'Turay', 'Jalloh', 'Sankoh'],
    ranges: { withdrawal: [1800, 9500], deposit: [1000, 7000], earning: [350, 1800] },
    seedTarget: 137,
  },
  {
    country: 'Liberia',
    flag: '🇱🇷',
    currency_code: 'LRD',
    currency_symbol: 'L$',
    currency_name: 'Liberian dollar',
    phonePrefix: '+231',
    mobilePrefixes: ['77', '88', '55', '99'],
    firstNames: ['Emmanuel', 'Comfort', 'Varney', 'Nowai', 'Thomas', 'Miatta', 'Joseph', 'Patience', 'Saye', 'Mamie'],
    lastNames: ['Kollie', 'Toe', 'Konneh', 'Flomo', 'Nimba', 'Johnson', 'Wesseh', 'Bility', 'Sherman', 'Dolo'],
    ranges: { withdrawal: [25000, 180000], deposit: [15000, 120000], earning: [2500, 18000] },
    seedTarget: 118,
  },
  {
    country: 'Togo',
    flag: '🇹🇬',
    currency_code: 'XOF',
    currency_symbol: 'CFA',
    currency_name: 'West African CFA franc',
    phonePrefix: '+228',
    mobilePrefixes: ['90', '91', '92', '93', '97', '99'],
    firstNames: ['Kofi', 'Ama', 'Edem', 'Akosua', 'Yao', 'Afi', 'Komlan', 'Abla', 'Kodjo', 'Essi'],
    lastNames: ['Mensah', 'Abalo', 'Agbeko', 'Dossou', 'Kpakpo', 'Adjovi', 'Togbe', 'Amegah', 'Sossou', 'Akakpo'],
    ranges: { withdrawal: [35000, 420000], deposit: [25000, 300000], earning: [5000, 45000] },
    seedTarget: 126,
  },
  {
    country: 'Ghana',
    flag: '🇬🇭',
    currency_code: 'GHS',
    currency_symbol: 'GH₵',
    currency_name: 'Ghanaian cedi',
    phonePrefix: '+233',
    mobilePrefixes: ['20', '24', '26', '27', '54', '55', '59'],
    firstNames: ['Kwame', 'Akosua', 'Yaw', 'Ama', 'Kofi', 'Abena', 'Kojo', 'Efua', 'Nana', 'Adwoa'],
    lastNames: ['Mensah', 'Owusu', 'Boateng', 'Asante', 'Addo', 'Osei', 'Appiah', 'Darko', 'Agyeman', 'Sarpong'],
    ranges: { withdrawal: [450, 6500], deposit: [300, 4500], earning: [80, 850] },
    seedTarget: 109,
  },
  {
    country: 'Guinea',
    flag: '🇬🇳',
    currency_code: 'GNF',
    currency_symbol: 'FG',
    currency_name: 'Guinean franc',
    phonePrefix: '+224',
    mobilePrefixes: ['620', '622', '624', '626', '628', '664'],
    firstNames: ['Mamadou', 'Aminata', 'Ibrahima', 'Fatoumata', 'Alpha', 'Binta', 'Ousmane', 'Mariama', 'Abdoulaye', 'Kadiatou'],
    lastNames: ['Diallo', 'Bah', 'Camara', 'Sow', 'Barry', 'Keita', 'Conte', 'Sylla', 'Toure', 'Kaba'],
    ranges: { withdrawal: [350000, 3500000], deposit: [250000, 2500000], earning: [60000, 420000] },
    seedTarget: 113,
  },
  {
    country: 'Nigeria',
    flag: '🇳🇬',
    currency_code: 'NGN',
    currency_symbol: '₦',
    currency_name: 'Nigerian naira',
    phonePrefix: '+234',
    mobilePrefixes: ['803', '806', '815', '701', '810', '905', '907', '913'],
    firstNames: ['Chukwuemeka', 'Ngozi', 'Babatunde', 'Chidinma', 'Emeka', 'Aisha', 'Ifeanyi', 'Zainab', 'Olumide', 'Adaeze'],
    lastNames: ['Obi', 'Okafor', 'Adeyemi', 'Eze', 'Nwosu', 'Bello', 'Okoro', 'Musa', 'Adebayo', 'Ibrahim'],
    ranges: { withdrawal: [45000, 650000], deposit: [30000, 450000], earning: [8000, 85000] },
    seedTarget: 151,
  },
  {
    country: 'Senegal',
    flag: '🇸🇳',
    currency_code: 'XOF',
    currency_symbol: 'CFA',
    currency_name: 'West African CFA franc',
    phonePrefix: '+221',
    mobilePrefixes: ['70', '76', '77', '78'],
    firstNames: ['Moussa', 'Aissatou', 'Ibrahima', 'Khady', 'Ousmane', 'Fatou', 'Cheikh', 'Aminata', 'Mamadou', 'Ndeye'],
    lastNames: ['Diallo', 'Ndiaye', 'Sow', 'Fall', 'Badji', 'Diop', 'Ba', 'Sarr', 'Gueye', 'Faye'],
    ranges: { withdrawal: [40000, 480000], deposit: [25000, 320000], earning: [7000, 50000] },
    seedTarget: 122,
  },
];

const COUNTRY_BY_NAME = new Map(COUNTRY_CONFIG.map(config => [config.country.toLowerCase(), config]));
const COUNTRY_OPTIONS = COUNTRY_CONFIG.map(({ country, flag, currency_code, currency_symbol, currency_name }) => ({
  country,
  flag,
  currency_code,
  currency_symbol,
  currency_name,
}));

const getCountryConfig = (country) => COUNTRY_BY_NAME.get(String(country || '').trim().toLowerCase()) || null;
const parsePositiveInt = (value, fallback, max) => {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.min(parsed, max);
};

const formatPhone = (config, index) => {
  const prefix = config.mobilePrefixes[index % config.mobilePrefixes.length];
  const seed = String(1000000 + ((index * 7919 + 234567) % 9000000));
  if (config.country === 'Nigeria') return `${config.phonePrefix} ${prefix} ${seed.slice(0, 3)} ${seed.slice(3)}`;
  if (config.country === 'Ghana') return `${config.phonePrefix} ${prefix} ${seed.slice(0, 3)} ${seed.slice(3)}`;
  if (config.country === 'Togo') return `${config.phonePrefix} ${prefix} ${seed.slice(0, 2)} ${seed.slice(2, 4)} ${seed.slice(4, 6)}`;
  if (config.country === 'Senegal') return `${config.phonePrefix} ${prefix} ${seed.slice(0, 3)} ${seed.slice(3, 6)}`;
  if (config.country === 'Guinea') return `${config.phonePrefix} ${prefix} ${seed.slice(0, 2)} ${seed.slice(2, 4)} ${seed.slice(4, 6)}`;
  return `${config.phonePrefix} ${prefix} ${seed.slice(0, 6)}`;
};

const amountFor = (config, type, index) => {
  const [min, max] = config.ranges[type];
  const raw = min + ((index * 6151 + type.charCodeAt(0) * 977) % (max - min + 1));
  const roundTo = max > 1000000 ? 5000 : max > 100000 ? 1000 : max > 10000 ? 500 : 10;
  return Math.round(raw / roundTo) * roundTo;
};

const buildSeedForCountry = (config, startIndex, count) => {
  return Array.from({ length: count }, (_, offset) => {
    const index = startIndex + offset;
    const type = ACTIVITY_TYPES[index % ACTIVITY_TYPES.length];
    const first = config.firstNames[index % config.firstNames.length];
    const last = config.lastNames[Math.floor(index / config.firstNames.length) % config.lastNames.length];
    return {
      name: `${first} ${last}`,
      country: config.country,
      flag: config.flag,
      phone: formatPhone(config, index),
      type,
      amount_nsl: amountFor(config, type, index),
    };
  });
};

const formatLocalAmount = (amount, config) => {
  const numeric = Number(amount) || 0;
  const value = numeric.toLocaleString('en-US', { maximumFractionDigits: 0 });
  if (!config) return `${value} NSL`;
  if (config.currency_symbol === config.currency_code) return `${value} ${config.currency_code}`;
  const prefix = ['L$', '₦'].includes(config.currency_symbol)
    ? config.currency_symbol
    : `${config.currency_symbol} `;
  return `${prefix}${value} ${config.currency_code}`;
};

const decorateTestimonial = (row) => {
  const plain = typeof row?.toJSON === 'function' ? row.toJSON() : row;
  const config = getCountryConfig(plain.country);
  const amount = Number(plain.amount_nsl) || 0;
  return {
    ...plain,
    flag: plain.flag || config?.flag || '',
    currency_code: config?.currency_code || 'NSL',
    currency_symbol: config?.currency_symbol || 'NSL',
    currency_name: config?.currency_name || 'Gold Mine credit',
    amount_local: amount,
    amount_display: formatLocalAmount(amount, config),
  };
};

async function seedIfNeeded() {
  try {
    await Testimonial.sync({ alter: false });
    for (const config of COUNTRY_CONFIG) {
      const count = await Testimonial.count({ where: { country: config.country } });
      const missing = Math.max(0, config.seedTarget - count);
      if (missing > 0) {
        await Testimonial.bulkCreate(buildSeedForCountry(config, count, missing));
      }
    }
  } catch {}
}
if (process.env.AUTO_SEED_TESTIMONIALS === 'true') {
  seedIfNeeded();
}

// Public: activity feed visibility setting
router.get('/settings', async (req, res) => {
  try {
    const enabled = await getActivityFeedEnabled();
    res.json({ activity_feed_visible: enabled });
  } catch (err) {
    res.status(500).json({ message: 'Error fetching settings', error: err.message });
  }
});

// Admin: update activity feed visibility
router.patch('/settings', authenticate, authorize(['superadmin']), adminLimiter, async (req, res) => {
  try {
    const { activity_feed_visible } = req.body;
    if (typeof activity_feed_visible !== 'boolean') {
      return res.status(400).json({ message: 'activity_feed_visible must be a boolean' });
    }
    await PaymentSetting.upsert({ key: ACTIVITY_FEED_KEY, value: String(activity_feed_visible), updated_by: req.user.id });
    res.json({ activity_feed_visible });
  } catch (err) {
    res.status(500).json({ message: 'Error updating settings', error: err.message });
  }
});

// Public: visible testimonials for user dashboard feed
router.get('/', async (req, res) => {
  try {
    const feedEnabled = await getActivityFeedEnabled();
    const requestedCountry = String(req.query.country || COUNTRY_OPTIONS[0].country).trim();
    const showAllCountries = requestedCountry.toLowerCase() === 'all';
    const countryConfig = showAllCountries ? null : getCountryConfig(requestedCountry);
    const page = parsePositiveInt(req.query.page, 1, 1000);
    const limit = parsePositiveInt(req.query.limit, 5, 30);

    if (!feedEnabled) {
      return res.json({
        feed_enabled: false,
        testimonials: [],
        countries: COUNTRY_OPTIONS,
        counts: {},
        pagination: { page, limit, total: 0, total_pages: 1, country: requestedCountry },
      });
    }

    const where = { visible: true };
    if (countryConfig) where.country = countryConfig.country;
    if (!showAllCountries && !countryConfig) where.country = COUNTRY_OPTIONS[0].country;
    const offset = (page - 1) * limit;
    const total = await Testimonial.count({ where });
    const rows = await Testimonial.findAll({
      where,
      order: [['id', 'ASC']],
      limit,
      offset,
    });
    const testimonials = rows.map(decorateTestimonial);
    const counts = {};
    await Promise.all(COUNTRY_OPTIONS.map(async option => {
      counts[option.country] = await Testimonial.count({ where: { visible: true, country: option.country } });
    }));
    res.json({
      feed_enabled: true,
      testimonials,
      countries: COUNTRY_OPTIONS,
      counts,
      pagination: {
        page,
        limit,
        total,
        total_pages: Math.max(1, Math.ceil(total / limit)),
        country: showAllCountries ? 'all' : (countryConfig?.country || COUNTRY_OPTIONS[0].country),
      },
    });
  } catch (err) {
    res.status(500).json({ message: 'Error fetching testimonials', error: err.message });
  }
});

// Admin: all testimonials
router.get('/all', authenticate, authorize(['superadmin']), async (req, res) => {
  try {
    const rows = await Testimonial.findAll({ order: [['id', 'ASC']] });
    res.json({ testimonials: rows.map(decorateTestimonial), countries: COUNTRY_OPTIONS });
  } catch (err) {
    res.status(500).json({ message: 'Error fetching testimonials', error: err.message });
  }
});

// Admin: toggle visible
router.patch('/:id/toggle', authenticate, authorize(['superadmin']), adminLimiter, async (req, res) => {
  try {
    const t = await Testimonial.findByPk(req.params.id);
    if (!t) return res.status(404).json({ message: 'Not found' });
    t.visible = !t.visible;
    await t.save();
    res.json({ testimonial: decorateTestimonial(t) });
  } catch (err) {
    res.status(500).json({ message: 'Error toggling testimonial', error: err.message });
  }
});

// Admin: delete
router.delete('/:id', authenticate, authorize(['superadmin']), adminLimiter, async (req, res) => {
  try {
    const t = await Testimonial.findByPk(req.params.id);
    if (!t) return res.status(404).json({ message: 'Not found' });
    await t.destroy();
    res.json({ message: 'Deleted' });
  } catch (err) {
    res.status(500).json({ message: 'Error deleting testimonial', error: err.message });
  }
});

// Admin: create
router.post('/', authenticate, authorize(['superadmin']), adminLimiter, async (req, res) => {
  try {
    const { name, country, phone, type, amount_nsl } = req.body;
    if (!name || !country || !phone || !type || !amount_nsl) {
      return res.status(400).json({ message: 'Name, country, phone, type, and amount are required' });
    }
    const cleanName = String(name).trim();
    const cleanPhone = String(phone).trim();
    const cleanType = String(type).trim().toLowerCase();
    if (cleanName.length > 80) return res.status(400).json({ message: 'Name cannot exceed 80 characters' });
    if (cleanPhone.length > 30) return res.status(400).json({ message: 'Phone cannot exceed 30 characters' });
    if (!VALID_ACTIVITY_TYPES.includes(cleanType)) return res.status(400).json({ message: 'Unsupported activity type' });
    const countryConfig = getCountryConfig(country);
    if (!countryConfig) return res.status(400).json({ message: 'Unsupported country' });
    const amount = Number(amount_nsl);
    if (!Number.isFinite(amount) || amount <= 0) return res.status(400).json({ message: 'Amount must be positive' });
    if (amount > 999999999999.99) return res.status(400).json({ message: 'Amount is too large' });
    const t = await Testimonial.create({
      name: cleanName,
      country: countryConfig.country,
      flag: countryConfig.flag,
      phone: cleanPhone,
      type: cleanType,
      amount_nsl: amount,
    });
    res.status(201).json({ testimonial: decorateTestimonial(t), countries: COUNTRY_OPTIONS });
  } catch (err) {
    res.status(500).json({ message: 'Error creating testimonial', error: err.message });
  }
});

module.exports = router;
