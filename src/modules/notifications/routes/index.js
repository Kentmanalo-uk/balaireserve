/**
 * Notifications Routes
 */
'use strict';

const express = require('express');
const db      = require('../../../config/database');
const { requireAuth } = require('../../../middleware/auth');

const router = express.Router();

// GET /notifications
router.get('/', requireAuth, async (req, res) => {
  const { page = 1 } = req.query;
  const limit  = 20;
  const offset = (parseInt(page) - 1) * limit;

  const total = (await db.prepare(`SELECT COUNT(*) AS cnt FROM notifications WHERE user_id=?`).get(req.session.user.id)).cnt;
  const notifications = await db.prepare(`
    SELECT * FROM notifications WHERE user_id=? ORDER BY created_at DESC LIMIT ? OFFSET ?
  `).all(req.session.user.id, limit, offset);

  // Mark all as read
  await db.prepare(`UPDATE notifications SET is_read=1 WHERE user_id=?`).run(req.session.user.id);

  res.render('notifications/index', {
    title: 'Notifications – Balai-Reserve',
    layout: 'layouts/main',
    notifications,
    filters: {},
    pagination: { total, page: parseInt(page), limit, totalPages: Math.ceil(total / limit) },
  });
});

// GET /notifications/feed — JSON endpoint for real-time polling
// Returns unread count + most recent notifications for the logged-in user.
router.get('/feed', requireAuth, async (req, res) => {
  try {
    const uid = req.session.user.id;
    const unread = (await db.prepare(
      `SELECT COUNT(*) AS c FROM notifications WHERE user_id=? AND is_read=0`
    ).get(uid)).c;

    const items = await db.prepare(`
      SELECT id, type, title, message, link, is_read, created_at
      FROM notifications
      WHERE user_id=?
      ORDER BY created_at DESC
      LIMIT 10
    `).all(uid);

    res.json({ success: true, unread, items });
  } catch (err) {
    res.json({ success: false, unread: 0, items: [] });
  }
});

// POST /notifications/read-all — mark every notification read (from the bell)
router.post('/read-all', requireAuth, async (req, res) => {
  await db.prepare(`UPDATE notifications SET is_read=1 WHERE user_id=?`).run(req.session.user.id);
  res.json({ success: true });
});

// POST /notifications/:id/read
router.post('/:id/read', requireAuth, async (req, res) => {
  await db.prepare(`UPDATE notifications SET is_read=1 WHERE id=? AND user_id=?`).run(req.params.id, req.session.user.id);
  res.json({ success: true });
});

// DELETE /notifications/clear
router.post('/clear', requireAuth, async (req, res) => {
  await db.prepare(`DELETE FROM notifications WHERE user_id=? AND is_read=1`).run(req.session.user.id);
  req.session.flash = { success: 'Read notifications cleared.' };
  res.redirect('/notifications');
});

module.exports = router;