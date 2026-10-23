/**
 * Guest Management Routes
 */
'use strict';

const express = require('express');
const db      = require('../../../config/database');
const { requireAuth, requireRole } = require('../../../middleware/auth');

const router = express.Router();

// GET /guests
router.get('/', requireAuth, async (req, res) => {
  const { search = '', status = '', page = 1 } = req.query;
  const limit  = 20;
  const offset = (parseInt(page) - 1) * limit;
  let   where  = 'WHERE 1=1';
  const params = [];

  if (search) {
    where += ` AND (g.first_name LIKE ? OR g.last_name LIKE ? OR g.email LIKE ? OR r.booking_ref LIKE ?)`;
    params.push(`%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`);
  }
  if (status) { where += ` AND g.status = ?`; params.push(status); }

  const total  = (await db.prepare(`SELECT COUNT(*) AS cnt FROM guests g JOIN reservations r ON r.id = g.reservation_id ${where}`).get(...params)).cnt;
  const guests = await db.prepare(`
    SELECT g.*, r.booking_ref, r.check_in_date, r.check_out_date, r.status AS res_status
    FROM guests g
    JOIN reservations r ON r.id = g.reservation_id
    ${where}
    ORDER BY g.created_at DESC
    LIMIT ? OFFSET ?
  `).all(...params, limit, offset);

  const statuses = ['expected','checked_in','checked_out','no_show'];
  res.render('guests/index', {
    title: 'Guests – Balai-Reserve',
    layout: 'layouts/main',
    guests, statuses,
    filters: { search, status },
    pagination: { total, page: parseInt(page), limit, totalPages: Math.ceil(total / limit) },
  });
});

// GET /guests/:id
router.get('/:id', requireAuth, async (req, res) => {
  const guest = await db.prepare(`
    SELECT g.*, r.booking_ref, r.check_in_date, r.check_out_date, r.total_amount,
           r.payment_status, r.status AS res_status
    FROM guests g JOIN reservations r ON r.id = g.reservation_id
    WHERE g.id = ?
  `).get(req.params.id);
  if (!guest) { req.session.flash = { error: 'Guest not found.' }; return res.redirect('/guests'); }

  const checkIn  = await db.prepare(`SELECT * FROM check_ins WHERE reservation_id = ? ORDER BY checked_in_at DESC LIMIT 1`).get(guest.reservation_id);
  const checkOut = await db.prepare(`SELECT * FROM check_outs WHERE reservation_id = ? ORDER BY checked_out_at DESC LIMIT 1`).get(guest.reservation_id);

  // All reservations for this guest's email
  const history = await db.prepare(`
    SELECT r.*, g2.status AS guest_status
    FROM guests g2 JOIN reservations r ON r.id = g2.reservation_id
    WHERE g2.email = ? ORDER BY r.created_at DESC
  `).all(guest.email || '___no_email___');

  res.render('guests/show', {
    title: `Guest: ${guest.first_name} ${guest.last_name}`,
    layout: 'layouts/main',
    guest, checkIn, checkOut, history,
  });
});

// POST /guests/:id/checkout
router.post('/:id/checkout', requireAuth, requireRole('admin','staff'), async (req, res) => {
  const guest = await db.prepare(`SELECT * FROM guests WHERE id=?`).get(req.params.id);
  if (!guest) return res.redirect('/guests');

  // ΓöÇΓöÇ Fix 5: Block checkout if balance is still outstanding ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ
  const reservation = await db.prepare(`SELECT * FROM reservations WHERE id=?`).get(guest.reservation_id);
  if (reservation) {
    const totalPaid = (await db.prepare(
      "SELECT COALESCE(SUM(amount),0) AS t FROM payments WHERE reservation_id = ? AND status IN ('received','verified')"
    ).get(guest.reservation_id)).t;
    const totalAmt = reservation.total_amount || 0;
    if (totalAmt > 0 && totalPaid < totalAmt) {
      req.session.flash = { error: `Cannot check out: balance of ₱${(totalAmt - totalPaid).toLocaleString('en-PH', {minimumFractionDigits:2})} is still outstanding. Collect full payment before checking out.` };
      return res.redirect(`/guests/${guest.id}`);
    }
  }

  await db.transaction(async () => {
    await db.prepare(`UPDATE guests SET status='checked_out', updated_at=NOW() WHERE id=?`).run(guest.id);
    // ΓöÇΓöÇ Fix 5: Set status=completed AND payment_status=fully_paid on checkout
    await db.prepare(`UPDATE reservations SET status='completed', payment_status='fully_paid', updated_at=NOW() WHERE id=?`).run(guest.reservation_id);
    await db.prepare(`INSERT INTO check_outs (reservation_id, guest_id, checked_out_by) VALUES (?,?,?)`).run(guest.reservation_id, guest.id, req.session.user.id);
    // Free up the room
    // Free the resource back to available right after checkout completes.
    const items = await db.prepare(`SELECT * FROM reservation_items WHERE reservation_id=?`).all(guest.reservation_id);
    for (const item of items) {
      if (item.item_type === 'room')    await db.prepare(`UPDATE rooms SET status='available' WHERE id=?`).run(item.item_id);
      if (item.item_type === 'venue')   await db.prepare(`UPDATE venues SET status='available' WHERE id=?`).run(item.item_id);
      if (item.item_type === 'cottage') await db.prepare(`UPDATE cottages SET status='available' WHERE id=?`).run(item.item_id);
    }
  });

  req.session.flash = { success: 'Guest checked out successfully.' };
  res.redirect(`/guests/${guest.id}`);
});

module.exports = router;
