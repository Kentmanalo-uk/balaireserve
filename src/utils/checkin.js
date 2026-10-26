/**
 * Guest check-in: one set of rules and one routine for every way a guest is checked in
 * (the guest scans the resort's QR at the front desk — src/modules/arrive — or staff check them in
 * by booking ref, or staff open an older booking QR).
 *
 * A booking can be checked in when:
 *   - it is pending, awaiting payment or confirmed (pencil / on-hold bookings must be confirmed first),
 *   - at least the downpayment has been received (verified online proofs, or payments staff recorded),
 *   - today (resort time, UTC+8) is within the booking's dates: from the first day to the last day.
 * Arriving before the usual check-in time on the right day is allowed and shown as a warning.
 *
 * Checking in stores the time-in (check_ins.checked_in_at), marks the booked place occupied, sets the
 * guest and booking to checked in, uses up the booking's QR codes, and writes the status history.
 */
'use strict';
const db = require('../config/database');

const CHECKIN_STATUSES = ['pending', 'awaiting_payment', 'confirmed'];
const RESOURCE_TABLES = { room: 'rooms', venue: 'venues', cottage: 'cottages' };
const TOKEN = /\/checkin\/([0-9a-f-]{36})(?:[/?#]|$)|^([0-9a-f-]{36})$/i;
const BOOKING_REF = /^[A-Z]{2,4}-\d{4}-\d{3,6}$/i;
const HISTORY_NOTE = {
  self: 'Guest checked in by scanning the resort QR',
  qr: 'Checked in via QR scan',
  manual: 'Checked in at the front desk',
};

// Resort clock (Philippines, UTC+8, no daylight saving).
function resortNow(at = new Date()) {
  const t = new Date(at.getTime() + 8 * 3600000).toISOString();
  return { date: t.slice(0, 10), time: t.slice(11, 16), iso: t };
}
const ymd = v => (v instanceof Date ? new Date(v.getTime() + 8 * 3600000).toISOString().slice(0, 10) : String(v || '').slice(0, 10));
const hhmm = v => (String(v || '').match(/^(\d{1,2}):(\d{2})/) || []).slice(1).map(x => x.padStart(2, '0')).join(':');

async function settingTimes() {
  const rows = await db.prepare("SELECT `key`, value FROM settings WHERE `key` IN ('check_in_time','check_out_time')").all();
  const s = Object.fromEntries(rows.map(r => [r.key, r.value]));
  return { checkIn: hhmm(s.check_in_time) || '14:00', checkOut: hhmm(s.check_out_time) || '12:00' };
}

// The booking's first and last day, and when the stay starts and must end.
function schedule(r, times) {
  const start = ymd(r.check_in_date || r.event_date);
  const end = ymd(r.check_out_date || r.event_date || r.check_in_date) || start;
  const isRoom = r.reservation_type === 'room';
  return {
    startDate: start,
    endDate: end < start ? start : end,
    startTime: isRoom ? times.checkIn : (hhmm(r.start_time) || null),
    endTime: isRoom ? times.checkOut : (hhmm(r.end_time) || null),
  };
}

// Money that counts at the desk: verified payments, or payments staff recorded themselves.
async function paidSoFar(reservationId) {
  const row = await db.prepare(`
    SELECT COALESCE(SUM(amount), 0) AS paid FROM payments
    WHERE reservation_id = ? AND payment_type <> 'refund'
      AND (status = 'verified' OR (status = 'received' AND COALESCE(submitted_by, 'staff') <> 'customer'))
  `).get(reservationId);
  return Number(row.paid) || 0;
}

// Everything the scanner and the check-in pages show about one booking.
async function loadContext(reservationId) {
  const r = await db.prepare(`
    SELECT r.*, c.first_name, c.last_name, c.phone, c.email, c.customer_code
    FROM reservations r JOIN customers c ON c.id = r.customer_id WHERE r.id = ?
  `).get(reservationId);
  if (!r) return null;
  const items = await db.prepare('SELECT item_type, item_id, item_name FROM reservation_items WHERE reservation_id = ? ORDER BY id').all(r.id);
  const checkIn = await db.prepare(`
    SELECT ci.checked_in_at, ci.method, u.first_name AS by_first, u.last_name AS by_last
    FROM check_ins ci LEFT JOIN users u ON u.id = ci.checked_in_by
    WHERE ci.reservation_id = ? ORDER BY ci.id DESC LIMIT 1
  `).get(r.id);
  const checkOut = await db.prepare('SELECT checked_out_at FROM check_outs WHERE reservation_id = ? ORDER BY id DESC LIMIT 1').get(r.id);
  const qr = await db.prepare('SELECT token, used, used_at FROM qr_codes WHERE reservation_id = ? ORDER BY id DESC LIMIT 1').get(r.id);
  const times = await settingTimes();
  const paid = await paidSoFar(r.id);
  return { reservation: r, items, checkIn, checkOut, qr, times, schedule: schedule(r, times), paid };
}

/**
 * Can this booking be checked in now? → { ok, code, reason, warnings[], balance, downpaymentShort }
 * code: ok | already | finished | held | status | refunded | unpaid | early | past
 */
function eligibility(ctx, at = new Date()) {
  const r = ctx.reservation, now = resortNow(at), sch = ctx.schedule;
  const total = Number(r.total_amount) || 0;
  const balance = Math.max(0, Math.round((total - ctx.paid) * 100) / 100);
  const dpNeeded = Number(r.downpayment_req) || 0;
  const base = { balance, paid: ctx.paid, total, downpayment: dpNeeded, warnings: [] };
  const fmt = d => new Date(d + 'T00:00:00Z').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });

  if (r.status === 'checked_in') return { ...base, ok: false, code: 'already', reason: 'This guest is already checked in.' };
  if (['completed', 'checked_out'].includes(r.status)) return { ...base, ok: false, code: 'finished', reason: 'This booking is already completed.' };
  if (['cancelled', 'rejected', 'no_show'].includes(r.status)) return { ...base, ok: false, code: 'status', reason: `This booking was ${r.status.replace('_', '-')} and can't be checked in.` };
  if (r.payment_status === 'refunded') return { ...base, ok: false, code: 'refunded', reason: 'This booking was refunded and can’t be checked in.' };
  if (['pencil', 'on_hold'].includes(r.status)) return { ...base, ok: false, code: 'held', reason: `This is ${r.status === 'pencil' ? 'a pencil booking' : 'on hold'}. Confirm the booking first, then check the guest in.` };
  if (!CHECKIN_STATUSES.includes(r.status)) return { ...base, ok: false, code: 'status', reason: 'This booking can’t be checked in in its current status.' };
  if (sch.startDate && now.date < sch.startDate) return { ...base, ok: false, code: 'early', reason: `This booking starts on ${fmt(sch.startDate)}. Check-in opens that day.` };
  if (sch.endDate && now.date > sch.endDate) return { ...base, ok: false, code: 'past', reason: `This booking ended on ${fmt(sch.endDate)}.` };
  if (dpNeeded > 0 && ctx.paid + 0.004 < dpNeeded) {
    return { ...base, ok: false, code: 'unpaid', downpaymentShort: Math.round((dpNeeded - ctx.paid) * 100) / 100,
      reason: `The downpayment isn’t paid yet (₱${dpNeeded.toLocaleString('en-PH')} needed, ₱${ctx.paid.toLocaleString('en-PH')} received). Record the payment first.` };
  }
  const warnings = [];
  if (now.date === sch.startDate && sch.startTime && now.time < sch.startTime) warnings.push(`Early arrival: the usual time-in is ${time12(sch.startTime)}.`);
  if (balance > 0) warnings.push(`Balance still due: ₱${balance.toLocaleString('en-PH', { minimumFractionDigits: 2 })}. Collect it before check-out.`);
  return { ...base, ok: true, code: 'ok', reason: '', warnings };
}

// DATETIME values come back as UTC text ('YYYY-MM-DD HH:MM:SS', the DB session runs in UTC) → ISO with Z.
const utcIso = v => (!v ? null : v instanceof Date ? v.toISOString() : String(v).replace(' ', 'T') + (/[zZ]|[+-]\d\d:?\d\d$/.test(String(v)) ? '' : 'Z'));

function time12(t) { const m = /^(\d{2}):(\d{2})$/.exec(t || ''); if (!m) return t || ''; const h = +m[1]; return `${h % 12 || 12}:${m[2]} ${h >= 12 ? 'PM' : 'AM'}`; }

// When the guest is due out (resort time), as 'YYYY-MM-DDTHH:MM' (+08:00 implied), or null.
function dueOut(ctx) {
  const s = ctx.schedule;
  return s.endDate && s.endTime ? `${s.endDate}T${s.endTime}` : null;
}

// What staff typed or the camera read → { reservationId, token } (or null). Accepts the QR link,
// the bare QR token, or a booking reference like BK-2026-0026.
async function findByCode(code) {
  const raw = String(code || '').trim();
  if (!raw) return null;
  const m = TOKEN.exec(raw);
  if (m) {
    const token = (m[1] || m[2]).toLowerCase();
    const qr = await db.prepare('SELECT reservation_id, token FROM qr_codes WHERE token = ?').get(token);
    return qr ? { reservationId: qr.reservation_id, token: qr.token, via: 'qr' } : null;
  }
  if (BOOKING_REF.test(raw)) {
    const r = await db.prepare('SELECT id FROM reservations WHERE booking_ref = ?').get(raw.toUpperCase());
    return r ? { reservationId: r.id, token: null, via: 'ref' } : null;
  }
  return null;
}

/**
 * Check the guest in. Re-checks the rules inside the transaction (two staff scanning the same QR at once:
 * only one succeeds). method: 'self' (guest scanned the resort QR) | 'qr' | 'manual'. Returns { ok, reason?, checkedInAt? }.
 */
async function performCheckIn(reservationId, userId, method = 'qr', notes = '') {
  return db.transaction(async () => {
    const ctx = await loadContext(reservationId);
    if (!ctx) return { ok: false, reason: 'Booking not found.' };
    const el = eligibility(ctx);
    if (!el.ok) return { ok: false, code: el.code, reason: el.reason };
    // Claim the booking: only one concurrent request can move it to checked_in.
    const claimed = await db.prepare(
      `UPDATE reservations SET status = 'checked_in', updated_at = NOW() WHERE id = ? AND status = ?`
    ).run(reservationId, ctx.reservation.status);
    if (!claimed.changes) return { ok: false, code: 'already', reason: 'This guest was just checked in by someone else.' };
    await db.prepare(`UPDATE qr_codes SET used = 1, used_at = NOW() WHERE reservation_id = ? AND used = 0`).run(reservationId);
    await db.prepare(`
      INSERT INTO reservation_status_history (reservation_id, from_status, to_status, changed_by, notes)
      VALUES (?, ?, 'checked_in', ?, ?)
    `).run(reservationId, ctx.reservation.status, userId, HISTORY_NOTE[method] || HISTORY_NOTE.manual);
    for (const it of ctx.items) {
      const table = RESOURCE_TABLES[it.item_type];
      if (table) await db.prepare(`UPDATE ${table} SET status = 'occupied', updated_at = NOW() WHERE id = ?`).run(it.item_id);
    }
    await db.prepare(`INSERT INTO check_ins (reservation_id, method, checked_in_by, notes) VALUES (?, ?, ?, ?)`)
      .run(reservationId, method, userId, notes || null);
    await db.prepare(`UPDATE guests SET status = 'checked_in', updated_at = NOW() WHERE reservation_id = ?`).run(reservationId);
    const row = await db.prepare('SELECT checked_in_at FROM check_ins WHERE reservation_id = ? ORDER BY id DESC LIMIT 1').get(reservationId);
    return { ok: true, checkedInAt: row && row.checked_in_at, bookingRef: ctx.reservation.booking_ref, warnings: el.warnings };
  });
}

// A compact, display-ready summary for the scanner (JSON).
function summary(ctx, el) {
  const r = ctx.reservation;
  return {
    id: r.id, ref: r.booking_ref, type: r.reservation_type, status: r.status, paymentStatus: r.payment_status,
    guest: `${r.first_name} ${r.last_name}`.trim(), phone: r.phone || '', guests: r.num_guests,
    items: ctx.items.map(i => i.item_name).filter(Boolean),
    startDate: ctx.schedule.startDate, endDate: ctx.schedule.endDate, startTime: ctx.schedule.startTime, endTime: ctx.schedule.endTime,
    dueOut: dueOut(ctx),
    checkedInAt: ctx.checkIn ? utcIso(ctx.checkIn.checked_in_at) : null,          // ISO (for scripts)
    checkedInAtDb: ctx.checkIn ? ctx.checkIn.checked_in_at : null,                 // DB text (for formatDateTime in templates)
    checkInMethod: ctx.checkIn ? ctx.checkIn.method : null,
    checkedInBy: ctx.checkIn && ctx.checkIn.by_first ? `${ctx.checkIn.by_first} ${ctx.checkIn.by_last || ''}`.trim() : null,
    total: el.total, paid: el.paid, balance: el.balance, downpayment: el.downpayment,
    canCheckIn: el.ok, code: el.code, reason: el.reason, warnings: el.warnings,
  };
}

module.exports = { utcIso, resortNow, loadContext, eligibility, performCheckIn, findByCode, summary, dueOut, time12, CHECKIN_STATUSES };
