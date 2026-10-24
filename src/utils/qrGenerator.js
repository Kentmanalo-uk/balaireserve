/**
 * QR Code Generator Utility
 * Records check-in QR tokens in the qr_codes table and renders the QR image
 * on demand, so the encoded check-in URL always uses the current public address.
 */
'use strict';

require('dotenv').config();
const os     = require('os');
const QRCode = require('qrcode');
const { v4: uuidv4 } = require('uuid');
const db     = require('../config/database');

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

// Prefer the usual home/office Wi-Fi ranges; skip link-local 169.254.x.x (unreachable).
const PRIVATE_RANGES = [/^192\.168\./, /^10\./, /^172\.(1[6-9]|2\d|3[01])\./];

function lanAddress() {
  const candidates = Object.values(os.networkInterfaces()).flat()
    .filter(addr => addr && addr.family === 'IPv4' && !addr.internal && !addr.address.startsWith('169.254.'))
    .map(addr => addr.address);
  return candidates.find(ip => PRIVATE_RANGES.some(re => re.test(ip))) || candidates[0] || null;
}

/**
 * Base URL that a phone scanning the QR can reach.
 * APP_URL wins unless it points at localhost (which a phone resolves to itself);
 * then the machine's LAN address is used so phones on the same Wi-Fi can connect.
 */
function publicBaseUrl() {
  const configured = (process.env.APP_URL || '').replace(/\/+$/, '');
  try {
    const url = new URL(configured || `http://localhost:${process.env.PORT || 3000}`);
    if (!LOCAL_HOSTS.has(url.hostname)) return url.origin;
    const lan = lanAddress();
    if (lan) {
      url.hostname = lan;
      return url.origin;
    }
    return url.origin;
  } catch {
    return configured || `http://localhost:${process.env.PORT || 3000}`;
  }
}

function checkInUrl(token) {
  return `${publicBaseUrl()}/checkin/${token}`;
}

/**
 * Generate and store a QR code for a reservation.
 * The token stays valid until the day after the stay/event ends.
 * @param {number} reservationId
 * @returns {object} { token, qrPath }
 */
async function generateReservationQR(reservationId) {
  const token    = uuidv4();
  const qrPath   = `/checkin/${token}/qr.png`;

  await db.prepare(`
    INSERT INTO qr_codes (reservation_id, token, qr_path, used, expires_at)
    SELECT r.id, ?, ?, 0,
           DATE_ADD(COALESCE(r.check_out_date, r.event_date, r.check_in_date, CURDATE()), INTERVAL 2 DAY)
    FROM reservations r WHERE r.id = ?
  `).run(token, qrPath, reservationId);

  return { token, qrPath };
}

/**
 * Render the QR image (PNG buffer) for a token.
 */
function renderQRPng(token) {
  return QRCode.toBuffer(checkInUrl(token), {
    errorCorrectionLevel: 'H',
    width: 300,
    margin: 2,
    color: { dark: '#1a1a2e', light: '#ffffff' },
  });
}

/**
 * Validate a QR token. Returns the reservation or null.
 */
async function validateQRToken(token) {
  const qr = await db.prepare(`
    SELECT qr.*, r.booking_ref, r.status, r.payment_status, r.customer_id
    FROM qr_codes qr
    JOIN reservations r ON r.id = qr.reservation_id
    WHERE qr.token = ?
  `).get(token);

  if (!qr)              return { valid: false, reason: 'QR code not found.' };
  if (qr.used)          return { valid: false, reason: 'This QR code has already been used or is no longer valid.' };
  // expires_at is stored in UTC ('YYYY-MM-DD HH:MM:SS').
  if (qr.expires_at && new Date(qr.expires_at.replace(' ', 'T') + 'Z') < new Date()) {
    return { valid: false, reason: 'This QR code has expired.' };
  }
  // A refunded or cancelled/rejected booking can never be checked in.
  if (qr.payment_status === 'refunded') {
    return { valid: false, reason: 'This booking has been refunded and cancelled. Check-in is not allowed.' };
  }
  if (!['confirmed', 'awaiting_payment'].includes(qr.status)) {
    return { valid: false, reason: `Reservation status is "${qr.status}". Cannot check in.` };
  }
  return { valid: true, qr };
}

/**
 * Mark a QR code as used. Returns false if it was already used.
 */
async function consumeQRToken(token) {
  const result = await db.prepare(`
    UPDATE qr_codes SET used = 1, used_at = NOW() WHERE token = ? AND used = 0
  `).run(token);
  return result.changes > 0;
}

module.exports = {
  generateReservationQR, renderQRPng, validateQRToken, consumeQRToken, publicBaseUrl, checkInUrl,
};
