/**
 * User Management Routes  (/users)
 * Admin-only: create, edit, toggle-active staff accounts.
 */
'use strict';

const express = require('express');
const bcrypt  = require('bcryptjs');
const { body, validationResult } = require('express-validator');
const db      = require('../../../config/database');
const { requireAuth, requireRole } = require('../../../middleware/auth');
const { sendAccountCreated } = require('../../../utils/accountEmails');

const router     = express.Router();
const ADMIN_ONLY = requireRole('admin');

// GET /users
router.get('/', requireAuth, ADMIN_ONLY, async (req, res) => {
  const { search = '', role = '', status = '', page = 1 } = req.query;
  const limit  = 20;
  const offset = (parseInt(page) - 1) * limit;
  let   where  = 'WHERE 1=1';
  const params = [];

  if (search) {
    where += ` AND (u.first_name LIKE ? OR u.last_name LIKE ? OR u.email LIKE ?)`;
    params.push(`%${search}%`, `%${search}%`, `%${search}%`);
  }
  if (role)   { where += ` AND r.name = ?`;    params.push(role); }
  if (status === 'active')   where += ` AND u.is_active = 1`;
  if (status === 'inactive') where += ` AND u.is_active = 0`;

  const total = (await db.prepare(`
    SELECT COUNT(*) AS cnt FROM users u JOIN roles r ON r.id=u.role_id ${where}
  `).get(...params)).cnt;

  const users = await db.prepare(`
    SELECT u.*, r.name AS role_name, r.label AS role_label
    FROM users u JOIN roles r ON r.id=u.role_id
    ${where}
    ORDER BY u.is_active DESC, u.first_name
    LIMIT ? OFFSET ?
  `).all(...params, limit, offset);

  const roles = await db.prepare(`SELECT * FROM roles ORDER BY name`).all();

  res.render('users/index', {
    title:  'User Management – Balai-Reserve',
    layout: 'layouts/main',
    users, roles,
    filters: { search, role, status },
    pagination: { total, page: parseInt(page), limit, totalPages: Math.ceil(total / limit) },
  });
});

// GET /users/new
router.get('/new', requireAuth, ADMIN_ONLY, async (req, res) => {
  // Exclude 'admin' and 'customer' — only one admin allowed, customers are self-registered
  const roles = await db.prepare(`SELECT * FROM roles WHERE name NOT IN ('customer','admin') ORDER BY name`).all();
  res.render('users/form', {
    title:  'Add Staff User',
    layout: 'layouts/main',
    user: null, roles, errors: [], old: {},
  });
});

// POST /users
router.post('/',
  requireAuth, ADMIN_ONLY,
  [
    body('first_name').trim().notEmpty().withMessage('First name is required.'),
    body('last_name').trim().notEmpty().withMessage('Last name is required.'),
    body('email').isEmail().normalizeEmail().withMessage('Enter a valid email address.'),
    body('role_id').isInt().withMessage('Select a role.'),
    body('password').isLength({ min: 8 }).withMessage('Password must be at least 8 characters.'),
    body('password_confirm').custom((val, { req }) => {
      if (val !== req.body.password) throw new Error('Passwords do not match.');
      return true;
    }),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    const roles  = await db.prepare(`SELECT * FROM roles WHERE name NOT IN ('customer','admin') ORDER BY name`).all();
    if (!errors.isEmpty()) {
      return res.render('users/form', {
        title: 'Add Staff User', layout: 'layouts/main',
        user: null, roles, errors: errors.array(), old: req.body,
      });
    }

    const { first_name, last_name, email, role_id, password, phone } = req.body;

    // Check email uniqueness
    const existing = await db.prepare(`SELECT id FROM users WHERE email = ?`).get(email);
    if (existing) {
      return res.render('users/form', {
        title: 'Add Staff User', layout: 'layouts/main',
        user: null, roles,
        errors: [{ msg: `Email "${email}" is already in use.` }], old: req.body,
      });
    }

    const hash = bcrypt.hashSync(password, 12);
    const id   = (await db.prepare(`
      INSERT INTO users (role_id, first_name, last_name, email, password_hash, phone, is_active, email_verified)
      VALUES (?, ?, ?, ?, ?, ?, 1, 1)
    `).run(role_id, first_name, last_name, email, hash, phone || '')).lastInsertRowid;
    await sendAccountCreated(Number(id), 'staff');

    await req.audit('create', 'users', id, null, { first_name, last_name, email, role_id });
    req.session.flash = { success: `User "${first_name} ${last_name}" created successfully.` };
    res.redirect('/users');
  }
);

// GET /users/:id/edit
router.get('/:id/edit', requireAuth, ADMIN_ONLY, async (req, res) => {
  const user  = await db.prepare(`SELECT u.*, r.name AS role_name FROM users u JOIN roles r ON r.id=u.role_id WHERE u.id=?`).get(req.params.id);
  if (!user) { req.session.flash = { error: 'User not found.' }; return res.redirect('/users'); }

  // Redirect admin to their own profile page
  if (parseInt(req.params.id) === req.session.user.id) {
    req.session.flash = { info: 'Use the Profile page to edit your own account.' };
    return res.redirect('/profile');
  }

  const roles = await db.prepare(`SELECT * FROM roles WHERE name NOT IN ('customer','admin') ORDER BY name`).all();
  res.render('users/form', {
    title:  `Edit ${user.first_name} ${user.last_name}`,
    layout: 'layouts/main',
    user, roles, errors: [], old: user,
  });
});

// POST /users/:id/edit
router.post('/:id/edit',
  requireAuth, ADMIN_ONLY,
  [
    body('first_name').trim().notEmpty().withMessage('First name is required.'),
    body('last_name').trim().notEmpty().withMessage('Last name is required.'),
    body('email').isEmail().normalizeEmail().withMessage('Enter a valid email address.'),
    body('role_id').isInt().withMessage('Select a role.'),
  ],
  async (req, res) => {
    const old    = await db.prepare(`SELECT * FROM users WHERE id=?`).get(req.params.id);
    const roles  = await db.prepare(`SELECT * FROM roles WHERE name NOT IN ('customer','admin') ORDER BY name`).all();
    const errors = validationResult(req);

    if (!errors.isEmpty()) {
      return res.render('users/form', {
        title: 'Edit User', layout: 'layouts/main',
        user: old, roles, errors: errors.array(), old: req.body,
      });
    }

    const { first_name, last_name, email, role_id, phone } = req.body;

    // Check email uniqueness (excluding self)
    const dup = await db.prepare(`SELECT id FROM users WHERE email=? AND id!=?`).get(email, req.params.id);
    if (dup) {
      return res.render('users/form', {
        title: 'Edit User', layout: 'layouts/main', user: old, roles,
        errors: [{ msg: `Email "${email}" is already used by another account.` }], old: req.body,
      });
    }

    await db.prepare(`UPDATE users SET first_name=?,last_name=?,email=?,role_id=?,phone=?,updated_at=NOW() WHERE id=?`)
      .run(first_name, last_name, email, role_id, phone || '', req.params.id);

    await req.audit('update', 'users', req.params.id, { email: old.email, role_id: old.role_id }, { email, role_id });
    req.session.flash = { success: 'User updated successfully.' };
    res.redirect('/users');
  }
);

// POST /users/:id/toggle  — activate / deactivate
router.post('/:id/toggle', requireAuth, ADMIN_ONLY, async (req, res) => {
  if (parseInt(req.params.id) === req.session.user.id) {
    req.session.flash = { error: 'You cannot deactivate your own account.' };
    return res.redirect('/users');
  }
  const user = await db.prepare(`SELECT id, is_active, first_name, last_name FROM users WHERE id=?`).get(req.params.id);
  if (!user) { req.session.flash = { error: 'User not found.' }; return res.redirect('/users'); }

  const newActive = user.is_active ? 0 : 1;
  await db.prepare(`UPDATE users SET is_active=?, updated_at=NOW() WHERE id=?`).run(newActive, user.id);
  await req.audit('toggle_active', 'users', user.id, { is_active: user.is_active }, { is_active: newActive });

  req.session.flash = {
    success: `${user.first_name} ${user.last_name} has been ${newActive ? 'activated' : 'deactivated'}.`,
  };
  res.redirect('/users');
});

// GET /users/:id  — view profile
router.get('/:id', requireAuth, ADMIN_ONLY, async (req, res) => {
  const user = await db.prepare(`SELECT u.*, r.name AS role_name, r.label AS role_label FROM users u JOIN roles r ON r.id=u.role_id WHERE u.id=?`).get(req.params.id);
  if (!user) { req.session.flash = { error: 'User not found.' }; return res.redirect('/users'); }

  const recentAudit = await db.prepare(`SELECT * FROM audit_logs WHERE user_id=? ORDER BY created_at DESC LIMIT 10`).all(user.id);

  res.render('users/show', {
    title:  `${user.first_name} ${user.last_name}`,
    layout: 'layouts/main',
    user, recentAudit,
  });
});

module.exports = router;
