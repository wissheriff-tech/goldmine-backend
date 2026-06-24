const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const { put: blobPut } = require('@vercel/blob');
const { protectedFileUrl } = require('./protectedFiles');

const isVercel = process.env.VERCEL === '1';

async function readUploadBuffer(file) {
  if (file.buffer) return file.buffer;
  return fs.promises.readFile(file.path);
}

async function sanitizeReceiptImage(file) {
  const input = await readUploadBuffer(file);
  return sharp(input, { limitInputPixels: 25000000 })
    .rotate()
    .png({ compressionLevel: 9 })
    .toBuffer();
}

async function storeSanitizedReceiptImage({ file, userId, localDir, blobPrefix, filePrefix }) {
  const safeBuffer = await sanitizeReceiptImage(file);
  const safeName = `${filePrefix}_${userId}_${Date.now()}.png`;

  if (isVercel) {
    const blobPath = `${blobPrefix}/${userId}/${safeName}`;
    await blobPut(blobPath, safeBuffer, {
      access: 'private',
      contentType: 'image/png',
    });
    return protectedFileUrl(`blob:${blobPath}`);
  }

  if (!fs.existsSync(localDir)) fs.mkdirSync(localDir, { recursive: true });
  const safePath = path.join(localDir, safeName);
  await fs.promises.writeFile(safePath, safeBuffer);
  if (file.path && path.resolve(file.path) !== path.resolve(safePath)) {
    fs.promises.unlink(file.path).catch(() => {});
  }
  return protectedFileUrl(`local:${safePath.replace(/\\/g, '/')}`);
}

module.exports = {
  storeSanitizedReceiptImage,
};
