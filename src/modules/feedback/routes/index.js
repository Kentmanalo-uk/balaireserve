/**
 * Feedback & Ratings Management  (/feedback)
 * Staff/admin can list, filter, view, and respond to customer feedback.
 */
'use strict';

const express = require('express');
const { body, validationResult } = require('express-validator');
const db      = require('../../../config/database');
const { requireAuth, requireRole } = require('../../../middleware/auth');

const router = express.Router();
const CAN_RESPOND = ['admin', 'staff'];

// GET /feedback
router.get('/', requireAuth, requireRole(...CAN_RESPOND), async (req, res) => {
  const { rating = '', category = '', page = 1 } = req.query;
  const limit  = 20;
  const offset = (parseInt(page) - 1) * limit;
  let   where  = 'WHERE 1=1';
  const params = [];

  if (rating)   { where += ` AND f.rating = ?`;    params.push(parseInt(rating)); }
  if (category) { where += ` AND f.category = ?`;  params.push(category); }

  const total = (await db.prepare(`
    SELECT COUNT(*) AS cnt FROM feedback f ${where}
  `).get(...params)).cnt;

  const feedbackList = await db.prepare(`
    SELECT f.*,
           c.first_name || ' ' || c.last_name AS customer_name,
           r.booking_ref,
           r.reservation_type,
           u.first_name || ' ' || u.last_name AS responded_by_name
    FROM feedback f
    JOIN customers c   ON c.id = f.customer_id
    JOIN reservations r ON r.id = f.reservation_id
    LEFT JOIN users u  ON u.id = f.responded_by
    ${where}
    ORDER BY f.created_at DESC
    LIMIT ? OFFSET ?
  `).all(...params, limit, offset);

  // Summary stats
  const summary = await db.prepare(`
    SELECT
      COUNT(*)                            AS total,
      ROUND(AVG(rating), 1)              AS avg_rating,
      SUM(CASE WHEN rating = 5 THEN 1 ELSE 0 END) AS five_star,
      SUM(CASE WHEN rating = 4 THEN 1 ELSE 0 END) AS four_star,
      SUM(CASE WHEN rating = 3 THEN 1 ELSE 0 END) AS three_star,
      SUM(CASE WHEN rating = 2 THEN 1 ELSE 0 END) AS two_star,
      SUM(CASE WHEN rating = 1 THEN 1 ELSE 0 END) AS one_star
    FROM feedback
  `).get();

  const categories = ['overall', 'room', 'venue', 'service', 'event'];

  res.render('feedback/index', {
    title:  'Customer Feedback',
    layout: 'layouts/main',
    feedbackList, summary, categories,
    filters: { rating, category },
    pagination: { total, page: parseInt(page), limit, totalPages: Math.ceil(total / limit) },
  });
});

// GET /feedback/:id
router.get('/:id', requireAuth, requireRole(...CAN_RESPOND), async (req, res) => {
  const fb = await db.prepare(`
    SELECT f.*,
           c.first_name || ' ' || c.last_name AS customer_name,
           c.email AS customer_email, c.id AS cust_id,
           r.booking_ref, r.reservation_type, r.check_in_date, r.event_date,
           u.first_name || ' ' || u.last_name AS responded_by_name
    FROM feedback f
    JOIN customers c    ON c.id = f.customer_id
    JOIN reservations r ON r.id = f.reservation_id
    LEFT JOIN users u   ON u.id = f.responded_by
    WHERE f.id = ?
  `).get(req.params.id);

  if (!fb) {
    req.session.flash = { error: 'Feedback not found.' };
    return res.redirect('/feedback');
  }

  // Other feedback from same customer
  const otherFeedback = await db.prepare(`
    SELECT f.*, r.booking_ref
    FROM feedback f JOIN reservations r ON r.id = f.reservation_id
    WHERE f.customer_id = ? AND f.id != ?
    ORDER BY f.created_at DESC LIMIT 5
  `).all(fb.cust_id, fb.id);

  res.render('feedback/show', {
    title:  `Feedback from ${fb.customer_name}`,
    layout: 'layouts/main',
    fb, otherFeedback,
    errors: [],
  });
});

// POST /feedback/:id/respond
router.post('/:id/respond',
  requireAuth, requireRole(...CAN_RESPOND),
  [
    body('admin_response').trim().notEmpty().withMessage('Response text is required.'),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      req.session.flash = { error: errors.array()[0].msg };
      return res.redirect(`/feedback/${req.params.id}`);
    }

    await db.prepare(`
      UPDATE feedback
      SET admin_response = ?,
          responded_by   = ?,
          responded_at   = NOW()
      WHERE id = ?
    `).run(req.body.admin_response.trim(), req.session.user.id, req.params.id);

    await req.audit('respond', 'feedback', req.params.id, null, { responded: true });
    req.session.flash = { success: 'Response saved successfully.' };
    res.redirect(`/feedback/${req.params.id}`);
  }
);

// POST /feedback/:id/toggle-public — show/hide from public view
router.post('/:id/toggle-public', requireAuth, requireRole('admin'), async (req, res) => {
  const fb = await db.prepare(`SELECT id, is_public FROM feedback WHERE id = ?`).get(req.params.id);
  if (!fb) return res.redirect('/feedback');
  await db.prepare(`UPDATE feedback SET is_public = ? WHERE id = ?`).run(fb.is_public ? 0 : 1, fb.id);
  req.session.flash = { success: `Feedback visibility updated.` };
  res.redirect(`/feedback/${fb.id}`);
});

module.exports = router;