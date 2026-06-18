const axios = require('axios');
const { PaymentSetting } = require('../models');
const ps = require('./platformSettings');

const DEFAULT_RATE = Number(ps.DEFAULTS.exchange_rate_nsl_per_usdt) || 23.99;
const DEFAULT_API_URL = 'https://open.er-api.com/v6/latest/USD';
const DEFAULT_TARGET_CODE = 'SLE';
const REFRESH_MS = Number(process.env.EXCHANGE_RATE_REFRESH_MS || 6 * 60 * 60 * 1000);
const FALLBACK_RETRY_MS = Number(process.env.EXCHANGE_RATE_FALLBACK_RETRY_MS || 5 * 60 * 1000);
const REQUEST_TIMEOUT_MS = Number(process.env.EXCHANGE_RATE_TIMEOUT_MS || 8000);

let cachedSnapshot = null;

function normalizeRate(value) {
  const rate = Number(value);
  return Number.isFinite(rate) && rate > 0 ? rate : DEFAULT_RATE;
}

function providerUrl() {
  const configured = process.env.EXCHANGE_RATE_API_URL || DEFAULT_API_URL;
  try {
    const url = new URL(configured);
    if (url.protocol !== 'https:' || url.hostname !== 'open.er-api.com') return DEFAULT_API_URL;
    return url.toString();
  } catch {
    return DEFAULT_API_URL;
  }
}

async function savedRateSnapshot() {
  const rate = normalizeRate(await ps.get('exchange_rate_nsl_per_usdt'));
  return {
    rate,
    source: 'platform-setting',
    target_code: process.env.EXCHANGE_RATE_TARGET_CODE || DEFAULT_TARGET_CODE,
    provider: null,
    provider_updated_at: null,
    provider_next_update_at: null,
    fetched_at: null,
    fallback: true,
  };
}

async function fetchProviderSnapshot() {
  const targetCode = String(process.env.EXCHANGE_RATE_TARGET_CODE || DEFAULT_TARGET_CODE).toUpperCase();
  const response = await axios.get(providerUrl(), {
    timeout: REQUEST_TIMEOUT_MS,
    validateStatus: status => status >= 200 && status < 300,
  });

  const body = response.data || {};
  if (body.result !== 'success' || !body.rates || !Number.isFinite(Number(body.rates[targetCode]))) {
    throw new Error(`Exchange rate provider did not return ${targetCode}`);
  }

  return {
    rate: normalizeRate(body.rates[targetCode]),
    source: 'exchange-rate-api',
    target_code: targetCode,
    provider: body.provider || 'https://www.exchangerate-api.com',
    provider_updated_at: body.time_last_update_utc || null,
    provider_next_update_at: body.time_next_update_utc || null,
    fetched_at: new Date().toISOString(),
    fallback: false,
  };
}

async function refreshExchangeRate({ force = false, updatedBy = null } = {}) {
  const now = Date.now();
  const ttl = cachedSnapshot && cachedSnapshot.fallback ? FALLBACK_RETRY_MS : REFRESH_MS;
  if (!force && cachedSnapshot && now - cachedSnapshot.cached_at < ttl) {
    return cachedSnapshot;
  }

  try {
    if (process.env.NODE_ENV === 'test' || process.env.EXCHANGE_RATE_PROVIDER_ENABLED === 'false') {
      throw new Error('Exchange rate provider disabled');
    }
    const snapshot = await fetchProviderSnapshot();
    await PaymentSetting.upsert({
      key: 'exchange_rate_nsl_per_usdt',
      value: String(snapshot.rate),
      updated_by: updatedBy,
    });
    ps.invalidate();
    cachedSnapshot = { ...snapshot, cached_at: now };
    return cachedSnapshot;
  } catch (error) {
    const fallback = await savedRateSnapshot();
    cachedSnapshot = {
      ...fallback,
      error: error.message,
      cached_at: now,
    };
    return cachedSnapshot;
  }
}

async function getExchangeRateSnapshot(options = {}) {
  return refreshExchangeRate(options);
}

module.exports = {
  refreshExchangeRate,
  getExchangeRateSnapshot,
};
