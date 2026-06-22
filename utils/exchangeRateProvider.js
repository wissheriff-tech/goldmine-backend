const { PaymentSetting } = require('../models');
const ps = require('./platformSettings');

// NSL is an internal platform unit — not tied to any external forex API.
// Rate is managed exclusively via the admin panel (PaymentSetting table).
// Default: 1 USDT = 23 NSL
const DEFAULT_RATE = Number(ps.DEFAULTS.exchange_rate_nsl_per_usdt) || 23;

let cachedSnapshot = null;
const CACHE_TTL_MS = 30_000;

function normalizeRate(value) {
  const rate = Number(value);
  return Number.isFinite(rate) && rate > 0 ? rate : DEFAULT_RATE;
}

async function getExchangeRateSnapshot() {
  const now = Date.now();
  if (cachedSnapshot && now - cachedSnapshot.cached_at < CACHE_TTL_MS) {
    return cachedSnapshot;
  }
  const rate = normalizeRate(await ps.get('exchange_rate_nsl_per_usdt'));
  cachedSnapshot = {
    rate,
    source: 'platform-setting',
    provider: null,
    provider_updated_at: null,
    provider_next_update_at: null,
    fetched_at: new Date().toISOString(),
    fallback: true,
    cached_at: now,
  };
  return cachedSnapshot;
}

async function refreshExchangeRate({ force = false } = {}) {
  if (force) cachedSnapshot = null;
  return getExchangeRateSnapshot();
}

module.exports = {
  refreshExchangeRate,
  getExchangeRateSnapshot,
};
