const multer = require('multer');
const path = require('path');
const fs = require('fs');

// Ensure all upload directories exist
const uploadDirs = {
  profiles: path.join(__dirname, '../uploads/profiles'),
  payments: path.join(__dirname, '../uploads/payments'),
  kyc: path.join(__dirname, '../uploads/kyc')
};

Object.values(uploadDirs).forEach(dir => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
});

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

// Configure storage for profile photos
const profileStorage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, uploadDirs.profiles);
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, 'profile-' + req.user.id + '-' + uniqueSuffix + path.extname(file.originalname));
  }
});

// Configure storage for payment proofs
const paymentStorage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, uploadDirs.payments);
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, 'payment-' + req.user.id + '-' + uniqueSuffix + path.extname(file.originalname));
  }
});

// Configure storage for KYC documents
const kycStorage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, uploadDirs.kyc);
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    const docType = file.fieldname; // e.g., 'id_front', 'id_back', 'selfie'
    cb(null, `kyc-${req.user.id}-${docType}-${uniqueSuffix}${path.extname(file.originalname)}`);
  }
});

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
  // Keep old default export for backward compatibility
  upload: profileUpload,
  default: profileUpload
};
