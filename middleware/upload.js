const multer = require('multer');
const path = require('path');
const fs = require('fs');

// ── Magic-byte validation ────────────────────────────────────────────────────
// MIME type / extension checks (done by fileFilter) can be spoofed in the HTTP
// headers.  We also read the first 12 bytes of the actual file content and
// compare against known signatures so that a renamed executable can never slip
// through as an image.

function detectMagic(buf) {
  if (!buf || buf.length < 3) return null;
  if (buf[0] === 0xFF && buf[1] === 0xD8 && buf[2] === 0xFF) return 'jpeg';
  if (buf.length >= 8 &&
      buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4E && buf[3] === 0x47 &&
      buf[4] === 0x0D && buf[5] === 0x0A && buf[6] === 0x1A && buf[7] === 0x0A) return 'png';
  if (buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x38) return 'gif';
  if (buf.length >= 12 &&
      buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46 &&
      buf[8] === 0x57 && buf[9] === 0x45 && buf[10] === 0x42 && buf[11] === 0x50) return 'webp';
  if (buf[0] === 0x25 && buf[1] === 0x50 && buf[2] === 0x44 && buf[3] === 0x46) return 'pdf';
  return null;
}

async function readHeader(file) {
  if (file.buffer) return file.buffer.slice(0, 12);
  return new Promise((resolve, reject) => {
    const chunks = [];
    const s = fs.createReadStream(file.path, { start: 0, end: 11 });
    s.on('data', c => chunks.push(c));
    s.on('end', () => resolve(Buffer.concat(chunks)));
    s.on('error', reject);
  });
}

function purge(file) {
  if (file.path) fs.unlink(file.path, () => {});
}

const IMAGE_TYPES    = new Set(['jpeg', 'png', 'gif', 'webp']);
const DOCUMENT_TYPES = new Set(['jpeg', 'png', 'gif', 'webp', 'pdf']);

// Middleware for single-file image uploads (req.file)
const assertImageMagicBytes = async (req, res, next) => {
  if (!req.file) return next();
  try {
    const buf  = await readHeader(req.file);
    const type = detectMagic(buf);
    if (!IMAGE_TYPES.has(type)) {
      purge(req.file);
      return res.status(400).json({ message: 'Invalid file content. Only real image files are accepted.' });
    }
    next();
  } catch {
    return res.status(400).json({ message: 'Could not verify file content.' });
  }
};

// Middleware for document uploads — single file (req.file) or multi-field (req.files)
const assertDocumentMagicBytes = async (req, res, next) => {
  const files = req.file
    ? [req.file]
    : Object.values(req.files || {}).flat();
  if (files.length === 0) return next();
  try {
    for (const file of files) {
      const buf  = await readHeader(file);
      const type = detectMagic(buf);
      if (!DOCUMENT_TYPES.has(type)) {
        files.forEach(purge);
        return res.status(400).json({ message: 'Invalid file content. Only real image or PDF files are accepted.' });
      }
    }
    next();
  } catch {
    return res.status(400).json({ message: 'Could not verify file content.' });
  }
};

// Check if running on Vercel (read-only file system)
const isVercel = process.env.VERCEL === '1';

// Upload directories (only used when NOT on Vercel)
const uploadDirs = {
  profiles: path.join(__dirname, '../uploads/profiles'),
  payments: path.join(__dirname, '../uploads/payments'),
  kyc: path.join(__dirname, '../uploads/kyc')
};

// Only create directories if NOT on Vercel
if (!isVercel) {
  Object.values(uploadDirs).forEach(dir => {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  });
}

// File filter for images only
const imageFilter = (req, file, cb) => {
  const allowedTypes = /jpeg|jpg|png|gif|webp/;
  const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
  const mimetype = allowedTypes.test(file.mimetype);

  if (mimetype && extname) {
    return cb(null, true);
  } else {
    cb(new Error('Only image files are allowed (jpeg, jpg, png, gif, webp)'));
  }
};

// File filter for documents (images and PDFs)
const documentFilter = (req, file, cb) => {
  const allowedTypes = /jpeg|jpg|png|gif|webp|pdf/;
  const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
  const mimetype = /image\/(jpeg|jpg|png|gif|webp)|application\/pdf/.test(file.mimetype);

  if (mimetype && extname) {
    return cb(null, true);
  } else {
    cb(new Error('Only image and PDF files are allowed'));
  }
};

// Use memory storage on Vercel, disk storage otherwise
let profileStorage, paymentStorage, kycStorage;

if (isVercel) {
  // Memory storage for Vercel (files stored in buffer, not on disk)
  profileStorage = multer.memoryStorage();
  paymentStorage = multer.memoryStorage();
  kycStorage = multer.memoryStorage();
} else {
  // Configure disk storage for profile photos
  profileStorage = multer.diskStorage({
    destination: function (req, file, cb) {
      cb(null, uploadDirs.profiles);
    },
    filename: function (req, file, cb) {
      const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
      cb(null, 'profile-' + req.user.id + '-' + uniqueSuffix + path.extname(file.originalname));
    }
  });

  // Configure disk storage for payment proofs
  paymentStorage = multer.diskStorage({
    destination: function (req, file, cb) {
      cb(null, uploadDirs.payments);
    },
    filename: function (req, file, cb) {
      const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
      cb(null, 'payment-' + req.user.id + '-' + uniqueSuffix + path.extname(file.originalname));
    }
  });

  // Configure disk storage for KYC documents
  kycStorage = multer.diskStorage({
    destination: function (req, file, cb) {
      cb(null, uploadDirs.kyc);
    },
    filename: function (req, file, cb) {
      const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
      const docType = file.fieldname; // e.g., 'id_front', 'id_back', 'selfie'
      cb(null, `kyc-${req.user.id}-${docType}-${uniqueSuffix}${path.extname(file.originalname)}`);
    }
  });
}

// Create multer upload instances
const profileUpload = multer({
  storage: profileStorage,
  limits: {
    fileSize: 10 * 1024 * 1024 // 10MB max file size
  },
  fileFilter: imageFilter
});

const paymentUpload = multer({
  storage: paymentStorage,
  limits: {
    fileSize: 10 * 1024 * 1024 // 10MB max file size
  },
  fileFilter: imageFilter
});

const kycUpload = multer({
  storage: kycStorage,
  limits: {
    fileSize: 10 * 1024 * 1024 // 10MB max file size
  },
  fileFilter: documentFilter
});

module.exports = {
  profileUpload,
  paymentUpload,
  kycUpload,
  assertImageMagicBytes,
  assertDocumentMagicBytes,
  upload: profileUpload,
  default: profileUpload,
};
