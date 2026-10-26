/**
 * Guest self check-in: the guest scans the resort's QR at the front desk with their own phone.
 *   GET  /arrive/scan            in-app camera for guests whose phone camera app doesn't open links
 *   GET  /arrive/:code           what the resort QR opens: checks the code (src/utils/arrivalCode.js),
 *                                remembers the scan in the session for 15 minutes, then → /arrive
 *   GET  /arrive                 signs the guest in if needed, then lists their bookings for today
 *   POST /arrive/booking/:id     checks that booking in (time-in starts now)
 *   GET  /arrive/done/:id        "You're checked in": time in, time out, time left
 * The check-in rules are the front desk's (src/utils/checkin.js); the guest just can't override them.
 */
'use strict';
const express = require('express');
const db = require('../../../config/database');
const arrival = require('../../../utils/arrivalCode');
const ck = require('../../../utils/checkin');
const { notifyReservationCustomer, notifyStaff } = require('../../../utils/notifications');

const router = express.Router();
const page = (res, view, locals, status = 200) => res.status(status).render('arrive/' + view, { title: 'Check in', layout: 'layouts/minimal', ...locals });

async function customerOf(req) {
  const u = req.session && req.session.user;
  if (!u || u.role !== 'customer') return null;
  return db.prepare('SELECT id, first_name FROM customers WHERE user_id = ?').get(u.id);
}

// What the guest sees for a booking that can't be checked in from their phone.
function guestReason(el) {
  switch (el.code) {
    case 'already': return 'You’re already checked in.';
    case 'held': return 'Your booking isn’t confirmed yet. Please see the front desk.';
    case 'unpaid': return 'We haven’t confirmed your downpayment yet. Please see the front desk — they can check you in once it’s settled.';
    default: return el.reason;
  }
}
function guestNotes(ctx, el) {
  const notes = [], now = ck.resortNow(), s = ctx.schedule;
  if (now.date === s.startDate && s.startTime && now.time < s.startTime) notes.push(`You’re early — the usual time-in is ${ck.time12(s.startTime)}. The front desk will tell you if your place is still being prepared.`);
  if (el.balance > 0) notes.push(`A balance of ₱${el.balance.toLocaleString('en-PH', { minimumFractionDigits: 2 })} is due. Please settle it at the front desk before you check out.`);
  return notes;
}

router.get('/scan', (req, res) => page(res, 'scan', { title: 'Scan the check-in QR' }));

router.get('/done/:id', async (req, res) => {
  const cust = await customerOf(req);
  const r = cust && await db.prepare('SELECT id FROM reservations WHERE id = ? AND customer_id = ?').get(req.params.id, cust.id);
  if (!r) return res.redirect('/portal/my-reservations');
  const ctx = await ck.loadContext(r.id);
  if (ctx.reservation.status !== 'checked_in') return res.redirect(`/portal/my-reservations/${r.id}`);
  page(res, 'done', { title: 'You’re checked in', s: ck.summary(ctx, ck.eligibility(ctx)), notes: guestNotes(ctx, ck.eligibility(ctx)) });
});

router.get('/', async (req, res) => {
  const user = req.session.user;
  if (!arrival.hasPass(req.session)) return page(res, 'index', { state: 'nopass' });
  if (!user) {
    req.session.flash = { info: 'Sign in to check in to your booking.' };
    req.session.returnTo = '/arrive';
    return res.redirect('/auth/login');
  }
  if (user.role !== 'customer') return page(res, 'index', { state: 'staff' });
  const cust = await customerOf(req);
  const today = ck.resortNow().date;
  const rows = cust ? await db.prepare(`
    SELECT id FROM reservations
    WHERE customer_id = ? AND status IN ('pending','awaiting_payment','confirmed','pencil','on_hold','checked_in')
      AND COALESCE(check_out_date, event_date, check_in_date) >= ?
    ORDER BY COALESCE(check_in_date, event_date), id LIMIT 6
  `).all(cust.id, today) : [];
  const bookings = [];
  for (const row of rows) {
    const ctx = await ck.loadContext(row.id);
    const el = ck.eligibility(ctx);
    bookings.push({ s: ck.summary(ctx, el), ok: el.ok, already: el.code === 'already', reason: el.ok ? '' : guestReason(el), notes: el.ok ? guestNotes(ctx, el) : [] });
  }
  // Today's bookings first; a later booking is only listed so the guest knows when check-in opens.
  const todays = bookings.filter(b => b.s.startDate <= today);
  page(res, 'index', { state: 'list', name: cust ? cust.first_name : user.first_name, bookings: todays.length ? todays : bookings.slice(0, 2), hasToday: todays.length > 0 });
});

router.post('/booking/:id', async (req, res) => {
  const user = req.session.user;
  if (!arrival.hasPass(req.session)) {
    req.session.flash = { error: 'Please scan the check-in QR at the front desk again.' };
    return res.redirect('/arrive');
  }
  const cust = await customerOf(req);
  if (!cust) return res.redirect('/arrive');
  const r = await db.prepare('SELECT id FROM reservations WHERE id = ? AND customer_id = ?').get(req.params.id, cust.id);
  if (!r) { req.session.flash = { error: 'Booking not found.' }; return res.redirect('/arrive'); }

  const result = await ck.performCheckIn(r.id, user.id, 'self');
  if (!result.ok) {
    if (result.code === 'already') return res.redirect(`/arrive/done/${r.id}`);
    const ctx = await ck.loadContext(r.id);
    req.session.flash = { error: guestReason({ ...ck.eligibility(ctx), code: result.code || 'status', reason: result.reason }) };
    return res.redirect('/arrive');
  }

  const ctx = await ck.loadContext(r.id);
  const s = ck.summary(ctx, ck.eligibility(ctx));
  await notifyReservationCustomer(r.id, 'reservation', 'Checked In',
    `Welcome! You're checked in for booking ${result.bookingRef}. Enjoy your stay!`, `/portal/my-reservations/${r.id}`);
  const staff = await db.prepare(`
    SELECT u.id FROM users u JOIN roles ro ON ro.id = u.role_id WHERE ro.name IN ('admin','staff') AND u.is_active = 1
  `).all();
  const what = s.items.length ? ` (${s.items.join(', ')})` : '';
  for (const st of staff) {
    await notifyStaff(st.id, 'reservation', 'Guest checked in',
      `${s.guest} checked in to ${result.bookingRef}${what} by scanning the front-desk QR.${s.balance > 0 ? ` Balance due: ₱${s.balance.toLocaleString('en-PH')}.` : ''}`,
      `/reservations/${r.id}`);
  }
  await req.audit('self_checkin', 'reservations', r.id, null, { checked_in_at: result.checkedInAt, method: 'self' });
  res.redirect(`/arrive/done/${r.id}`);
});

// Last: anything else after /arrive/ is a code from the resort QR.
router.get('/:code', async (req, res) => {
  const result = await arrival.check(req.params.code);
  if (!result.ok) return page(res, 'index', { state: 'invalid', reason: result.reason }, 410);
  arrival.grantPass(req.session);
  res.redirect('/arrive');
});

module.exports = router;
