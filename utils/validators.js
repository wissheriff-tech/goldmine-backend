/**
 * Input Validation Utilities
 * Common validation functions for user input, transactions, etc.
 */

const { USER, TRANSACTION, PRODUCT } = require('../config/constants');

/**
 * Validate email format
 */
const isValidEmail = (email) => {
  if (!email) return false;
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
};

/**
 * Validate phone number format (international)
 */
const isValidPhone = (phone) => {
  if (!phone) return false;
  // Allow international format: +123456789 or 123456789
  const phoneRegex = /^\+?[1-9]\d{6,14}$/;
  return phoneRegex.test(phone.replace(/[\s-()]/g, ''));
};

/**
 * Validate username format
 */
const isValidUsername = (username) => {
  if (!username) return false;
  // 3-30 characters, alphanumeric, underscores, hyphens
  const usernameRegex = /^[a-zA-Z0-9_-]{3,30}$/;
  return usernameRegex.test(username);
};

/**
 * Validate password strength
 */
const isValidPassword = (password) => {
  if (!password || password.length < USER.MIN_PASSWORD_LENGTH) return false;
  // At least 8 characters, 1 uppercase, 1 lowercase, 1 number, 1 special char
  const passwordRegex = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]{8,}$/;
  return passwordRegex.test(password);
};

/**
 * Validate amount (positive number with max 2 decimals)
 */
const isValidAmount = (amount) => {
  if (typeof amount !== 'number' || amount <= 0) return false;
  // Max 2 decimal places
  return /^\d+(\.\d{1,2})?$/.test(amount.toString());
};

/**
 * Validate role
 */
const isValidRole = (role) => {
  return USER.ROLES.includes(role);
};

/**
 * Validate transaction type
 */
const isValidTransactionType = (type) => {
  return TRANSACTION.TYPES.includes(type);
};

/**
 * Validate transaction status
 */
const isValidTransactionStatus = (status) => {
  return TRANSACTION.STATUSES.includes(status);
};

/**
 * Validate VIP level
 */
const isValidVIPLevel = (level) => {
  return PRODUCT.VIP_LEVELS.includes(level) || level === 'none';
};

/**
 * Validate MongoDB ObjectId format
 */
const isValidObjectId = (id) => {
  if (!id) return false;
  return /^[0-9a-fA-F]{24}$/.test(id);
};

/**
 * Validate crypto wallet address (basic validation)
 */
const isValidWalletAddress = (address) => {
  if (!address) return false;
  // Basic validation: 26-42 alphanumeric characters
  return /^[a-zA-Z0-9]{26,42}$/.test(address);
};

/**
 * Sanitize string input (remove dangerous characters)
 */
const sanitizeString = (str) => {
  if (!str) return '';
  return str.toString().trim().replace(/[<>]/g, '');
};

/**
 * Validate file type
 */
const isValidImageFile = (mimetype) => {
  const { UPLOAD } = require('../config/constants');
  return UPLOAD.ALLOWED_IMAGE_TYPES.includes(mimetype);
};

const isValidDocumentFile = (mimetype) => {
  const { UPLOAD } = require('../config/constants');
  return UPLOAD.ALLOWED_DOCUMENT_TYPES.includes(mimetype);
};

/**
 * Validate pagination parameters
 */
const validatePagination = (page, limit) => {
  const { PAGINATION } = require('../config/constants');

  const validPage = Math.max(1, parseInt(page) || PAGINATION.DEFAULT_PAGE);
  const validLimit = Math.min(
    Math.max(1, parseInt(limit) || PAGINATION.DEFAULT_LIMIT),
    PAGINATION.MAX_LIMIT
  );

  return { page: validPage, limit: validLimit };
};

/**
 * Validate date range
 */
const isValidDateRange = (startDate, endDate) => {
  const start = new Date(startDate);
  const end = new Date(endDate);

  if (isNaN(start.getTime()) || isNaN(end.getTime())) return false;
  return start <= end;
};

module.exports = {
  isValidEmail,
  isValidPhone,
  isValidUsername,
  isValidPassword,
  isValidAmount,
  isValidRole,
  isValidTransactionType,
  isValidTransactionStatus,
  isValidVIPLevel,
  isValidObjectId,
  isValidWalletAddress,
  sanitizeString,
  isValidImageFile,
  isValidDocumentFile,
  validatePagination,
  isValidDateRange
};
