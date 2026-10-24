/**
 * Dashboard Routes
 *
 * Dispatches to a role-specific handler.
 *
 *  admin    ΓåÆ full business overview: revenue, occupancy, AI insights
 *  staff    ΓåÆ operational dashboard: bookings, check-ins, payments, inquiries
 *  customer ΓåÆ redirected to /portal (their self-service area)
 */
'use strict';

const express = require('express');
const db      = require('../../../config/database');
const { requireAuth } = require('../../../middleware/auth');

const router = express.Router();

// ΓöÇΓöÇ Entry point ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ
router.get('/', requireAuth, async (req, res) => {
  const role = req.session.user.role;
  switch (role) {
    case 'admin':    return renderAdmin(req, res);
    case 'staff':    return renderStaff(req, res);
    case 'customer': return res.redirect('/portal');
    default:         return renderStaff(req, res);   // fallback for any staff-like role
  }
});

// ── Admin Dashboard ─────────────────────────────────────────────────────────
//
// Three review periods, all driven by query params so every view is linkable
// and works without JavaScript:
//   ?view=daily&date=YYYY-MM-DD          (default: today)
//   ?view=monthly&year=YYYY[&month=M]    (month drills into that month)
//   ?view=yearly[&year=YYYY]             (year picks the accommodation period)
//
// The resort runs on Philippine time (UTC+8, no DST). DATETIME columns such as
// created_at are stored in UTC; DATE columns (payment_date, check_in_date,
// event_date) are already local dates and are compared as-is.

const PH_OFFSET_MS = 8 * 60 * 60 * 1000;
const FIRST_YEAR   = 2026;   // the system went live in 2026
const MONTH_NAMES  = ['January','February','March','April','May','June',
  'July','August','September','October','November','December'];

// Collected money = received + verified payments. Refund rows are excluded; a
// refund also marks the original payments 'refunded', so they drop out too
// (same rule as the sales report).
const COLLECTED = `p.status IN ('received','verified') AND p.payment_type <> 'refund'`;
const NOT_VOID  = `status NOT IN ('cancelled','rejected')`;

const phToday = () => new Date(Date.now() + PH_OFFSET_MS).toISOString().slice(0, 10);

// Local midnight of a 'YYYY-MM-DD' date as a UTC instant, for created_at ranges.
const phMidnight = (ymd) => new Date(`${ymd}T00:00:00+08:00`);

function addDays(ymd, n) {
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

const pad2 = (n) => String(n).padStart(2, '0');

function parseDate(value, fallback) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value || '')) return fallback;
  const d = new Date(`${value}T00:00:00Z`);
  return !isNaN(d) && d.toISOString().slice(0, 10) === value ? value : fallback;
}

function parseYear(value, fallback) {
  const y = parseInt(value, 10);
  return y >= 2000 && y <= 2100 ? y : fallback;
}

function parseMonth(value) {
  const m = parseInt(value, 10);
  return m >= 1 && m <= 12 ? m : null;
}

// Safe to embed inside a <script> tag.
const toScriptJson = (value) => JSON.stringify(value).replace(/</g, '\\u003c');

// ── Period queries (date ranges are inclusive 'YYYY-MM-DD' local dates) ─────
async function salesFor(from, to) {
  const sales = await db.prepare(`
    SELECT COALESCE(SUM(p.amount),0) AS total, COUNT(*) AS cnt
    FROM payments p WHERE ${COLLECTED} AND p.payment_date BETWEEN ? AND ?`).get(from, to);
  const refunds = await db.prepare(`
    SELECT COALESCE(SUM(p.amount),0) AS total, COUNT(*) AS cnt
    FROM payments p WHERE p.payment_type='refund' AND p.payment_date BETWEEN ? AND ?`).get(from, to);
  const methods = await db.prepare(`
    SELECT p.payment_method AS method, COUNT(*) AS cnt, SUM(p.amount) AS total
    FROM payments p WHERE ${COLLECTED} AND p.payment_date BETWEEN ? AND ?
    GROUP BY p.payment_method ORDER BY total DESC`).all(from, to);
  return { total: sales.total, count: sales.cnt, refundTotal: refunds.total, refundCount: refunds.cnt, methods };
}

// Bookings are counted by when they were made (created_at, local date).
async function bookingCountsFor(from, to) {
  const row = await db.prepare(`
    SELECT COUNT(*) AS total, COALESCE(SUM(status IN ('cancelled','rejected')),0) AS voided
    FROM reservations WHERE created_at >= ? AND created_at < ?`)
    .get(phMidnight(from), phMidnight(addDays(to, 1)));
  return { total: row.total, voided: row.voided, active: row.total - row.voided };
}

async function bookingsListFor(from, to) {
  return db.prepare(`
    SELECT r.id, r.booking_ref, r.reservation_type, r.status, r.payment_status, r.total_amount,
           DATE_FORMAT(CONVERT_TZ(r.created_at,'+00:00','+08:00'), '%Y-%m-%dT%H:%i:%s') AS created_ph,
           c.first_name||' '||c.last_name AS customer_name,
           (SELECT GROUP_CONCAT(ri.item_name ORDER BY ri.id SEPARATOR ', ')
              FROM reservation_items ri
             WHERE ri.reservation_id=r.id AND ri.item_type IN ('room','cottage','venue','event_package')) AS items
    FROM reservations r JOIN customers c ON c.id=r.customer_id
    WHERE r.created_at >= ? AND r.created_at < ?
    ORDER BY r.created_at`).all(phMidnight(from), phMidnight(addDays(to, 1)));
}

// Bookings per accommodation (room, cottage, venue, event package) by name.
// Booked value is the item price on bookings that were not cancelled/rejected.
async function accommodationFor(from, to) {
  return db.prepare(`
    SELECT ri.item_type,
           COALESCE(ri.item_name, CONCAT(ri.item_type,' #',ri.item_id)) AS name,
           COUNT(DISTINCT r.id) AS bookings,
           COUNT(DISTINCT CASE WHEN r.status IN ('cancelled','rejected') THEN r.id END) AS voided,
           COALESCE(SUM(CASE WHEN r.status NOT IN ('cancelled','rejected') THEN ri.total_price END),0) AS booked_value
    FROM reservation_items ri JOIN reservations r ON r.id=ri.reservation_id
    WHERE ri.item_type IN ('room','cottage','venue','event_package')
      AND r.created_at >= ? AND r.created_at < ?
    GROUP BY ri.item_type, name
    ORDER BY bookings DESC, name`).all(phMidnight(from), phMidnight(addDays(to, 1)));
}

// Counts for the "Needs attention" rows (admin and staff dashboards).
async function attentionCounts() {
  const count = async (sql) => (await db.prepare(sql).get()).c;
  return {
    // Guest-submitted proofs not yet verified or rejected
    proofsToVerify:  await count(`SELECT COUNT(*) AS c FROM payments WHERE status='received' AND submitted_by='customer'`),
    awaitingPayment: await count(`SELECT COUNT(*) AS c FROM reservations WHERE status='awaiting_payment'`),
    refundRequests:  await count(`SELECT COUNT(*) AS c FROM refund_requests WHERE status='pending'`),
  };
}

// Years shown in selectors: 2026 up to this year, plus any later year with bookings.
async function reviewYears(currentYear) {
  const row = await db.prepare(`
    SELECT MAX(YEAR(CONVERT_TZ(created_at,'+00:00','+08:00'))) AS y FROM reservations`).get();
  const last = Math.max(currentYear, row.y || 0);
  const years = [];
  for (let y = FIRST_YEAR; y <= last; y++) years.push(y);
  return years;
}

async function buildDaily(date) {
  const sales    = await salesFor(date, date);
  const bookings = await bookingCountsFor(date, date);

  const payments = await db.prepare(`
    SELECT p.id, p.amount, p.payment_method, p.payment_type, p.status,
           -- 'T' form = already Philippine time, so formatDateTime won't shift it again
           DATE_FORMAT(CONVERT_TZ(p.created_at,'+00:00','+08:00'), '%Y-%m-%dT%H:%i:%s') AS recorded_ph,
           r.id AS reservation_id, r.booking_ref,
           c.first_name||' '||c.last_name AS guest_name
    FROM payments p
    JOIN reservations r ON r.id=p.reservation_id
    JOIN customers c ON c.id=r.customer_id
    WHERE p.payment_date=?
    ORDER BY p.created_at, p.id`).all(date);

  // Scheduled arrivals/departures that day. Day-use bookings (cottages, venues)
  // have no check-out date, so they leave on their check-in/event date.
  const arrivals   = (await db.prepare(`
    SELECT COUNT(*) AS c FROM reservations
    WHERE COALESCE(check_in_date, event_date)=? AND ${NOT_VOID}`).get(date)).c;
  const departures = (await db.prepare(`
    SELECT COUNT(*) AS c FROM reservations
    WHERE COALESCE(check_out_date, check_in_date, event_date)=? AND ${NOT_VOID}`).get(date)).c;

  return {
    date,
    prevDate: addDays(date, -1),
    nextDate: addDays(date, 1),
    sales, bookings, payments, arrivals, departures,
    bookingsList: await bookingsListFor(date, date),
  };
}

async function buildMonthly(year, month) {
  const yearFrom = `${year}-01-01`;
  const yearTo   = `${year}-12-31`;

  const bookingRows = await db.prepare(`
    SELECT MONTH(CONVERT_TZ(created_at,'+00:00','+08:00')) AS m,
           COUNT(*) AS total, COALESCE(SUM(status IN ('cancelled','rejected')),0) AS voided
    FROM reservations WHERE created_at >= ? AND created_at < ?
    GROUP BY m`).all(phMidnight(yearFrom), phMidnight(`${year + 1}-01-01`));
  const salesRows = await db.prepare(`
    SELECT MONTH(p.payment_date) AS m, SUM(p.amount) AS total
    FROM payments p WHERE ${COLLECTED} AND p.payment_date BETWEEN ? AND ?
    GROUP BY m`).all(yearFrom, yearTo);

  const months = MONTH_NAMES.map((name, i) => {
    const b = bookingRows.find(r => r.m === i + 1);
    const s = salesRows.find(r => r.m === i + 1);
    return {
      month: i + 1, name, short: name.slice(0, 3),
      bookings: b ? b.total : 0,
      voided:   b ? b.voided : 0,
      sales:    s ? s.total : 0,
    };
  });

  const result = {
    year, month, months,
    yearBookings: months.reduce((s, m) => s + m.bookings, 0),
    yearVoided:   months.reduce((s, m) => s + m.voided, 0),
    yearSales:    months.reduce((s, m) => s + m.sales, 0),
    detail: null,
  };

  if (month) {
    const from = `${year}-${pad2(month)}-01`;
    const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
    const to   = `${year}-${pad2(month)}-${pad2(daysInMonth)}`;
    const prevFrom = month === 1 ? `${year - 1}-12-01` : `${year}-${pad2(month - 1)}-01`;
    const prevTo   = addDays(from, -1);

    const sales     = await salesFor(from, to);
    const prevSales = (await db.prepare(`
      SELECT COALESCE(SUM(p.amount),0) AS t FROM payments p
      WHERE ${COLLECTED} AND p.payment_date BETWEEN ? AND ?`).get(prevFrom, prevTo)).t;

    const dayRows = await db.prepare(`
      SELECT DAY(p.payment_date) AS d, SUM(p.amount) AS total, COUNT(*) AS cnt
      FROM payments p WHERE ${COLLECTED} AND p.payment_date BETWEEN ? AND ?
      GROUP BY d`).all(from, to);
    const days = [];
    for (let d = 1; d <= daysInMonth; d++) {
      const row = dayRows.find(r => r.d === d);
      days.push({ day: d, date: `${year}-${pad2(month)}-${pad2(d)}`, sales: row ? row.total : 0, count: row ? row.cnt : 0 });
    }

    const statusRows = await db.prepare(`
      SELECT status, COUNT(*) AS cnt FROM reservations
      WHERE created_at >= ? AND created_at < ?
      GROUP BY status ORDER BY cnt DESC`).all(phMidnight(from), phMidnight(addDays(to, 1)));

    result.detail = {
      name: MONTH_NAMES[month - 1],
      from, to, days, sales, statusRows,
      bookings:     await bookingCountsFor(from, to),
      bookingsList: await bookingsListFor(from, to),
      salesChange:  prevSales > 0 ? Math.round(((sales.total - prevSales) / prevSales) * 100) : null,
      prevName:     MONTH_NAMES[(month + 10) % 12],
    };
  }
  return result;
}

async function buildYearly(years) {
  const bookingRows = await db.prepare(`
    SELECT YEAR(CONVERT_TZ(created_at,'+00:00','+08:00')) AS y,
           COUNT(*) AS total, COALESCE(SUM(status IN ('cancelled','rejected')),0) AS voided
    FROM reservations GROUP BY y`).all();
  const salesRows = await db.prepare(`
    SELECT YEAR(p.payment_date) AS y, SUM(p.amount) AS total, COUNT(*) AS cnt
    FROM payments p WHERE ${COLLECTED} GROUP BY y`).all();

  const rows = years.map((y) => {
    const b = bookingRows.find(r => r.y === y);
    const s = salesRows.find(r => r.y === y);
    const total  = b ? b.total : 0;
    const voided = b ? b.voided : 0;
    return { year: y, bookings: total, voided, active: total - voided, sales: s ? s.total : 0, payments: s ? s.cnt : 0 };
  });

  return {
    rows,
    allBookings: bookingRows.reduce((s, r) => s + r.total, 0),
    allSales:    salesRows.reduce((s, r) => s + r.total, 0),
  };
}

async function renderAdmin(req, res) {
  const today       = phToday();
  const currentYear = Number(today.slice(0, 4));
  const view        = ['daily', 'monthly', 'yearly'].includes(req.query.view) ? req.query.view : 'daily';
  const years       = await reviewYears(currentYear);

  let daily = null, monthly = null, yearly = null;
  let accFrom, accTo, accLabel;
  let selectedYear = parseYear(req.query.year, currentYear);
  if (!years.includes(selectedYear)) selectedYear = currentYear;

  if (view === 'daily') {
    daily    = await buildDaily(parseDate(req.query.date, today));
    accFrom  = accTo = daily.date;
    accLabel = 'Bookings made on this day';
  } else if (view === 'monthly') {
    monthly = await buildMonthly(selectedYear, parseMonth(req.query.month));
    if (monthly.detail) {
      accFrom = monthly.detail.from; accTo = monthly.detail.to;
      accLabel = `Bookings made in ${monthly.detail.name} ${selectedYear}`;
    } else {
      accFrom = `${selectedYear}-01-01`; accTo = `${selectedYear}-12-31`;
      accLabel = `Bookings made in ${selectedYear}`;
    }
  } else {
    yearly  = await buildYearly(years);
    accFrom = `${selectedYear}-01-01`; accTo = `${selectedYear}-12-31`;
    accLabel = `Bookings made in ${selectedYear}`;
  }
  const accommodation = await accommodationFor(accFrom, accTo);

  // ── Operations right now (independent of the selected period) ────────────
  const pendingRes        = (await db.prepare(`SELECT COUNT(*) AS c FROM reservations WHERE status='pending'`).get()).c;
  const pendingPayments   = (await db.prepare(`SELECT COUNT(*) AS c FROM reservations WHERE payment_status IN ('unpaid','partially_paid') AND status NOT IN ('cancelled','rejected')`).get()).c;
  const openInquiries     = (await db.prepare(`SELECT COUNT(*) AS c FROM inquiries WHERE status IN ('open','in_progress')`).get()).c;
  const attention         = await attentionCounts();
  const totalCustomers    = (await db.prepare(`SELECT COUNT(*) AS c FROM customers`).get()).c;
  const avgRating         = (await db.prepare(`SELECT ROUND(AVG(rating),1) AS a FROM feedback`).get()).a || 0;

  // Only active (is_active=1) resources count toward availability.
  const availableRooms    = (await db.prepare(`SELECT COUNT(*) AS c FROM rooms WHERE status='available' AND is_active=1`).get()).c;
  const occupiedRooms     = (await db.prepare(`SELECT COUNT(*) AS c FROM rooms WHERE status='occupied' AND is_active=1`).get()).c;
  const totalRooms        = (await db.prepare(`SELECT COUNT(*) AS c FROM rooms WHERE is_active=1`).get()).c;
  const availableVenues   = (await db.prepare(`SELECT COUNT(*) AS c FROM venues WHERE status='available' AND is_active=1`).get()).c;
  const totalVenues       = (await db.prepare(`SELECT COUNT(*) AS c FROM venues WHERE is_active=1`).get()).c;
  const occupiedVenues    = (await db.prepare(`SELECT COUNT(*) AS c FROM venues WHERE status IN ('reserved','occupied') AND is_active=1`).get()).c;
  const availableCottages = (await db.prepare(`SELECT COUNT(*) AS c FROM cottages WHERE status='available' AND is_active=1`).get()).c;
  const totalCottages     = (await db.prepare(`SELECT COUNT(*) AS c FROM cottages WHERE is_active=1`).get()).c;
  const occupiedCottages  = (await db.prepare(`SELECT COUNT(*) AS c FROM cottages WHERE status IN ('reserved','occupied') AND is_active=1`).get()).c;

  // Upcoming events: today + the next 6 days. Venue/event bookings count too
  // (most events live only as reservations); a booking already linked to an
  // events row is listed once, as the event.
  const weekEnd = addDays(today, 7);
  const upcomingEventsList = await db.prepare(`
    SELECT * FROM (
      SELECT CONCAT('/events/', e.id) AS link, e.event_name AS name, e.event_date, e.start_time,
             c.first_name||' '||c.last_name AS customer_name, v.name AS venue_name, e.status
      FROM events e JOIN customers c ON c.id=e.customer_id
      LEFT JOIN venues v ON v.id=e.venue_id
      WHERE e.event_date >= ? AND e.event_date < ? AND e.status NOT IN ('completed','cancelled')
      UNION ALL
      SELECT CONCAT('/reservations/', r.id), r.booking_ref, r.event_date, r.start_time,
             c.first_name||' '||c.last_name,
             (SELECT GROUP_CONCAT(ri.item_name SEPARATOR ', ') FROM reservation_items ri
               WHERE ri.reservation_id=r.id AND ri.item_type IN ('venue','event_package')),
             r.status
      FROM reservations r JOIN customers c ON c.id=r.customer_id
      WHERE r.reservation_type IN ('venue','event') AND r.event_date >= ? AND r.event_date < ?
        AND r.status NOT IN ('cancelled','rejected','completed','no_show')
        AND NOT EXISTS (SELECT 1 FROM events e2 WHERE e2.reservation_id=r.id)
    ) upcoming
    ORDER BY event_date, start_time`).all(today, weekEnd, today, weekEnd);

  const invAlertCount = (await db.prepare(`
    SELECT COUNT(*) AS c FROM inventory_items WHERE available_qty<=reorder_level AND is_active=1`).get()).c;
  const invAlerts = await db.prepare(`
    SELECT name, available_qty, reorder_level
    FROM inventory_items WHERE available_qty<=reorder_level AND is_active=1 LIMIT 5`).all();

  const recentReservations = await db.prepare(`
    SELECT r.*, c.first_name||' '||c.last_name AS customer_name
    FROM reservations r JOIN customers c ON c.id=r.customer_id
    ORDER BY r.created_at DESC LIMIT 8`).all();

  const insights = await db.prepare(`
    SELECT * FROM ai_insights WHERE is_dismissed=0 ORDER BY created_at DESC LIMIT 4`).all();

  res.render('dashboard/admin', {
    title:  'Admin Dashboard – Balai-Reserve',
    layout: 'layouts/main',
    view, today, years, selectedYear, monthNames: MONTH_NAMES,
    daily, monthly, yearly,
    accommodation, accLabel,
    stats: {
      pendingRes, pendingPayments, openInquiries, totalCustomers, avgRating,
      ...attention,
      availableRooms, occupiedRooms, totalRooms,
      availableVenues, totalVenues, occupiedVenues,
      availableCottages, totalCottages, occupiedCottages,
      upcomingEvents: upcomingEventsList.length,
      invAlertCount,
    },
    recentReservations,
    upcomingEventsList,
    invAlerts,
    insights,
    chartJson: toScriptJson({
      months:        monthly ? monthly.months : [],
      days:          monthly && monthly.detail ? monthly.detail.days : [],
      years:         yearly ? yearly.rows : [],
      accommodation,
      year:          monthly ? monthly.year : selectedYear,
    }),
  });
}

// ΓöÇΓöÇ Staff Dashboard (unified) ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ
async function renderStaff(req, res) {
  const today = phToday();

  const pendingRes      = (await db.prepare(`SELECT COUNT(*) AS c FROM reservations WHERE status='pending'`).get()).c;
  const confirmedRes    = (await db.prepare(`SELECT COUNT(*) AS c FROM reservations WHERE status='confirmed'`).get()).c;
  const checkedInToday  = (await db.prepare(`SELECT COUNT(*) AS c FROM reservations WHERE DATE(check_in_date)=? AND status='checked_in'`).get(today)).c;
  const checkOutsToday  = (await db.prepare(`SELECT COUNT(*) AS c FROM reservations WHERE DATE(check_out_date)=? AND status='checked_in'`).get(today)).c;
  const pendingPayments = (await db.prepare(`SELECT COUNT(*) AS c FROM reservations WHERE payment_status IN ('unpaid','partially_paid') AND status NOT IN ('cancelled','rejected','completed')`).get()).c;
  const availableRooms  = (await db.prepare(`SELECT COUNT(*) AS c FROM rooms WHERE status='available' AND is_active=1`).get()).c;
  const openInquiries   = (await db.prepare(`SELECT COUNT(*) AS c FROM inquiries WHERE status IN ('open','in_progress')`).get()).c;
  const upcomingEvents  = (await db.prepare(`SELECT COUNT(*) AS c FROM events WHERE event_date>=? AND status NOT IN ('completed','cancelled')`).get(today)).c;

  // Today's arrivals
  const arrivals = await db.prepare(`
    SELECT r.*, c.first_name||' '||c.last_name AS customer_name, c.phone AS customer_phone
    FROM reservations r JOIN customers c ON c.id=r.customer_id
    WHERE DATE(r.check_in_date)=? AND r.status IN ('confirmed','awaiting_payment','pending')
    ORDER BY r.check_in_date LIMIT 10`).all(today);

  // Today's departures
  const departures = await db.prepare(`
    SELECT r.*, c.first_name||' '||c.last_name AS customer_name
    FROM reservations r JOIN customers c ON c.id=r.customer_id
    WHERE DATE(r.check_out_date)=? AND r.status='checked_in'
    ORDER BY r.check_out_date LIMIT 10`).all(today);

  // Pending reservations needing attention
  const pendingList = await db.prepare(`
    SELECT r.*, c.first_name||' '||c.last_name AS customer_name
    FROM reservations r JOIN customers c ON c.id=r.customer_id
    WHERE r.status='pending'
    ORDER BY r.created_at ASC LIMIT 8`).all();

  // Recent inquiries
  const recentInquiries = await db.prepare(`
    SELECT * FROM inquiries WHERE status IN ('open','in_progress')
    ORDER BY created_at DESC LIMIT 6`).all();

  res.render('dashboard/reservation-staff', {
    title:  'Reservations Dashboard',
    layout: 'layouts/main',
    stats: { pendingRes, confirmedRes, checkedInToday, checkOutsToday, pendingPayments, availableRooms, openInquiries, upcomingEvents, ...(await attentionCounts()) },
    arrivals,
    departures,
    pendingList,
    recentInquiries,
    today,
  });
}

module.exports = router;
