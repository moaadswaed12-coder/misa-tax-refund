require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const { getDb, queryAll, queryOne, run } = require('./db');
const { calculateRefund } = require('./tax-calc');
const { upload } = require('./upload');
const { notifyNewLead } = require('./notify');
const { createCardToken, chargeCard } = require('./payment');
const { sendWelcomeSMS, sendApprovedSMS, sendChargedSMS, sendRejectedSMS } = require('./sms');

const app = express();
const PORT = process.env.PORT || 3001;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD && process.env.ADMIN_PASSWORD.trim() !== '' ? process.env.ADMIN_PASSWORD.trim() : 'MisaAdmin2026!';

// ──────────────────────────────────────────────────────────────────
// Middleware
// ──────────────────────────────────────────────────────────────────
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

app.use('/uploads', express.static(path.join(__dirname, 'uploads')));
app.use(express.static(path.join(__dirname, '..')));

// ──────────────────────────────────────────────────────────────────
// Bootstrap DB
// ──────────────────────────────────────────────────────────────────
let dbReady = false;
getDb().then(() => { dbReady = true; });

function requireDb(req, res, next) {
  if (!dbReady) return res.status(503).json({ error: 'מסד הנתונים באתחול, נסה שוב בעוד שנייה' });
  next();
}
app.use(requireDb);

// ──────────────────────────────────────────────────────────────────
// Admin Auth Middleware
// ──────────────────────────────────────────────────────────────────
function requireAdmin(req, res, next) {
  const secret = req.query.secret || (req.headers.authorization || '').replace('Bearer ', '');
  if (secret !== ADMIN_PASSWORD) {
    if (req.accepts('html')) {
      return res.status(401).send('<html dir="rtl"><body style="font-family:sans-serif;background:#0f172a;color:#e2e8f0;display:flex;justify-content:center;align-items:center;height:100vh;"><div style="text-align:center;"><h1>🔒 נדרשת הזדהות</h1><p style="color:#94a3b8;">הוסף <code>?secret=YOUR_PASSWORD</code> לכתובת</p></div></body></html>');
    }
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
}

// ──────────────────────────────────────────────────────────────────
// API: Submit Lead
// ──────────────────────────────────────────────────────────────────
app.post('/api/submit-lead', (req, res) => {
  try {
    const { name, phone, answers } = req.body;
    if (!name || name.trim().length < 2) return res.status(400).json({ error: 'נא להזין שם מלא' });
    const cleanPhone = (phone || '').replace(/[^0-9]/g, '');
    if (cleanPhone.length < 9) return res.status(400).json({ error: 'נא להזין מספר טלפון תקין' });

    const { refund, breakdown } = calculateRefund(answers || []);

    const existing = queryOne('SELECT id FROM leads WHERE phone = ?', [cleanPhone]);
    if (existing) {
      run(`UPDATE leads SET name = ?, refund_estimate = ?, answers_json = ?, status = 'updated' WHERE phone = ?`,
        [name.trim(), refund, JSON.stringify(answers || []), cleanPhone]);
    } else {
      run(`INSERT INTO leads (name, phone, refund_estimate, answers_json) VALUES (?, ?, ?, ?)`,
        [name.trim(), cleanPhone, refund, JSON.stringify(answers || [])]);
    }

    notifyNewLead({ name: name.trim(), phone: cleanPhone, refundEstimate: refund, createdAt: new Date().toISOString() });

    res.json({ success: true, refund, breakdown, message: `ההחזר המשוער שלך הוא ₪${refund.toLocaleString('he-IL')}` });
  } catch (err) {
    console.error('❌ /api/submit-lead error:', err);
    res.status(500).json({ error: 'שגיאת שרת פנימית. נסה שוב מאוחר יותר.' });
  }
});

// ──────────────────────────────────────────────────────────────────
// API: Upload documents (Form 106 + ID photo)
// ──────────────────────────────────────────────────────────────────
app.post('/api/upload-106', upload.fields([
  { name: 'documents', maxCount: 10 },
  { name: 'id_photo', maxCount: 1 },
]), (req, res) => {
  try {
    const { phone } = req.body;
    const cleanPhone = (phone || '').replace(/[^0-9]/g, '');
    if (!cleanPhone || cleanPhone.length < 9) return res.status(400).json({ error: 'נא לספק מספר טלפון תקין' });

    const lead = queryOne('SELECT id FROM leads WHERE phone = ?', [cleanPhone]);
    if (!lead) return res.status(404).json({ error: 'לא נמצא משתמש. יש להשלים תחילה את השאלון.' });

    const uploaded = [];

    // Form 106 documents
    const docs106 = req.files?.documents || [];
    for (const file of docs106) {
      run(`INSERT INTO documents (lead_id, filename, original_name, file_path, mime_type, file_size, doc_type) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [lead.id, file.filename, file.originalname, file.path, file.mimetype, file.size, '106']);
      uploaded.push({ filename: file.filename, originalName: file.originalname, type: '106', url: `/uploads/${cleanPhone}/${file.filename}` });
    }

    // ID photo
    const idPhotos = req.files?.id_photo || [];
    for (const file of idPhotos) {
      run(`INSERT INTO documents (lead_id, filename, original_name, file_path, mime_type, file_size, doc_type) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [lead.id, file.filename, file.originalname, file.path, file.mimetype, file.size, 'id_photo']);
      run(`UPDATE leads SET id_photo_path = ?, id_photo_verified = 1 WHERE id = ?`,
        [file.path, lead.id]);
      uploaded.push({ filename: file.filename, originalName: file.originalname, type: 'id_photo', url: `/uploads/${cleanPhone}/${file.filename}` });
    }

    if (uploaded.length === 0) return res.status(400).json({ error: 'לא התקבלו קבצים להעלאה' });

    run(`UPDATE leads SET status = 'documents_uploaded' WHERE id = ?`, [lead.id]);
    res.json({ success: true, uploaded, count: uploaded.length, message: `${uploaded.length} מסמכים הועלו בהצלחה` });
  } catch (err) {
    if (err.code === 'LIMIT_FILE_SIZE') return res.status(400).json({ error: 'גודל הקובץ חורג מהמותר (15MB מקסימום לקובץ)' });
    if (err.message && err.message.includes('סוג קובץ לא נתמך')) return res.status(400).json({ error: err.message });
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
    if (!cleanPhone || cleanPhone.length < 9) return res.status(400).json({ error: 'נא לספק מספר טלפון תקין' });
    if (!cardNumber || cardNumber.replace(/\s/g, '').length < 13) return res.status(400).json({ error: 'נא להזין מספר כרטיס תקין' });
    if (!expMonth || !expYear) return res.status(400).json({ error: 'נא להזין תוקף כרטיס' });
    if (!cvv || cvv.length < 3) return res.status(400).json({ error: 'נא להזין קוד אבטחה (CVV)' });
    if (!holderId || holderId.replace(/[^0-9]/g, '').length < 8) return res.status(400).json({ error: 'נא להזין תעודת זהות תקינה' });

    const lead = queryOne('SELECT id, name, status FROM leads WHERE phone = ?', [cleanPhone]);
    if (!lead) return res.status(404).json({ error: 'לא נמצא משתמש. יש להשלים תחילה את השאלון.' });

    const result = await createCardToken({
      cardNumber: cardNumber.replace(/\s/g, ''), expMonth, expYear, cvv, holderId,
      holderName: holderName || lead.name,
    });

    if (!result.success) return res.status(400).json({ error: result.message || 'אימות הכרטיס נכשל, נסה כרטיס אחר' });

    run(`UPDATE leads SET card_token = ?, card_last_four = ?, status = 'card_verified' WHERE phone = ?`,
      [result.token, result.lastFour, cleanPhone]);
    console.log(`✅ Card tokenized for ${cleanPhone}: ${result.token} (****${result.lastFour})`);

    // Auto welcome SMS – only sent after card verification (cost-protected)
    sendWelcomeSMS(cleanPhone, lead.name);

    res.json({ success: true, token: result.token, lastFour: result.lastFour, message: 'כרטיס אומת בהצלחה! הטוקן נשמר במערכת.' });
  } catch (err) {
    console.error('❌ /api/setup-payment error:', err);
    res.status(500).json({ error: err.message || 'שגיאה באימות הכרטיס, נסה שוב מאוחר יותר' });
  }
});

// ──────────────────────────────────────────────────────────────────
// ADMIN: Serve dashboard
// ──────────────────────────────────────────────────────────────────
app.get('/admin/dashboard', requireAdmin, (req, res) => {
  res.sendFile(path.join(__dirname, 'admin.html'));
});

// ──────────────────────────────────────────────────────────────────
// ADMIN: List all leads
// ──────────────────────────────────────────────────────────────────
app.get('/api/admin/leads', requireAdmin, (req, res) => {
  try {
    const leads = queryAll(`
      SELECT l.*,
             (SELECT COUNT(*) FROM documents d WHERE d.lead_id = l.id) AS document_count
      FROM leads l
      ORDER BY l.created_at DESC
    `);
    res.json({ success: true, leads });
  } catch (err) {
    console.error('❌ /api/admin/leads error:', err);
    res.status(500).json({ error: 'שגיאה בשליפת הלידים' });
  }
});

// ──────────────────────────────────────────────────────────────────
// ADMIN: Get single lead with documents
// ──────────────────────────────────────────────────────────────────
app.get('/api/admin/leads/:id', requireAdmin, (req, res) => {
  try {
    const lead = queryOne('SELECT * FROM leads WHERE id = ?', [req.params.id]);
    if (!lead) return res.status(404).json({ error: 'ליד לא נמצא' });
    lead.answers = JSON.parse(lead.answers_json || '[]');
    lead.documents = queryAll('SELECT * FROM documents WHERE lead_id = ?', [lead.id]);
    res.json({ success: true, lead });
  } catch (err) {
    console.error('❌ /api/admin/leads/:id error:', err);
    res.status(500).json({ error: 'שגיאה בשליפת הליד' });
  }
});

// ──────────────────────────────────────────────────────────────────
// ADMIN: Get documents download list
// ──────────────────────────────────────────────────────────────────
app.get('/api/admin/leads/:id/documents', requireAdmin, (req, res) => {
  try {
    const lead = queryOne('SELECT id, name, phone FROM leads WHERE id = ?', [req.params.id]);
    if (!lead) return res.status(404).json({ error: 'ליד לא נמצא' });

    const docs = queryAll('SELECT * FROM documents WHERE lead_id = ?', [lead.id]);
    const html = docs.map(d =>
      `<li><a href="/uploads/${lead.phone}/${d.filename}" download>${d.original_name}</a> (${(d.file_size / 1024).toFixed(1)} KB)</li>`
    ).join('') || '<li>אין מסמכים</li>';

    res.send(`<html dir="rtl"><head><meta charset="utf-8"><title>מסמכים - ${lead.name}</title>
    <style>body{font-family:sans-serif;background:#0f172a;color:#e2e8f0;padding:20px;}
    a{color:#3b82f6;} li{margin:8px 0;}</style></head>
    <body><h2>📎 מסמכים: ${lead.name} (${lead.phone})</h2><ul>${html}</ul></body></html>`);
  } catch (err) {
    console.error('❌ /api/admin/leads/:id/documents error:', err);
    res.status(500).json({ error: 'שגיאה' });
  }
});

// ──────────────────────────────────────────────────────────────────
// ADMIN: Approve refund – send SMS "money is coming"
// ──────────────────────────────────────────────────────────────────
app.post('/api/admin/leads/:id/approve', requireAdmin, async (req, res) => {
  try {
    const lead = queryOne('SELECT * FROM leads WHERE id = ?', [req.params.id]);
    if (!lead) return res.status(404).json({ error: 'ליד לא נמצא' });
    if (lead.status === 'completed_paid') return res.status(400).json({ error: 'הליד כבר הושלם' });

    // Send Step 1 SMS: "שלח SMS בשורה משמחת"
    sendApprovedSMS(lead.phone, lead.name, lead.refund_estimate);

    // Update status
    run(`UPDATE leads SET status = 'approved_waiting_delay', approved_at = datetime('now', '+2 hours') WHERE id = ?`, [lead.id]);

    res.json({ success: true, message: `✅ SMS נשלח ל-${lead.name}` });
  } catch (err) {
    console.error('❌ /api/admin/leads/:id/approve error:', err);
    res.status(500).json({ error: 'שגיאה בשליחת האישור' });
  }
});

// ──────────────────────────────────────────────────────────────────
// ADMIN: Charge 12% fee + send final SMS
// ──────────────────────────────────────────────────────────────────
app.post('/api/admin/leads/:id/charge', requireAdmin, async (req, res) => {
  try {
    const lead = queryOne('SELECT * FROM leads WHERE id = ?', [req.params.id]);
    if (!lead) return res.status(404).json({ error: 'ליד לא נמצא' });
    if (lead.status === 'completed_paid') return res.status(400).json({ error: 'הליד כבר שולם' });
    if (lead.status !== 'approved_waiting_delay') return res.status(400).json({ error: 'יש לאשר החזר קודם לפני גביה' });
    if (!lead.card_token) return res.status(400).json({ error: 'אין כרטיס אשראי שמור לליד זה' });

    const refundAmount = lead.refund_estimate || 0;
    const feeAgurot = Math.round(refundAmount * 0.12 * 100); // 12% in agurot
    const feeShekels = refundAmount * 0.12;

    // Charge via Meshulam
    const chargeResult = await chargeCard(lead.card_token, feeAgurot, `מיסה - עמלת 12% על החזר מס ₪${refundAmount}`);

    if (!chargeResult.success) {
      return res.status(402).json({ error: '⚠️ החיוב נכשל: ' + (chargeResult.message || 'נסה שוב או בדוק את פרטי הכרטיס') });
    }

    // Send Step 2 SMS: "בצע גבייה ושלח SMS סופי"
    sendChargedSMS(lead.phone, lead.name, lead.refund_estimate, feeShekels);

    // Update status
    run(`UPDATE leads SET status = 'completed_paid', charged_amount = ?, charged_at = datetime('now', '+2 hours') WHERE id = ?`,
      [feeAgurot / 100, lead.id]);

    res.json({
      success: true,
      message: `✅ נגבה ₪${(feeAgurot / 100).toFixed(2)} מ-${lead.name}. SMS סופי נשלח.`,
      transactionId: chargeResult.transactionId,
      chargedAmount: feeAgurot / 100,
    });
  } catch (err) {
    console.error('❌ /api/admin/leads/:id/charge error:', err);
    res.status(500).json({ error: err.message || 'שגיאה בגביית העמלה' });
  }
});

// ──────────────────────────────────────────────────────────────────
// Old public lead list (kept for backward compat)
// ──────────────────────────────────────────────────────────────────
app.get('/api/leads', requireAdmin, (req, res) => {
  const leads = queryAll('SELECT l.*, (SELECT COUNT(*) FROM documents d WHERE d.lead_id = l.id) AS document_count FROM leads l ORDER BY l.created_at DESC');
  res.json({ success: true, leads });
});

app.get('/api/leads/:id', requireAdmin, (req, res) => {
  const lead = queryOne('SELECT * FROM leads WHERE id = ?', [req.params.id]);
  if (!lead) return res.status(404).json({ error: 'ליד לא נמצא' });
  lead.answers = JSON.parse(lead.answers_json || '[]');
  lead.documents = queryAll('SELECT * FROM documents WHERE lead_id = ?', [lead.id]);
  res.json({ success: true, lead });
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
║  Admin     : http://localhost:${String(PORT).padEnd(4)}/admin/dashboard ║
║  Database  : SQLite (sql.js)                     ║
║  Uploads   : server/uploads/                     ║
╚══════════════════════════════════════════════════╝
  `);
});
