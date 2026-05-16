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

  /*
   * ─── Integration placeholder ─────────────────────────────────
   *
   * 1. Inforu:
   *    const res = await fetch('https://api.inforu.co.il/api/v1/SMS', {
   *      method: 'POST',
   *      headers: { 'Content-Type': 'application/json' },
   *      body: JSON.stringify({
   *        username: process.env.INFORU_USER,
   *        password: process.env.INFORU_PASS,
   *        recipients: [{ phone: phone.replace('+', '') }],
   *        message: text,
   *      }),
   *    });
   *
   * 2. Twilio:
   *    const client = require('twilio')(TWILIO_SID, TWILIO_TOKEN);
   *    await client.messages.create({ body: text, from: TWILIO_NUMBER, to: phone });
   *
   * 3. SMS019:
   *    const res = await fetch(`https://api.sms019.co.il/SendSMS`, { ... });
   *
   * ─────────────────────────────────────────────────────────────
   */

  return { success: true, phone, text, timestamp };
}

function truncate(str, max) {
  return str.length > max ? str.slice(0, max - 1) + '…' : str;
}

module.exports = { sendSMS };
