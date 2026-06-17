const { PaymentSetting } = require('../models');

// Defaults — used when DB has no value
const DEFAULTS = {
  referral_l1_pct:      3,
  referral_l2_pct:      2,
  referral_l3_pct:      1,
  recharge_fee_pct:     5,
  withdrawal_fee_pct:   10,
  om_withdrawal_fee_pct: 20,
  exchange_rate_nsl_per_usdt: 23.99,
  dur_short:         3,
  dur_week:          7,
  dur_month:         30,
  dur_promo:         14,
  dur_promo_label:   'Promo',
};

// Simple 30-second in-process cache
let _cache = null;
let _cacheAt = 0;
const TTL = 30_000;

async function getAll() {
  if (_cache && Date.now() - _cacheAt < TTL) return _cache;
  const rows = await PaymentSetting.findAll({ attributes: ['key', 'value'] });
  const map = { ...DEFAULTS };
  for (const row of rows) {
    if (row.key in DEFAULTS) {
      const def = DEFAULTS[row.key];
      map[row.key] = typeof def === 'number' ? parseFloat(row.value) : row.value;
    }
  }
  _cache = map;
  _cacheAt = Date.now();
  return map;
}

function invalidate() {
  _cache = null;
}

async function get(key) {
  const all = await getAll();
  return all[key] ?? DEFAULTS[key];
}

module.exports = { getAll, get, invalidate, DEFAULTS };
