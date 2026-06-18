const ps = require('./platformSettings');

const DEFAULT_NSL_PER_USDT = Number(ps.DEFAULTS.exchange_rate_nsl_per_usdt) || 23.99;

function round(value, decimals = 4) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 0;
  return Number(numeric.toFixed(decimals));
}

function normalizeRate(value) {
  const rate = Number(value);
  return Number.isFinite(rate) && rate > 0 ? rate : DEFAULT_NSL_PER_USDT;
}

async function getNslPerUsdt() {
  return normalizeRate(await ps.get('exchange_rate_nsl_per_usdt'));
}

function nslToUsdt(amountNSL, rate = DEFAULT_NSL_PER_USDT) {
  return round(Number(amountNSL || 0) / normalizeRate(rate));
}

function usdtToNsl(amountUsdt, rate = DEFAULT_NSL_PER_USDT) {
  return round(Number(amountUsdt || 0) * normalizeRate(rate));
}

function buildConversion(amount, sourceCurrency = 'NSL', rate = DEFAULT_NSL_PER_USDT) {
  const normalizedRate = normalizeRate(rate);
  const numericAmount = Number(amount);
  if (!Number.isFinite(numericAmount) || numericAmount <= 0) {
    return {
      amount_NSL: 0,
      amount_usdt: 0,
      exchange_rate_nsl_per_usdt: normalizedRate,
      base_currency: 'USDT',
      local_currency: 'NSL',
    };
  }

  const currency = String(sourceCurrency || 'NSL').toUpperCase();
  const amount_NSL = currency === 'USDT' ? usdtToNsl(numericAmount, normalizedRate) : round(numericAmount);
  const amount_usdt = currency === 'USDT' ? round(numericAmount) : nslToUsdt(numericAmount, normalizedRate);

  return {
    amount_NSL,
    amount_usdt,
    exchange_rate_nsl_per_usdt: normalizedRate,
    base_currency: 'USDT',
    local_currency: 'NSL',
  };
}

function syncUsdtBalanceFromNsl(balanceNSL, rate = DEFAULT_NSL_PER_USDT) {
  return nslToUsdt(balanceNSL, rate);
}

module.exports = {
  DEFAULT_NSL_PER_USDT,
  round,
  normalizeRate,
  getNslPerUsdt,
  nslToUsdt,
  usdtToNsl,
  buildConversion,
  syncUsdtBalanceFromNsl,
};
