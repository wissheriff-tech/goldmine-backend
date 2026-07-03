const { Op } = require('sequelize');

const FILE_API_PATH = '/api/files';
const LOCAL_PREFIX = 'local:';
const BLOB_PREFIX = 'blob:';
const LEGACY_URL_PREFIX = 'url:';
const KYC_FIELDS = ['kyc_id_front', 'kyc_id_back', 'kyc_selfie', 'kyc_additional'];

function protectedFileUrl(ref) {
  return `${FILE_API_PATH}?ref=${encodeURIComponent(ref)}`;
}

function normalizeSlashes(value) {
  return String(value || '').replace(/\\/g, '/');
}

function decodeProtectedRef(value) {
  let raw = String(value || '').trim();
  if (!raw) return '';

  if (raw.startsWith(`${FILE_API_PATH}?`)) {
    try {
      const url = new URL(raw, 'https://app.local');
      raw = url.searchParams.get('ref') || '';
    } catch {
      return '';
    }
  }

  return raw;
}

function toStorageRef(value) {
  const raw = decodeProtectedRef(value);
  if (!raw) return null;

  if (raw.startsWith(BLOB_PREFIX) || raw.startsWith(LOCAL_PREFIX) || raw.startsWith(LEGACY_URL_PREFIX)) {
    return raw;
  }

  if (/^https?:\/\//i.test(raw)) {
    return `${LEGACY_URL_PREFIX}${raw}`;
  }

  const normalized = normalizeSlashes(raw).replace(/^\/+/, '');
  if (normalized.startsWith('uploads/')) {
    return `${LOCAL_PREFIX}${normalized}`;
  }

  return null;
}

function storedValueCandidates(refOrStoredValue) {
  const decoded = decodeProtectedRef(refOrStoredValue);
  const ref = toStorageRef(decoded);
  const values = new Set();

  if (decoded) values.add(decoded);
  if (ref) {
    values.add(ref);
    values.add(protectedFileUrl(ref));

    if (ref.startsWith(LOCAL_PREFIX)) {
      const localPath = ref.slice(LOCAL_PREFIX.length);
      values.add(localPath);
      values.add(`/${localPath}`);
    }

    if (ref.startsWith(LEGACY_URL_PREFIX)) {
      values.add(ref.slice(LEGACY_URL_PREFIX.length));
    }
  }

  return [...values].filter(Boolean);
}

function isGlobalAdmin(role) {
  return role === 'superadmin' || role === 'admin';
}

function canReviewFinance(role) {
  return isGlobalAdmin(role) || role === 'finance';
}

function canReviewKyc(role) {
  return isGlobalAdmin(role) || role === 'verificator' || role === 'approval';
}

async function canAccessProtectedFile(user, refOrStoredValue) {
  if (!user?.id) return false;
  const values = storedValueCandidates(refOrStoredValue);
  if (values.length === 0) return false;

  const { User, Transaction, DepositProof } = require('../models');
  const role = user.role;
  const userId = Number(user.id);

  const payment = await Transaction.findOne({
    where: { payment_proof: { [Op.in]: values } },
    attributes: ['id', 'user_id'],
  });
  if (payment) {
    return Number(payment.user_id) === userId || canReviewFinance(role);
  }

  const depositProof = await DepositProof.findOne({
    where: { receipt_image: { [Op.in]: values } },
    attributes: ['id', 'user_id'],
  });
  if (depositProof) {
    return Number(depositProof.user_id) === userId || canReviewFinance(role);
  }

  const kycWhere = {
    [Op.or]: KYC_FIELDS.map((field) => ({ [field]: { [Op.in]: values } })),
  };
  const kycOwner = await User.findOne({
    where: kycWhere,
    attributes: ['id'],
  });
  if (kycOwner) {
    return Number(kycOwner.id) === userId || canReviewKyc(role);
  }

  return false;
}

module.exports = {
  FILE_API_PATH,
  LOCAL_PREFIX,
  BLOB_PREFIX,
  LEGACY_URL_PREFIX,
  protectedFileUrl,
  toStorageRef,
  storedValueCandidates,
  canAccessProtectedFile,
};
