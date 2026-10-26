/**
 * Reservation Management Routes
 */
'use strict';

const express = require('express');
const { body, validationResult } = require('express-validator');
const db      = require('../../../config/database');
const { requireAuth, requireRole } = require('../../../middleware/auth');
const { generateBookingRef, generateCustomerCode } = require('../../../utils/bookingRef');
const { generateReservationQR }    = require('../../../utils/qrGenerator');
const { verifyPayment }            = require('../../../utils/paymentVerification');
const { notifyStaff, notifyCustomer, notifyAllAdmins, notifyReservationCustomer } = require('../../../utils/notifications');
const { FINAL_RESERVATION_STATUSES } = require('../../../utils/reservationAvailability');
const { statusLabel, formatDate } = require('../../../xianfire/helpers');

const router = express.Router();

// Every status a reservation can be in. pencil / on_hold are active (their dates
// stay blocked) but wait for an admin decision before moving on.
const ALL_STATUSES = ['pending','pencil','on_hold','awaiting_payment','confirmed','checked_in','completed','cancelled','rejected','no_show'];
const STAFF_PAYMENT_METHODS = ['cash','gcash','maya','bank_transfer'];
const NOTES_MAX_LENGTH = 5000;

// Today's date at the resort (Philippines, UTC+8) as 'YYYY-MM-DD'.
const resortToday = () => new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10);

// Reservations in these statuses no longer hold their resource.
const RELEASED_STATUS_SQL = [...FINAL_RESERVATION_STATUSES].map(s => `'${s}'`).join(',');

const RESOURCE_TABLES = { room: 'rooms', cottage: 'cottages', venue: 'venues' };

// Duplicated form fields arrive as arrays — take the first non-empty value.
function field(value) {
  if (Array.isArray(value)) value = value.find(v => typeof v === 'string' && v.trim() !== '') || '';
  return typeof value === 'string' ? value.trim() : '';
}

// Internal notes are kept as typed. Browsers submit textarea newlines as \r\n,
// which would count twice against the 5000-character limit, so use \n.
function normalizeNotes(value) {
  if (Array.isArray(value)) value = value[0];
  return String(value ?? '').replace(/\r\n?/g, '\n').replace(/\s+$/, '');
}

function isValidDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && !isNaN(Date.parse(value));
}

function isValidTime(value) {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
}

function localDate(date = new Date()) {
  const y = date.getFullYear(), m = String(date.getMonth() + 1).padStart(2, '0'), d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function peso(amount) {
  return '₱' + Number(amount || 0).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/**
 * Validate a reservation schedule. Rooms need check-out after check-in; cottages,
 * venues and events may start and end on the same day, in which case the
 * time-out must be after the time-in. Returns a list of { msg } errors.
 */
function validateSchedule(type, s) {
  const errors = [];
  if (!s.check_in_date)                    errors.push({ msg: 'Check-in date is required.' });
  else if (!isValidDate(s.check_in_date))  errors.push({ msg: 'Check-in date is invalid.' });
  if (!s.check_out_date)                   errors.push({ msg: 'Check-out date is required.' });
  else if (!isValidDate(s.check_out_date)) errors.push({ msg: 'Check-out date is invalid.' });
  if (s.start_time && !isValidTime(s.start_time)) errors.push({ msg: 'Time-in is invalid.' });
  if (s.end_time && !isValidTime(s.end_time))     errors.push({ msg: 'Time-out is invalid.' });
  if (errors.length) return errors;

  if (type === 'room') {
    if (s.check_out_date <= s.check_in_date) errors.push({ msg: 'Check-out date must be after the check-in date for rooms.' });
  } else if (s.check_out_date < s.check_in_date) {
    errors.push({ msg: 'Check-out date cannot be before the check-in date.' });
  } else if (s.check_out_date === s.check_in_date && s.start_time && s.end_time && s.end_time <= s.start_time) {
    errors.push({ msg: 'Time-out must be after time-in for a same-day booking.' });
  }
  return errors;
}

// [start, end) of a booking as comparable 'YYYY-MM-DD HH:MM' strings. Missing
// times mean the whole day; older venue rows only carry event_date.
function bookingWindow(row) {
  const startDate = String(row.check_in_date || row.event_date || '').slice(0, 10);
  if (!startDate) return null;
  const endDate   = String(row.check_out_date || startDate).slice(0, 10);
  const startTime = (!row.whole_day && String(row.start_time || '').slice(0, 5)) || '00:00';
  const endTime   = (!row.whole_day && String(row.end_time || '').slice(0, 5)) || '24:00';
  return { start: `${startDate} ${startTime}`, end: `${endDate} ${endTime}` };
}

function schedulesOverlap(itemType, existing, requested) {
  if (itemType === 'room') {
    // Nightly: a check-out day can be the next guest's check-in day.
    return Boolean(
      existing.check_in_date && existing.check_out_date &&
      existing.check_in_date < requested.check_out_date &&
      existing.check_out_date > requested.check_in_date
    );
  }
  const a = bookingWindow(existing);
  const b = bookingWindow(requested);
  return Boolean(a && b && a.start < b.end && a.end > b.start);
}

/**
 * First active reservation (pending, pencil, on_hold, confirmed, ...) that holds
 * the same room / cottage / venue during the requested schedule, or null.
 */
async function findBookingConflict(itemType, itemId, requested, excludeReservationId = 0) {
  const rows = await db.prepare(`
    SELECT r.id, r.booking_ref, r.check_in_date, r.check_out_date, r.event_date, r.start_time, r.end_time
    FROM reservation_items ri
    JOIN reservations r ON r.id = ri.reservation_id
    WHERE ri.item_type = ? AND ri.item_id = ? AND r.id <> ?
      AND r.status NOT IN (${RELEASED_STATUS_SQL})
  `).all(itemType, itemId, excludeReservationId || 0);
  return rows.find(row => schedulesOverlap(itemType, row, requested)) || null;
}

// Umbrella tables are booked for the whole day, whatever times are entered.
async function isWholeDayItem(itemType, itemId) {
  if (itemType !== 'cottage') return false;
  const row = await db.prepare(`SELECT name FROM cottages WHERE id = ?`).get(itemId);
  return (row?.name || '').trim().toLowerCase() === 'umbrella table';
}

function paymentStatusFor(totalPaid, totalAmount) {
  if (totalPaid <= 0 && totalAmount > 0) return 'unpaid';
  if (totalPaid >= totalAmount) return 'fully_paid';
  return 'partially_paid';
}

async function amountPaidFor(reservationId) {
  return (await db.prepare(
    "SELECT COALESCE(SUM(amount),0) AS t FROM payments WHERE reservation_id = ? AND status IN ('received','verified')"
  ).get(reservationId)).t;
}

/**
 * Insert a staff-received payment, then recalculate payment_status and move a
 * pending / awaiting_payment booking along (confirmed once fully paid).
 */
async function recordStaffPayment(reservationId, { amount, method, date, type, notes }, userId) {
  return db.transaction(async () => {
    const resRow = await db.prepare(`SELECT status, total_amount FROM reservations WHERE id=?`).get(reservationId);
    const refNum = `PAY-${Date.now()}`;
    await db.prepare(`
      INSERT INTO payments (reservation_id, reference_number, amount, payment_method, payment_date, payment_type, status, received_by, notes, submitted_by)
      VALUES (?, ?, ?, ?, ?, ?, 'received', ?, ?, 'staff')
    `).run(reservationId, refNum, amount, method || 'cash', date || resortToday(), type || 'balance', userId, notes || '');

    // Recalculate payment status (count received + verified toward the balance)
    const totalPaid = await amountPaidFor(reservationId);
    let payStatus = 'partially_paid';
    if (totalPaid >= resRow.total_amount && resRow.total_amount > 0) payStatus = 'fully_paid';

    let newStatus = resRow.status;
    if (resRow.status === 'pending' || resRow.status === 'awaiting_payment') {
      newStatus = payStatus === 'fully_paid' ? 'confirmed' : 'awaiting_payment';
    }

    await db.prepare(`UPDATE reservations SET payment_status=?, status=?, updated_at=NOW() WHERE id=?`).run(payStatus, newStatus, reservationId);
    if (newStatus !== resRow.status) {
      await db.prepare(`INSERT INTO reservation_status_history (reservation_id, from_status, to_status, changed_by, notes) VALUES (?,?,?,?,?)`).run(reservationId, resRow.status, newStatus, userId, 'Auto-updated after payment');
    }
    return { payStatus, newStatus, refNum };
  });
}

// Walk-in guest → customer record. Reuses an existing customer only when the name matches AND the
// email or mobile number matches (so two guests sharing a name are never merged); otherwise adds one.
async function findOrCreateWalkInCustomer(f, code) {
  const digits = v => String(v || '').replace(/\D/g, '').slice(-10);
  const email = f.guest_email.toLowerCase(), phone = digits(f.guest_phone);
  if (email || phone) {
    const sameName = await db.prepare(
      `SELECT id, first_name, last_name, email, phone FROM customers
       WHERE LOWER(TRIM(first_name)) = ? AND LOWER(TRIM(last_name)) = ? AND status <> 'blacklisted' ORDER BY id`
    ).all(f.guest_first_name.toLowerCase(), f.guest_last_name.toLowerCase());
    const hit = sameName.find(c => (email && String(c.email || '').toLowerCase() === email) || (phone.length >= 7 && digits(c.phone) === phone));
    if (hit) return hit;
  }
  const id = (await db.prepare(`
    INSERT INTO customers (customer_code, first_name, last_name, email, phone, preferred_contact, customer_type, notes)
    VALUES (?, ?, ?, ?, ?, ?, 'regular', 'Added from a walk-in reservation.')
  `).run(code, f.guest_first_name, f.guest_last_name, f.guest_email || '', f.guest_phone || '', f.guest_phone ? 'phone' : 'email')).lastInsertRowid;
  return { id, first_name: f.guest_first_name, last_name: f.guest_last_name, email: f.guest_email || '', phone: f.guest_phone || '' };
}

// Walk-in form fields, normalised (also used as `old` when re-rendering).
function readWalkInForm(body) {
  const f = {};
  for (const key of ['customer_id','guest_first_name','guest_last_name','guest_phone','guest_email','reservation_type','room_id','cottage_id','venue_id','package_id',
    'check_in_date','check_out_date','start_time','end_time','num_guests','payment_method',
    'total_amount','downpayment_req','payment_now','initial_status','special_requests']) {
    f[key] = field(body[key]);
  }
  f.notes = normalizeNotes(body.notes);
  f.source = 'walk_in';
  if (!STAFF_PAYMENT_METHODS.includes(f.payment_method)) f.payment_method = 'cash';
  if (!['pending','pencil'].includes(f.initial_status)) f.initial_status = 'pending';
  return f;
}

async function downpaymentPercent() {
  const row = await db.prepare("SELECT value FROM settings WHERE `key` = 'downpayment_percent'").get();
  const percent = Number.parseFloat(row?.value || '50');
  return Number.isFinite(percent) && percent >= 0 && percent <= 100 ? percent : 50;
}

async function renderWalkInForm(res, { old = {}, errors = [] } = {}) {
  // Opened from a customer's profile ("New reservation"): book for that customer.
  const linkedCustomer = /^\d+$/.test(old.customer_id || '')
    ? (await db.prepare(`SELECT id, customer_code, first_name, last_name, email, phone FROM customers WHERE id = ?`).get(old.customer_id)) || null
    : null;
  if (linkedCustomer) {
    old.guest_first_name = linkedCustomer.first_name; old.guest_last_name = linkedCustomer.last_name;
    old.guest_phone = linkedCustomer.phone || ''; old.guest_email = linkedCustomer.email || '';
  }
  const rooms     = await db.prepare(`SELECT * FROM rooms WHERE is_active = 1 ORDER BY room_number`).all();
  const cottages  = await db.prepare(`SELECT * FROM cottages WHERE is_active = 1 ORDER BY name, id`).all();
  const venues    = await db.prepare(`SELECT * FROM venues WHERE is_active = 1 ORDER BY name, id`).all();
  const packages  = await db.prepare(`SELECT * FROM event_packages WHERE is_active = 1 ORDER BY name, id`).all();
  res.render('reservations/form', {
    title: 'New Reservation',
    layout: 'layouts/main',
    reservation: null, linkedCustomer, rooms, cottages, venues, packages,
    paymentMethods: STAFF_PAYMENT_METHODS,
    downpaymentPercent: await downpaymentPercent(),
    errors, old,
  });
}

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
           c.phone AS customer_phone,
           (SELECT GROUP_CONCAT(ri.item_name ORDER BY ri.id SEPARATOR ', ')
              FROM reservation_items ri
             WHERE ri.reservation_id = r.id
               AND ri.item_type IN ('room','cottage','venue','event_package')) AS items
    FROM reservations r
    JOIN customers c ON c.id = r.customer_id
    ${where}
    ORDER BY r.created_at DESC
    LIMIT ? OFFSET ?
  `).all(...params, limit, offset);

  // 'completed' kept in the filter list so staff can still search/view completed reservations,
  // but it is not offered as a manual status transition (checkout uses the Guest Check Out button).
  const statuses = ALL_STATUSES;
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
  const customerId = /^\d+$/.test(String(req.query.customer_id || '')) ? String(req.query.customer_id) : '';
  await renderWalkInForm(res, { old: { customer_id: customerId, num_guests: '1', payment_method: 'cash', initial_status: 'pending', source: 'walk_in' } });
});

// POST /reservations — walk-in booking entered by staff at the front desk.
// On any problem the form is re-rendered with the entered values.
router.post('/', requireAuth, requireRole('admin','staff'), async (req, res) => {
  const f      = readWalkInForm(req.body);
  const type   = f.reservation_type;
  const errors = [];
  const fail   = (list) => renderWalkInForm(res, { old: f, errors: list });

  // Guest: the customer from a profile link, or the details typed at the desk.
  let customer = /^\d+$/.test(f.customer_id)
    ? await db.prepare(`SELECT id, first_name, last_name, email, phone FROM customers WHERE id = ?`).get(f.customer_id)
    : null;
  if (!customer) {
    if (!f.guest_first_name) errors.push({ msg: "Enter the guest's first name." });
    if (!f.guest_last_name) errors.push({ msg: "Enter the guest's last name." });
    if (f.guest_first_name.length > 100 || f.guest_last_name.length > 100) errors.push({ msg: 'Names can be at most 100 characters.' });
    if (f.guest_email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(f.guest_email)) errors.push({ msg: 'Enter a valid email address, or leave it empty.' });
    if (f.guest_phone.length > 50) errors.push({ msg: 'The mobile number is too long.' });
  }
  if (!['room','cottage','venue','event'].includes(type)) errors.push({ msg: 'Select a reservation type.' });

  // No upper limit and no capacity check for staff bookings.
  if (!/^\d+$/.test(f.num_guests) || Number(f.num_guests) < 1) errors.push({ msg: 'Number of guests must be a whole number of at least 1.' });

  // ── Selected room / cottage / venue and event package ──
  const activeRow = async (table, id) => /^\d+$/.test(id)
    ? (await db.prepare(`SELECT * FROM ${table} WHERE id = ? AND is_active = 1`).get(id)) || null
    : null;
  let resource = null, resourceType = null, pkg = null;
  if (type === 'room') {
    resourceType = 'room';
    resource = await activeRow('rooms', f.room_id);
    if (!resource) errors.push({ msg: 'Select a room.' });
  } else if (type === 'cottage') {
    resourceType = 'cottage';
    resource = await activeRow('cottages', f.cottage_id);
    if (!resource) errors.push({ msg: 'Select a cottage.' });
  } else if (type === 'venue' || type === 'event') {
    resourceType = 'venue';
    resource = await activeRow('venues', f.venue_id);
    if (type === 'venue' && !resource) errors.push({ msg: 'Select a venue.' });
    if (type === 'event' && f.venue_id && !resource) errors.push({ msg: 'The selected venue is no longer available.' });
    pkg = await activeRow('event_packages', f.package_id);
    if (type === 'event' && !pkg) errors.push({ msg: 'Select an event package.' });
    if (type === 'venue' && f.package_id && !pkg) errors.push({ msg: 'The selected event package is no longer available.' });
  }

  if (type) errors.push(...validateSchedule(type, f));

  // ── Pricing (staff may overwrite the auto-filled amounts) ──
  const total = Number(f.total_amount);
  if (!f.total_amount || !Number.isFinite(total) || total <= 0) errors.push({ msg: 'Total amount must be greater than zero.' });
  const downpayment = f.downpayment_req === ''
    ? (Number.isFinite(total) ? Math.ceil(total * (await downpaymentPercent()) / 100) : 0)
    : Number(f.downpayment_req);
  if (!Number.isFinite(downpayment) || downpayment < 0) errors.push({ msg: 'Downpayment must be zero or more.' });
  else if (Number.isFinite(total) && downpayment > total) errors.push({ msg: 'Downpayment cannot be more than the total amount.' });
  const paymentNow = f.payment_now === '' ? 0 : Number(f.payment_now);
  if (!Number.isFinite(paymentNow) || paymentNow < 0) errors.push({ msg: 'Payment received must be zero or more.' });
  else if (Number.isFinite(total) && paymentNow > total) errors.push({ msg: 'Payment received cannot be more than the total amount.' });
  if (f.notes.length > NOTES_MAX_LENGTH) errors.push({ msg: `Notes can be at most ${NOTES_MAX_LENGTH} characters.` });

  if (errors.length) return fail(errors);

  const isVenueType = type === 'venue' || type === 'event';
  const schedule = {
    check_in_date:  f.check_in_date,
    check_out_date: f.check_out_date,
    start_time:     f.start_time || null,
    end_time:       f.end_time || null,
  };
  const bookingRef = await generateBookingRef();

  const newCustomerCode = customer ? null : await generateCustomerCode();

  const result = await db.transaction(async () => {
    // Prevent double booking (pending, pencil, on-hold, confirmed ... all block).
    if (resource) {
      const requested = { ...schedule, whole_day: await isWholeDayItem(resourceType, resource.id) };
      const conflict = await findBookingConflict(resourceType, resource.id, requested);
      if (conflict) return { error: `This ${resourceType} is already booked (${conflict.booking_ref}) for the selected dates and times.` };
    }
    // Only once the booking can go ahead, so a refused booking never leaves a new customer behind.
    if (!customer) customer = await findOrCreateWalkInCustomer(f, newCustomerCode);

    const resId = (await db.prepare(`
      INSERT INTO reservations
        (booking_ref, customer_id, reservation_type, check_in_date, check_out_date,
         event_date, start_time, end_time, num_guests, special_requests,
         total_amount, downpayment_req, status, payment_status, notes, source, payment_method)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'unpaid', ?, 'walk_in', ?)
    `).run(
      bookingRef, customer.id, type,
      schedule.check_in_date, schedule.check_out_date,
      isVenueType ? schedule.check_in_date : null,
      schedule.start_time, schedule.end_time,
      Number(f.num_guests), f.special_requests || '',
      total, downpayment, f.initial_status,
      f.notes || '', f.payment_method
    )).lastInsertRowid;

    // Guest record, as online bookings get — check-out works through it.
    await db.prepare(`
      INSERT INTO guests (reservation_id, customer_id, first_name, last_name, email, phone, num_guests, special_requests, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'expected')
    `).run(resId, customer.id, customer.first_name || '', customer.last_name || '', customer.email || null,
      customer.phone || null, Number(f.num_guests), f.special_requests || null);

    // Booked items — a single item carries the whole total; with a venue plus a
    // package each line keeps its own list price.
    const singleItem = !(resource && pkg);
    if (resource) {
      await db.prepare(`INSERT INTO reservation_items (reservation_id, item_type, item_id, item_name, quantity, unit_price, total_price) VALUES (?,?,?,?,1,?,?)`)
        .run(resId, resourceType, resource.id, resource.name || '', resource.price || 0, singleItem ? total : (resource.price || 0));
      // Mark the resource reserved so it stops showing as available while the booking is active.
      await db.prepare(`UPDATE ${RESOURCE_TABLES[resourceType]} SET status='reserved', updated_at=NOW() WHERE id=? AND status IN ('available','reserved')`).run(resource.id);
    }
    if (pkg) {
      await db.prepare(`INSERT INTO reservation_items (reservation_id, item_type, item_id, item_name, quantity, unit_price, total_price) VALUES (?,?,?,?,1,?,?)`)
        .run(resId, 'event_package', pkg.id, pkg.name || '', pkg.price || 0, singleItem ? total : (pkg.price || 0));
    }

    // Status history
    await db.prepare(`INSERT INTO reservation_status_history (reservation_id, from_status, to_status, changed_by, notes) VALUES (?,null,?,?,?)`)
      .run(resId, f.initial_status, req.session.user.id, 'Walk-in reservation created');

    // Cash (or other) payment taken at the desk while booking.
    if (paymentNow > 0) {
      await recordStaffPayment(resId, {
        amount: paymentNow,
        method: f.payment_method,
        date:   localDate(),
        type:   paymentNow >= total ? 'full_payment' : 'downpayment',
        notes:  'Received at the front desk during walk-in booking',
      }, req.session.user.id);
    }

    return { id: resId };
  });

  if (result.error) return fail([{ msg: result.error }]);

  // Generate QR code
  try { await generateReservationQR(result.id, bookingRef); } catch { /* non-critical */ }

  // Notify admins
  await notifyAllAdmins('reservation', 'New Reservation', `${bookingRef} has been created.`, `/reservations/${result.id}`);

  await req.audit('create', 'reservations', result.id, null, { bookingRef, reservation_type: type, total_amount: total, payment_now: paymentNow || 0 });
  req.session.flash = { success: `Reservation ${bookingRef} created successfully.` + (paymentNow > 0 ? ` Payment of ${peso(paymentNow)} recorded.` : '') };
  res.redirect(`/reservations/${result.id}`);
});

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
    // 'completed' is not a manual transition (checkout uses the Guest Check Out button).
    manualStatuses: ALL_STATUSES.filter(s => s !== 'completed'),
    // Latest "put on hold" entry, to show the reason while the booking is on hold.
    holdEntry: [...statusHistory].reverse().find(sh => sh.to_status === 'on_hold') || null,
    canReschedule: !FINAL_RESERVATION_STATUSES.has(reservation.status),
    notesMaxLength: NOTES_MAX_LENGTH,
  });
});

// POST /reservations/:id/status
router.post('/:id/status', requireAuth, requireRole('admin','staff'), async (req, res) => {
  const status = field(req.body.status);
  const notes  = field(req.body.notes);
  const old = await db.prepare(`SELECT status, payment_status, total_amount FROM reservations WHERE id=?`).get(req.params.id);
  if (!old) { return res.redirect('/reservations'); }

  if (!ALL_STATUSES.includes(status)) {
    req.session.flash = { error: 'Select a valid status.' };
    return res.redirect(`/reservations/${req.params.id}`);
  }
  // Putting a booking on hold needs a reason; it is kept in the status history.
  if (status === 'on_hold' && !notes) {
    req.session.flash = { error: 'Enter a reason for putting this booking on hold.' };
    return res.redirect(`/reservations/${req.params.id}`);
  }

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
      pencil:           { t: 'Pencil Booking',           m: `Your booking ${ref} is pencil-booked: the date is tentatively reserved for you while we finalise the details.` },
      on_hold:          { t: 'Booking On Hold',          m: `Your booking ${ref} has been placed on hold. Your dates stay reserved and our staff will contact you shortly.` },
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

  const label = statusLabel(status);
  req.session.flash = { success: old.status === 'on_hold' && status !== 'on_hold'
    ? `Booking resumed from hold. Status is now ${label}.`
    : `Reservation status updated to ${label}.` };
  res.redirect(`/reservations/${req.params.id}`);
});

// POST /reservations/:id/payment
router.post('/:id/payment', requireAuth, requireRole('admin','staff'), async (req, res) => {
  const { amount, payment_method, payment_date, payment_type, notes } = req.body;
  const paidAmt = parseFloat(amount);
  if (!paidAmt || paidAmt <= 0) { req.session.flash = { error: 'Invalid payment amount.' }; return res.redirect(`/reservations/${req.params.id}`); }

  const res_row = await db.prepare(`SELECT * FROM reservations WHERE id=?`).get(req.params.id);
  if (!res_row) return res.redirect('/reservations');

  await recordStaffPayment(req.params.id, {
    amount: paidAmt,
    method: payment_method,
    date:   payment_date,
    type:   payment_type,
    notes,
  }, req.session.user.id);

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
    await verifyPayment(payment, req.session.user.id);

    await req.audit('verify_payment', 'payments', payment.id, { status: payment.status }, { status: 'verified' });
    req.session.flash = { success: 'Payment verified. Booking status updated.' };

  } else if (action === 'reject') {
    // Optional reason from staff, shown to the guest so they know what to fix.
    const reason = String(req.body.reason || '').replace(/\s+/g, ' ').trim().slice(0, 300);
    // Mark as rejected — remove from balance calculation
    await db.prepare("UPDATE payments SET status = 'refunded', notes = COALESCE(notes,'') || ' [Rejected by staff: ' || NOW() || ']' || ? WHERE id = ?")
      .run(reason ? ' Reason: ' + reason : '', payment.id);

    // Recalculate payment_status
    const totalPaid = (await db.prepare("SELECT COALESCE(SUM(amount),0) AS t FROM payments WHERE reservation_id = ? AND status IN ('received','verified')").get(req.params.id)).t;
    const totalAmt  = reservation.total_amount || 0;
    let newPayStatus = totalPaid <= 0 ? 'unpaid' : (totalAmt > 0 && totalPaid >= totalAmt ? 'fully_paid' : 'partially_paid');
    await db.prepare("UPDATE reservations SET payment_status = ? WHERE id = ?").run(newPayStatus, req.params.id);

    await notifyReservationCustomer(reservation.id, 'payment', 'Payment Not Accepted',
      'We could not verify your payment of ₱' + payment.amount.toLocaleString() + ' for booking ' + reservation.booking_ref + '.' +
        (reason ? ' Reason: ' + reason + '.' : '') + ' Please check the details and submit your proof again.',
      '/portal/my-reservations/' + reservation.id);
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
      resortToday(),
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

function describeSchedule(r) {
  const start = r.check_in_date || r.event_date;
  const end   = r.check_out_date || start;
  if (!start) return 'no date';
  const part = (date, time) => formatDate(date) + (time ? ' ' + String(time).slice(0, 5) : '');
  return `${part(start, r.start_time)} to ${part(end, r.end_time)}`;
}

// ── POST /reservations/:id/reschedule ──────────────────────────────────────
// Moves the booking to new dates / times after the same double-booking checks
// used at creation (ignoring this reservation itself).
router.post('/:id/reschedule', requireAuth, requireRole('admin','staff'), async (req, res) => {
  const back = `/reservations/${req.params.id}`;
  const reservation = await db.prepare('SELECT * FROM reservations WHERE id = ?').get(req.params.id);
  if (!reservation) { req.session.flash = { error: 'Reservation not found.' }; return res.redirect('/reservations'); }
  if (FINAL_RESERVATION_STATUSES.has(reservation.status)) {
    req.session.flash = { error: `A ${statusLabel(reservation.status).toLowerCase()} booking cannot be rescheduled.` };
    return res.redirect(back);
  }

  const s = {
    check_in_date:  field(req.body.check_in_date),
    check_out_date: field(req.body.check_out_date),
    start_time:     field(req.body.start_time),
    end_time:       field(req.body.end_time),
  };
  const reason = field(req.body.reason);
  const errors = validateSchedule(reservation.reservation_type, s);
  if (errors.length) { req.session.flash = { error: errors.map(e => e.msg).join(' ') }; return res.redirect(back); }

  const isVenueType = reservation.reservation_type === 'venue' || reservation.reservation_type === 'event';
  const schedule = {
    check_in_date:  s.check_in_date,
    check_out_date: s.check_out_date,
    start_time:     s.start_time || null,
    end_time:       s.end_time || null,
    event_date:     isVenueType ? s.check_in_date : reservation.event_date,
  };
  const before = {
    check_in_date:  reservation.check_in_date,
    check_out_date: reservation.check_out_date,
    start_time:     reservation.start_time,
    end_time:       reservation.end_time,
    event_date:     reservation.event_date,
  };
  const oldText = describeSchedule(before);
  const newText = describeSchedule(schedule);
  if (Object.keys(schedule).every(k => (before[k] || null) === (schedule[k] || null))) {
    req.session.flash = { info: 'The schedule is unchanged.' };
    return res.redirect(back);
  }

  const result = await db.transaction(async () => {
    const items = await db.prepare(`
      SELECT item_type, item_id, item_name FROM reservation_items
      WHERE reservation_id = ? AND item_type IN ('room','cottage','venue')
    `).all(reservation.id);
    for (const item of items) {
      const requested = { ...schedule, whole_day: await isWholeDayItem(item.item_type, item.item_id) };
      const conflict = await findBookingConflict(item.item_type, item.item_id, requested, reservation.id);
      if (conflict) return { error: `${item.item_name || 'This ' + item.item_type} is already booked (${conflict.booking_ref}) for the new dates and times.` };
    }

    await db.prepare(`
      UPDATE reservations
      SET check_in_date = ?, check_out_date = ?, start_time = ?, end_time = ?, event_date = ?, updated_at = NOW()
      WHERE id = ?
    `).run(schedule.check_in_date, schedule.check_out_date, schedule.start_time, schedule.end_time, schedule.event_date, reservation.id);

    await db.prepare(`INSERT INTO reservation_status_history (reservation_id, from_status, to_status, changed_by, notes) VALUES (?,?,?,?,?)`).run(
      reservation.id, reservation.status, reservation.status, req.session.user.id,
      `Rescheduled: ${oldText} → ${newText}` + (reason ? ` (Reason: ${reason})` : '')
    );
    return {};
  });

  if (result.error) { req.session.flash = { error: result.error }; return res.redirect(back); }

  await notifyReservationCustomer(
    reservation.id, 'reservation', 'Booking Rescheduled',
    `Your booking ${reservation.booking_ref} has been rescheduled to ${newText}.`,
    '/portal/my-reservations/' + reservation.id
  );
  await req.audit('reschedule', 'reservations', reservation.id, before, schedule);
  req.session.flash = { success: `Booking rescheduled to ${newText}.` };
  res.redirect(back);
});

// ── POST /reservations/:id/amount ──────────────────────────────────────────
// Edit the booking total directly, or set the remaining balance (total becomes
// amount paid + balance). payment_status is recalculated afterwards.
router.post('/:id/amount', requireAuth, requireRole('admin','staff'), async (req, res) => {
  const back = `/reservations/${req.params.id}`;
  const reservation = await db.prepare('SELECT * FROM reservations WHERE id = ?').get(req.params.id);
  if (!reservation) { req.session.flash = { error: 'Reservation not found.' }; return res.redirect('/reservations'); }

  const mode  = field(req.body.mode) === 'balance' ? 'balance' : 'total';
  const raw   = field(mode === 'balance' ? req.body.balance : req.body.total_amount);
  const value = Number(raw);
  if (raw === '' || !Number.isFinite(value) || value < 0) {
    req.session.flash = { error: `Enter a ${mode === 'balance' ? 'balance' : 'total amount'} of zero or more.` };
    return res.redirect(back);
  }

  const paid     = await amountPaidFor(reservation.id);
  const newTotal = Math.round((mode === 'balance' ? paid + value : value) * 100) / 100;
  if (newTotal < paid) {
    req.session.flash = { error: `The total cannot be less than the amount already paid (${peso(paid)}).` };
    return res.redirect(back);
  }

  let downpayment = reservation.downpayment_req || 0;
  const dpRaw = field(req.body.downpayment_req);
  if (dpRaw !== '') {
    downpayment = Number(dpRaw);
    if (!Number.isFinite(downpayment) || downpayment < 0) {
      req.session.flash = { error: 'Downpayment must be zero or more.' };
      return res.redirect(back);
    }
  }
  if (downpayment > newTotal) downpayment = newTotal;

  if (newTotal === (reservation.total_amount || 0) && downpayment === (reservation.downpayment_req || 0)) {
    req.session.flash = { info: 'The amount is unchanged.' };
    return res.redirect(back);
  }

  // A refunded booking keeps its refunded payment status.
  const payStatus = reservation.payment_status === 'refunded'
    ? 'refunded'
    : paymentStatusFor(paid, newTotal);
  const reason = field(req.body.reason);
  const newBalance = Math.round((newTotal - paid) * 100) / 100;

  await db.transaction(async () => {
    await db.prepare(`
      UPDATE reservations SET total_amount = ?, downpayment_req = ?, payment_status = ?, updated_at = NOW() WHERE id = ?
    `).run(newTotal, downpayment, payStatus, reservation.id);

    let note = `Total amount changed: ${peso(reservation.total_amount)} → ${peso(newTotal)} (paid ${peso(paid)}, balance ${peso(newBalance)})`;
    if (downpayment !== (reservation.downpayment_req || 0)) note += `; downpayment ${peso(reservation.downpayment_req)} → ${peso(downpayment)}`;
    if (reason) note += ` (Reason: ${reason})`;
    await db.prepare(`INSERT INTO reservation_status_history (reservation_id, from_status, to_status, changed_by, notes) VALUES (?,?,?,?,?)`)
      .run(reservation.id, reservation.status, reservation.status, req.session.user.id, note);
  });

  await req.audit('update_amount', 'reservations', reservation.id,
    { total_amount: reservation.total_amount, downpayment_req: reservation.downpayment_req, payment_status: reservation.payment_status },
    { total_amount: newTotal, downpayment_req: downpayment, payment_status: payStatus, mode });
  req.session.flash = { success: `Total amount updated to ${peso(newTotal)}. Balance is now ${peso(newBalance)}.` };
  res.redirect(back);
});

// ── POST /reservations/:id/notes ───────────────────────────────────────────
// Internal staff notes (never shown to the guest).
router.post('/:id/notes', requireAuth, requireRole('admin','staff'), async (req, res) => {
  const back = `/reservations/${req.params.id}`;
  const reservation = await db.prepare('SELECT id, notes FROM reservations WHERE id = ?').get(req.params.id);
  if (!reservation) { req.session.flash = { error: 'Reservation not found.' }; return res.redirect('/reservations'); }

  const notes = normalizeNotes(req.body.notes);
  if (notes.length > NOTES_MAX_LENGTH) {
    req.session.flash = { error: `Notes can be at most ${NOTES_MAX_LENGTH} characters.` };
    return res.redirect(back);
  }

  await db.prepare('UPDATE reservations SET notes = ?, updated_at = NOW() WHERE id = ?').run(notes, reservation.id);
  await req.audit('update_notes', 'reservations', reservation.id,
    { notes_length: (reservation.notes || '').length }, { notes_length: notes.length });
  req.session.flash = { success: 'Internal notes saved.' };
  res.redirect(back);
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
      (SELECT pk.item_name FROM reservation_items pk
        WHERE pk.reservation_id = r.id AND pk.item_type = 'event_package'
        ORDER BY pk.id LIMIT 1) AS event_name,
      1                AS is_all_day,
      0                AS is_event
    FROM reservations r
    JOIN customers c          ON c.id = r.customer_id
    LEFT JOIN reservation_items ri ON ri.reservation_id = r.id
                                   AND ri.item_type = 'venue'
    -- Event reservations (package, optional venue) show here too, unless an
    -- events-table row already represents them (section 3).
    WHERE (r.reservation_type = 'venue'
           OR (r.reservation_type = 'event'
               AND NOT EXISTS (SELECT 1 FROM events e WHERE e.reservation_id = r.id)))
      AND COALESCE(r.check_in_date, r.event_date) IS NOT NULL
      AND r.status NOT IN ('completed','no_show')
      AND r.payment_status != 'refunded'
    ORDER BY COALESCE(r.check_in_date, r.event_date)
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