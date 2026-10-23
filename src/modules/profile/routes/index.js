/**
 * Profile Routes  (/profile)
 * Available to every authenticated user regardless of role.
 *
 *  GET  /profile          — view & edit own profile
 *  POST /profile          — save profile changes (name, phone)
 *  POST /profile/password — change own password
 */
'use strict';

const express = require('express');
const bcrypt  = require('bcryptjs');
const { body, validationResult } = require('express-validator');
const db      = require('../../../config/database');
const { requireAuth } = require('../../../middleware/auth');

const router = express.Router();

// GET /profile
router.get('/', requireAuth, async (req, res) => {
  const user = await db.prepare(`
    SELECT u.*, r.name AS role_name, r.label AS role_label
    FROM users u JOIN roles r ON r.id = u.role_id
    WHERE u.id = ?
  `).get(req.session.user.id);

  if (!user) {
    req.session.destroy(() => res.redirect('/auth/login'));
    return;
  }

  const recentActivity = await db.prepare(`
    SELECT * FROM audit_logs WHERE user_id = ?
    ORDER BY created_at DESC LIMIT 8
  `).all(user.id);

  res.render('profile/index', {
    title:  'My Profile',
    layout: 'layouts/main',
    profileUser: user,
    recentActivity,
    errors:    [],
    pwErrors:  [],
    old:       {},
  });
});

// POST /profile — update name / phone
router.post('/',
  requireAuth,
  [
    body('first_name').trim().notEmpty().withMessage('First name is required.'),
    body('last_name').trim().notEmpty().withMessage('Last name is required.'),
    body('phone').optional({ checkFalsy: true }).trim(),
  ],
  async (req, res) => {
    const user = await db.prepare(`
      SELECT u.*, r.name AS role_name, r.label AS role_label
      FROM users u JOIN roles r ON r.id = u.role_id
      WHERE u.id = ?
    `).get(req.session.user.id);

    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.render('profile/index', {
        title: 'My Profile', layout: 'layouts/main',
        profileUser: user,
        recentActivity: [],
        errors: errors.array(), pwErrors: [], old: req.body,
      });
    }

    const { first_name, last_name, phone } = req.body;
    const old = { first_name: user.first_name, last_name: user.last_name, phone: user.phone };

    await db.prepare(`
      UPDATE users SET first_name=?, last_name=?, phone=?, updated_at=NOW()
      WHERE id=?
    `).run(first_name, last_name, phone || '', req.session.user.id);

    // Refresh session so navbar name updates immediately
    req.session.user.firstName = first_name;
    req.session.user.lastName  = last_name;

    await req.audit('update', 'profile', req.session.user.id, old, { first_name, last_name, phone });
    req.session.flash = { success: 'Profile updated successfully.' };
    res.redirect('/profile');
  }
);

// POST /profile/password — change password
router.post('/password',
  requireAuth,
  [
    body('current_password').notEmpty().withMessage('Current password is required.'),
    body('new_password').isLength({ min: 8 }).withMessage('New password must be at least 8 characters.'),
    body('confirm_password').custom((val, { req }) => {
      if (val !== req.body.new_password) throw new Error('Passwords do not match.');
      return true;
    }),
  ],
  async (req, res) => {
    const user = await db.prepare(`
      SELECT u.*, r.name AS role_name, r.label AS role_label
      FROM users u JOIN roles r ON r.id = u.role_id
      WHERE u.id = ?
    `).get(req.session.user.id);

    const errors = validationResult(req);

    // Always verify current password, even before other validations
    const currentOk = bcrypt.compareSync(req.body.current_password || '', user.password_hash);

    const allErrors = errors.array();
    if (!currentOk) {
      allErrors.unshift({ msg: 'Current password is incorrect.', param: 'current_password' });
    }

    if (allErrors.length > 0) {
      const recentActivity = await db.prepare(`SELECT * FROM audit_logs WHERE user_id=? ORDER BY created_at DESC LIMIT 8`).all(user.id);
      return res.render('profile/index', {
        title: 'My Profile', layout: 'layouts/main',
        profileUser: user, recentActivity,
        errors: [], pwErrors: allErrors, old: {},
        activeTab: 'password',
      });
    }

    const hash = bcrypt.hashSync(req.body.new_password, 12);
    await db.prepare(`UPDATE users SET password_hash=?, updated_at=NOW() WHERE id=?`).run(hash, user.id);

    await req.audit('password_change', 'profile', user.id, null, null);
    req.session.flash = { success: 'Password changed successfully.' };
    res.redirect('/profile');
  }
);

module.exports = router;