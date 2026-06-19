const { AdminAuditLog } = require('../models');
const logger = require('./logger');

const SENSITIVE_KEY_PATTERN = /(password|token|secret|authorization|cookie|session|otp|code|proof|image|file)/i;

function redactValue(value) {
  if (Array.isArray(value)) return value.map(redactValue);
  if (value && typeof value === 'object') return sanitizeMetadata(value);
  if (typeof value === 'string' && value.length > 500) return `${value.slice(0, 500)}...`;
  return value;
}

function sanitizeMetadata(metadata = {}) {
  if (!metadata || typeof metadata !== 'object') return null;

  return Object.entries(metadata).reduce((safe, [key, value]) => {
    safe[key] = SENSITIVE_KEY_PATTERN.test(key) ? '[redacted]' : redactValue(value);
    return safe;
  }, {});
}

async function recordAdminAudit(req, {
  action,
  targetType = null,
  targetId = null,
  targetUserId = null,
  status = 'success',
  metadata = null,
} = {}) {
  if (!action) return;

  try {
    await AdminAuditLog.create({
      actor_user_id: req.user?.id || null,
      actor_role: req.user?.role || null,
      action,
      target_type: targetType,
      target_id: targetId == null ? null : String(targetId),
      target_user_id: targetUserId || null,
      status,
      ip_address: req.ip || req.headers?.['x-forwarded-for'] || null,
      user_agent: req.get?.('user-agent') || null,
      metadata: sanitizeMetadata(metadata),
    });
  } catch (error) {
    logger.error('Admin audit log write failed:', error);
  }
}

module.exports = {
  recordAdminAudit,
  sanitizeMetadata,
};
