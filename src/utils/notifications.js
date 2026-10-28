/**
 * Notification Utility
 * Creates in-app notifications stored in the database, and emails each one to the recipient
 * (src/utils/mailer.js — in the background, so a slow or failed email never holds up a page).
 */
'use strict';

const db = require('../config/database');
const { mailNotification } = require('./mailer');

// Email the same notification to a users.id / customers.id (active accounts with an address only).
async function emailUser(userId, title, message, link) {
  const u = await db.prepare('SELECT email, first_name FROM users WHERE id = ? AND is_active = 1').get(userId);
  if (u && u.email) mailNotification({ to: u.email, name: u.first_name, title, message, link });
}
async function emailCustomer(customerId, title, message, link) {
  const c = await db.prepare('SELECT email, first_name FROM customers WHERE id = ?').get(customerId);
  if (c && c.email) mailNotification({ to: c.email, name: c.first_name, title, message, link });
}

/**
 * Create a notification for a staff user.
 */
async function notifyStaff(userId, type, title, message, link = null) {
  try {
    await db.prepare(`
      INSERT INTO notifications (user_id, type, title, message, link)
      VALUES (?, ?, ?, ?, ?)
    `).run(userId, type, title, message, link);
    await emailUser(userId, title, message, link);
  } catch { /* non-critical */ }
}

/**
 * Create a notification for a customer.
 */
async function notifyCustomer(customerId, type, title, message, link = null) {
  try {
    await db.prepare(`
      INSERT INTO notifications (customer_id, type, title, message, link)
      VALUES (?, ?, ?, ?, ?)
    `).run(customerId, type, title, message, link);
    await emailCustomer(customerId, title, message, link);
  } catch { /* non-critical */ }
}

/**
 * Create an in-app notification for any user by their users.id.
 * Works for both staff and customers (customers have a linked users row).
 * This is the notification that shows up in the recipient's bell.
 */
async function notifyUser(userId, type, title, message, link = null) {
  if (!userId) return;
  try {
    await db.prepare(`
      INSERT INTO notifications (user_id, type, title, message, link)
      VALUES (?, ?, ?, ?, ?)
    `).run(userId, type, title, message, link);
    await emailUser(userId, title, message, link);
  } catch { /* non-critical */ }
}

/**
 * Notify the customer that owns a reservation (resolves customer → user_id).
 * A walk-in guest without an account gets the email only (if staff recorded an address).
 */
async function notifyReservationCustomer(reservationId, type, title, message, link = null) {
  try {
    const row = await db.prepare(`
      SELECT c.id AS customer_id, c.user_id AS user_id
      FROM reservations r
      JOIN customers c ON c.id = r.customer_id
      WHERE r.id = ?
    `).get(reservationId);
    if (row && row.user_id) {
      await notifyUser(row.user_id, type, title, message, link);
    } else if (row) {
      // No account to sign in to, so no portal link in the email.
      await emailCustomer(row.customer_id, title, message, null);
    }
  } catch { /* non-critical */ }
}

/**
 * Notify all admins.
 */
async function notifyAllAdmins(type, title, message, link = null) {
  try {
    const admins = await db.prepare(`
      SELECT u.id FROM users u
      JOIN roles r ON r.id = u.role_id
      WHERE r.name = 'admin' AND u.is_active = 1
    `).all();
    const stmt = db.prepare(`
      INSERT INTO notifications (user_id, type, title, message, link)
      VALUES (?, ?, ?, ?, ?)
    `);
    for (const a of admins) {
      await stmt.run(a.id, type, title, message, link);
      await emailUser(a.id, title, message, link);
    }
  } catch { /* non-critical */ }
}

/**
 * Get unread notification count for a user.
 */
async function getUnreadCount(userId) {
  try {
    const row = await db.prepare(`
      SELECT COUNT(*) AS cnt FROM notifications WHERE user_id = ? AND is_read = 0
    `).get(userId);
    return row?.cnt || 0;
  } catch { return 0; }
}

/**
 * Get recent notifications for a user.
 */
async function getRecentNotifications(userId, limit = 10) {
  try {
    return await db.prepare(`
      SELECT * FROM notifications
      WHERE user_id = ?
      ORDER BY created_at DESC
      LIMIT ?
    `).all(userId, limit);
  } catch { return []; }
}

module.exports = {
  notifyStaff,
  notifyCustomer,
  notifyUser,
  notifyReservationCustomer,
  notifyAllAdmins,
  getUnreadCount,
  getRecentNotifications,
};
