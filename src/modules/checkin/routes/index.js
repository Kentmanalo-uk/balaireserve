/**
 * Check-in routes (front desk).
 *   GET  /checkin/desk              check-in desk: the resort QR guests scan (src/modules/arrive), today's
 *                                   arrivals, guests in-house, and check-in by booking ref
 *   GET  /checkin/desk/code         the live QR (SVG) and when it changes next (JSON)
 *   GET  /checkin/desk/lists        the arrivals / in-house lists alone (the desk page refreshes them)
 *   GET  /checkin/desk/poster       printable poster with the fixed QR
 *   POST /checkin/desk/settings     admin: poster on/off, retire old codes
 *   GET  /checkin/lookup?code=…     staff: booking ref (or an older booking QR) → booking summary (JSON)
 *   POST /checkin/booking/:id       staff: check the booking in (JSON for the desk page, or a redirect)
 *   GET  /checkin/:token …          booking QRs issued before guests checked themselves in: still open the
 *                                   booking for staff to confirm
 * Rules and the check-in itself: src/utils/checkin.js.
 */
'use strict';
const express = require('express');
const QRCode = require('qrcode');
const db = require('../../../config/database');
const { requireAuth, requireRole } = require('../../../middleware/auth');
const { renderQRPng, publicBaseUrl } = require('../../../utils/qrGenerator');
const { notifyReservationCustomer } = require('../../../utils/notifications');
const ck = require('../../../utils/checkin');
const arrival = require('../../../utils/arrivalCode');

const router = express.Router();
const STAFF = [requireAuth, requireRole('admin', 'staff')];

async function afterCheckIn(req, result, reservationId, method) {
  await notifyReservationCustomer(reservationId, 'reservation', 'Checked In',
    `Welcome! You're checked in for booking ${result.bookingRef}. Enjoy your stay!`, `/portal/my-reservations/${reservationId}`);
  await req.audit(method === 'qr' ? 'qr_checkin' : 'manual_checkin', 'reservations', reservationId, null, { checked_in_at: result.checkedInAt, method });
}

const arriveUrl = code => `${publicBaseUrl()}/arrive/${code}`;
const qrSvg = url => QRCode.toString(url, { type: 'svg', errorCorrectionLevel: 'M', margin: 1, color: { dark: '#10282c', light: '#ffffff' } });

async function deskLists() {
  const today = ck.resortNow().date;
  const arrivals = await db.prepare(`
    SELECT r.id, r.booking_ref, r.reservation_type, r.status, r.payment_status, r.num_guests,
           r.check_in_date, r.check_out_date, r.event_date, r.start_time, r.end_time,
           c.first_name, c.last_name,
           (SELECT GROUP_CONCAT(ri.item_name SEPARATOR ', ') FROM reservation_items ri WHERE ri.reservation_id = r.id) AS items
    FROM reservations r JOIN customers c ON c.id = r.customer_id
    WHERE COALESCE(r.check_in_date, r.event_date) = ? AND r.status IN ('pending','awaiting_payment','confirmed','pencil','on_hold')
    ORDER BY COALESCE(r.start_time, '99:99'), r.id
  `).all(today);
  const inHouse = await db.prepare(`
    SELECT r.id, r.booking_ref, r.reservation_type, r.payment_status, r.num_guests, r.total_amount,
           r.check_in_date, r.check_out_date, r.event_date, r.start_time, r.end_time,
           c.first_name, c.last_name,
           (SELECT GROUP_CONCAT(ri.item_name SEPARATOR ', ') FROM reservation_items ri WHERE ri.reservation_id = r.id) AS items,
           (SELECT ci.checked_in_at FROM check_ins ci WHERE ci.reservation_id = r.id ORDER BY ci.id DESC LIMIT 1) AS checked_in_at,
           (SELECT ci.method FROM check_ins ci WHERE ci.reservation_id = r.id ORDER BY ci.id DESC LIMIT 1) AS checkin_method
    FROM reservations r JOIN customers c ON c.id = r.customer_id
    WHERE r.status = 'checked_in'
    ORDER BY checked_in_at DESC
  `).all();
  const times = await db.prepare("SELECT `key`, value FROM settings WHERE `key` IN ('check_in_time','check_out_time')").all();
  const t = Object.fromEntries(times.map(x => [x.key, x.value]));
  return { arrivals, inHouse, today, checkOutTime: t.check_out_time || '12:00' };
}

// ── Check-in desk ────────────────────────────────────────────────────────────
router.get('/scan', (req, res) => res.redirect(301, '/checkin/desk'));

router.get('/desk', ...STAFF, async (req, res) => {
  const live = await arrival.liveCode();
  res.render('checkin/desk', {
    title: 'Check-in desk', layout: 'layouts/main', activeTab: 'checkin',
    ...(await deskLists()),
    qr: await qrSvg(arriveUrl(live.code)), refreshInMs: live.refreshInMs, windowMs: arrival.WINDOW_MS,
    mode: await arrival.mode(), isAdmin: req.session.user.role === 'admin',
  });
});

router.get('/desk/code', ...STAFF, async (req, res) => {
  const live = await arrival.liveCode();
  res.set('Cache-Control', 'no-store').json({ svg: await qrSvg(arriveUrl(live.code)), refreshInMs: live.refreshInMs });
});

router.get('/desk/lists', ...STAFF, async (req, res) => {
  res.set('Cache-Control', 'no-store').render('checkin/desk-lists', { layout: false, ...(await deskLists()) });
});

router.get('/desk/poster', ...STAFF, async (req, res) => {
  const mode = await arrival.mode();
  res.render('checkin/poster', {
    title: 'Check-in poster', layout: 'layouts/minimal', mode,
    qr: mode === 'poster' ? await qrSvg(arriveUrl(await arrival.posterCode())) : '',
  });
});

router.post('/desk/settings', requireAuth, requireRole('admin'), async (req, res) => {
  if (req.body.regenerate) {
    await arrival.regenerate();
    await req.audit('checkin_qr_regenerated', 'settings', null, null, null);
    req.session.flash = { success: 'New check-in codes made. Printed posters with the old code no longer work — print the new one.' };
  } else {
    const mode = req.body.mode === 'screen' ? 'screen' : 'poster';
    await arrival.setMode(mode);
    await req.audit('checkin_qr_mode', 'settings', null, null, { mode });
    req.session.flash = { success: mode === 'screen' ? 'Guests can now check in only from the QR on this screen.' : 'Guests can check in from the printed poster or this screen.' };
  }
  res.redirect('/checkin/desk');
});

// ── Check-in by booking ref ──────────────────────────────────────────────────
router.get('/lookup', ...STAFF, async (req, res) => {
  const found = await ck.findByCode(req.query.code);
  if (!found) return res.status(404).json({ found: false, reason: 'No booking matches that reference (e.g. BK-2026-0026).' });
  const ctx = await ck.loadContext(found.reservationId);
  if (!ctx) return res.status(404).json({ found: false, reason: 'Booking not found.' });
  res.json({ found: true, via: found.via, booking: ck.summary(ctx, ck.eligibility(ctx)) });
});

router.post('/booking/:id', ...STAFF, async (req, res) => {
  const wantsJson = /json/.test(req.get('Accept') || '');
  const method = req.body && req.body.method === 'qr' ? 'qr' : 'manual';
  const id = Number(req.params.id);
  const result = Number.isInteger(id) ? await ck.performCheckIn(id, req.session.user.id, method) : { ok: false, reason: 'Booking not found.' };
  if (result.ok) await afterCheckIn(req, result, id, method);
  if (wantsJson) {
    const ctx = result.ok ? await ck.loadContext(id) : null;
    return res.status(result.ok ? 200 : 409).json(result.ok ? { ok: true, booking: ck.summary(ctx, ck.eligibility(ctx)) } : result);
  }
  req.session.flash = result.ok ? { success: `Checked in ${result.bookingRef}.` } : { error: result.reason };
  res.redirect(`/reservations/${id}`);
});

// ── Older booking QRs ────────────────────────────────────────────────────────
router.get('/:token/qr.png', async (req, res) => {
  const qr = await db.prepare('SELECT id FROM qr_codes WHERE token = ?').get(req.params.token);
  if (!qr) return res.status(404).end();
  res.type('png').set('Cache-Control', 'no-store').send(await renderQRPng(req.params.token));
});

async function qrPage(req, res) {
  const found = await ck.findByCode(req.params.token);
  const invalid = reason => res.status(404).render('guests/checkin-invalid', { title: 'Invalid QR Code', layout: 'layouts/minimal', reason });
  if (!found) return invalid('This QR code isn’t recognised.');
  const ctx = await ck.loadContext(found.reservationId);
  if (!ctx) return invalid('This QR code isn’t recognised.');
  const role = req.session?.user?.role;
  const isStaff = role === 'admin' || role === 'staff';
  const el = ck.eligibility(ctx);
  const used = ctx.qr && ctx.qr.token === found.token && ctx.qr.used && !['checked_in', 'completed'].includes(ctx.reservation.status);
  if (!isStaff && (used || ['finished', 'status', 'refunded'].includes(el.code))) return invalid(used ? 'This QR code was already used.' : el.reason);
  res.render('guests/checkin-scan', {
    title: 'QR Check-in', layout: 'layouts/minimal',
    reservation: ctx.reservation, ctx, el: used ? { ...el, ok: false, code: 'used', reason: 'This QR code was already used or cancelled.' } : el,
    summary: ck.summary(ctx, el), token: req.params.token, isStaff, isLoggedIn: !!role,
  });
}
router.get('/:token', qrPage);
router.get('/:token/staff', requireAuth, (req, res) => res.redirect(`/checkin/${req.params.token}`));

router.post('/:token', ...STAFF, async (req, res) => {
  const found = await ck.findByCode(req.params.token);
  if (!found) return res.status(404).render('guests/checkin-invalid', { title: 'Invalid QR Code', layout: 'layouts/minimal', reason: 'This QR code isn’t recognised.' });
  const result = await ck.performCheckIn(found.reservationId, req.session.user.id, 'qr');
  if (!result.ok) return res.status(409).render('guests/checkin-invalid', { title: 'Can’t check in', layout: 'layouts/minimal', reason: result.reason });
  await afterCheckIn(req, result, found.reservationId, 'qr');
  const ctx = await ck.loadContext(found.reservationId);
  res.render('guests/checkin-success', {
    title: 'Check-in Successful', layout: 'layouts/minimal', reservationId: found.reservationId, bookingRef: result.bookingRef,
    summary: ck.summary(ctx, ck.eligibility(ctx)), warnings: result.warnings || [],
  });
});

module.exports = router;
