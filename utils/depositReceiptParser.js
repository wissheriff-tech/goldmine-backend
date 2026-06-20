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
  const cleaned = normalizeString(value, 600).toLowerCase();
  const compact = cleaned.replace(/[\s_-]+/g, '');
  if (!compact) return '';
  if (compact.includes('africell') || compact.includes('afrimoney') || compact.includes('afrimobile')) return 'africell';
  if (
    compact.includes('orange')
    || compact.includes('referencepp')
    || compact.includes('orangeinfo')
    || (/\br\d{6}[\s.]\d{4}[\s.][a-z0-9]{3,40}\b/i.test(cleaned) && compact.includes('recharge'))
  ) return 'orange_money';
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
  const cleaned = normalizeString(value, 40)
    .replace(/[^\d+]/g, '')
    .replace(/(?!^)\+/g, '')
    .slice(0, 20);
  const digits = cleaned.replace(/\D/g, '');

  if (cleaned.startsWith('+232') && digits.length >= 11) return `+232${digits.slice(3, 11)}`;
  if (digits.startsWith('232') && digits.length >= 11) return `232${digits.slice(3, 11)}`;
  if (digits.startsWith('0') && digits.length >= 9) return digits.slice(0, 9);
  if (digits.startsWith('7') && digits.length >= 8) return digits.slice(0, 8);

  return cleaned;
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
  return extractReferenceInfo(text, provider)?.value || '';
}

function addReferenceCandidate(candidates, value, index, baseScore = 0) {
  const reference = sanitizeReference(value);
  if (!reference || reference.length < 6) return;
  const key = reference.toLowerCase();
  const existing = candidates.get(key);
  if (!existing || baseScore > existing.baseScore || index > existing.index) {
    candidates.set(key, { value: reference, index: Math.max(0, index || 0), baseScore });
  }
}

function collectReferenceMatches(text, pattern, handler) {
  let match = pattern.exec(text);
  while (match) {
    handler(match);
    if (pattern.lastIndex === match.index) pattern.lastIndex += 1;
    match = pattern.exec(text);
  }
}

function referenceTailScore(reference) {
  const match = reference.match(/^[a-zA-Z]{1,4}\d{6}\.(\d{4})\.([a-zA-Z0-9]{3,40})$/);
  if (!match) return 8;

  const tail = match[2];
  if (/^[a-zA-Z]\d{4,}$/.test(tail)) return 80;
  if (/^\d{4,}$/.test(tail)) return 60;
  if (/^[a-zA-Z0-9]{4,}$/.test(tail)) return 45;
  return 15;
}

function referenceContext(text, candidate, before = 80, after = 360) {
  if (!candidate) return text;
  const start = Math.max(0, candidate.index - before);
  const end = Math.min(text.length, candidate.index + after);
  return text.slice(start, end);
}

function scoreReferenceCandidate(text, provider, candidate) {
  const afterReference = text.slice(candidate.index, Math.min(text.length, candidate.index + 360));
  const aroundReference = referenceContext(text, candidate, 120, 360);
  const amount = extractAmount(afterReference, provider).amount || extractAmount(aroundReference, provider).amount;
  const sender = extractPhone(afterReference, /(?:sender|from|paid\s*by|customer|mobile|phone|number|account)\s*[:#-]?\s*(\+?\d[\d\s().-]{6,22})/i, false)
    || extractPhone(aroundReference, /(?:sender|from|paid\s*by|customer|mobile|phone|number|account)\s*[:#-]?\s*(\+?\d[\d\s().-]{6,22})/i, false);
  const receiver = extractPhone(afterReference, /(?:receiver|to|merchant|destination|recipient)\s*[:#-]?\s*(\+?\d[\d\s().-]{6,22})/i, false)
    || extractPhone(aroundReference, /(?:receiver|to|merchant|destination|recipient)\s*[:#-]?\s*(\+?\d[\d\s().-]{6,22})/i, false);

  let score = candidate.baseScore + referenceTailScore(candidate.value);
  if (amount > 0) score += 35;
  if (sender || receiver) score += 25;
  if (/(successful|completed|money\s*transfer|recharge|main\s*account|details)/i.test(afterReference)) score += 8;
  score += Math.min(10, Math.round((candidate.index / Math.max(text.length, 1)) * 10));
  return score;
}

function extractReferenceInfo(text, provider) {
  const candidates = new Map();
  const groupedLabel = /(?:reference|ref|transaction\s*(?:id|no|number)?|trx\s*(?:id)?|txid|tx\s*hash|order\s*id|fact\s*id)\s*[:#-]?\s*([a-zA-Z]{1,4}\d{6})[\s.]+(\d{4})[\s.]+([a-zA-Z0-9]{3,40})/gi;
  const groupedBare = /\b([a-zA-Z]{1,4}\d{6})[\s.]+(\d{4})[\s.]+([a-zA-Z0-9]{3,40})\b/gi;
  const labelledToken = /(?:reference|ref|transaction\s*(?:id|no|number)?|trx\s*(?:id)?|txid|tx\s*hash|order\s*id|fact\s*id)\s*[:#-]?\s*([a-zA-Z0-9][a-zA-Z0-9._:/#-]{5,95})/gi;
  const dottedToken = /\b([a-zA-Z]{1,4}\d{6}\.\d{4}\.[a-zA-Z0-9]{3,40})\b/gi;
  const compactToken = /\b([a-zA-Z]{1,4}\d{10,}[a-zA-Z0-9]{4,})\b/gi;

  collectReferenceMatches(text, groupedLabel, (match) => {
    addReferenceCandidate(candidates, `${match[1]}.${match[2]}.${match[3]}`, match.index, 28);
  });
  collectReferenceMatches(text, groupedBare, (match) => {
    addReferenceCandidate(candidates, `${match[1]}.${match[2]}.${match[3]}`, match.index, 16);
  });
  collectReferenceMatches(text, labelledToken, (match) => {
    addReferenceCandidate(candidates, match[1], match.index, 18);
  });
  collectReferenceMatches(text, dottedToken, (match) => {
    addReferenceCandidate(candidates, match[1], match.index, 14);
  });
  collectReferenceMatches(text, compactToken, (match) => {
    addReferenceCandidate(candidates, match[1], match.index, 8);
  });

  if (provider === 'binance') {
    collectReferenceMatches(text, /\b(0x[a-fA-F0-9]{32,80}|[a-fA-F0-9]{40,96})\b/gi, (match) => {
      addReferenceCandidate(candidates, match[1], match.index, 70);
    });
    collectReferenceMatches(text, /\b([a-zA-Z0-9]{20,96})\b/gi, (match) => {
      addReferenceCandidate(candidates, match[1], match.index, 18);
    });
  }

  return Array.from(candidates.values())
    .map((candidate) => ({ ...candidate, score: scoreReferenceCandidate(text, provider, candidate) }))
    .sort((left, right) => (right.score - left.score) || (right.index - left.index))[0] || null;
}

function extractPhone(text, labelPattern, allowGeneric = true) {
  const labelled = text.match(labelPattern);
  if (labelled) return sanitizePhone(labelled[1]);
  if (!allowGeneric) return '';

  const generic = text.match(/\b(\+?232[\s().-]?\d{2,3}[\s().-]?\d{3}[\s().-]?\d{3,4}|0\d[\d\s().-]{6,13}|7\d{7})\b/);
  return generic ? sanitizePhone(generic[1]) : '';
}

function extractAmount(text, provider) {
  const patterns = [
    /(?:recharge|transfer|money\s*transfer)\s*(?:of)?\s*[:=-]?\s*(NSL|SLE|LEONES?|LE|USD|USDT|\$)?\s*([0-9][0-9,]*(?:\.\d{1,6})?)\s*(NSL|SLE|LEONES?|LE|USD|USDT)?/i,
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
  if (match) return normalizeString(match[1], 40);

  const spaced = text.match(/\b(20\d{2})\s+(\d{2})\s+(\d{2})\s*(\d{2})(\d{2})\b/);
  if (spaced) return `${spaced[1]}-${spaced[2]}-${spaced[3]} ${spaced[4]}:${spaced[5]}`;

  const compact = text.match(/\b(20\d{2})(\d{2})(\d{2})[ T]?(\d{2})(\d{2})\b/);
  if (compact) return `${compact[1]}-${compact[2]}-${compact[3]} ${compact[4]}:${compact[5]}`;

  return '';
}

function extractDepositReceipt(ocrText, providerHint = '') {
  const text = sanitizeOcrText(ocrText);
  const provider = extractProvider(text, providerHint);
  const reference = extractReferenceInfo(text, provider);
  const afterReferenceText = reference ? text.slice(reference.index, Math.min(text.length, reference.index + 360)) : text;
  const aroundReferenceText = reference ? referenceContext(text, reference, 120, 360) : text;
  const amountData = extractAmount(afterReferenceText, provider);
  const fallbackAmountData = amountData.amount > 0 ? amountData : extractAmount(aroundReferenceText, provider);
  const finalAmountData = fallbackAmountData.amount > 0 ? fallbackAmountData : extractAmount(text, provider);
  const senderPattern = /(?:sender|from|paid\s*by|customer|mobile|phone|number|account)\s*[:#-]?\s*(\+?\d[\d\s().-]{6,22})/i;
  const receiverPattern = /(?:receiver|to|merchant|destination|recipient)\s*[:#-]?\s*(\+?\d[\d\s().-]{6,22})/i;
  const senderNumber = extractPhone(afterReferenceText, senderPattern, false)
    || extractPhone(aroundReferenceText, senderPattern, false)
    || extractPhone(text, senderPattern);
  const receiverNumber = extractPhone(afterReferenceText, receiverPattern, false)
    || extractPhone(aroundReferenceText, receiverPattern, false)
    || extractPhone(text, receiverPattern, false);
  const timestamp = extractTimestamp(afterReferenceText) || extractTimestamp(aroundReferenceText) || extractTimestamp(text);

  return {
    provider: provider || 'unknown',
    reference_id: reference?.value || extractReference(text, provider),
    sender_number: senderNumber,
    receiver_number: receiverNumber && receiverNumber !== senderNumber ? receiverNumber : '',
    amount: finalAmountData.amount,
    currency: finalAmountData.currency,
    timestamp_receipt: timestamp,
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
