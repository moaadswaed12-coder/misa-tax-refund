/**
 * Notification placeholder – will be swapped with real WhatsApp / SMS API later.
 */

function notifyNewLead(lead) {
  const msg = `
╔══════════════════════════════════════════╗
║          🔔 ליד חדש!                     ║
╠══════════════════════════════════════════╣
║  שם:        ${lead.name.padEnd(30)}  ║
║  טלפון:     ${lead.phone.padEnd(30)}  ║
║  החזר משוער: ₪${String(lead.refundEstimate).padEnd(26)}  ║
║  מועד:      ${new Date(lead.createdAt).toLocaleString('he-IL').padEnd(20)}  ║
╚══════════════════════════════════════════╝
  `;

  console.log('\n' + msg);

  /*
   * ─── Integration placeholder ─────────────────────────────────
   * 1. WhatsApp (using `whatsapp-web.js` or Twilio API):
   *    await sendWhatsApp({
   *      to: '+9725XXXXXXX',       // owner number
   *      body: `לקוח חדש: ${lead.name}, ${lead.phone}, ₪${lead.refundEstimate}`,
   *    });
   *
   * 2. SMS (Twilio / MessageBird):
   *    await sendSms({
   *      to: '+9725XXXXXXX',
   *      body: `ליד חדש: ${lead.name} - ${lead.phone} - ₪${lead.refundEstimate}`,
   *    });
   *
   * 3. Email (Nodemailer):
   *    await sendMail({
   *      to: 'owner@example.com',
   *      subject: '🔔 ליד חדש!',
   *      text: msg,
   *    });
   * ────────────────────────────────────────────────────────────
   */
}

module.exports = { notifyNewLead };
