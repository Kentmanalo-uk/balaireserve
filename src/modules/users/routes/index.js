/**
 * User Management Routes  (/users)
 * Admin-only: create, edit, toggle-active staff and admin accounts; find an account and make it an admin.
 */
'use strict';

const express = require('express');
const bcrypt  = require('bcryptjs');
const { body, validationResult } = require('express-validator');
const db      = require('../../../config/database');
const { requireAuth, requireRole } = require('../../../middleware/auth');
const { sendAccountCreated } = require('../../../utils/accountEmails');
const { notifyUser, notifyAllAdmins } = require('../../../utils/notifications');

const router     = express.Router();
const ADMIN_ONLY = requireRole('admin');

// Roles the form offers: back-office roles, plus Customer when editing a guest (so saving keeps them a guest).
async function formRoles(user) {
  const keepCustomer = user && user.role_name === 'customer';
  return db.prepare(`SELECT * FROM roles WHERE name <> 'customer' ${keepCustomer ? "OR name = 'customer'" : ''} ORDER BY name`).all();
}
const activeAdminCount = async () => (await db.prepare(
  "SELECT COUNT(*) AS n FROM users u JOIN roles r ON r.id = u.role_id WHERE r.name = 'admin' AND u.is_active = 1"
).get()).n;
const roleById = id => db.prepare('SELECT * FROM roles WHERE id = ?').get(id);

// The person and every admin hear about a change of access.
async function announceRoleChange(target, role, by) {
  const name = `${target.first_name} ${target.last_name}`;
  const isAdmin = role.name === 'admin';
  await notifyUser(target.id, 'account', isAdmin ? 'You are now an administrator' : `Your role is now ${role.label}`,
    isAdmin
      ? `${by.firstName || 'An administrator'} gave you administrator access to Balai-Reserve. You can now manage bookings, payments, listings, settings and user accounts.`
      : `${by.firstName || 'An administrator'} changed your Balai-Reserve role to ${role.label}.`,
    role.name === 'customer' ? '/portal' : '/dashboard');
  await notifyAllAdmins('account', isAdmin ? 'New Administrator' : 'Role Changed',
    `${name} (${target.email}) is now ${role.label}. Changed by ${by.firstName || 'an administrator'}.`, `/users/${target.id}`);
}

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

// GET /users/admins — current administrators, and a search to find any account and make it an admin.
router.get('/admins', requireAuth, ADMIN_ONLY, async (req, res) => {
  const q = String(req.query.q || '').trim().slice(0, 100);
  const admins = await db.prepare(`
    SELECT u.* FROM users u JOIN roles r ON r.id = u.role_id
    WHERE r.name = 'admin' ORDER BY u.is_active DESC, u.first_name, u.last_name
  `).all();
  let results = [];
  if (q) {
    const like = `%${q}%`;
    results = await db.prepare(`
      SELECT u.*, r.name AS role_name, r.label AS role_label FROM users u JOIN roles r ON r.id = u.role_id
      WHERE r.name <> 'admin' AND (u.first_name LIKE ? OR u.last_name LIKE ? OR u.email LIKE ? OR CONCAT(u.first_name, ' ', u.last_name) LIKE ?)
      ORDER BY u.is_active DESC, u.first_name, u.last_name LIMIT 20
    `).all(like, like, like, like);
  }
  res.render('users/admins', {
    title:  'Administrators – Balai-Reserve',
    layout: 'layouts/main',
    admins, results, q, activeAdmins: admins.filter(a => a.is_active).length,
  });
});

// POST /users/:id/make-admin — give an existing (active) account administrator access.
router.post('/:id/make-admin', requireAuth, ADMIN_ONLY, async (req, res) => {
  const back = '/users/admins' + (req.body.q ? '?q=' + encodeURIComponent(String(req.body.q).slice(0, 100)) : '');
  const target = await db.prepare('SELECT u.*, r.name AS role_name, r.label AS role_label FROM users u JOIN roles r ON r.id = u.role_id WHERE u.id = ?').get(req.params.id);
  if (!target) { req.session.flash = { error: 'Account not found.' }; return res.redirect(back); }
  if (target.role_name === 'admin') { req.session.flash = { info: `${target.first_name} ${target.last_name} is already an administrator.` }; return res.redirect(back); }
  if (!target.is_active) { req.session.flash = { error: `${target.first_name} ${target.last_name}'s account is deactivated. Activate it on the Users page first.` }; return res.redirect(back); }

  const admin = await db.prepare("SELECT * FROM roles WHERE name = 'admin'").get();
  await db.prepare('UPDATE users SET role_id = ?, updated_at = NOW() WHERE id = ?').run(admin.id, target.id);
  await req.audit('make_admin', 'users', target.id, { role: target.role_name }, { role: 'admin' });
  await announceRoleChange(target, admin, req.session.user);
  req.session.flash = { success: `${target.first_name} ${target.last_name} is now an administrator.` };
  res.redirect('/users/admins');
});

// POST /users/:id/remove-admin — back to Staff. Never yourself, never the last active admin.
router.post('/:id/remove-admin', requireAuth, ADMIN_ONLY, async (req, res) => {
  const target = await db.prepare('SELECT u.*, r.name AS role_name FROM users u JOIN roles r ON r.id = u.role_id WHERE u.id = ?').get(req.params.id);
  if (!target || target.role_name !== 'admin') { req.session.flash = { error: 'That account is not an administrator.' }; return res.redirect('/users/admins'); }
  if (target.id === req.session.user.id) { req.session.flash = { error: 'You cannot remove your own administrator access. Ask another administrator.' }; return res.redirect('/users/admins'); }
  if (target.is_active && await activeAdminCount() <= 1) { req.session.flash = { error: 'At least one active administrator is required.' }; return res.redirect('/users/admins'); }

  const staff = await db.prepare("SELECT * FROM roles WHERE name = 'staff'").get();
  await db.prepare('UPDATE users SET role_id = ?, updated_at = NOW() WHERE id = ?').run(staff.id, target.id);
  await req.audit('remove_admin', 'users', target.id, { role: 'admin' }, { role: 'staff' });
  await announceRoleChange(target, staff, req.session.user);
  req.session.flash = { success: `${target.first_name} ${target.last_name} is now Staff.` };
  res.redirect('/users/admins');
});

// GET /users/new  (?role=admin preselects Administrator)
router.get('/new', requireAuth, ADMIN_ONLY, async (req, res) => {
  const roles = await formRoles(null);
  const pre = roles.find(r => r.name === req.query.role);
  res.render('users/form', {
    title:  'Add User',
    layout: 'layouts/main',
    user: null, roles, errors: [], old: pre ? { role_id: pre.id } : {},
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
    const roles  = await formRoles(null);
    if (!errors.isEmpty()) {
      return res.render('users/form', {
        title: 'Add User', layout: 'layouts/main',
        user: null, roles, errors: errors.array(), old: req.body,
      });
    }

    const { first_name, last_name, email, role_id, password, phone } = req.body;
    if (!roles.some(r => String(r.id) === String(role_id))) {
      return res.render('users/form', {
        title: 'Add User', layout: 'layouts/main',
        user: null, roles, errors: [{ msg: 'Select a role.' }], old: req.body,
      });
    }

    // Check email uniqueness
    const existing = await db.prepare(`SELECT id FROM users WHERE email = ?`).get(email);
    if (existing) {
      return res.render('users/form', {
        title: 'Add User', layout: 'layouts/main',
        user: null, roles,
        errors: [{ msg: `Email "${email}" is already in use. To give that account admin access, use Users → Administrators.` }], old: req.body,
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

  const roles = await formRoles(user);
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
    const old    = await db.prepare(`SELECT u.*, r.name AS role_name FROM users u JOIN roles r ON r.id=u.role_id WHERE u.id=?`).get(req.params.id);
    if (!old) { req.session.flash = { error: 'User not found.' }; return res.redirect('/users'); }
    if (old.id === req.session.user.id) { req.session.flash = { info: 'Use the Profile page to edit your own account.' }; return res.redirect('/profile'); }
    const roles  = await formRoles(old);
    const errors = validationResult(req);

    if (!errors.isEmpty()) {
      return res.render('users/form', {
        title: 'Edit User', layout: 'layouts/main',
        user: old, roles, errors: errors.array(), old: req.body,
      });
    }

    const { first_name, last_name, email, role_id, phone } = req.body;
    const newRole = roles.find(r => String(r.id) === String(role_id));
    const roleError = !newRole ? 'Select a role.'
      : old.role_name === 'admin' && newRole.name !== 'admin' && old.is_active && await activeAdminCount() <= 1
        ? 'At least one active administrator is required, so this account must stay an administrator.' : null;
    if (roleError) {
      return res.render('users/form', {
        title: 'Edit User', layout: 'layouts/main',
        user: old, roles, errors: [{ msg: roleError }], old: req.body,
      });
    }

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
    if (String(old.role_id) !== String(role_id)) await announceRoleChange({ ...old, first_name, last_name, email }, newRole, req.session.user);
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
