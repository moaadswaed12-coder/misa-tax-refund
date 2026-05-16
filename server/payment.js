/**
 * Meshulam Payment Gateway Integration
 *
 * Environment variables:
 *   MESHULAM_API_KEY   – API key from Meshulam dashboard
 *   MESHULAM_TERMINAL  – Terminal ID
 *   MESHULAM_SANDBOX   – Set "true" to use sandbox environment
 *
 * Sandbox docs: https://meshulam.co.il/api-docs
 */

const https = require('https');

const SANDBOX_URL = 'sandbox.meshulam.co.il';
const PRODUCTION_URL = 'api.meshulam.co.il';

function getBaseUrl() {
  const host = process.env.MESHULAM_SANDBOX === 'true' ? SANDBOX_URL : PRODUCTION_URL;
  return `https://${host}/api/v1`;
}

function getApiKey() {
  return process.env.MESHULAM_API_KEY || '';
}

function getTerminal() {
  return process.env.MESHULAM_TERMINAL || '';
}

/**
 * Call Meshulam API to tokenize a card.
 *
 * In production this sends card data directly to Meshulam's server
 * and returns a secure token. The backend never stores raw card numbers.
 *
 * @param {Object} cardData
 * @param {string} cardData.cardNumber
 * @param {string} cardData.expMonth
 * @param {string} cardData.expYear
 * @param {string} cardData.cvv
 * @param {string} cardData.holderId – Israeli ID (ת.ז.)
 * @param {string} cardData.holderName
 * @returns {Promise<{success: boolean, token: string, lastFour: string, message: string}>}
 */
function createCardToken(cardData) {
  const apiKey = getApiKey();
  const terminal = getTerminal();

  // ── Sandbox / No-API-key mode ─────────────────────────────────
  // If no real API key is configured, simulate success.
  // This lets development proceed without a real merchant account.
  if (!apiKey || apiKey === 'your_api_key_here') {
    console.log('⚠️  Meshulam API key not set. Simulating tokenization...');
    return new Promise((resolve) => {
      const lastFour = cardData.cardNumber.slice(-4);
      const token = 'tok_sim_' + Date.now() + '_' + lastFour;
      setTimeout(() => {
        resolve({
          success: true,
          token,
          lastFour,
          message: 'Token created (simulated – set MESHULAM_API_KEY for live)',
        });
      }, 1200);
    });
  }

  // ── Live Meshulam API call ──────────────────────────────────
  const payload = JSON.stringify({
    apiKey,
    terminalId: terminal,
    action: 'tokenize',
    cardNumber: cardData.cardNumber.replace(/\s/g, ''),
    expMonth: cardData.expMonth.padStart(2, '0'),
    expYear: cardData.expYear.length === 2 ? '20' + cardData.expYear : cardData.expYear,
    cvv: cardData.cvv,
    holderId: cardData.holderId.replace(/[^0-9]/g, ''),
    holderName: cardData.holderName,
    // ₪0 auth – validates card without charging
    amount: 0,
    currency: 'ILS',
    description: 'אימות כרטיס - מיסה החזרי מס',
    jSuccess: 'https://misa.co.il/payment/success',
    jFailure: 'https://misa.co.il/payment/failure',
  });

  const url = new URL(getBaseUrl() + '/transaction/tokenize');

  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname: url.hostname,
        path: url.pathname,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload),
          'x-api-key': apiKey,
        },
      },
      (res) => {
        let body = '';
        res.on('data', (chunk) => (body += chunk));
        res.on('end', () => {
          try {
            const data = JSON.parse(body);
            if (data.success || data.status === 'success') {
              resolve({
                success: true,
                token: data.token || data.cardToken,
                lastFour: data.lastFour || cardData.cardNumber.slice(-4),
                message: 'כרטיס אומת בהצלחה',
              });
            } else {
              resolve({
                success: false,
                token: null,
                lastFour: null,
                message: data.error || data.message || 'שגיאה באימות הכרטיס',
              });
            }
          } catch {
            reject(new Error('תשובה לא צפויה ממערכת הסליקה'));
          }
        });
      }
    );

    req.on('error', (err) => reject(new Error('שגיאת תקשורת עם מערכת הסליקה: ' + err.message)));
    req.write(payload);
    req.end();
  });
}

module.exports = { createCardToken };
