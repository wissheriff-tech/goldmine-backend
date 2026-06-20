const MAX_TEXT_LENGTH = 8000;
const MAX_FIELD_LENGTH = 120;
const LOCAL_CURRENCIES = new Set(['NSL', 'SLE', 'LE', 'LEONE', 'LEONES']);
const CRYPTO_CURRENCIES = new Set(['USDT', 'USD', '$']);
const ALLOWED_PROVIDERS = new Set(['orange_money', 'africell', 'binance']);

function normalizeString(value, maxLength = MAX_FIELD_LENGTH) {
  return String(value || '')
    .normalize('NFKC')
    .replace(/[\u0000-\u001F\u007F]/g, ' ')
    .replace(/[<>`]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength);
}

function sanitizeOcrText(value) {
  return normalizeString(value, MAX_TEXT_LENGTH);
}

function normalizeProvider(value) {
  const compact = normalizeString(value, 80).toLowerCase().replace(/[\s_-]+/g, '');
  if (!compact) return '';
  if (compact.includes('africell') || compact.includes('afrimoney') || compact.includes('afrimobile')) return 'africell';
  if (compact.includes('orange')) return 'orange_money';
  if (compact.includes('binance') || compact.includes('usdt') || compact.includes('trc20') || compact.includes('txid') || compact.includes('txhash')) return 'binance';
  return '';
}

function normalizeCurrency(value, provider = '') {
  const upper = normalizeString(value, 20).toUpperCase();
  if (CRYPTO_CURRENCIES.has(upper) || provider === 'binance') return 'USDT';
  if (LOCAL_CURRENCIES.has(upper)) return 'NSL';
  return provider === 'binance' ? 'USDT' : 'NSL';
}

function sanitizeReference(value) {
  return normalizeString(value, 100)
    .replace(/[^a-zA-Z0-9._:/#-]/g, '')
    .slice(0, 96);
}

function sanitizePhone(value) {
  return normalizeString(value, 40)
    .replace(/[^\d+]/g, '')
    .replace(/(?!^)\+/g, '')
    .slice(0, 20);
}

function parseAmountValue(value) {
  const cleaned = normalizeString(value, 40).replace(/,/g, '');
  if (!/^\d+(?:\.\d{1,6})?$/.test(cleaned)) return 0;
  const amount = parseFloat(cleaned);
  if (!Number.isFinite(amount) || amount <= 0 || amount > 1000000000) return 0;
  return amount;
}

function isAmountToken(value) {
  return /^\d/.test(String(value || '').replace(/,/g, ''));
}

function extractProvider(text, hint) {
  return normalizeProvider(hint) || normalizeProvider(text);
}

function extractReference(text, provider) {
  const patterns = [
    /(?:reference|ref|transaction\s*(?:id|no|number)?|trx\s*(?:id)?|txid|tx\s*hash|order\s*id|fact\s*id)\s*[:#-]?\s*([a-zA-Z0-9][a-zA-Z0-9._:/#-]{5,95})/i,
    /\b([a-zA-Z]{2}\d{6}\.\d{4}\.[a-zA-Z0-9]{3,40})\b/i,
    /\b([a-zA-Z]{2}\d{10,}[a-zA-Z0-9]{4,})\b/i,
  ];

  if (provider === 'binance') {
    patterns.push(/\b(0x[a-fA-F0-9]{32,80}|[a-fA-F0-9]{40,96})\b/i);
    patterns.push(/\b([a-zA-Z0-9]{20,96})\b/i);
  }

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) return sanitizeReference(match[1]);
  }
  return '';
}

function extractPhone(text, labelPattern) {
  const labelled = text.match(labelPattern);
  if (labelled) return sanitizePhone(labelled[1]);

  const generic = text.match(/\b(\+?232[\s().-]?\d{2,3}[\s().-]?\d{3}[\s().-]?\d{3,4}|0\d[\d\s().-]{6,13})\b/);
  return generic ? sanitizePhone(generic[1]) : '';
}

function extractAmount(text, provider) {
  const patterns = [
    /(?:amount|sent|paid|payment|total|received|credited)\s*(?:of)?\s*[:=-]?\s*(NSL|SLE|LEONES?|LE|USD|USDT|\$)?\s*([0-9][0-9,]*(?:\.\d{1,6})?)\s*(NSL|SLE|LEONES?|LE|USD|USDT)?/i,
    /(NSL|SLE|LEONES?|LE|USD|USDT|\$)\s*([0-9][0-9,]*(?:\.\d{1,6})?)/i,
    /([0-9][0-9,]*(?:\.\d{1,6})?)\s*(NSL|SLE|LEONES?|LE|USD|USDT)\b/i,
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (!match) continue;
    const amountToken = isAmountToken(match[2]) ? match[2] : match[1];
    const currencyToken = isAmountToken(match[2]) ? (match[1] || match[3]) : (match[2] || match[3]);
    const amount = parseAmountValue(amountToken);
    if (amount > 0) {
      return {
        amount,
        currency: normalizeCurrency(currencyToken, provider),
      };
    }
  }

  return { amount: 0, currency: normalizeCurrency('', provider) };
}

function extractTimestamp(text) {
  const match = text.match(/\b(\d{4}[-/]\d{2}[-/]\d{2}[ T]\d{1,2}:\d{2}(?::\d{2})?)\b/)
    || text.match(/\b(\d{1,2}[-/]\d{1,2}[-/]\d{2,4}\s+\d{1,2}:\d{2}(?::\d{2})?)\b/);
  return match ? normalizeString(match[1], 40) : '';
}

function extractDepositReceipt(ocrText, providerHint = '') {
  const text = sanitizeOcrText(ocrText);
  const provider = extractProvider(text, providerHint);
  const amountData = extractAmount(text, provider);
  const senderNumber = extractPhone(text, /(?:sender|from|paid\s*by|customer|mobile|phone|number|account)\s*[:#-]?\s*(\+?\d[\d\s().-]{6,22})/i);
  const receiverNumber = extractPhone(text, /(?:receiver|to|merchant|destination|recipient)\s*[:#-]?\s*(\+?\d[\d\s().-]{6,22})/i);

  return {
    provider: provider || 'unknown',
    reference_id: extractReference(text, provider),
    sender_number: senderNumber,
    receiver_number: receiverNumber && receiverNumber !== senderNumber ? receiverNumber : '',
    amount: amountData.amount,
    currency: amountData.currency,
    timestamp_receipt: extractTimestamp(text),
  };
}

function sanitizeReceiptSubmission(input = {}) {
  const extracted = input.ocr_text ? extractDepositReceipt(input.ocr_text, input.provider || input.ocr_provider) : {};
  const extractedProvider = extracted.provider && extracted.provider !== 'unknown' ? extracted.provider : '';
  const provider = normalizeProvider(input.ocr_provider) || extractedProvider || normalizeProvider(input.provider) || 'unknown';
  const amount = parseAmountValue(input.amount || input.amount_SLE || input.amount_NSL || extracted.amount);
  const currency = isMobileProvider(provider) ? 'NSL' : normalizeCurrency(input.currency || extracted.currency, provider);

  return {
    provider,
    reference_id: sanitizeReference(input.reference_id || input.txid || input.user_submitted_txid || extracted.reference_id),
    sender_number: sanitizePhone(input.sender_number || extracted.sender_number),
    receiver_number: sanitizePhone(input.receiver_number || extracted.receiver_number),
    amount,
    currency,
    timestamp_receipt: normalizeString(input.timestamp_receipt || extracted.timestamp_receipt, 60),
  };
}

function isMobileProvider(provider) {
  return provider === 'orange_money' || provider === 'africell';
}

function validateDepositReceipt(receipt) {
  const errors = [];
  if (!ALLOWED_PROVIDERS.has(receipt.provider)) errors.push('Payment provider could not be read from the screenshot.');
  if (!receipt.reference_id || receipt.reference_id.length < 6) errors.push('Transaction reference could not be read from the screenshot.');
  if (!receipt.amount || receipt.amount <= 0) errors.push('Payment amount could not be read from the screenshot.');
  if (isMobileProvider(receipt.provider) && receipt.amount < 1000) errors.push('Minimum mobile money deposit is 1,000 NSL.');
  if (isMobileProvider(receipt.provider) && !receipt.sender_number && !receipt.receiver_number) {
    errors.push('Mobile money number could not be read from the screenshot.');
  }
  return { valid: errors.length === 0, errors };
}

function providerLabel(provider) {
  if (provider === 'orange_money') return 'Orange Money';
  if (provider === 'africell') return 'Africell';
  if (provider === 'binance') return 'Binance';
  return 'Deposit';
}

function formatAmountLabel(amount, currency) {
  const value = Number(amount);
  const formatted = Number.isFinite(value)
    ? value.toLocaleString('en-US', { maximumFractionDigits: currency === 'USDT' ? 6 : 2 })
    : '0';
  return `${formatted} ${currency || 'NSL'}`;
}

module.exports = {
  sanitizeOcrText,
  extractDepositReceipt,
  sanitizeReceiptSubmission,
  validateDepositReceipt,
  normalizeProvider,
  normalizeCurrency,
  sanitizeReference,
  sanitizePhone,
  isMobileProvider,
  providerLabel,
  formatAmountLabel,
};
