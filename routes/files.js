const express = require('express');
const path = require('path');
const { Readable } = require('stream');
const { get: blobGet } = require('@vercel/blob');
const { authenticate } = require('../middleware/auth');
const logger = require('../utils/logger');
const {
  LOCAL_PREFIX,
  BLOB_PREFIX,
  LEGACY_URL_PREFIX,
  toStorageRef,
  canAccessProtectedFile,
} = require('../utils/protectedFiles');

const router = express.Router();

function applySensitiveFileHeaders(res, contentType) {
  if (contentType) res.setHeader('Content-Type', contentType);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Cache-Control', 'private, no-store');
}

function localUploadPath(ref) {
  const raw = ref.slice(LOCAL_PREFIX.length).replace(/\\/g, '/').replace(/^\/+/, '');
  const normalized = path.posix.normalize(raw);
  if (!normalized.startsWith('uploads/') || normalized.includes('\0') || normalized.startsWith('../')) {
    return null;
  }

  const root = path.resolve(__dirname, '..');
  const absolute = path.resolve(root, normalized);
  const uploadsRoot = path.resolve(root, 'uploads');
  if (!absolute.startsWith(`${uploadsRoot}${path.sep}`)) return null;
  return absolute;
}

function legacyBlobUrl(ref) {
  const raw = ref.slice(LEGACY_URL_PREFIX.length);
  try {
    const url = new URL(raw);
    if (url.protocol !== 'https:') return null;
    const hostname = url.hostname.toLowerCase();
    if (hostname !== 'blob.vercel-storage.com' && !hostname.endsWith('.blob.vercel-storage.com')) return null;
    return url.toString();
  } catch {
    return null;
  }
}

router.get('/', authenticate, async (req, res) => {
  try {
    const rawRef = Array.isArray(req.query.ref) ? req.query.ref[0] : req.query.ref;
    const ref = toStorageRef(rawRef);
    if (!ref) {
      return res.status(400).json({ message: 'Invalid file reference' });
    }

    const allowed = await canAccessProtectedFile(req.user, rawRef);
    if (!allowed) {
      return res.status(403).json({ message: 'Access denied' });
    }

    if (ref.startsWith(BLOB_PREFIX)) {
      const pathname = ref.slice(BLOB_PREFIX.length);
      const blob = await blobGet(pathname, { access: 'private', useCache: false });
      if (!blob || blob.statusCode === 304 || !blob.stream) {
        return res.status(404).json({ message: 'File not found' });
      }

      applySensitiveFileHeaders(res, blob.blob.contentType);
      if (blob.blob.size) res.setHeader('Content-Length', String(blob.blob.size));
      return Readable.fromWeb(blob.stream).pipe(res);
    }

    if (ref.startsWith(LOCAL_PREFIX)) {
      const filePath = localUploadPath(ref);
      if (!filePath) {
        return res.status(403).json({ message: 'Access denied' });
      }
      applySensitiveFileHeaders(res);
      return res.sendFile(filePath, (err) => {
        if (err && !res.headersSent) res.status(404).json({ message: 'File not found' });
      });
    }

    if (ref.startsWith(LEGACY_URL_PREFIX)) {
      const url = legacyBlobUrl(ref);
      if (!url) {
        return res.status(403).json({ message: 'Access denied' });
      }
      const upstream = await fetch(url);
      if (!upstream.ok || !upstream.body) {
        return res.status(404).json({ message: 'File not found' });
      }
      applySensitiveFileHeaders(res, upstream.headers.get('content-type'));
      const length = upstream.headers.get('content-length');
      if (length) res.setHeader('Content-Length', length);
      return Readable.fromWeb(upstream.body).pipe(res);
    }

    return res.status(400).json({ message: 'Invalid file reference' });
  } catch (error) {
    logger.error('Protected file fetch error:', error);
    return res.status(500).json({ message: 'Error fetching file' });
  }
});

async function serveLegacyUpload(req, res) {
  const rawSegment = req.params[0] || '';
  const ref = `${LOCAL_PREFIX}uploads/${rawSegment}`;
  const allowed = await canAccessProtectedFile(req.user, ref);
  if (!allowed) {
    return res.status(403).json({ message: 'Access denied' });
  }

  const filePath = localUploadPath(ref);
  if (!filePath) {
    return res.status(403).json({ message: 'Access denied' });
  }

  applySensitiveFileHeaders(res);
  return res.sendFile(filePath, (err) => {
    if (err && !res.headersSent) res.status(404).json({ message: 'File not found' });
  });
}

module.exports = {
  router,
  serveLegacyUpload,
};
