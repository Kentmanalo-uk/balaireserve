/**
 * Authentication routes for SQL-backed email and password accounts.
 */
'use strict';

const { randomBytes } = require('crypto');
const express = require('express');
const bcrypt = require('bcryptjs');
const { body, validationResult } = require('express-validator');
const db = require('../../../config/database');
const { guestOnly } = require('../../../middleware/auth');

const router = express.Router();

async function get(sql, params = []) {
  return (await db.prepare(sql).get(...params)) || null;
}

function getGoogleOAuthConfig() {
  const { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI } = process.env;
  if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET || !GOOGLE_REDIRECT_URI) return null;
  return { clientId: GOOGLE_CLIENT_ID, clientSecret: GOOGLE_CLIENT_SECRET, redirectUri: GOOGLE_REDIRECT_URI };
}

// Login and register pages both offer "Continue with Google" once it is configured.
router.use((req, res, next) => {
  res.locals.googleLoginEnabled = Boolean(getGoogleOAuthConfig());
  next();
});

function buildSessionUser(user) {
  return {
    id: user.id,
    firstName: user.first_name,
    lastName: user.last_name,
    email: user.email,
    role: user.role,
    roleLabel: user.role_label,
    avatar: user.avatar || null,
  };
}

function postLoginRedirect(req, res, role) {
  const staffPaths = ['/dashboard', '/rooms', '/venues', '/events', '/inventory',
    '/crm', '/reports', '/analytics', '/users', '/payments',
    '/guests', '/reservations', '/inquiries', '/feedback', '/cottages'];
  const returnTo = req.session.returnTo;

  if (returnTo) {
    delete req.session.returnTo;
    if (role === 'customer' && staffPaths.some(path => returnTo.startsWith(path))) {
      return res.redirect('/portal');
    }
    return res.redirect(returnTo);
  }

  return res.redirect(role === 'customer' ? '/portal' : '/dashboard');
}

router.get('/login', guestOnly, (req, res) => {
  res.render('auth/login', {
    title: 'Sign In - Balai-Reserve',
    layout: 'layouts/auth',
    errors: [],
    old: {},
    googleLoginEnabled: Boolean(getGoogleOAuthConfig()),
  });
});

router.get('/google', guestOnly, (req, res, next) => {
  const config = getGoogleOAuthConfig();
  if (!config) {
    req.session.flash = { error: 'Google sign-in is not configured yet.' };
    return res.redirect('/auth/login');
  }

  const state = randomBytes(32).toString('hex');
  req.session.googleOAuthState = state;
  return req.session.save(error => {
    if (error) return next(error);

    const authorizationUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
    authorizationUrl.search = new URLSearchParams({
      client_id: config.clientId,
      redirect_uri: config.redirectUri,
      response_type: 'code',
      scope: 'openid email profile',
      state,
      prompt: 'select_account',
    }).toString();

    return res.redirect(authorizationUrl.toString());
  });
});

router.get('/google/callback', async (req, res, next) => {
  const expectedState = req.session.googleOAuthState;
  delete req.session.googleOAuthState;
  if (!expectedState || typeof req.query.state !== 'string' || req.query.state !== expectedState) {
    req.session.flash = { error: 'Google sign-in could not be verified. Please try again.' };
    return res.redirect('/auth/login');
  }

  if (req.query.error || typeof req.query.code !== 'string') {
    req.session.flash = { error: 'Google sign-in was cancelled or could not be completed.' };
    return res.redirect('/auth/login');
  }

  const config = getGoogleOAuthConfig();
  if (!config) {
    req.session.flash = { error: 'Google sign-in is not configured yet.' };
    return res.redirect('/auth/login');
  }

  try {
    const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code: req.query.code,
        client_id: config.clientId,
        client_secret: config.clientSecret,
        redirect_uri: config.redirectUri,
        grant_type: 'authorization_code',
      }),
      signal: AbortSignal.timeout(10000),
    });
    if (!tokenResponse.ok) throw new Error(`Google token exchange failed (${tokenResponse.status}).`);

    const token = await tokenResponse.json();
    if (!token.access_token) throw new Error('Google did not return an access token.');

    const profileResponse = await fetch('https://openidconnect.googleapis.com/v1/userinfo', {
      headers: { Authorization: `Bearer ${token.access_token}` },
      signal: AbortSignal.timeout(10000),
    });
    if (!profileResponse.ok) throw new Error(`Google profile request failed (${profileResponse.status}).`);

    const profile = await profileResponse.json();
    if (typeof profile.sub !== 'string' || typeof profile.email !== 'string' ||
        profile.email_verified !== true) {
      throw new Error('Google did not provide a verified email address.');
    }

    const email = profile.email.trim().toLowerCase();
    let user = await get(`
      SELECT u.*, r.name AS role, r.label AS role_label
      FROM users u
      JOIN roles r ON r.id = u.role_id
      WHERE u.google_sub = ?
    `, [profile.sub]);

    if (user && user.email.toLowerCase() !== email) {
      throw new Error('The Google account email no longer matches its linked account.');
    }

    if (!user) {
      const emailUser = await get(`
        SELECT u.*, r.name AS role, r.label AS role_label
        FROM users u
        JOIN roles r ON r.id = u.role_id
        WHERE lower(u.email) = ?
      `, [email]);

      if (emailUser && emailUser.google_sub && emailUser.google_sub !== profile.sub) {
        throw new Error('This email is already linked to a different Google account.');
      }

      if (!emailUser) {
        const customerRole = await get("SELECT id FROM roles WHERE name = 'customer'");
        if (!customerRole) throw new Error('Customer registration is not configured.');

        const firstName = (profile.given_name || profile.name || email.split('@')[0]).trim();
        const lastName = (profile.family_name || '').trim();
        await db.transaction(async () => {
          const result = await db.prepare(`
            INSERT INTO users
              (role_id, first_name, last_name, email, password_hash, google_sub, last_login, is_active)
            VALUES (?, ?, ?, ?, '', ?, NOW(), 1)
          `).run(customerRole.id, firstName, lastName, email, profile.sub);
          const userId = Number(result.lastInsertRowid);

          await db.prepare(`
            INSERT INTO customers (user_id, customer_code, first_name, last_name, email)
            VALUES (?, ?, ?, ?, ?)
          `).run(userId, `CUS-G-${profile.sub}`, firstName, lastName, email);

          return userId;
        });
      } else {
        await db.prepare(`
          UPDATE users
          SET google_sub = ?, last_login = NOW()
          WHERE id = ?
        `).run(profile.sub, emailUser.id);
      }

      user = await get(`
        SELECT u.*, r.name AS role, r.label AS role_label
        FROM users u
        JOIN roles r ON r.id = u.role_id
        WHERE u.google_sub = ?
      `, [profile.sub]);
    } else {
      await db.prepare('UPDATE users SET last_login = NOW() WHERE id = ?').run(user.id);
    }

    if (!user || !user.is_active) {
      req.session.flash = { error: 'This account is inactive. Contact an administrator for help.' };
      return res.redirect('/auth/login');
    }

    const returnTo = req.session.returnTo;
    return req.session.regenerate(error => {
      if (error) return next(error);
      req.session.user = buildSessionUser(user);
      if (returnTo) req.session.returnTo = returnTo;
      return postLoginRedirect(req, res, user.role);
    });
  } catch (error) {
    console.error('[Google OAuth] Sign-in failed:', error.message);
    req.session.flash = { error: 'Google sign-in could not be completed. Please try again.' };
    return res.redirect('/auth/login');
  }
});

router.post('/login',
  guestOnly,
  [
    body('email').isEmail().normalizeEmail().withMessage('Enter a valid email address.'),
    body('password').notEmpty().withMessage('Password is required.'),
  ],
  async (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      req.session.flash = { error: errors.array()[0].msg };
      return req.session.save(error => {
        if (error) return next(error);
        return res.redirect('/auth/login');
      });
    }

    try {
      const { email, password } = req.body;
      const user = await get(`
        SELECT u.*, r.name AS role, r.label AS role_label
        FROM users u
        JOIN roles r ON r.id = u.role_id
        WHERE u.email = ? AND u.is_active = 1
      `, [email]);

      if (!user || !user.password_hash || !bcrypt.compareSync(password, user.password_hash)) {
        req.session.flash = { error: 'Invalid email or password. Please try again.' };
        return req.session.save(error => {
          if (error) return next(error);
          return res.redirect('/auth/login');
        });
      }

      await db.prepare('UPDATE users SET last_login = NOW() WHERE id = ?').run(user.id);
      const returnTo = req.session.returnTo;
      return req.session.regenerate(error => {
        if (error) return next(error);

        req.session.user = buildSessionUser(user);
        if (returnTo) req.session.returnTo = returnTo;
        return postLoginRedirect(req, res, user.role);
      });
    } catch (error) {
      return next(error);
    }
  }
);

router.get('/register', guestOnly, (req, res) => {
  res.render('auth/register', {
    title: 'Create Account - Balai-Reserve',
    layout: 'layouts/auth',
    errors: [],
    old: {},
  });
});

router.post('/register',
  guestOnly,
  [
    body('first_name').trim().notEmpty().withMessage('First name is required.'),
    body('last_name').trim().notEmpty().withMessage('Last name is required.'),
    body('email').isEmail().normalizeEmail().withMessage('Enter a valid email address.'),
    body('password').isLength({ min: 8 }).withMessage('Password must be at least 8 characters.'),
    body('password_confirm').custom((value, { req }) => {
      if (value !== req.body.password) throw new Error('Passwords do not match.');
      return true;
    }),
    body('agree_terms').notEmpty().withMessage('You must agree to the Terms and Conditions.'),
  ],
  async (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.render('auth/register', {
        title: 'Create Account - Balai-Reserve',
        layout: 'layouts/auth',
        errors: errors.array(),
        old: req.body,
      });
    }

    const { first_name, last_name, email, password, phone } = req.body;

    try {
      const existing = await get('SELECT id FROM users WHERE email = ?', [email]);
      if (existing) {
        return res.render('auth/register', {
          title: 'Create Account - Balai-Reserve',
          layout: 'layouts/auth',
          errors: [{ msg: 'An account with this email already exists. Please sign in instead.' }],
          old: req.body,
        });
      }

      const customerRole = await get("SELECT id FROM roles WHERE name = 'customer'");
      if (!customerRole) {
        return res.status(503).render('auth/register', {
          title: 'Create Account - Balai-Reserve',
          layout: 'layouts/auth',
          errors: [{ msg: 'Registration is temporarily unavailable. Please try again later.' }],
          old: req.body,
        });
      }

      const userId = await db.transaction(async () => {
        const userResult = await db.prepare(`
          INSERT INTO users (role_id, first_name, last_name, email, password_hash, phone, is_active)
          VALUES (?, ?, ?, ?, ?, ?, 1)
        `).run(
          customerRole.id,
          first_name,
          last_name,
          email,
          bcrypt.hashSync(password, 12),
          phone || '',
        );
        const userId = Number(userResult.lastInsertRowid);

        await db.prepare(`
          INSERT INTO customers
            (user_id, customer_code, first_name, last_name, email, phone)
          VALUES (?, ?, ?, ?, ?, ?)
        `).run(
          userId,
          `CUS-${Date.now().toString().slice(-6)}`,
          first_name,
          last_name,
          email,
          phone || '',
        );
        return userId;
      });

      const newUser = await get(`
        SELECT u.*, r.name AS role, r.label AS role_label
        FROM users u
        JOIN roles r ON r.id = u.role_id
        WHERE u.id = ?
      `, [userId]);

      const returnTo = req.session.returnTo;
      return req.session.regenerate(error => {
        if (error) return next(error);

        req.session.user = buildSessionUser(newUser);
        if (returnTo) req.session.returnTo = returnTo;
        req.session.flash = {
          success: `Welcome, ${first_name}! Your account has been created. You can now make a booking.`,
        };
        return postLoginRedirect(req, res, newUser.role);
      });
    } catch (error) {
      if (error.code === 'ER_DUP_ENTRY') {
        return res.render('auth/register', {
          title: 'Create Account - Balai-Reserve',
          layout: 'layouts/auth',
          errors: [{ msg: 'An account with this email already exists. Please sign in instead.' }],
          old: req.body,
        });
      }
      return next(error);
    }
  }
);

router.get('/logout', (req, res) => {
  req.session.destroy(error => {
    if (error) return res.status(500).send('Could not sign out. Please try again.');
    return res.redirect('/auth/login');
  });
});

module.exports = router;
