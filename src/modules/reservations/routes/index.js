/**
 * Reservation Management Routes
 */
'use strict';

const express = require('express');
const { body, validationResult } = require('express-validator');
const db      = require('../../../config/database');
const { requireAuth, requireRole } = require('../../../middleware/auth');
const { generateBookingRef }       = require('../../../utils/bookingRef');
const { generateReservationQR }    = require('../../../utils/qrGenerator');
const { notifyStaff, notifyCustomer, notifyAllAdmins, notifyReservationCustomer } = require('../../../utils/notifications');

const router = express.Router();

// GET /reservations
router.get('/', requireAuth, async (req, res) => {
  const { search = '', status = '', type = '', payment = '', page = 1, from = '', to = '' } = req.query;
  const limit  = 20;
  const offset = (parseInt(page) - 1) * limit;
  let   where  = 'WHERE 1=1';
  const params = [];

  if (search) {
    where += ` AND (r.booking_ref LIKE ? OR c.first_name LIKE ? OR c.last_name LIKE ?)`;
    params.push(`%${search}%`, `%${search}%`, `%${search}%`);
  }
  if (status)  { where += ` AND r.status = ?`;            params.push(status); }
  if (type)    { where += ` AND r.reservation_type = ?`;  params.push(type); }
  if (payment) { where += ` AND r.payment_status = ?`;    params.push(payment); }
  if (from)    { where += ` AND r.created_at >= ?`;       params.push(from); }
  if (to)      { where += ` AND r.created_at <= ?`;       params.push(to + ' 23:59:59'); }

  const total = (await db.prepare(`
    SELECT COUNT(*) AS cnt FROM reservations r JOIN customers c ON c.id = r.customer_id ${where}
  `).get(...params)).cnt;

  const reservations = await db.prepare(`
    SELECT r.*,
           c.first_name || ' ' || c.last_name AS customer_name,
           c.phone AS customer_phone
    FROM reservations r
    JOIN customers c ON c.id = r.customer_id
    ${where}
    ORDER BY r.created_at DESC
    LIMIT ? OFFSET ?
  `).all(...params, limit, offset);

  // 'completed' kept in the filter list so staff can still search/view completed reservations,
  // but it is not offered as a manual status transition (checkout uses the Guest Check Out button).
  const statuses = ['pending','awaiting_payment','confirmed','checked_in','completed','cancelled','rejected','no_show'];
  const types    = ['room','venue','event','cottage'];
  const payments = ['unpaid','partially_paid','fully_paid','refunded'];

  res.render('reservations/index', {
    title: 'Reservations – Balai-Reserve',
    layout: 'layouts/main',
    reservations, statuses, types, payments,
    filters: { search, status, type, payment, from, to },
    pagination: { total, page: parseInt(page), limit, totalPages: Math.ceil(total / limit) },
  });
});

// GET /reservations/new
router.get('/new', requireAuth, requireRole('admin','staff'), async (req, res) => {
  const customers = await db.prepare(`SELECT id, customer_code, first_name, last_name, email FROM customers WHERE status = 'active' ORDER BY first_name`).all();
  const rooms     = await db.prepare(`SELECT * FROM rooms WHERE status = 'available' AND is_active = 1 ORDER BY room_number`).all();
  const venues    = await db.prepare(`SELECT * FROM venues WHERE status = 'available' AND is_active = 1 ORDER BY name`).all();
  const packages  = await db.prepare(`SELECT * FROM event_packages WHERE is_active = 1 ORDER BY name`).all();
  res.render('reservations/form', {
    title: 'New Reservation',
    layout: 'layouts/main',
    reservation: null, customers, rooms, venues, packages,
    errors: [], old: {},
  });
});

// POST /reservations
router.post('/',
  requireAuth, requireRole('admin','staff'),
  [
    body('customer_id').isInt().withMessage('Select a customer.'),
    body('reservation_type').notEmpty().withMessage('Select a reservation type.'),
    body('num_guests').isInt({ min: 1 }).withMessage('Number of guests must be at least 1.'),
    body('total_amount').isFloat({ min: 0.01 }).withMessage('Total amount must be greater than zero.'),
    // Date validation — required depending on type
    body('check_in_date').custom((val, { req: r }) => {
      if (['room','cottage'].includes(r.body.reservation_type)) {
        if (!val || !val.trim()) throw new Error('Check-in date is required for room/cottage reservations.');
        if (isNaN(Date.parse(val))) throw new Error('Check-in date is invalid.');
      }
      return true;
    }),
    body('check_out_date').custom((val, { req: r }) => {
      if (['room','cottage'].includes(r.body.reservation_type)) {
        if (!val || !val.trim()) throw new Error('Check-out date is required for room/cottage reservations.');
        if (isNaN(Date.parse(val))) throw new Error('Check-out date is invalid.');
        const ci = r.body.check_in_date;
        if (ci && val <= ci) throw new Error('Check-out date must be after check-in date.');
      }
      return true;
    }),
    body('event_date').custom((val, { req: r }) => {
      if (['venue','event'].includes(r.body.reservation_type)) {
        if (!val || !val.trim()) throw new Error('Event date is required for venue/event reservations.');
        if (isNaN(Date.parse(val))) throw new Error('Event date is invalid.');
      }
      return true;
    }),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      const customers = await db.prepare(`SELECT id, customer_code, first_name, last_name FROM customers WHERE status='active' ORDER BY first_name`).all();
      const rooms  = await db.prepare(`SELECT * FROM rooms WHERE status='available' AND is_active=1`).all();
      const venues = await db.prepare(`SELECT * FROM venues WHERE status='available' AND is_active=1`).all();
      const packages = await db.prepare(`SELECT * FROM event_packages WHERE is_active=1`).all();
      return res.render('reservations/form', { title: 'New Reservation', layout: 'layouts/main', reservation: null, customers, rooms, venues, packages, errors: errors.array(), old: req.body });
    }

    const {
      customer_id, reservation_type, check_in_date, check_out_date,
      event_date, start_time, end_time, num_guests, special_requests,
      total_amount, downpayment_req, item_id, package_id, notes, source,
    } = req.body;

    // Prevent double booking for rooms
    if (reservation_type === 'room' && item_id && check_in_date && check_out_date) {
      const conflict = await db.prepare(`
        SELECT r.id FROM reservations r
        JOIN reservation_items ri ON ri.reservation_id = r.id
        WHERE ri.item_type = 'room' AND ri.item_id = ?
          AND r.status NOT IN ('cancelled','rejected','completed')
          AND r.check_in_date < ? AND r.check_out_date > ?
      `).get(item_id, check_out_date, check_in_date);
      if (conflict) {
        req.session.flash = { error: 'This room is already reserved for the selected dates.' };
        return res.redirect('/reservations/new');
      }
    }

    // Prevent overlapping venue reservations
    if ((reservation_type === 'venue' || reservation_type === 'event') && item_id && event_date) {
      const conflict = await db.prepare(`
        SELECT r.id FROM reservations r
        JOIN reservation_items ri ON ri.reservation_id = r.id
        WHERE ri.item_type = 'venue' AND ri.item_id = ?
          AND r.status NOT IN ('cancelled','rejected','completed')
          AND DATE(r.event_date) = ? AND (
            (r.start_time < ? AND r.end_time > ?)
          )
      `).get(item_id, event_date, end_time || '23:59', start_time || '00:00');
      if (conflict) {
        req.session.flash = { error: 'This venue already has a booking for the selected date and time.' };
        return res.redirect('/reservations/new');
      }
    }

    const bookingRef = await generateBookingRef();

    const result = await db.transaction(async () => {
      const resId = (await db.prepare(`
        INSERT INTO reservations
          (booking_ref, customer_id, reservation_type, check_in_date, check_out_date,
           event_date, start_time, end_time, num_guests, special_requests,
           total_amount, downpayment_req, status, payment_status, notes, source)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', 'unpaid', ?, ?)
      `).run(
        bookingRef, customer_id, reservation_type,
        check_in_date || null, check_out_date || null,
        event_date || null, start_time || null, end_time || null,
        num_guests, special_requests || '',
        parseFloat(total_amount) || 0,
        parseFloat(downpayment_req) || 0,
        notes || '', source || 'walk_in'
      )).lastInsertRowid;

      // Insert reservation item — and mark the resource reserved so it stops
      // showing as available while the booking is active.
      if (item_id) {
        let itemName = '';
        if (reservation_type === 'room') {
          const room = await db.prepare(`SELECT name, price FROM rooms WHERE id=?`).get(item_id);
          itemName = room?.name || '';
          await db.prepare(`INSERT INTO reservation_items (reservation_id, item_type, item_id, item_name, quantity, unit_price, total_price) VALUES (?,?,?,?,1,?,?)`).run(resId,'room',item_id,itemName,room?.price||0,parseFloat(total_amount)||0);
          await db.prepare("UPDATE rooms SET status='reserved', updated_at=NOW() WHERE id=?").run(item_id);
        } else if (reservation_type === 'venue') {
          const venue = await db.prepare(`SELECT name, price FROM venues WHERE id=?`).get(item_id);
          itemName = venue?.name || '';
          await db.prepare(`INSERT INTO reservation_items (reservation_id, item_type, item_id, item_name, quantity, unit_price, total_price) VALUES (?,?,?,?,1,?,?)`).run(resId,'venue',item_id,itemName,venue?.price||0,parseFloat(total_amount)||0);
          await db.prepare("UPDATE venues SET status='reserved', updated_at=NOW() WHERE id=?").run(item_id);
        } else if (reservation_type === 'cottage') {
          const cottage = await db.prepare(`SELECT name, price FROM cottages WHERE id=?`).get(item_id);
          itemName = cottage?.name || '';
          await db.prepare(`INSERT INTO reservation_items (reservation_id, item_type, item_id, item_name, quantity, unit_price, total_price) VALUES (?,?,?,?,1,?,?)`).run(resId,'cottage',item_id,itemName,cottage?.price||0,parseFloat(total_amount)||0);
          await db.prepare("UPDATE cottages SET status='reserved', updated_at=NOW() WHERE id=?").run(item_id);
        }
      }
      if (package_id) {
        const pkg = await db.prepare(`SELECT name, price FROM event_packages WHERE id=?`).get(package_id);
        await db.prepare(`INSERT INTO reservation_items (reservation_id, item_type, item_id, item_name, quantity, unit_price, total_price) VALUES (?,?,?,?,1,?,?)`).run(resId,'event_package',package_id,pkg?.name||'',pkg?.price||0,pkg?.price||0);
      }

      // Status history
      await db.prepare(`INSERT INTO reservation_status_history (reservation_id, from_status, to_status, changed_by) VALUES (?,null,'pending',?)`).run(resId, req.session.user.id);

      return resId;
    });

    // Generate QR code
    try { await generateReservationQR(result, bookingRef); } catch { /* non-critical */ }

    // Notify admins
    await notifyAllAdmins('reservation', 'New Reservation', `${bookingRef} has been created.`, `/reservations/${result}`);

    await req.audit('create', 'reservations', result, null, { bookingRef, reservation_type });
    req.session.flash = { success: `Reservation ${bookingRef} created successfully.` };
    res.redirect(`/reservations/${result}`);
  }
);

// GET /reservations/:id
router.get('/:id', requireAuth, async (req, res) => {
  const reservation = await db.prepare(`
    SELECT r.*, c.first_name || ' ' || c.last_name AS customer_name,
           c.phone AS customer_phone, c.email AS customer_email
    FROM reservations r JOIN customers c ON c.id = r.customer_id
    WHERE r.id = ?
  `).get(req.params.id);
  if (!reservation) { req.session.flash = { error: 'Reservation not found.' }; return res.redirect('/reservations'); }

  const items    = await db.prepare(`SELECT * FROM reservation_items WHERE reservation_id = ?`).all(reservation.id);
  const payments = await db.prepare(`SELECT p.*, u.first_name || ' ' || u.last_name AS received_by_name FROM payments p LEFT JOIN users u ON u.id = p.received_by WHERE p.reservation_id = ? ORDER BY p.payment_date`).all(reservation.id);
  const qrCode   = await db.prepare(`SELECT * FROM qr_codes WHERE reservation_id = ? ORDER BY created_at DESC LIMIT 1`).get(reservation.id);
  const statusHistory = await db.prepare(`
    SELECT sh.*, u.first_name || ' ' || u.last_name AS changed_by_name
    FROM reservation_status_history sh LEFT JOIN users u ON u.id = sh.changed_by
    WHERE sh.reservation_id = ? ORDER BY sh.created_at
  `).all(reservation.id);
  const guest    = await db.prepare(`SELECT * FROM guests WHERE reservation_id = ? LIMIT 1`).get(reservation.id);
  const checkIn  = await db.prepare(`SELECT * FROM check_ins WHERE reservation_id = ? LIMIT 1`).get(reservation.id);
  const checkOut = await db.prepare(`SELECT * FROM check_outs WHERE reservation_id = ? LIMIT 1`).get(reservation.id);

  // Only count payments that actually contribute to the balance (exclude
  // refunded/rejected) so the displayed balance matches the checkout gate.
  const amountPaid = payments
    .filter(p => p.status === 'received' || p.status === 'verified')
    .reduce((s, p) => s + (p.amount || 0), 0);
  const balance    = (reservation.total_amount || 0) - amountPaid;

  // Pending refund request for this booking (if any) — surfaced for review.
  const refundRequest = await db.prepare(
    `SELECT * FROM refund_requests WHERE reservation_id = ? ORDER BY created_at DESC LIMIT 1`
  ).get(reservation.id);

  res.render('reservations/show', {
    title: `Reservation ${reservation.booking_ref}`,
    layout: 'layouts/main',
    reservation, items, payments, qrCode, statusHistory, guest, checkIn, checkOut, amountPaid, balance,
    refundRequest,
  });
});

// POST /reservations/:id/status
router.post('/:id/status', requireAuth, requireRole('admin','staff'), async (req, res) => {
  const { status, notes } = req.body;
  const old = await db.prepare(`SELECT status, payment_status, total_amount FROM reservations WHERE id=?`).get(req.params.id);
  if (!old) { return res.redirect('/reservations'); }

  // ΓöÇΓöÇ Fix 5: Block checkout (completed) if balance is still outstanding ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ
  if (status === 'completed') {
    const totalPaidCheck = (await db.prepare(
      "SELECT COALESCE(SUM(amount),0) AS t FROM payments WHERE reservation_id = ? AND status IN ('received','verified')"
    ).get(req.params.id)).t;
    const totalAmt = old.total_amount || 0;
    if (totalAmt > 0 && totalPaidCheck < totalAmt) {
      req.session.flash = { error: `Cannot check out: balance of ₱${(totalAmt - totalPaidCheck).toLocaleString('en-PH', {minimumFractionDigits:2})} is still outstanding. Collect full payment before checking out.` };
      return res.redirect(`/reservations/${req.params.id}`);
    }
  }

  await db.transaction(async () => {
    await db.prepare(`UPDATE reservations SET status=?, updated_at=NOW() WHERE id=?`).run(status, req.params.id);
    await db.prepare(`INSERT INTO reservation_status_history (reservation_id, from_status, to_status, changed_by, notes) VALUES (?,?,?,?,?)`).run(req.params.id, old.status, status, req.session.user.id, notes || null);

    // Sync payment_status when status changes to confirmed / awaiting_payment
    if (status === 'confirmed' || status === 'awaiting_payment') {
      const totalPaid = (await db.prepare(
        "SELECT COALESCE(SUM(amount),0) AS t FROM payments WHERE reservation_id = ? AND status IN ('received','verified')"
      ).get(req.params.id)).t;

      const totalAmt = old.total_amount || 0;
      let newPayStatus = old.payment_status;

      if (totalPaid <= 0) {
        newPayStatus = 'unpaid';
      } else if (totalAmt > 0 && totalPaid >= totalAmt) {
        newPayStatus = 'fully_paid';
      } else {
        newPayStatus = 'partially_paid';
      }

      if (newPayStatus !== old.payment_status) {
        await db.prepare("UPDATE reservations SET payment_status = ? WHERE id = ?").run(newPayStatus, req.params.id);
      }
    }

    // ΓöÇΓöÇ Fix 5: On checkout (completed), force payment_status = fully_paid ΓöÇΓöÇΓöÇ
    if (status === 'completed') {
      await db.prepare("UPDATE reservations SET payment_status = 'fully_paid', updated_at = NOW() WHERE id = ?").run(req.params.id);
    }

    // Handle room/venue/cottage status side effects
    if (status === 'checked_in') {
      const items = await db.prepare(`SELECT * FROM reservation_items WHERE reservation_id = ?`).all(req.params.id);
      for (const item of items) {
        if (item.item_type === 'room')    await db.prepare(`UPDATE rooms SET status='occupied' WHERE id=?`).run(item.item_id);
        if (item.item_type === 'venue')   await db.prepare(`UPDATE venues SET status='occupied' WHERE id=?`).run(item.item_id);
        if (item.item_type === 'cottage') await db.prepare(`UPDATE cottages SET status='occupied' WHERE id=?`).run(item.item_id);
      }
      await db.prepare(`INSERT INTO check_ins (reservation_id, method, checked_in_by) VALUES (?, 'manual', ?)`).run(req.params.id, req.session.user.id);
      await db.prepare(`UPDATE guests SET status='checked_in' WHERE reservation_id=?`).run(req.params.id);
    }

    if (status === 'completed') {
      // On checkout, free the resource back to available immediately.
      const items = await db.prepare(`SELECT * FROM reservation_items WHERE reservation_id = ?`).all(req.params.id);
      for (const item of items) {
        if (item.item_type === 'room')    await db.prepare(`UPDATE rooms SET status='available' WHERE id=?`).run(item.item_id);
        if (item.item_type === 'venue')   await db.prepare(`UPDATE venues SET status='available' WHERE id=?`).run(item.item_id);
        if (item.item_type === 'cottage') await db.prepare(`UPDATE cottages SET status='available' WHERE id=?`).run(item.item_id);
      }
      await db.prepare(`INSERT INTO check_outs (reservation_id, checked_out_by) VALUES (?, ?)`).run(req.params.id, req.session.user.id);
      await db.prepare(`UPDATE guests SET status='checked_out' WHERE reservation_id=?`).run(req.params.id);
    }

    // Cancelled / rejected / no-show all free the resource back to available.
    if (status === 'cancelled' || status === 'rejected' || status === 'no_show') {
      const items = await db.prepare(`SELECT * FROM reservation_items WHERE reservation_id = ?`).all(req.params.id);
      for (const item of items) {
        if (item.item_type === 'room')    await db.prepare(`UPDATE rooms SET status='available' WHERE id=?`).run(item.item_id);
        if (item.item_type === 'venue')   await db.prepare(`UPDATE venues SET status='available' WHERE id=?`).run(item.item_id);
        if (item.item_type === 'cottage') await db.prepare(`UPDATE cottages SET status='available' WHERE id=?`).run(item.item_id);
      }
    }
  });

  await req.audit('status_change', 'reservations', req.params.id, old, { status });

  // ΓöÇΓöÇ Fix 6: Mark reservation-related notifications as read when the booking
  // reaches a terminal/resolved state so the bell count drops correctly ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ
  if (['confirmed','completed','cancelled','rejected'].includes(status)) {
    try {
      await db.prepare(
        `UPDATE notifications SET is_read = 1 WHERE link LIKE ? AND is_read = 0`
      ).run(`/reservations/${req.params.id}%`);
    } catch { /* non-critical */ }
  }

  // ΓöÇΓöÇ Notify the customer of the new booking status ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ
  if (status !== old.status) {
    const ref = (await db.prepare(`SELECT booking_ref FROM reservations WHERE id=?`).get(req.params.id))?.booking_ref || '';
    const statusMessages = {
      confirmed:        { t: 'Booking Confirmed',        m: `Great news! Your booking ${ref} is confirmed. We look forward to your visit.` },
      awaiting_payment: { t: 'Awaiting Payment',         m: `Your booking ${ref} is awaiting payment. Please complete your downpayment to confirm.` },
      checked_in:       { t: 'Checked In',               m: `You are now checked in for booking ${ref}. Enjoy your stay!` },
      completed:        { t: 'Stay Completed',           m: `Your booking ${ref} is complete and fully paid. Thank you for choosing Balai-Reserve!` },
      cancelled:        { t: 'Booking Cancelled',        m: `Your booking ${ref} has been cancelled. Contact us if you have any questions.` },
      rejected:         { t: 'Booking Rejected',         m: `Unfortunately your booking ${ref} could not be accommodated. Please contact us for alternatives.` },
      no_show:          { t: 'Marked as No-Show',        m: `Your booking ${ref} was marked as a no-show. Please contact us if this is an error.` },
    };
    const info = statusMessages[status];
    if (info) {
      await notifyReservationCustomer(
        req.params.id, 'reservation', info.t, info.m,
        '/portal/my-reservations/' + req.params.id
      );
    }
  }

  req.session.flash = { success: `Reservation status updated to ${status}.` };
  res.redirect(`/reservations/${req.params.id}`);
});

// POST /reservations/:id/payment
router.post('/:id/payment', requireAuth, requireRole('admin','staff'), async (req, res) => {
  const { amount, payment_method, payment_date, payment_type, notes } = req.body;
  const paidAmt = parseFloat(amount);
  if (!paidAmt || paidAmt <= 0) { req.session.flash = { error: 'Invalid payment amount.' }; return res.redirect(`/reservations/${req.params.id}`); }

  const res_row = await db.prepare(`SELECT * FROM reservations WHERE id=?`).get(req.params.id);
  if (!res_row) return res.redirect('/reservations');

  await db.transaction(async () => {
    const refNum = `PAY-${Date.now()}`;
    await db.prepare(`
      INSERT INTO payments (reservation_id, reference_number, amount, payment_method, payment_date, payment_type, status, received_by, notes, submitted_by)
      VALUES (?, ?, ?, ?, ?, ?, 'received', ?, ?, 'staff')
    `).run(req.params.id, refNum, paidAmt, payment_method || 'cash', payment_date || new Date().toISOString().slice(0,10), payment_type || 'balance', req.session.user.id, notes || '');

    // Recalculate payment status (count received + verified toward the balance)
    const totalPaid = (await db.prepare(`SELECT COALESCE(SUM(amount),0) AS total FROM payments WHERE reservation_id=? AND status IN ('received','verified')`).get(req.params.id)).total;
    let payStatus = 'partially_paid';
    if (totalPaid >= res_row.total_amount && res_row.total_amount > 0) payStatus = 'fully_paid';

    let newStatus = res_row.status;
    if (res_row.status === 'pending' || res_row.status === 'awaiting_payment') {
      newStatus = payStatus === 'fully_paid' ? 'confirmed' : 'awaiting_payment';
    }

    await db.prepare(`UPDATE reservations SET payment_status=?, status=?, updated_at=NOW() WHERE id=?`).run(payStatus, newStatus, req.params.id);
    if (newStatus !== res_row.status) {
      await db.prepare(`INSERT INTO reservation_status_history (reservation_id, from_status, to_status, changed_by, notes) VALUES (?,?,?,?,?)`).run(req.params.id, res_row.status, newStatus, req.session.user.id, 'Auto-updated after payment');
    }
  });

  await notifyAllAdmins('payment', 'Payment Received', `₱${paidAmt.toLocaleString()} received for ${res_row.booking_ref}`, `/reservations/${req.params.id}`);

  // Notify the customer their payment was recorded
  await notifyReservationCustomer(
    req.params.id, 'payment', 'Payment Recorded',
    `We recorded your ₱${paidAmt.toLocaleString('en-PH')} payment for ${res_row.booking_ref}. Thank you!`,
    '/portal/my-reservations/' + req.params.id
  );

  await req.audit('payment', 'reservations', req.params.id, null, { amount: paidAmt, payment_method });
  req.session.flash = { success: `Payment of ₱${paidAmt.toLocaleString()} recorded successfully.` };
  res.redirect(`/reservations/${req.params.id}`);
});

// ΓöÇΓöÇ FIX 7: POST /reservations/:id/verify-payment/:paymentId ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ
// Staff verifies a customer-submitted payment proof.
router.post('/:id/verify-payment/:paymentId', requireAuth, requireRole('admin','staff'), async (req, res) => {
  const { action } = req.body; // 'verify' or 'reject'
  const payment = await db.prepare('SELECT * FROM payments WHERE id = ? AND reservation_id = ?').get(req.params.paymentId, req.params.id);
  if (!payment) { req.session.flash = { error: 'Payment record not found.' }; return res.redirect(`/reservations/${req.params.id}`); }

  const reservation = await db.prepare('SELECT * FROM reservations WHERE id = ?').get(req.params.id);
  if (!reservation) return res.redirect('/reservations');

  if (action === 'verify') {
    await db.transaction(async () => {
      // Mark as verified
      await db.prepare('UPDATE payments SET status = \'verified\', verified_by = ?, verified_at = NOW() WHERE id = ?').run(req.session.user.id, payment.id);

      // Recalculate payment_status on reservation
      const totalPaid = (await db.prepare("SELECT COALESCE(SUM(amount),0) AS t FROM payments WHERE reservation_id = ? AND status IN ('received','verified')").get(req.params.id)).t;
      const totalAmt  = reservation.total_amount || 0;
      let newPayStatus = 'partially_paid';
      if (totalAmt > 0 && totalPaid >= totalAmt) newPayStatus = 'fully_paid';

      // Promote reservation status: awaiting_payment ΓåÆ confirmed
      let newResStatus = reservation.status;
      if (reservation.status === 'awaiting_payment' || reservation.status === 'pending') {
        newResStatus = newPayStatus === 'fully_paid' ? 'confirmed' : 'awaiting_payment';
      }

      await db.prepare("UPDATE reservations SET payment_status = ?, status = ?, updated_at = NOW() WHERE id = ?").run(newPayStatus, newResStatus, req.params.id);

      if (newResStatus !== reservation.status) {
        await db.prepare('INSERT INTO reservation_status_history (reservation_id, from_status, to_status, changed_by, notes) VALUES (?,?,?,?,?)').run(
          req.params.id, reservation.status, newResStatus, req.session.user.id, 'Auto-confirmed after payment verified'
        );
      }

      // Notify the customer's user account if linked
      const customer = await db.prepare('SELECT * FROM customers WHERE id = ?').get(reservation.customer_id);
      if (customer?.user_id) {
        const { notifyStaff } = require('../../../utils/notifications');
        await notifyStaff(customer.user_id, 'payment', 'Payment Verified', 'Your payment of ₱' + payment.amount.toLocaleString() + ' for booking ' + reservation.booking_ref + ' has been verified. Your booking is now ' + newResStatus.replace(/_/g,' ') + '.', '/portal/my-reservations/' + reservation.id);
      }
    });

    await req.audit('verify_payment', 'payments', payment.id, { status: payment.status }, { status: 'verified' });
    req.session.flash = { success: 'Payment verified. Booking status updated.' };

  } else if (action === 'reject') {
    // Mark as rejected — remove from balance calculation
    await db.prepare("UPDATE payments SET status = 'refunded', notes = COALESCE(notes,'') || ' [Rejected by staff: ' || NOW() || ']' WHERE id = ?").run(payment.id);

    // Recalculate payment_status
    const totalPaid = (await db.prepare("SELECT COALESCE(SUM(amount),0) AS t FROM payments WHERE reservation_id = ? AND status IN ('received','verified')").get(req.params.id)).t;
    const totalAmt  = reservation.total_amount || 0;
    let newPayStatus = totalPaid <= 0 ? 'unpaid' : (totalAmt > 0 && totalPaid >= totalAmt ? 'fully_paid' : 'partially_paid');
    await db.prepare("UPDATE reservations SET payment_status = ? WHERE id = ?").run(newPayStatus, req.params.id);

    await req.audit('reject_payment', 'payments', payment.id, { status: payment.status }, { status: 'refunded' });
    req.session.flash = { warning: 'Payment proof rejected. Customer will need to resubmit.' };
  }

  res.redirect(`/reservations/${req.params.id}`);
});

// ΓöÇΓöÇ POST /reservations/:id/collect-balance ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ
// Records the full outstanding balance as a single "balance" payment so the
// booking becomes fully paid. This is the step staff run BEFORE checking a
// guest out (checkout stays gated on full payment).
router.post('/:id/collect-balance', requireAuth, requireRole('admin','staff'), async (req, res) => {
  const reservation = await db.prepare('SELECT * FROM reservations WHERE id = ?').get(req.params.id);
  if (!reservation) { req.session.flash = { error: 'Reservation not found.' }; return res.redirect('/reservations'); }

  const totalAmt = reservation.total_amount || 0;
  const paid = (await db.prepare(
    "SELECT COALESCE(SUM(amount),0) AS t FROM payments WHERE reservation_id = ? AND status IN ('received','verified')"
  ).get(req.params.id)).t;
  const balance = Math.round((totalAmt - paid) * 100) / 100;

  if (balance <= 0) {
    req.session.flash = { info: 'This booking is already fully paid.' };
    return res.redirect(`/reservations/${req.params.id}`);
  }

  const method = (req.body.payment_method || 'cash').trim();

  await db.transaction(async () => {
    const refNum = `PAY-${Date.now()}`;
    await db.prepare(`
      INSERT INTO payments (reservation_id, reference_number, amount, payment_method, payment_date, payment_type, status, received_by, notes, submitted_by, verified_by, verified_at)
      VALUES (?, ?, ?, ?, ?, 'balance', 'verified', ?, ?, 'staff', ?, NOW())
    `).run(
      req.params.id, refNum, balance, method,
      new Date().toISOString().slice(0, 10),
      req.session.user.id,
      'Remaining balance collected before checkout',
      req.session.user.id
    );

    // Booking is now fully paid.
    await db.prepare("UPDATE reservations SET payment_status = 'fully_paid', updated_at = NOW() WHERE id = ?").run(req.params.id);
  });

  await notifyAllAdmins('payment', 'Balance Collected', `Remaining ₱${balance.toLocaleString('en-PH',{minimumFractionDigits:2})} collected for ${reservation.booking_ref}.`, `/reservations/${req.params.id}`);
  await notifyReservationCustomer(
    req.params.id, 'payment', 'Payment Complete',
    `Your remaining balance of ₱${balance.toLocaleString('en-PH',{minimumFractionDigits:2})} for ${reservation.booking_ref} has been paid in full. Thank you!`,
    '/portal/my-reservations/' + req.params.id
  );

  await req.audit('collect_balance', 'reservations', req.params.id, { payment_status: reservation.payment_status }, { payment_status: 'fully_paid', amount: balance });
  req.session.flash = { success: `Remaining balance of ₱${balance.toLocaleString('en-PH',{minimumFractionDigits:2})} collected. Booking is now fully paid and ready for checkout.` };
  res.redirect(`/reservations/${req.params.id}`);
});

// GET /reservations/calendar
router.get('/view/calendar', requireAuth, async (req, res) => {
  // ΓöÇΓöÇ 1. Room & cottage reservations (multi-day allDay spans) ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ
  const roomReservations = await db.prepare(`
    SELECT
      r.id,
      r.id            AS reservation_id,
      r.booking_ref,
      r.status,
      r.payment_status,
      r.reservation_type,
      r.num_guests,
      r.check_in_date  AS checkin_date,
      r.check_out_date AS checkout_date,
      NULL             AS event_date,
      NULL             AS start_time,
      NULL             AS end_time,
      c.first_name || ' ' || c.last_name AS customer_name,
      c.first_name || ' ' || c.last_name AS title,
      ri.item_name     AS room_name,
      NULL             AS venue_name,
      NULL             AS event_name,
      1                AS is_all_day,
      0                AS is_event
    FROM reservations r
    JOIN customers c         ON c.id = r.customer_id
    LEFT JOIN reservation_items ri ON ri.reservation_id = r.id
                                  AND ri.item_type IN ('room','cottage')
    WHERE r.reservation_type IN ('room','cottage')
      AND r.check_in_date IS NOT NULL
      -- Completed / no-show bookings are historical and drop off the calendar.
      -- Cancelled / rejected stay in the feed but are hidden unless the user
      -- ticks the "Cancelled" filter. Refunded bookings are excluded entirely.
      AND r.status NOT IN ('completed','no_show')
      AND r.payment_status != 'refunded'
    ORDER BY r.check_in_date
  `).all();

  // ΓöÇΓöÇ 2. Venue reservations (single-day) ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ
  const venueReservations = await db.prepare(`
    SELECT
      r.id,
      r.id             AS reservation_id,
      r.booking_ref,
      r.status,
      r.payment_status,
      r.reservation_type,
      r.num_guests,
      r.check_in_date  AS checkin_date,
      r.check_out_date AS checkout_date,
      r.event_date,
      r.start_time,
      r.end_time,
      c.first_name || ' ' || c.last_name AS customer_name,
      c.first_name || ' ' || c.last_name AS title,
      NULL             AS room_name,
      ri.item_name     AS venue_name,
      NULL             AS event_name,
      1                AS is_all_day,
      0                AS is_event
    FROM reservations r
    JOIN customers c          ON c.id = r.customer_id
    LEFT JOIN reservation_items ri ON ri.reservation_id = r.id
                                   AND ri.item_type = 'venue'
    WHERE r.reservation_type = 'venue'
      AND r.status NOT IN ('completed','no_show')
      AND r.payment_status != 'refunded'
    ORDER BY r.event_date
  `).all();

  // ΓöÇΓöÇ 3. Standalone events (from the events table) ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ
  const standaloneEvents = await db.prepare(`
    SELECT
      e.id,
      COALESCE(e.reservation_id, e.id) AS reservation_id,
      r.booking_ref,
      e.status,
      COALESCE(r.payment_status, e.payment_status) AS payment_status,
      'event'          AS reservation_type,
      e.num_attendees  AS num_guests,
      e.event_date     AS checkin_date,
      e.event_date     AS checkout_date,
      e.event_date,
      e.start_time,
      e.end_time,
      c.first_name || ' ' || c.last_name AS customer_name,
      e.event_name     AS title,
      NULL             AS room_name,
      v.name           AS venue_name,
      e.event_name,
      1                AS is_all_day,
      1                AS is_event
    FROM events e
    JOIN customers c       ON c.id = e.customer_id
    LEFT JOIN venues v     ON v.id = e.venue_id
    LEFT JOIN reservations r ON r.id = e.reservation_id
    WHERE e.status NOT IN ('completed','no_show')
      AND COALESCE(r.status, '') NOT IN ('completed','no_show')
      AND COALESCE(r.payment_status, '') != 'refunded'
    ORDER BY e.event_date
  `).all();

  const allCalendarEvents = [
    ...roomReservations,
    ...venueReservations,
    ...standaloneEvents,
  ];

  res.render('reservations/calendar', {
    title:  'Booking Calendar',
    layout: 'layouts/main',
    calendarEvents: JSON.stringify(allCalendarEvents),
  });
});

module.exports = router;