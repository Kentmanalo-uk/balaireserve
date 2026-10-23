/**
 * Event Management Routes
 */
'use strict';

const express = require('express');
const { body, validationResult } = require('express-validator');
const db      = require('../../../config/database');
const { requireAuth, requireRole } = require('../../../middleware/auth');

const router = express.Router();
const CAN_MANAGE = ['admin','staff'];

// GET /events
router.get('/', requireAuth, async (req, res) => {
  const { search='', status='', type='', page=1, from='', to='' } = req.query;
  const limit  = 20;
  const offset = (parseInt(page) - 1) * limit;
  let   where  = 'WHERE 1=1';
  const params = [];

  if (search) {
    where += ` AND (e.event_name LIKE ? OR c.first_name LIKE ? OR c.last_name LIKE ?)`;
    params.push(`%${search}%`, `%${search}%`, `%${search}%`);
  }
  if (status) { where += ` AND e.status = ?`;      params.push(status); }
  if (type)   { where += ` AND e.event_type = ?`;  params.push(type); }
  if (from)   { where += ` AND e.event_date >= ?`; params.push(from); }
  if (to)     { where += ` AND e.event_date <= ?`; params.push(to); }

  const total  = (await db.prepare(`SELECT COUNT(*) AS cnt FROM events e JOIN customers c ON c.id=e.customer_id ${where}`).get(...params)).cnt;
  const events = await db.prepare(`
    SELECT e.*, c.first_name || ' ' || c.last_name AS customer_name,
           v.name AS venue_name, ep.name AS package_name
    FROM events e
    JOIN customers c ON c.id = e.customer_id
    LEFT JOIN venues v ON v.id = e.venue_id
    LEFT JOIN event_packages ep ON ep.id = e.event_package_id
    ${where}
    ORDER BY e.event_date DESC
    LIMIT ? OFFSET ?
  `).all(...params, limit, offset);

  const statuses   = ['pending','confirmed','in_progress','completed','cancelled'];
  const eventTypes = ['wedding','birthday','debut','corporate','meeting','party','family_gathering','other'];

  res.render('events/index', {
    title: 'Events – Balai-Reserve',
    layout: 'layouts/main',
    events, statuses, eventTypes,
    filters: { search, status, type, from, to },
    pagination: { total, page: parseInt(page), limit, totalPages: Math.ceil(total/limit) },
  });
});

// GET /events/new
router.get('/new', requireAuth, requireRole(...CAN_MANAGE), async (req, res) => {
  const customers = await db.prepare(`SELECT id, customer_code, first_name, last_name FROM customers WHERE status='active' ORDER BY first_name`).all();
  const venues    = await db.prepare(`SELECT id, name, capacity, price FROM venues WHERE is_active=1 ORDER BY name`).all();
  const packages  = await db.prepare(`SELECT * FROM event_packages WHERE is_active=1 ORDER BY name`).all();
  const eventTypes= ['wedding','birthday','debut','corporate','meeting','party','family_gathering','other'];
  res.render('events/form', {
    title: 'New Event', layout: 'layouts/main',
    event: null, customers, venues, packages, eventTypes, errors: [], old: {},
  });
});

// POST /events
router.post('/',
  requireAuth, requireRole(...CAN_MANAGE),
  [
    body('event_name').trim().notEmpty().withMessage('Event name is required.'),
    body('customer_id').isInt().withMessage('Select a customer.'),
    body('event_type').notEmpty().withMessage('Select an event type.'),
    body('event_date').isDate().withMessage('Enter a valid event date.'),
    body('start_time').notEmpty().withMessage('Start time is required.'),
    body('end_time').notEmpty().withMessage('End time is required.'),
    body('num_attendees').isInt({ min: 1 }).withMessage('Enter a valid attendee count.'),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    const customers = await db.prepare(`SELECT id, customer_code, first_name, last_name FROM customers WHERE status='active' ORDER BY first_name`).all();
    const venues    = await db.prepare(`SELECT id, name, capacity, price FROM venues WHERE is_active=1 ORDER BY name`).all();
    const packages  = await db.prepare(`SELECT * FROM event_packages WHERE is_active=1 ORDER BY name`).all();
    const eventTypes= ['wedding','birthday','debut','corporate','meeting','party','family_gathering','other'];

    if (!errors.isEmpty()) {
      return res.render('events/form', { title: 'New Event', layout: 'layouts/main', event: null, customers, venues, packages, eventTypes, errors: errors.array(), old: req.body });
    }

    const {
      event_name, customer_id, event_type, event_date, start_time, end_time,
      num_attendees, venue_id, event_package_id, special_requests, total_cost, notes, reservation_id,
    } = req.body;

    // Check venue availability
    if (venue_id) {
      const conflict = await db.prepare(`
        SELECT id FROM events
        WHERE venue_id=? AND event_date=? AND status NOT IN ('cancelled','completed')
          AND start_time < ? AND end_time > ?
      `).get(venue_id, event_date, end_time, start_time);
      if (conflict) {
        const errs = [{ msg: 'This venue already has a booking at the selected time.' }];
        return res.render('events/form', { title: 'New Event', layout: 'layouts/main', event: null, customers, venues, packages, eventTypes, errors: errs, old: req.body });
      }
    }

    const id = (await db.prepare(`
      INSERT INTO events
        (reservation_id, customer_id, event_package_id, venue_id,
         event_name, event_type, event_date, start_time, end_time,
         num_attendees, special_requests, status, total_cost, payment_status, notes)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,'pending',?,'unpaid',?)
    `).run(
      reservation_id || null, customer_id, event_package_id || null, venue_id || null,
      event_name, event_type, event_date, start_time, end_time,
      num_attendees, special_requests || '', parseFloat(total_cost) || 0, notes || ''
    )).lastInsertRowid;

    await req.audit('create', 'events', id, null, { event_name, event_type, event_date });
    req.session.flash = { success: `Event "${event_name}" created successfully.` };
    res.redirect(`/events/${id}`);
  }
);

// GET /events/:id
router.get('/:id', requireAuth, async (req, res) => {
  const event = await db.prepare(`
    SELECT e.*, c.first_name || ' ' || c.last_name AS customer_name,
           c.phone AS customer_phone, v.name AS venue_name, ep.name AS package_name
    FROM events e
    JOIN customers c ON c.id=e.customer_id
    LEFT JOIN venues v ON v.id=e.venue_id
    LEFT JOIN event_packages ep ON ep.id=e.event_package_id
    WHERE e.id=?
  `).get(req.params.id);
  if (!event) { req.session.flash = { error: 'Event not found.' }; return res.redirect('/events'); }

  const assignments = await db.prepare(`
    SELECT ea.*, eq.name AS equipment_name
    FROM equipment_assignments ea JOIN equipment eq ON eq.id=ea.equipment_id
    WHERE ea.event_id=?
  `).all(event.id);

  res.render('events/show', {
    title: event.event_name, layout: 'layouts/main',
    event, assignments,
  });
});

// POST /events/:id/status
router.post('/:id/status', requireAuth, requireRole(...CAN_MANAGE), async (req, res) => {
  const { status } = req.body;
  await db.prepare(`UPDATE events SET status=?, updated_at=NOW() WHERE id=?`).run(status, req.params.id);
  req.session.flash = { success: `Event status updated to ${status}.` };
  res.redirect(`/events/${req.params.id}`);
});

module.exports = router;