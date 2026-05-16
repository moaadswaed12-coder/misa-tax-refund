const multer = require('multer');
const path = require('path');
const fs = require('fs');

const UPLOAD_DIR = path.join(__dirname, 'uploads');

if (!fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const phone = req.body.phone ? req.body.phone.replace(/[^0-9]/g, '') : 'unknown';
    const userDir = path.join(UPLOAD_DIR, phone);
    if (!fs.existsSync(userDir)) {
      fs.mkdirSync(userDir, { recursive: true });
    }
    cb(null, userDir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    const base = path.basename(file.originalname, ext).replace(/[^a-zA-Z0-9\u0590-\u05FF_-]/g, '_');
    const ts = Date.now();
    cb(null, `${ts}_${base}${ext}`);
  },
});

const fileFilter = (req, file, cb) => {
  const allowed = [
    'application/pdf',
    'image/jpeg',
    'image/png',
    'image/jpg',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  ];
  if (allowed.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error('סוג קובץ לא נתמך. נא להעלות PDF, תמונות או מסמכי וורד בלבד.'), false);
  }
};

const upload = multer({
  storage,
  fileFilter,
  limits: { fileSize: 15 * 1024 * 1024 },
});

module.exports = { upload };
