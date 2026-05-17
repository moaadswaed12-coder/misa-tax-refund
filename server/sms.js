/**
 * SMS Service – Mock implementation
 *
 * In production, swap the body of sendSMS() with an API call to:
 *   - Inforu   : https://api.inforu.co.il
 *   - SMS019   : https://api.sms019.co.il
 *   - Twilio   : https://api.twilio.com
 *
 * Usage:
 *   const { sendSMS } = require('./sms');
 *   await sendSMS('+972501234567', 'היי משה, הכסף בדרך!');
 */

function sendSMS(phone, text) {
  const timestamp = new Date().toLocaleString('he-IL', { timeZone: 'Asia/Jerusalem' });
  const logLine = `
╔══════════════════════════════════════════════╗
║  📨 SMS נשלח                                 ║
╠══════════════════════════════════════════════╣
║  To:    ${String(phone).padEnd(37)}║
║  Time:  ${String(timestamp).padEnd(37)}║
║  Text:  ${truncate(text, 35).padEnd(37)}║
╚══════════════════════════════════════════════╝
  `;
  console.log(logLine);

  return { success: true, phone, text, timestamp, formattedFor: phone };
}

// ──────────────────────────────────────────────────────────────────
// Template helpers
// ──────────────────────────────────────────────────────────────────

/**
 * 1. Automatic Welcome SMS – sent right after card verification
 */
function sendWelcomeSMS(phone, name) {
  const text = `היי ${name}, התיק שלך התקבל בהצלחה באפליקציה! מערכת ה-AI שלנו בודקת את המסמכים. תהליך הטיפול מול רשות המיסים לוקח בדרך כלל בין 30 ל-90 יום. נעדכן אותך ברגע שהכסף בדרך לבנק!`;
  return sendSMS(phone, text);
}

/**
 * 2. Step 1 Admin SMS – "שלח SMS בשורה משמחת"
 *    Triggered when Admin clicks Approve on the dashboard
 */
function sendApprovedSMS(phone, name, refundAmount) {
  const formatted = refundAmount ? `₪${Number(refundAmount).toLocaleString()}` : 'החזר מס';
  const text = `היי ${name}, בשורות מעולות! רשות המיסים אישרה את החזר המס שלך. הכסף צפוי להיכנס לחשבון הבנק שלך במהלך ה-3 ימים הקרובים. מיד לאחר מכן, המערכת תבצע גבייה אוטומטית של עמלת ההצלחה (12%). תודה רבה!`;
  return sendSMS(phone, text);
}

/**
 * 3. Step 2 Admin SMS – "בצע גבייה ושלח SMS סופי"
 *    Triggered when Admin clicks Charge on the dashboard
 */
function sendChargedSMS(phone, name, refundAmount, feeAmount) {
  const refundFormatted = refundAmount ? `₪${Number(refundAmount).toLocaleString()}` : 'החזר מס';
  const feeFormatted = feeAmount ? `₪${Number(feeAmount).toLocaleString()}` : 'עמלה';
  const text = `בשורה משמחת! רשות המיסים אישרה את ההחזר שלך והכסף הועבר לחשבונך. בהתאם לתקנון, בוצע חיוב של 12% עמלת הצלחה דרך כרטיסך. תודה שבחרת בנו!`;
  return sendSMS(phone, text);
}

/**
 * 4. Rejection SMS – sent when the user is not eligible
 */
function sendRejectedSMS(phone, name) {
  const text = `היי ${name}, בדקנו את הטפסים ולצערנו השנה לא הגעת לסף המס שמזכה בהחזר. לא חויבת בשקל! נתראה בשנה הבאה.`;
  return sendSMS(phone, text);
}

function truncate(str, max) {
  return str.length > max ? str.slice(0, max - 1) + '…' : str;
}

module.exports = { sendSMS, sendWelcomeSMS, sendApprovedSMS, sendChargedSMS, sendRejectedSMS };
