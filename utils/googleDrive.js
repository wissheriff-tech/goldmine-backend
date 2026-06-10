const { google } = require('googleapis');
const { Readable } = require('stream');

const FOLDER_ID = process.env.GOOGLE_DRIVE_KYC_FOLDER_ID;

function getAuth() {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!raw) throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON env var is missing');
  const credentials = JSON.parse(raw);
  return new google.auth.GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/drive.file'],
  });
}

async function uploadToDrive(buffer, filename, mimeType) {
  if (!FOLDER_ID) throw new Error('GOOGLE_DRIVE_KYC_FOLDER_ID env var is missing');
  const auth = getAuth();
  const drive = google.drive({ version: 'v3', auth });

  const stream = new Readable();
  stream.push(buffer);
  stream.push(null);

  const res = await drive.files.create({
    requestBody: {
      name: filename,
      parents: [FOLDER_ID],
    },
    media: {
      mimeType,
      body: stream,
    },
    fields: 'id, webViewLink',
  });

  return {
    fileId: res.data.id,
    viewUrl: res.data.webViewLink,
  };
}

module.exports = { uploadToDrive };
