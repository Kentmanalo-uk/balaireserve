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
const account = require('../../../utils/accountEmails');

const router = express.Router();

async function get(sql, params = []) {
  return (await db.prepare(sql).get(...params)) || null;
}

// Google sign-in. The redirect address defaults to APP_URL + /auth/google/callback; it must be listed
// under Authorized redirect URIs in the Google Cloud console.
function getGoogleOAuthConfig() {
  const { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET } = process.env;
  const appUrl = (process.env.APP_URL || '').replace(/\/+$/, '');
  const redirectUri = process.env.GOOGLE_REDIRECT_URI || (appUrl ? appUrl + '/auth/google/callback' : '');
  if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET || !redirectUri) return null;
  return { clientId: GOOGLE_CLIENT_ID, clientSecret: GOOGLE_CLIENT_SECRET, redirectUri };
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
    emailVerified: Number(user.email_verified) === 1,
  };
}

function postLoginRedirect(req, res, role) {
  const staffPaths = ['/dashboard', '/rooms', '/venues', '/events', '/inventory',
    '/crm', '/reports', '/analytics', '/users', '/payments',
    '/guests', '/reservations', '/inquiries', '/feedback', '/cottages', '/packages', '/checkin'];
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
        // Google has already confirmed the address.
        const newUserId = await db.transaction(async () => {
          const result = await db.prepare(`
            INSERT INTO users
              (role_id, first_name, last_name, email, password_hash, google_sub, last_login, is_active, email_verified, auth_provider)
            VALUES (?, ?, ?, ?, '', ?, NOW(), 1, 1, 'google')
          `).run(customerRole.id, firstName, lastName, email, profile.sub);
          const userId = Number(result.lastInsertRowid);

          await db.prepare(`
            INSERT INTO customers (user_id, customer_code, first_name, last_name, email)
            VALUES (?, ?, ?, ?, ?)
          `).run(userId, `CUS-G-${profile.sub}`, firstName, lastName, email);

          return userId;
        });
        await account.sendWelcome({ id: newUserId, first_name: firstName });
      } else {
        // Signing in with Google proves the address, so the account counts as confirmed from now on.
        await db.prepare(`
          UPDATE users
          SET google_sub = ?, last_login = NOW(), email_verified = 1
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

    const { returnTo, arrivalPass } = req.session;
    return req.session.regenerate(error => {
      if (error) return next(error);
      req.session.user = buildSessionUser(user);
      if (returnTo) req.session.returnTo = returnTo;
      if (arrivalPass) req.session.arrivalPass = arrivalPass;   // scanned the resort's check-in QR before signing in
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
      const { returnTo, arrivalPass } = req.session;
      return req.session.regenerate(error => {
        if (error) return next(error);

        req.session.user = buildSessionUser(user);
        if (returnTo) req.session.returnTo = returnTo;
        if (arrivalPass) req.session.arrivalPass = arrivalPass;   // scanned the resort's check-in QR before signing in
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

      // Confirm the address before the first booking (src/utils/accountEmails.js).
      await account.sendVerification(newUser);

      const { returnTo, arrivalPass } = req.session;
      return req.session.regenerate(error => {
        if (error) return next(error);

        req.session.user = buildSessionUser(newUser);
        req.session.verifySentAt = Date.now();
        if (returnTo) req.session.returnTo = returnTo;
        if (arrivalPass) req.session.arrivalPass = arrivalPass;
        req.session.flash = {
          success: `Welcome, ${first_name}! We sent a link to ${newUser.email} — open it to confirm your email, then you can book.`,
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

// ── Confirm email ───────────────────────────────────────────────────────────
// The link from the confirmation email. Works signed in or out.
router.get('/verify-email', async (req, res) => {
  const found = await account.findToken(req.query.token, 'verify');
  const signedIn = req.session && req.session.user;
  if (!found || !found.is_active) {
    req.session.flash = { error: 'That confirmation link has expired or was already used. Sign in and ask for a new one.' };
    return res.redirect(signedIn ? '/portal' : '/auth/login');
  }
  if (await account.useToken(found.token_id)) {
    const firstTime = Number(found.email_verified) !== 1;
    await db.prepare('UPDATE users SET email_verified = 1, updated_at = NOW() WHERE id = ?').run(found.id);
    if (firstTime) await account.sendWelcome(found);
  }
  if (signedIn && req.session.user.id === found.id) req.session.user.emailVerified = true;
  req.session.flash = { success: 'Thank you — your email is confirmed. You can now book.' };
  return res.redirect(signedIn ? '/portal' : '/auth/login');
});

// "Send the link again" (signed-in guests whose email isn't confirmed yet). At most once a minute.
router.post('/verify-email/resend', async (req, res) => {
  const user = req.session && req.session.user;
  if (!user) return res.redirect('/auth/login');
  const back = (req.get('Referer') || '').startsWith(`${req.protocol}://${req.get('host')}`) ? req.get('Referer') : '/portal';
  const row = await get('SELECT id, email, first_name, email_verified FROM users WHERE id = ? AND is_active = 1', [user.id]);
  if (!row || Number(row.email_verified) === 1) {
    req.session.user.emailVerified = true;
    return res.redirect(back);
  }
  if (req.session.verifySentAt && Date.now() - req.session.verifySentAt < 60000) {
    req.session.flash = { info: 'We just sent a link — please wait a minute before asking for another, and check your spam folder.' };
    return res.redirect(back);
  }
  await account.sendVerification(row);
  req.session.verifySentAt = Date.now();
  req.session.flash = { success: `We sent a new confirmation link to ${row.email}.` };
  return res.redirect(back);
});

// ── Forgot / reset password ─────────────────────────────────────────────────
router.get('/forgot-password', (req, res) => {
  res.render('auth/forgot', { title: 'Forgot password - Balai-Reserve', layout: 'layouts/auth', errors: [], old: {}, sent: false });
});

router.post('/forgot-password',
  [body('email').isEmail().normalizeEmail().withMessage('Enter a valid email address.')],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.render('auth/forgot', { title: 'Forgot password - Balai-Reserve', layout: 'layouts/auth', errors: errors.array(), old: req.body, sent: false });
    }
    // The same answer whether or not the address has an account, so the form can't be used to find accounts.
    const user = await get('SELECT id, email, first_name FROM users WHERE lower(email) = lower(?) AND is_active = 1', [req.body.email]);
    if (user) await account.sendPasswordReset(user);
    return res.render('auth/forgot', { title: 'Check your email - Balai-Reserve', layout: 'layouts/auth', errors: [], old: req.body, sent: true });
  });

router.get('/reset-password', async (req, res) => {
  const found = await account.findToken(req.query.token, 'reset');
  res.render('auth/reset', { title: 'Choose a new password - Balai-Reserve', layout: 'layouts/auth', errors: [], token: found ? req.query.token : '', valid: !!(found && found.is_active) });
});

router.post('/reset-password',
  [
    body('password').isLength({ min: 8 }).withMessage('Password must be at least 8 characters.'),
    body('password_confirm').custom((value, { req }) => {
      if (value !== req.body.password) throw new Error('Passwords do not match.');
      return true;
    }),
  ],
  async (req, res) => {
    const token = typeof req.body.token === 'string' ? req.body.token : '';
    const found = await account.findToken(token, 'reset');
    const render = (errors, valid = true) => res.render('auth/reset', { title: 'Choose a new password - Balai-Reserve', layout: 'layouts/auth', errors, token, valid });
    if (!found || !found.is_active) return render([], false);
    const errors = validationResult(req);
    if (!errors.isEmpty()) return render(errors.array());
    if (!(await account.useToken(found.token_id))) return render([], false);
    // Opening the link proves the address too.
    await db.prepare('UPDATE users SET password_hash = ?, email_verified = 1, updated_at = NOW() WHERE id = ?')
      .run(bcrypt.hashSync(req.body.password, 12), found.id);
    await db.prepare("UPDATE email_tokens SET used_at = NOW() WHERE user_id = ? AND purpose = 'reset' AND used_at IS NULL").run(found.id);
    await account.sendPasswordChanged(found);
    await req.audit('password_reset', 'users', found.id, null, null);
    req.session.flash = { success: 'Your password has been changed. Sign in with your new password.' };
    return res.redirect('/auth/login');
  });

router.get('/logout', (req, res) => {
  req.session.destroy(error => {
    if (error) return res.status(500).send('Could not sign out. Please try again.');
    return res.redirect('/auth/login');
  });
});

module.exports = router;
