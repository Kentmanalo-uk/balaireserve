/**
 * Analytics & AI Decision Support Routes
 */
'use strict';

const express = require('express');
const db      = require('../../../config/database');
const { requireAuth, requireRole } = require('../../../middleware/auth');

const router = express.Router();

// GET /analytics
router.get('/', requireAuth, requireRole('admin'), async (req, res) => {
  const today     = new Date().toISOString().slice(0, 10);
  const thisMonth = today.slice(0, 7);
  const lastMonth = new Date(new Date().setMonth(new Date().getMonth() - 1)).toISOString().slice(0, 7);

  // ΓöÇΓöÇ Revenue Trend (12 months) ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ
  const revenueTrend = await db.prepare(`
    SELECT DATE_FORMAT(payment_date, '%Y-%m') AS month, SUM(amount) AS revenue
    FROM payments WHERE status IN ('received','verified') AND payment_date >= DATE_SUB(CURDATE(), INTERVAL 12 MONTH)
    GROUP BY month ORDER BY month
  `).all();

  // ΓöÇΓöÇ Reservation Trend (12 months) ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ
  const resTrend = await db.prepare(`
    SELECT DATE_FORMAT(created_at, '%Y-%m') AS month, COUNT(*) AS total,
           SUM(CASE WHEN status='cancelled' THEN 1 ELSE 0 END) AS cancelled
    FROM reservations WHERE created_at >= DATE_SUB(CURDATE(), INTERVAL 12 MONTH)
    GROUP BY month ORDER BY month
  `).all();

  // ΓöÇΓöÇ Room Occupancy ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ
  const roomOccupancy = await db.prepare(`
    SELECT status, COUNT(*) AS cnt FROM rooms WHERE is_active=1 GROUP BY status
  `).all();
  const totalRooms   = roomOccupancy.reduce((s, r) => s + r.cnt, 0);
  const occupiedRooms= roomOccupancy.find(r => r.status === 'occupied')?.cnt || 0;
  const occupancyRate= totalRooms > 0 ? Math.round((occupiedRooms / totalRooms) * 100) : 0;

  // ΓöÇΓöÇ Venue Utilization ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ
  const venueUtil = await db.prepare(`
    SELECT v.name, COUNT(ri.id) AS bookings
    FROM venues v LEFT JOIN reservation_items ri ON ri.item_id=v.id AND ri.item_type='venue'
    GROUP BY v.id ORDER BY bookings DESC
  `).all();

  // ΓöÇΓöÇ Event Demand ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ
  const eventDemand = await db.prepare(`
    SELECT event_type, COUNT(*) AS cnt, SUM(total_cost) AS revenue
    FROM events WHERE event_date >= DATE_SUB(CURDATE(), INTERVAL 6 MONTH)
    GROUP BY event_type ORDER BY cnt DESC
  `).all();

  // ΓöÇΓöÇ Customer Satisfaction ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ
  const satisfaction = await db.prepare(`
    SELECT DATE_FORMAT(created_at, '%Y-%m') AS month, ROUND(AVG(rating),2) AS avg_rating, COUNT(*) AS reviews
    FROM feedback WHERE created_at >= DATE_SUB(CURDATE(), INTERVAL 6 MONTH)
    GROUP BY month ORDER BY month
  `).all();

  // ΓöÇΓöÇ Cancellation Rate ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ
  const cancRate = await db.prepare(`
    SELECT
      COUNT(*) AS total,
      SUM(CASE WHEN status='cancelled' THEN 1 ELSE 0 END) AS cancelled
    FROM reservations WHERE created_at >= DATE_SUB(CURDATE(), INTERVAL 3 MONTH)
  `).get();
  const cancellationRate = cancRate.total > 0 ? Math.round((cancRate.cancelled / cancRate.total) * 100) : 0;

  // ΓöÇΓöÇ Peak Booking Periods ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ
  const peakDays = await db.prepare(`
    SELECT CAST(DAYOFWEEK(created_at) - 1 AS CHAR) AS dow, COUNT(*) AS cnt
    FROM reservations GROUP BY dow ORDER BY cnt DESC
  `).all();
  const dayNames = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  const peakDaysLabeled = peakDays.map(r => ({ day: dayNames[r.dow] || r.dow, cnt: r.cnt }));

  // ΓöÇΓöÇ Month-over-month comparison ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ
  const thisMonthRev = (await db.prepare(`SELECT COALESCE(SUM(amount),0) AS rev FROM payments WHERE status IN ('received','verified') AND DATE_FORMAT(payment_date,'%Y-%m')=?`).get(thisMonth)).rev;
  const lastMonthRev = (await db.prepare(`SELECT COALESCE(SUM(amount),0) AS rev FROM payments WHERE status IN ('received','verified') AND DATE_FORMAT(payment_date,'%Y-%m')=?`).get(lastMonth)).rev;
  const revChange    = lastMonthRev > 0 ? Math.round(((thisMonthRev - lastMonthRev) / lastMonthRev) * 100) : null;

  const thisMonthRes = (await db.prepare(`SELECT COUNT(*) AS cnt FROM reservations WHERE DATE_FORMAT(created_at,'%Y-%m')=?`).get(thisMonth)).cnt;
  const lastMonthRes = (await db.prepare(`SELECT COUNT(*) AS cnt FROM reservations WHERE DATE_FORMAT(created_at,'%Y-%m')=?`).get(lastMonth)).cnt;
  const resChange    = lastMonthRes > 0 ? Math.round(((thisMonthRes - lastMonthRes) / lastMonthRes) * 100) : null;

  // ΓöÇΓöÇ AI Insights ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ
  const insights = await db.prepare(`SELECT * FROM ai_insights WHERE is_dismissed=0 ORDER BY created_at DESC`).all();

  // ΓöÇΓöÇ Forecast (simple linear projection) ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ
  // Uses last 3 months average to project next month
  const last3MonthsRevenue = await db.prepare(`
    SELECT DATE_FORMAT(payment_date, '%Y-%m') AS month, SUM(amount) AS revenue
    FROM payments WHERE status IN ('received','verified') AND payment_date >= DATE_SUB(CURDATE(), INTERVAL 3 MONTH)
    GROUP BY month ORDER BY month DESC LIMIT 3
  `).all();
  const avgRevenue = last3MonthsRevenue.length > 0
    ? Math.round(last3MonthsRevenue.reduce((s, r) => s + r.revenue, 0) / last3MonthsRevenue.length)
    : 0;

  const last3MonthsRes = (await db.prepare(`
    SELECT COUNT(*) AS cnt FROM reservations
    WHERE created_at >= DATE_SUB(CURDATE(), INTERVAL 3 MONTH)
  `).get()).cnt;
  const projectedRes = Math.round(last3MonthsRes / 3);

  res.render('analytics/index', {
    title: 'Analytics & Insights – Balai-Reserve',
    layout: 'layouts/main',
    revenueTrend:   JSON.stringify(revenueTrend),
    resTrend:       JSON.stringify(resTrend),
    venueUtil:      JSON.stringify(venueUtil),
    eventDemand:    JSON.stringify(eventDemand),
    satisfactionJson: JSON.stringify(satisfaction),
    peakDaysJson:   JSON.stringify(peakDaysLabeled),
    roomOccupancy, occupancyRate, cancellationRate,
    revChange, resChange, thisMonthRev, lastMonthRev,
    avgRevenue, projectedRes, insights,
  });
});

// POST /analytics/dismiss-insight
router.post('/dismiss/:id', requireAuth, requireRole('admin'), async (req, res) => {
  await db.prepare(`UPDATE ai_insights SET is_dismissed=1 WHERE id=?`).run(req.params.id);
  res.redirect('/analytics');
});

module.exports = router;