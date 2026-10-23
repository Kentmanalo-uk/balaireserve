/**
 * Notification Utility
 * Creates in-app notifications stored in the database.
 */
'use strict';

const db = require('../config/database');

/**
 * Create a notification for a staff user.
 */
async function notifyStaff(userId, type, title, message, link = null) {
  try {
    await db.prepare(`
      INSERT INTO notifications (user_id, type, title, message, link)
      VALUES (?, ?, ?, ?, ?)
    `).run(userId, type, title, message, link);
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
  } catch { /* non-critical */ }
}

/**
 * Notify the customer that owns a reservation (resolves customer ΓåÆ user_id).
 * Safe no-op if the customer has no linked user account.
 */
async function notifyReservationCustomer(reservationId, type, title, message, link = null) {
  try {
    const row = await db.prepare(`
      SELECT c.user_id AS user_id
      FROM reservations r
      JOIN customers c ON c.id = r.customer_id
      WHERE r.id = ?
    `).get(reservationId);
    if (row && row.user_id) {
      await notifyUser(row.user_id, type, title, message, link);
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
    for (const a of admins) await stmt.run(a.id, type, title, message, link);
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
