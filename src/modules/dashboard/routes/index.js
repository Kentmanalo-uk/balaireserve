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

// ΓöÇΓöÇ Admin Dashboard ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ
async function renderAdmin(req, res) {
  const today     = new Date().toISOString().slice(0, 10);
  const thisMonth = today.slice(0, 7);
  const lastMonth = new Date(new Date().setMonth(new Date().getMonth() - 1))
    .toISOString().slice(0, 7);

  const totalReservations = (await db.prepare(`SELECT COUNT(*) AS c FROM reservations`).get()).c;
  const todayCheckIns     = (await db.prepare(`SELECT COUNT(*) AS c FROM reservations WHERE DATE(check_in_date)=? AND status IN ('confirmed','checked_in')`).get(today)).c;
  const pendingRes        = (await db.prepare(`SELECT COUNT(*) AS c FROM reservations WHERE status='pending'`).get()).c;
  const pendingPayments   = (await db.prepare(`SELECT COUNT(*) AS c FROM reservations WHERE payment_status IN ('unpaid','partially_paid') AND status NOT IN ('cancelled','rejected')`).get()).c;
  const availableRooms    = (await db.prepare(`SELECT COUNT(*) AS c FROM rooms WHERE status='available' AND is_active=1`).get()).c;
  const occupiedRooms     = (await db.prepare(`SELECT COUNT(*) AS c FROM rooms WHERE status='occupied'`).get()).c;
  const totalRooms        = (await db.prepare(`SELECT COUNT(*) AS c FROM rooms WHERE is_active=1`).get()).c;
  const availableVenues   = (await db.prepare(`SELECT COUNT(*) AS c FROM venues WHERE status='available' AND is_active=1`).get()).c;
  const totalVenues       = (await db.prepare(`SELECT COUNT(*) AS c FROM venues WHERE is_active=1`).get()).c;
  const occupiedVenues    = (await db.prepare(`SELECT COUNT(*) AS c FROM venues WHERE status IN ('reserved','occupied') AND is_active=1`).get()).c;
  const availableCottages = (await db.prepare(`SELECT COUNT(*) AS c FROM cottages WHERE status='available' AND is_active=1`).get()).c;
  const totalCottages     = (await db.prepare(`SELECT COUNT(*) AS c FROM cottages WHERE is_active=1`).get()).c;
  const occupiedCottages  = (await db.prepare(`SELECT COUNT(*) AS c FROM cottages WHERE status IN ('reserved','occupied') AND is_active=1`).get()).c;
  const upcomingEvents    = (await db.prepare(`SELECT COUNT(*) AS c FROM events WHERE event_date>=? AND status NOT IN ('completed','cancelled')`).get(today)).c;
  const openInquiries     = (await db.prepare(`SELECT COUNT(*) AS c FROM inquiries WHERE status IN ('open','in_progress')`).get()).c;
  const totalCustomers    = (await db.prepare(`SELECT COUNT(*) AS c FROM customers`).get()).c;
  const avgRating         = (await db.prepare(`SELECT ROUND(AVG(rating),1) AS a FROM feedback`).get()).a || 0;

  // Revenue counts both 'received' and 'verified' payments (a verified payment
  // is real, collected money). Refunded/rejected payments are excluded.
  const monthRevRow  = await db.prepare(`SELECT COALESCE(SUM(amount),0) AS t FROM payments WHERE status IN ('received','verified') AND DATE_FORMAT(payment_date,'%Y-%m')=?`).get(thisMonth);
  const lastMonthRev = (await db.prepare(`SELECT COALESCE(SUM(amount),0) AS t FROM payments WHERE status IN ('received','verified') AND DATE_FORMAT(payment_date,'%Y-%m')=?`).get(lastMonth)).t;
  const totalRevRow  = await db.prepare(`SELECT COALESCE(SUM(amount),0) AS t FROM payments WHERE status IN ('received','verified')`).get();
  const revChange    = lastMonthRev > 0
    ? Math.round(((monthRevRow.t - lastMonthRev) / lastMonthRev) * 100) : null;

  const revenueChart = await db.prepare(`
    SELECT DATE_FORMAT(payment_date,'%Y-%m') AS month, SUM(amount) AS revenue
    FROM payments WHERE status IN ('received','verified') AND payment_date>=DATE_SUB(CURDATE(), INTERVAL 6 MONTH)
    GROUP BY month ORDER BY month`).all();

  const statusDist = await db.prepare(`SELECT status, COUNT(*) AS cnt FROM reservations GROUP BY status`).all();

  const recentReservations = await db.prepare(`
    SELECT r.*, c.first_name||' '||c.last_name AS customer_name
    FROM reservations r JOIN customers c ON c.id=r.customer_id
    ORDER BY r.created_at DESC LIMIT 8`).all();

  const invAlerts = await db.prepare(`
    SELECT name, available_qty, reorder_level
    FROM inventory_items WHERE available_qty<=reorder_level AND is_active=1 LIMIT 5`).all();

  const insights = await db.prepare(`
    SELECT * FROM ai_insights WHERE is_dismissed=0 ORDER BY created_at DESC LIMIT 4`).all();

  const nextWeek = new Date();
  nextWeek.setDate(nextWeek.getDate() + 7);
  const upcomingEventsList = await db.prepare(`
    SELECT e.*, c.first_name||' '||c.last_name AS customer_name, v.name AS venue_name
    FROM events e JOIN customers c ON c.id=e.customer_id
    LEFT JOIN venues v ON v.id=e.venue_id
    WHERE e.event_date BETWEEN ? AND ? AND e.status NOT IN ('completed','cancelled')
    ORDER BY e.event_date LIMIT 5`).all(today, nextWeek.toISOString().slice(0, 10));

  res.render('dashboard/admin', {
    title:  'Admin Dashboard – Balai-Reserve',
    layout: 'layouts/main',
    stats: {
      totalReservations, todayCheckIns, pendingRes, pendingPayments,
      availableRooms, occupiedRooms, totalRooms,
      availableVenues, totalVenues, occupiedVenues,
      availableCottages, totalCottages, occupiedCottages,
      upcomingEvents, openInquiries, totalCustomers, avgRating,
      monthRevenue: monthRevRow.t,
      totalRevenue: totalRevRow.t,
      revChange,
    },
    recentReservations,
    upcomingEventsList,
    invAlerts,
    insights,
    revenueChartJson: JSON.stringify(revenueChart),
    statusDistJson:   JSON.stringify(statusDist),
  });
}

// ΓöÇΓöÇ Staff Dashboard (unified) ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ
async function renderStaff(req, res) {
  const today = new Date().toISOString().slice(0, 10);

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
    stats: { pendingRes, confirmedRes, checkedInToday, checkOutsToday, pendingPayments, availableRooms, openInquiries, upcomingEvents },
    arrivals,
    departures,
    pendingList,
    recentInquiries,
    today,
  });
}

module.exports = router;
