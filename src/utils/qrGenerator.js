/**
 * QR Code Generator Utility
 * Generates a QR image file and records it in the qr_codes table.
 */
'use strict';

require('dotenv').config();
const QRCode = require('qrcode');
const path   = require('path');
const fs     = require('fs');
const { v4: uuidv4 } = require('uuid');
const db     = require('../config/database');

const QR_DIR = process.env.QR_PATH || './public/qrcodes';

/**
 * Generate and store a QR code for a reservation.
 * @param {number} reservationId
 * @param {string} bookingRef
 * @returns {object} { token, qrPath }
 */
async function generateReservationQR(reservationId, bookingRef) {
  if (!fs.existsSync(QR_DIR)) {
    fs.mkdirSync(QR_DIR, { recursive: true });
  }

  const token    = uuidv4();
  const filename = `qr-${bookingRef}-${token.slice(0, 8)}.png`;
  const filePath = path.join(QR_DIR, filename);
  const publicPath = `/qrcodes/${filename}`;

  // The QR encodes the check-in URL with the secure token
  const checkInUrl = `${process.env.APP_URL || 'http://localhost:3000'}/checkin/${token}`;

  await QRCode.toFile(filePath, checkInUrl, {
    errorCorrectionLevel: 'H',
    width: 300,
    margin: 2,
    color: { dark: '#1a1a2e', light: '#ffffff' },
  });

  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + 30); // valid for 30 days

  await db.prepare(`
    INSERT INTO qr_codes (reservation_id, token, qr_path, used, expires_at)
    VALUES (?, ?, ?, 0, ?)
  `).run(reservationId, token, publicPath, expiresAt.toISOString());

  return { token, qrPath: publicPath };
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
  if (qr.expires_at && new Date(qr.expires_at) < new Date()) {
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
 * Mark a QR code as used.
 */
async function consumeQRToken(token) {
  await db.prepare(`
    UPDATE qr_codes SET used = 1, used_at = NOW() WHERE token = ?
  `).run(token);
}

module.exports = { generateReservationQR, validateQRToken, consumeQRToken };
