require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const { getDb, queryAll, queryOne, run } = require('./db');
const { calculateRefund } = require('./tax-calc');
const { upload } = require('./upload');
const { notifyNewLead } = require('./notify');
const { createCardToken } = require('./payment');

const app = express();
const PORT = process.env.PORT || 3001;

// ──────────────────────────────────────────────────────────────────
// Middleware
// ──────────────────────────────────────────────────────────────────
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Serve uploaded files statically
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Serve the frontend (parent directory)
app.use(express.static(path.join(__dirname, '..')));

// ──────────────────────────────────────────────────────────────────
// Bootstrap DB
// ──────────────────────────────────────────────────────────────────
let dbReady = false;
getDb().then(() => { dbReady = true; });

function requireDb(req, res, next) {
  if (!dbReady) {
    return res.status(503).json({ error: 'מסד הנתונים באתחול, נסה שוב בעוד שנייה' });
  }
  next();
}
app.use(requireDb);

// ──────────────────────────────────────────────────────────────────
// API: Submit Lead
// ──────────────────────────────────────────────────────────────────
app.post('/api/submit-lead', (req, res) => {
  try {
    const { name, phone, answers } = req.body;

    if (!name || name.trim().length < 2) {
      return res.status(400).json({ error: 'נא להזין שם מלא' });
    }
    const cleanPhone = (phone || '').replace(/[^0-9]/g, '');
    if (cleanPhone.length < 9) {
      return res.status(400).json({ error: 'נא להזין מספר טלפון תקין' });
    }

    const { refund, breakdown } = calculateRefund(answers || []);

    // Upsert: INSERT OR REPLACE
    const existing = queryOne('SELECT id FROM leads WHERE phone = ?', [cleanPhone]);
    if (existing) {
      run(
        `UPDATE leads SET name = ?, refund_estimate = ?, answers_json = ?, status = 'updated' WHERE phone = ?`,
        [name.trim(), refund, JSON.stringify(answers || []), cleanPhone]
      );
    } else {
      run(
        `INSERT INTO leads (name, phone, refund_estimate, answers_json) VALUES (?, ?, ?, ?)`,
        [name.trim(), cleanPhone, refund, JSON.stringify(answers || [])]
      );
    }

    const lead = {
      name: name.trim(),
      phone: cleanPhone,
      refundEstimate: refund,
      createdAt: new Date().toISOString(),
    };

    notifyNewLead(lead);

    res.json({
      success: true,
      refund,
      breakdown,
      message: `ההחזר המשוער שלך הוא ₪${refund.toLocaleString('he-IL')}`,
    });
  } catch (err) {
    console.error('❌ /api/submit-lead error:', err);
    res.status(500).json({ error: 'שגיאת שרת פנימית. נסה שוב מאוחר יותר.' });
  }
});

// ──────────────────────────────────────────────────────────────────
// API: Upload Form 106 document(s)
// ──────────────────────────────────────────────────────────────────
app.post('/api/upload-106', upload.array('documents', 10), (req, res) => {
  try {
    const { phone } = req.body;
    const cleanPhone = (phone || '').replace(/[^0-9]/g, '');

    if (!cleanPhone || cleanPhone.length < 9) {
      return res.status(400).json({ error: 'נא לספק מספר טלפון תקין בשדה phone' });
    }

    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ error: 'לא התקבלו קבצים להעלאה' });
    }

    const lead = queryOne('SELECT id FROM leads WHERE phone = ?', [cleanPhone]);
    if (!lead) {
      return res.status(404).json({ error: 'לא נמצא משתמש עם מספר טלפון זה. יש להשלים תחילה את השאלון.' });
    }

    const uploaded = [];
    for (const file of req.files) {
      const info = {
        filename: file.filename,
        originalName: file.originalname,
        mimeType: file.mimetype,
        size: file.size,
        url: `/uploads/${cleanPhone}/${file.filename}`,
      };
      run(
        `INSERT INTO documents (lead_id, filename, original_name, file_path, mime_type, file_size) VALUES (?, ?, ?, ?, ?, ?)`,
        [lead.id, file.filename, file.originalname, file.path, file.mimetype, file.size]
      );
      uploaded.push(info);
    }

    run(`UPDATE leads SET status = 'documents_uploaded' WHERE id = ?`, [lead.id]);

    res.json({
      success: true,
      uploaded,
      count: uploaded.length,
      message: `${uploaded.length} מסמכים הועלו בהצלחה`,
    });
  } catch (err) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ error: 'גודל הקובץ חורג מהמותר (15MB מקסימום לקובץ)' });
    }
    if (err.message && err.message.includes('סוג קובץ לא נתמך')) {
      return res.status(400).json({ error: err.message });
    }
    console.error('❌ /api/upload-106 error:', err);
    res.status(500).json({ error: 'שגיאה בהעלאת הקבצים' });
  }
});

// ──────────────────────────────────────────────────────────────────
// API: Setup Payment – Tokenize card via Meshulam
// ──────────────────────────────────────────────────────────────────
app.post('/api/setup-payment', async (req, res) => {
  try {
    const { phone, cardNumber, expMonth, expYear, cvv, holderId, holderName } = req.body;

    const cleanPhone = (phone || '').replace(/[^0-9]/g, '');
    if (!cleanPhone || cleanPhone.length < 9) {
      return res.status(400).json({ error: 'נא לספק מספר טלפון תקין' });
    }

    // Validate card fields
    if (!cardNumber || cardNumber.replace(/\s/g, '').length < 13) {
      return res.status(400).json({ error: 'נא להזין מספר כרטיס תקין' });
    }
    if (!expMonth || !expYear) {
      return res.status(400).json({ error: 'נא להזין תוקף כרטיס' });
    }
    if (!cvv || cvv.length < 3) {
      return res.status(400).json({ error: 'נא להזין קוד אבטחה (CVV)' });
    }
    if (!holderId || holderId.replace(/[^0-9]/g, '').length < 8) {
      return res.status(400).json({ error: 'נא להזין תעודת זהות תקינה' });
    }

    const lead = queryOne('SELECT id, name, status FROM leads WHERE phone = ?', [cleanPhone]);
    if (!lead) {
      return res.status(404).json({ error: 'לא נמצא משתמש. יש להשלים תחילה את השאלון.' });
    }

    // Call Meshulam API to tokenize
    const result = await createCardToken({
      cardNumber: cardNumber.replace(/\s/g, ''),
      expMonth,
      expYear,
      cvv,
      holderId,
      holderName: holderName || lead.name,
    });

    if (!result.success) {
      return res.status(400).json({ error: result.message || 'אימות הכרטיס נכשל, נסה כרטיס אחר' });
    }

    // Store token in DB
    run(
      `UPDATE leads SET card_token = ?, card_last_four = ?, status = 'card_verified' WHERE phone = ?`,
      [result.token, result.lastFour, cleanPhone]
    );

    console.log(`✅ Card tokenized for ${cleanPhone}: ${result.token} (****${result.lastFour})`);

    res.json({
      success: true,
      token: result.token,
      lastFour: result.lastFour,
      message: 'כרטיס אומת בהצלחה! הטוקן נשמר במערכת.',
    });
  } catch (err) {
    console.error('❌ /api/setup-payment error:', err);
    res.status(500).json({ error: err.message || 'שגיאה באימות הכרטיס, נסה שוב מאוחר יותר' });
  }
});

// ──────────────────────────────────────────────────────────────────
// API: Get all leads (admin)
// ──────────────────────────────────────────────────────────────────
app.get('/api/leads', (req, res) => {
  try {
    const leads = queryAll(`
      SELECT l.*,
             (SELECT COUNT(*) FROM documents d WHERE d.lead_id = l.id) AS document_count
      FROM leads l
      ORDER BY l.created_at DESC
    `);
    res.json({ success: true, leads });
  } catch (err) {
    console.error('❌ /api/leads error:', err);
    res.status(500).json({ error: 'שגיאה בשליפת הלידים' });
  }
});

// ──────────────────────────────────────────────────────────────────
// API: Get single lead with documents
// ──────────────────────────────────────────────────────────────────
app.get('/api/leads/:id', (req, res) => {
  try {
    const lead = queryOne('SELECT * FROM leads WHERE id = ?', [req.params.id]);
    if (!lead) {
      return res.status(404).json({ error: 'ליד לא נמצא' });
    }
    lead.answers = JSON.parse(lead.answers_json || '[]');
    lead.documents = queryAll('SELECT * FROM documents WHERE lead_id = ?', [lead.id]);
    res.json({ success: true, lead });
  } catch (err) {
    console.error('❌ /api/leads/:id error:', err);
    res.status(500).json({ error: 'שגיאה בשליפת הליד' });
  }
});

// ──────────────────────────────────────────────────────────────────
// Health check
// ──────────────────────────────────────────────────────────────────
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', dbReady, timestamp: new Date().toISOString() });
});

// ──────────────────────────────────────────────────────────────────
// Start server
// ──────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`
╔══════════════════════════════════════════════════╗
║         מיסה - Tax Refund Server                 ║
║──────────────────────────────────────────────────║
║  Running on : http://localhost:${String(PORT).padEnd(4)}               ║
║  Frontend  : http://localhost:${String(PORT).padEnd(4)}               ║
║  Database  : SQLite (sql.js)                     ║
║  Uploads   : server/uploads/                     ║
╚══════════════════════════════════════════════════╝
  `);
});
