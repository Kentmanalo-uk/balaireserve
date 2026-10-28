/**
 * CRM – Customer Relationship Management Routes
 */
'use strict';

const express = require('express');
const bcrypt  = require('bcryptjs');
const { body, validationResult } = require('express-validator');
const db      = require('../../../config/database');
const { requireAuth, requireRole } = require('../../../middleware/auth');
const { generateCustomerCode } = require('../../../utils/bookingRef');
const { sendAccountCreated } = require('../../../utils/accountEmails');

const router     = express.Router();
const CAN_MANAGE = ['admin','staff'];

// GET /crm – Customer list
router.get('/', requireAuth, async (req, res) => {
  const { search='', type='', status='', page=1 } = req.query;
  const limit  = 20;
  const offset = (parseInt(page) - 1) * limit;
  let   where  = 'WHERE 1=1';
  const params = [];

  if (search) {
    where += ` AND (first_name LIKE ? OR last_name LIKE ? OR email LIKE ? OR phone LIKE ? OR customer_code LIKE ?)`;
    params.push(`%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`);
  }
  if (type)   { where += ` AND customer_type = ?`; params.push(type); }
  if (status) { where += ` AND status = ?`;        params.push(status); }

  const total     = (await db.prepare(`SELECT COUNT(*) AS cnt FROM customers ${where}`).get(...params)).cnt;
  const customers = await db.prepare(`
    SELECT c.*,
      (SELECT COUNT(*) FROM reservations WHERE customer_id = c.id) AS total_bookings,
      (SELECT MAX(created_at) FROM reservations WHERE customer_id = c.id) AS last_booking
    FROM customers c ${where}
    ORDER BY c.first_name
    LIMIT ? OFFSET ?
  `).all(...params, limit, offset);

  const types    = ['regular','vip','corporate'];
  const statuses = ['active','inactive','blacklisted'];

  res.render('crm/customers', {
    title: 'Customers – CRM',
    layout: 'layouts/main',
    customers, types, statuses,
    filters: { search, type, status },
    pagination: { total, page: parseInt(page), limit, totalPages: Math.ceil(total/limit) },
  });
});

// GET /crm/customers/new
router.get('/customers/new', requireAuth, requireRole(...CAN_MANAGE), async (req, res) => {
  res.render('crm/customer-form', { title: 'Add Customer', layout: 'layouts/main', customer: null, errors: [], old: {} });
});

// POST /crm/customers
router.post('/customers',
  requireAuth, requireRole(...CAN_MANAGE),
  [
    body('first_name').trim().notEmpty().withMessage('First name is required.'),
    body('last_name').trim().notEmpty().withMessage('Last name is required.'),
    body('email').optional({ checkFalsy: true }).isEmail().withMessage('Enter a valid email.'),
    // Password is optional, but if given it must be at least 8 chars and needs an email.
    body('login_password').optional({ checkFalsy: true }).isLength({ min: 8 }).withMessage('Login password must be at least 8 characters.'),
  ],
  async (req, res) => {
    const renderErr = async (msgs) => res.render('crm/customer-form', {
      title: 'Add Customer', layout: 'layouts/main', customer: null,
      errors: Array.isArray(msgs) ? msgs : [{ msg: msgs }], old: req.body,
    });

    const errors = validationResult(req);
    if (!errors.isEmpty()) return renderErr(errors.array());

    const { first_name, last_name, email, phone, address, preferred_contact, customer_type, notes } = req.body;
    const loginPassword = (req.body.login_password || '').trim();
    const loginConfirm  = (req.body.login_password_confirm || '').trim();
    const wantsLogin    = loginPassword.length > 0;

    // Validate the login sub-form only when a password was supplied.
    if (wantsLogin) {
      if (!email) return renderErr('An email address is required to create a portal login.');
      if (loginPassword !== loginConfirm) return renderErr('The login passwords do not match.');
      const dupe = await db.prepare('SELECT id FROM users WHERE email = ?').get(email);
      if (dupe) return renderErr('A user account with that email already exists. Use a different email or leave the password blank.');
    }

    const code = await generateCustomerCode();

    let newUserId = null;
    try {
      newUserId = await db.transaction(async () => {
        let userId = null;

        if (wantsLogin) {
          const customerRole = await db.prepare(`SELECT id FROM roles WHERE name = 'customer'`).get();
          if (!customerRole) throw new Error('Customer role is missing. Cannot create a login.');
          const hash = bcrypt.hashSync(loginPassword, 12);
          // Staff entered the address for the guest, so it counts as confirmed.
          userId = (await db.prepare(`
            INSERT INTO users (role_id, first_name, last_name, email, password_hash, phone, is_active, email_verified)
            VALUES (?, ?, ?, ?, ?, ?, 1, 1)
          `).run(customerRole.id, first_name, last_name, email, hash, phone || '')).lastInsertRowid;
        }

        await db.prepare(`
          INSERT INTO customers (user_id, customer_code, first_name, last_name, email, phone, address, preferred_contact, customer_type, notes)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(userId, code, first_name, last_name, email || '', phone || '', address || '', preferred_contact || 'email', customer_type || 'regular', notes || '');
        return userId;
      });
    } catch (e) {
      return renderErr('Could not add customer: ' + e.message);
    }
    if (newUserId) await sendAccountCreated(Number(newUserId), 'guest');

    req.session.flash = {
      success: wantsLogin
        ? `Customer "${first_name} ${last_name}" added with portal login (${email}).`
        : `Customer "${first_name} ${last_name}" added.`,
    };
    res.redirect('/crm');
  }
);

// GET /crm/customers/:id – Customer profile
router.get('/customers/:id', requireAuth, async (req, res) => {
  const customer = await db.prepare(`SELECT * FROM customers WHERE id=?`).get(req.params.id);
  if (!customer) { req.session.flash = { error: 'Customer not found.' }; return res.redirect('/crm'); }

  const reservations = await db.prepare(`SELECT * FROM reservations WHERE customer_id=? ORDER BY created_at DESC LIMIT 10`).all(customer.id);
  const activities   = await db.prepare(`
    SELECT a.*, u.first_name || ' ' || u.last_name AS staff_name
    FROM crm_activities a LEFT JOIN users u ON u.id=a.staff_id
    WHERE a.customer_id=? ORDER BY a.created_at DESC LIMIT 15
  `).all(customer.id);
  const tickets  = await db.prepare(`SELECT * FROM support_tickets WHERE customer_id=? ORDER BY created_at DESC LIMIT 5`).all(customer.id);
  const feedback = await db.prepare(`SELECT f.*, r.booking_ref FROM feedback f JOIN reservations r ON r.id=f.reservation_id WHERE f.customer_id=? ORDER BY f.created_at DESC`).all(customer.id);
  const calls    = await db.prepare(`SELECT sc.*, u.first_name || ' ' || u.last_name AS staff_name FROM sales_calls sc LEFT JOIN users u ON u.id=sc.staff_id WHERE sc.customer_id=? ORDER BY sc.call_date DESC LIMIT 5`).all(customer.id);

  const totalSpent = (await db.prepare(`
    SELECT COALESCE(SUM(p.amount),0) AS total
    FROM payments p JOIN reservations r ON r.id=p.reservation_id
    WHERE r.customer_id=? AND p.status IN ('received','verified')
  `).get(customer.id)).total;

  res.render('crm/customer-profile', {
    title: `${customer.first_name} ${customer.last_name}`,
    layout: 'layouts/main',
    customer, reservations, activities, tickets, feedback, calls, totalSpent,
  });
});

// POST /crm/customers/:id/edit
router.post('/customers/:id/edit', requireAuth, requireRole(...CAN_MANAGE), async (req, res) => {
  const { first_name, last_name, email, phone, address, preferred_contact, customer_type, status, notes } = req.body;
  await db.prepare(`
    UPDATE customers SET first_name=?, last_name=?, email=?, phone=?, address=?, preferred_contact=?,
    customer_type=?, status=?, notes=?, updated_at=NOW() WHERE id=?
  `).run(first_name, last_name, email||'', phone||'', address||'', preferred_contact||'email', customer_type||'regular', status||'active', notes||'', req.params.id);
  req.session.flash = { success: 'Customer updated.' };
  res.redirect(`/crm/customers/${req.params.id}`);
});

// POST /crm/activities – Log a CRM activity
router.post('/activities', requireAuth, requireRole(...CAN_MANAGE), async (req, res) => {
  const { customer_id, activity_type, subject, description, follow_up_at } = req.body;
  await db.prepare(`
    INSERT INTO crm_activities (customer_id, activity_type, subject, description, staff_id, status, completed_at, follow_up_at)
    VALUES (?, ?, ?, ?, ?, 'completed', NOW(), ?)
  `).run(customer_id, activity_type, subject || '', description || '', req.session.user.id, follow_up_at || null);
  req.session.flash = { success: 'Activity logged.' };
  res.redirect(`/crm/customers/${customer_id}`);
});

// GET /crm/calls – Sales calls list
router.get('/calls', requireAuth, requireRole(...CAN_MANAGE), async (req, res) => {
  const { search='', status='', page=1 } = req.query;
  const limit  = 20;
  const offset = (parseInt(page)-1)*limit;
  let   where  = 'WHERE 1=1';
  const params = [];

  if (search) {
    where += ` AND (c.first_name LIKE ? OR c.last_name LIKE ? OR sc.purpose LIKE ?)`;
    params.push(`%${search}%`, `%${search}%`, `%${search}%`);
  }
  if (status) { where += ` AND sc.status = ?`; params.push(status); }

  const total = (await db.prepare(`SELECT COUNT(*) AS cnt FROM sales_calls sc JOIN customers c ON c.id=sc.customer_id ${where}`).get(...params)).cnt;
  const calls = await db.prepare(`
    SELECT sc.*, c.first_name || ' ' || c.last_name AS customer_name,
           u.first_name || ' ' || u.last_name AS staff_name
    FROM sales_calls sc
    JOIN customers c ON c.id=sc.customer_id
    LEFT JOIN users u ON u.id=sc.staff_id
    ${where}
    ORDER BY sc.call_date DESC
    LIMIT ? OFFSET ?
  `).all(...params, limit, offset);

  res.render('crm/calls', {
    title: 'Sales Calls – CRM', layout: 'layouts/main',
    calls, filters: { search, status },
    pagination: { total, page: parseInt(page), limit, totalPages: Math.ceil(total/limit) },
  });
});

// POST /crm/calls
router.post('/calls', requireAuth, requireRole(...CAN_MANAGE), async (req, res) => {
  const { customer_id, call_date, call_time, purpose, result, notes, follow_up_at, status } = req.body;
  await db.prepare(`
    INSERT INTO sales_calls (customer_id, staff_id, call_date, call_time, purpose, result, notes, follow_up_at, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(customer_id, req.session.user.id, call_date, call_time||null, purpose, result||'', notes||'', follow_up_at||null, status||'completed');
  req.session.flash = { success: 'Sales call logged.' };
  const ref = req.body.redirect || `/crm/customers/${customer_id}`;
  res.redirect(ref);
});

// GET /crm/tickets – Support tickets
router.get('/tickets', requireAuth, async (req, res) => {
  const { search='', status='', priority='', page=1 } = req.query;
  const limit  = 20;
  const offset = (parseInt(page)-1)*limit;
  let   where  = 'WHERE 1=1';
  const params = [];

  if (search)   { where += ` AND (t.ticket_number LIKE ? OR t.subject LIKE ?)`; params.push(`%${search}%`, `%${search}%`); }
  if (status)   { where += ` AND t.status = ?`;   params.push(status); }
  if (priority) { where += ` AND t.priority = ?`; params.push(priority); }

  const total   = (await db.prepare(`SELECT COUNT(*) AS cnt FROM support_tickets t ${where}`).get(...params)).cnt;
  const tickets = await db.prepare(`
    SELECT t.*, c.first_name || ' ' || c.last_name AS customer_name,
           u.first_name || ' ' || u.last_name AS assigned_name
    FROM support_tickets t
    LEFT JOIN customers c ON c.id=t.customer_id
    LEFT JOIN users u ON u.id=t.assigned_to
    ${where}
    ORDER BY CASE t.priority WHEN 'urgent' THEN 1 WHEN 'high' THEN 2 WHEN 'normal' THEN 3 ELSE 4 END, t.created_at DESC
    LIMIT ? OFFSET ?
  `).all(...params, limit, offset);

  const statuses   = ['open','in_progress','resolved','closed'];
  const priorities = ['low','normal','high','urgent'];
  res.render('crm/tickets', {
    title: 'Support Tickets – CRM', layout: 'layouts/main',
    tickets, statuses, priorities, filters: { search, status, priority },
    pagination: { total, page: parseInt(page), limit, totalPages: Math.ceil(total/limit) },
  });
});

module.exports = router;
