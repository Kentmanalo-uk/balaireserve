/**
 * Balai-Reserve – Main Application Entry Point
 * =============================================
 * Online Booking & Event Management System
 * Framework: Xianfire (custom .xian template engine over Express)
 * Database:  MySQL via mysql2
 */
'use strict';

require('dotenv').config();
// Local key files (not committed). On the server the same names are real environment variables, which win.
require('dotenv').config({ path: require('path').join(__dirname, 'google.env') });
require('dotenv').config({ path: require('path').join(__dirname, 'resend.env') });

const express     = require('express');
require('express-async-errors'); // route async handler rejections to the error handler
const path        = require('path');
const session     = require('express-session');
const cookieParser= require('cookie-parser');
const helmet      = require('helmet');
const morgan      = require('morgan');
const rateLimit   = require('express-rate-limit');

// ΓöÇΓöÇ Xianfire Engine & Helpers ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ
const xianfire = require('./src/xianfire/engine');
const { xianHelpersMiddleware } = require('./src/xianfire/helpers');
const { reconcileExpiredReservations } = require('./src/utils/reservationAvailability');
const { withExistingPhotos, photosFirst } = require('./src/utils/catalog');
const { publicSettings } = require('./src/utils/publicSettings');

// ΓöÇΓöÇ Middleware ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ
const { attachAudit } = require('./src/middleware/auth');

// ΓöÇΓöÇ Database ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ
const db = require('./src/config/database');
const MySqlSessionStore = require('./src/config/sessionStore');
const { UPLOAD_ROOT, seedUploads } = require('./src/config/paths');

// ΓöÇΓöÇ Notification Utility ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ
const { getUnreadCount, getRecentNotifications } = require('./src/utils/notifications');

// ΓöÇΓöÇ Route modules ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ
const authRoutes         = require('./src/modules/auth/routes');
const dashboardRoutes    = require('./src/modules/dashboard/routes');
const portalRoutes       = require('./src/modules/portal/routes');
const roomRoutes         = require('./src/modules/rooms/routes');
const venueRoutes        = require('./src/modules/venues/routes');
const cottageRoutes      = require('./src/modules/cottages/routes');
const reservationRoutes  = require('./src/modules/reservations/routes');
const guestRoutes        = require('./src/modules/guests/routes');
const eventRoutes        = require('./src/modules/events/routes');
const inventoryRoutes    = require('./src/modules/inventory/routes');
const paymentRoutes      = require('./src/modules/payments/routes');
const inquiryRoutes      = require('./src/modules/inquiries/routes');
const crmRoutes          = require('./src/modules/crm/routes');
const feedbackRoutes     = require('./src/modules/feedback/routes');
const reportRoutes       = require('./src/modules/reports/routes');
const analyticsRoutes    = require('./src/modules/analytics/routes');
const notificationRoutes = require('./src/modules/notifications/routes');
const usersRoutes        = require('./src/modules/users/routes');
const profileRoutes      = require('./src/modules/profile/routes');
const settingsRoutes     = require('./src/modules/settings/routes');

// ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ
const app  = express();
const PORT = process.env.PORT || 3000;
const isDev= process.env.NODE_ENV !== 'production';

// ★★★ DITO ANG FIX: Trust the proxy (Nginx) so rate-limit works correctly ★★★
app.set('trust proxy', 1);

// For uptime checks: is the app up, and can it reach the database? Answers before everything else.
app.get('/health', async (req, res) => {
  try {
    await db.prepare('SELECT 1 AS ok').get();
    res.set('Cache-Control', 'no-store').json({ ok: true });
  } catch {
    res.set('Cache-Control', 'no-store').status(503).json({ ok: false });
  }
});

// One address: www. goes to the main domain, so sign-in (Google included) always stays on the same site.
app.use((req, res, next) => {
  const host = req.hostname || '';
  if (host.startsWith('www.') && (req.method === 'GET' || req.method === 'HEAD')) {
    return res.redirect(301, `https://${host.slice(4)}${req.originalUrl}`);
  }
  next();
});

// A request stuck on something slow gets a clear answer instead of hanging until the browser times out.
// (Uploads are exempt: a photo on a slow connection can legitimately take longer.)
app.use((req, res, next) => {
  if (req.is('multipart/form-data')) return next();
  const timer = setTimeout(() => {
    if (res.headersSent) return;
    console.error(`[timeout] ${req.method} ${req.originalUrl}`);
    res.status(503).set('Retry-After', '10').type('html').send('<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Please try again</title><body style="font-family:system-ui,sans-serif;text-align:center;padding:48px 20px"><h1>That took too long</h1><p>Please try again in a moment.</p><p><a href="/">Back to Balai-Reserve</a></p>');
  }, 30000);
  res.on('close', () => clearTimeout(timer));
  next();
});

// ΓöÇΓöÇ Security Headers ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc:  ["'self'", "'unsafe-inline'", 'cdn.jsdelivr.net', 'cdnjs.cloudflare.com',
                   'static.cloudflareinsights.com'],
      styleSrc:   ["'self'", "'unsafe-inline'", 'cdn.jsdelivr.net', 'cdnjs.cloudflare.com', 'fonts.googleapis.com'],
      fontSrc:    ["'self'", 'fonts.gstatic.com', 'cdnjs.cloudflare.com', 'data:'],
      imgSrc:     ["'self'", 'data:', 'blob:'],
      connectSrc: ["'self'", 'cdn.jsdelivr.net', 'cdnjs.cloudflare.com', 'fonts.googleapis.com', 'fonts.gstatic.com',
                   'cloudflareinsights.com'],
      frameSrc:   ["'self'"],
      formAction: ["'self'"],
      workerSrc:  ["'self'", 'blob:'],
      // Buttons and selects in the views use onclick / onsubmit / onchange (scripts are already allowed inline).
      scriptSrcAttr: ["'unsafe-inline'"],
    },
  },
  crossOriginEmbedderPolicy: false,
}));

// ΓöÇΓöÇ Request Logging ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ
if (!isDev) app.use(morgan('combined'));
else        app.use(morgan('dev'));

// ΓöÇΓöÇ Rate Limiting ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ
// Many real guests can share one IP (resort Wi-Fi, mobile carriers), so this limit only stops floods:
// page assets and the booking / check-in desk status checks don't count. Guessing passwords is limited
// separately, per account, after the form is parsed (below).
app.use(rateLimit({
  windowMs: 15 * 60 * 1000,
  max:      isDev ? 100000 : parseInt(process.env.RATE_LIMIT_PER_IP || '3000', 10),
  standardHeaders: true, legacyHeaders: false,
  skip: (req) => /^\/(css|js|images|img|fonts|vendor|qrcodes|uploads)\//.test(req.path)
    || /^\/(sw\.js|manifest\.webmanifest|favicon\.(svg|ico)|offline\.html|health)$/.test(req.path)
    || /^\/portal\/my-reservations\/\d+\/live$/.test(req.path)
    || /^\/checkin\/desk\/(code|lists)$/.test(req.path),
  handler: (req, res) => {
    res.status(429).set('Retry-After', '60').type('html').send('<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Please wait</title><body style="font-family:system-ui,sans-serif;text-align:center;padding:48px 20px"><h1>Please wait a moment</h1><p>There is a lot of traffic from your network right now. Please try again in a minute.</p><p><a href="/">Back to Balai-Reserve</a></p>');
  },
}));

// ΓöÇΓöÇ Body Parsing ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(express.json({ limit: '10mb' }));
app.use(cookieParser());

// Sign-in and account forms: limited per account + IP, so one person's mistakes (or someone guessing a
// password) can't lock out everyone else on the same Wi-Fi; the second limit stops guessing many accounts.
const AUTH_FORMS = new Set(['/login', '/register', '/forgot-password', '/reset-password', '/verify-email/resend']);
const authFormOnly = (req) => req.method !== 'POST' || !AUTH_FORMS.has(req.path);
const tooManyTries = 'Too many attempts. Please wait 15 minutes and try again.';
app.use('/auth', rateLimit({
  windowMs: 15 * 60 * 1000, max: isDev ? 1000 : 15, standardHeaders: true, legacyHeaders: false, skip: authFormOnly, message: tooManyTries,
  keyGenerator: (req) => `${req.ip}|${String(req.body?.email || '').trim().toLowerCase()}`,
}));
app.use('/auth', rateLimit({
  windowMs: 15 * 60 * 1000, max: isDev ? 5000 : 200, standardHeaders: true, legacyHeaders: false, skip: authFormOnly, message: tooManyTries,
}));

// ── Static files (before the session, so files never touch the session store) ──
// Versioned URLs (?v=<hash>, added by src/utils/pageOptimizer.js) can be cached for a year; anything
// else is cached for a day and revalidated. Uploads have unique file names.
const staticLong  = express.static(path.join(__dirname, 'public'), { maxAge: '365d', immutable: true });
const staticShort = express.static(path.join(__dirname, 'public'), {
  maxAge: '1d',
  setHeaders: (res, file) => { if (/[\\/]sw\.js$/.test(file)) res.setHeader('Cache-Control', 'no-cache'); },   // app updates reach installed apps at once
});
app.use((req, res, next) => (req.query.v ? staticLong : staticShort)(req, res, next));
app.get('/img/:w/*', require('./src/utils/images').imageRoute);   // resized WebP photos

app.use('/uploads/payment_proofs', async (req, res) => {
  res.status(403).send('Forbidden');
});
app.use('/uploads', express.static(UPLOAD_ROOT, { maxAge: '30d' }));

// ΓöÇΓöÇ Session ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ
app.use(session({
  store: new MySqlSessionStore(db, { clearIntervalMs: 900000 }),
  secret:            process.env.SESSION_SECRET || 'balai-reserve-change-me',
  resave:            false,
  saveUninitialized: false,
  cookie: {
    secure:   !isDev,
    httpOnly: true,
    maxAge:   24 * 60 * 60 * 1000,
    sameSite: 'lax',
  },
}));


// ΓöÇΓöÇ Xianfire Template Engine ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ
// Ikions icons: <i class="fas fa-…"> in rendered pages gets the matching SVG (src/utils/ikions.js).
app.use(require('./src/utils/ikions').ikionsMiddleware);
// Responsive photos, lazy images and versioned CSS/JS links on every page (src/utils/pageOptimizer.js).
app.use(require('./src/utils/pageOptimizer').pageOptimizerMiddleware);

xianfire.register(app, { viewsDir: path.join(__dirname, 'views') });

// ΓöÇΓöÇ Global Template Helpers (pure functions — no per-request state) ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ
app.use(xianHelpersMiddleware);

// ΓöÇΓöÇ Per-request globals (single authoritative block) ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ
app.use(async (req, res, next) => {
  const user = req.session?.user || null;

  res.locals.flash = req.session?.flash || {};
  if (req.session?.flash) delete req.session.flash;

  res.locals.appName     = process.env.APP_NAME || 'Balai-Reserve';
  res.locals.currentUser = user;
  res.locals.currentPath = req.path;
  // The public address (for absolute links in page metadata); the request's own host when APP_URL is local.
  const _appUrl = (process.env.APP_URL || '').replace(/\/+$/, '');
  res.locals.siteUrl = _appUrl && !/\/\/(localhost|127\.0\.0\.1)/i.test(_appUrl) ? _appUrl : `${req.protocol}://${req.get('host')}`;
  // Shown as "Received by" on payments (the resort's cashier); who typed an entry is kept as "Recorded by".
  res.locals.paymentReceiver = process.env.PAYMENT_RECEIVER_NAME || 'Maria Nora Miciano';

  res.locals.activeTab              = null;
  res.locals.unreadNotifCount       = 0;
  res.locals.recentNotifications    = [];
  res.locals.pendingInquiriesCount  = 0;
  res.locals.pendingReservationsCount = 0;

  if (user) {
    try {
      res.locals.unreadNotifCount      = await getUnreadCount(user.id);
      res.locals.recentNotifications   = await getRecentNotifications(user.id, 6);
      res.locals.pendingInquiriesCount = (await db.prepare(
        `SELECT COUNT(*) AS c FROM inquiries WHERE status IN ('open','in_progress')`
      ).get()).c || 0;
      res.locals.pendingReservationsCount = (await db.prepare(
        `SELECT COUNT(*) AS c FROM reservations WHERE status IN ('pending','awaiting_payment')`
      ).get()).c || 0;
    } catch { /* non-critical — never let badge queries crash a page */ }
  }

  next();
});

// ΓöÇΓöÇ Audit helper on every request ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ
app.use(attachAudit(db));

// ΓöÇΓöÇ Favicon (browsers request /favicon.ico automatically) ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ
app.get('/favicon.ico', async (req, res) => res.redirect('/favicon.svg'));

// ΓöÇΓöÇ Root: show public landing page to everyone (auth status changes nav only) ΓöÇΓöÇΓöÇΓöÇ
app.get('/', async (req, res) => {
  // Every list is the live catalogue (active items only), so prices, counts
  // and photos on the landing page always match what guests can book.
  // Only photos whose files exist are shown; listings with real photos lead.
  const featuredRooms = photosFirst(withExistingPhotos(await db.prepare(
    "SELECT r.*, rt.name AS type_name FROM rooms r JOIN room_types rt ON rt.id=r.room_type_id WHERE r.is_active=1 ORDER BY r.price LIMIT 12"
  ).all()));
  const featuredVenues   = photosFirst(withExistingPhotos(await db.prepare("SELECT * FROM venues   WHERE is_active=1 ORDER BY price LIMIT 3").all()));
  const featuredCottages = photosFirst(withExistingPhotos(await db.prepare("SELECT * FROM cottages WHERE is_active=1 ORDER BY price LIMIT 6").all()));

  // Inclusions are stored as {name, price, is_default, is_optional}; very old
  // rows may still be plain strings, which count as included items.
  const eventPackages = withExistingPhotos(await db.prepare("SELECT * FROM event_packages WHERE is_active=1 ORDER BY price").all());
  await require('./src/utils/eventPackages').attachPlaces(eventPackages);
  for (const p of eventPackages) {
    let list = [];
    try { list = JSON.parse(p.inclusions || '[]'); } catch { list = []; }
    if (!Array.isArray(list)) list = [];
    list = list
      .map(i => (typeof i === 'string' ? { name: i, price: 0, is_default: 1, is_optional: 0 } : i))
      .filter(i => i && typeof i.name === 'string' && i.name.trim());
    p.inclusionsList = list;
    p.includedItems  = list.filter(i => Number(i.is_default) === 1 || !Number(i.is_optional));
    p.addonItems     = list.filter(i => Number(i.is_default) !== 1 && Number(i.is_optional) && Number(i.price) > 0);
  }

  // Only real, public, well-rated feedback with a comment is shown.
  const reviews = await db.prepare(`
    SELECT f.rating, f.comments, f.created_at,
           cu.first_name || ' ' || SUBSTR(cu.last_name,1,1) || '.' AS customer_name
    FROM feedback f
    JOIN customers cu ON cu.id = f.customer_id
    WHERE f.is_public = 1 AND f.rating >= 4 AND TRIM(COALESCE(f.comments, '')) <> ''
    ORDER BY f.rating DESC, f.created_at DESC
    LIMIT 6
  `).all();

  const settingsRows = await db.prepare("SELECT `key`, value FROM settings").all();
  const siteSettings = {};
  settingsRows.forEach(s => { siteSettings[s.key] = s.value; });

  // Gallery: the admin's landing photos (Settings > Landing Page); until there are any,
  // the real catalogue photos, each captioned with the place it shows.
  let landingGallery = [];
  try { landingGallery = JSON.parse(siteSettings.landing_gallery || '[]'); } catch { landingGallery = []; }
  if (!Array.isArray(landingGallery)) landingGallery = [];
  landingGallery = landingGallery.filter(g => g && typeof g.path === 'string' && g.path.startsWith('/uploads/settings/landing/'));
  const catalogPhotos = [];
  for (const row of [...featuredRooms, ...featuredCottages, ...featuredVenues]) {
    for (const src of (row.imagesList || [])) catalogPhotos.push({ path: src, caption: row.name });
  }

  res.render('landing/index', {
    title:  'Balai-Reserve — Your Home Away From Home',
    layout: 'layouts/landing',
    featuredRooms, featuredVenues, featuredCottages,
    eventPackages, reviews, landingGallery, catalogPhotos,
    hasEvents: eventPackages.length > 0,
    hasGallery: landingGallery.length > 0 || catalogPhotos.length > 0,
    site: publicSettings(siteSettings),
  });
});

app.use(async (req, res, next) => {
  try {
    await reconcileExpiredReservations(db);
  } catch (error) {
    console.error('[reconciler] Error during reconciliation:', error);
  }
  next();
});

// ΓöÇΓöÇ Authentication ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ
// Back-office modules are staff-only: customers are sent to their portal.
// (Public chatbot endpoints under /inquiries stay open.)
const PUBLIC_STAFF_PATHS = new Set(['/inquiries/submit', '/inquiries/chat']);
const staffArea = (req, res, next) => {
  if (req.session?.user?.role !== 'customer' || PUBLIC_STAFF_PATHS.has(req.baseUrl + req.path)) return next();
  return res.redirect('/portal');
};

app.use('/auth', authRoutes);
app.use('/portal', portalRoutes);
app.use('/stay', require('./src/modules/stay/routes'));   // public listing detail pages (no login)
app.use('/', require('./src/modules/site/routes'));          // robots.txt, sitemap.xml, privacy, terms, security.txt
app.use('/dashboard',     dashboardRoutes);
app.use('/rooms',         staffArea, roomRoutes);
app.use('/venues',        staffArea, venueRoutes);
app.use('/cottages',      staffArea, cottageRoutes);
app.use('/reservations',  staffArea, reservationRoutes);
app.use('/guests',        staffArea, guestRoutes);
app.use('/events',        staffArea, eventRoutes);
app.use('/packages',      staffArea, require('./src/modules/packages/routes'));   // event packages (Birthday, Wedding …)
app.use('/inventory',     staffArea, inventoryRoutes);
app.use('/payments',      paymentRoutes);
app.use('/inquiries',     staffArea, inquiryRoutes);
app.use('/crm',           staffArea, crmRoutes);
app.use('/feedback',      feedbackRoutes);
app.use('/reports',       reportRoutes);
app.use('/analytics',     analyticsRoutes);
app.use('/notifications', notificationRoutes);
app.use('/users',         usersRoutes);
app.use('/profile',       profileRoutes);
app.use('/settings',      settingsRoutes);

// ΓöÇΓöÇ QR Check-in (public — no auth required) ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ
// Check-in desk with the resort QR, check-in by booking ref, older booking QRs (src/modules/checkin).
app.use('/checkin', require('./src/modules/checkin/routes'));
// Guests scan the resort QR with their own phone to check themselves in (src/modules/arrive).
app.use('/arrive', require('./src/modules/arrive/routes'));

// ΓöÇΓöÇ 404 ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ
app.use((req, res) => {
  res.status(404).render('errors/404', { title: 'Page Not Found', layout: 'layouts/main' });
});

// ΓöÇΓöÇ Global Error Handler ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error('[Error]', err.stack || err.message);
  const status  = err.status || 500;
  const message = isDev ? err.message : 'An unexpected error occurred.';
  res.status(status).render('errors/500', {
    title: 'Server Error', layout: 'layouts/main', message,
  });
});

// ΓöÇΓöÇ Start ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ
// A fresh server (or a new UPLOAD_PATH folder) gets the catalog photos.
try {
  const seeded = seedUploads();
  if (seeded) console.log(`Copied ${seeded} catalog photo(s) into ${UPLOAD_ROOT}`);
} catch (err) {
  console.error('Could not copy catalog photos:', err.message);
}

// Columns added since the database was first set up (e.g. event package photos).
require('./src/database/ensureSchema').ensureSchema().catch(err => console.error('[schema] check failed:', err.message));

const server = app.listen(PORT, () => {
  console.log('');
  console.log('  ΓòöΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòù');
  console.log('  Γòæ         Balai-Reserve is running         Γòæ');
  console.log(`  Γòæ   http://localhost:${PORT}                  Γòæ`);
  console.log('  ΓòÜΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓò¥');
  console.log('');
  console.log('  Routes mounted:');
  console.log('  /portal       — Customer self-service portal');
  console.log('  /dashboard    — Role-specific dashboards');
  console.log('  /users        — User management (admin)');
  console.log('  /profile      — Profile & password (all roles)');
  console.log('  /feedback     — Customer feedback management');
  console.log('  /cottages     — Cottage management');
  console.log('  /payments/:id — Payment detail + refund');
  console.log('');
});

module.exports = app;

// Keep connections open longer than the CDN / proxy in front does: otherwise Node closes an idle connection
// just as the proxy reuses it, and that visitor gets a random failed request.
server.keepAliveTimeout = 75000;
server.headersTimeout = 80000;
server.requestTimeout = 120000;   // photo uploads on slow connections

// Restarts and deploys: finish what is in progress, then exit.
const shutdown = (signal) => {
  console.log(`[${signal}] shutting down`);
  server.close(() => db.close().catch(() => {}).finally(() => process.exit(0)));
  setTimeout(() => process.exit(0), 10000).unref();
};
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('unhandledRejection', (err) => console.error('[unhandledRejection]', err));
