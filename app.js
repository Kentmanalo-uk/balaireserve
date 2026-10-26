/**
 * Balai-Reserve – Main Application Entry Point
 * =============================================
 * Online Booking & Event Management System
 * Framework: Xianfire (custom .xian template engine over Express)
 * Database:  MySQL via mysql2
 */
'use strict';

require('dotenv').config();

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
    },
  },
  crossOriginEmbedderPolicy: false,
}));

// ΓöÇΓöÇ Request Logging ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ
if (!isDev) app.use(morgan('combined'));
else        app.use(morgan('dev'));

// ΓöÇΓöÇ Rate Limiting ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ
app.use('/auth', rateLimit({
  windowMs: 15 * 60 * 1000,
  max:      isDev ? 300 : 30,
  standardHeaders: true, legacyHeaders: false,
  skip: (req) => req.method === 'GET' && ['/login', '/register'].includes(req.path),
  message: 'Too many login attempts. Please wait 15 minutes and try again.',
}));

app.use(rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS || '900000'),
  max:      isDev ? 10000 : parseInt(process.env.RATE_LIMIT_MAX || '500'),
  standardHeaders: true, legacyHeaders: false,
  skip: (req) => /^\/(css|js|images|qrcodes|uploads)/.test(req.path),
  handler: (req, res) => {
    if (req.session?.user) {
      return res.status(429).render('errors/429', {
        title:  'Too Many Requests',
        layout: 'layouts/main',
        message: 'You have sent too many requests. Please wait a moment.',
      });
    }
    res.status(429).send('Too many requests. Please wait and try again.');
  },
}));

// ΓöÇΓöÇ Body Parsing ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(express.json({ limit: '10mb' }));
app.use(cookieParser());

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

// ΓöÇΓöÇ Static Files ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ
app.use(express.static(path.join(__dirname, 'public')));

app.use('/uploads/payment_proofs', async (req, res) => {
  res.status(403).send('Forbidden');
});
app.use('/uploads', express.static(UPLOAD_ROOT));

// ΓöÇΓöÇ Xianfire Template Engine ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ
// Ikions icons: <i class="fas fa-…"> in rendered pages gets the matching SVG (src/utils/ikions.js).
app.use(require('./src/utils/ikions').ikionsMiddleware);

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
  const eventPackages = await db.prepare("SELECT * FROM event_packages WHERE is_active=1 ORDER BY price").all();
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
app.use('/dashboard',     dashboardRoutes);
app.use('/rooms',         staffArea, roomRoutes);
app.use('/venues',        staffArea, venueRoutes);
app.use('/cottages',      staffArea, cottageRoutes);
app.use('/reservations',  staffArea, reservationRoutes);
app.use('/guests',        staffArea, guestRoutes);
app.use('/events',        staffArea, eventRoutes);
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
const { validateQRToken, consumeQRToken, renderQRPng } = require('./src/utils/qrGenerator');
const { requireAuth, requireRole } = require('./src/middleware/auth');
const { notifyReservationCustomer } = require('./src/utils/notifications');

const renderInvalidQR = (res, reason) => res.render('guests/checkin-invalid', {
  title:  'Invalid QR Code',
  layout: 'layouts/minimal',
  reason,
});

// QR image is rendered on demand so it always encodes the current public address.
app.get('/checkin/:token/qr.png', async (req, res) => {
  const qr = await db.prepare('SELECT id FROM qr_codes WHERE token = ?').get(req.params.token);
  if (!qr) return res.status(404).end();
  res.type('png').set('Cache-Control', 'no-store').send(await renderQRPng(req.params.token));
});

// Anyone can open the scanned link; only staff can confirm the check-in.
app.get('/checkin/:token', async (req, res) => {
  const result = await validateQRToken(req.params.token);
  if (!result.valid) return renderInvalidQR(res, result.reason);

  const reservation = await db.prepare(`
    SELECT r.*, c.first_name, c.last_name, c.phone, c.email
    FROM reservations r JOIN customers c ON c.id = r.customer_id
    WHERE r.id = ?
  `).get(result.qr.reservation_id);

  const role = req.session?.user?.role;
  res.render('guests/checkin-scan', {
    title:       'QR Check-in',
    layout:      'layouts/minimal',
    reservation,
    token:       req.params.token,
    isStaff:     role === 'admin' || role === 'staff',
    isLoggedIn:  !!role,
  });
});

// Staff who scan while logged out sign in here and come back to the check-in page.
app.get('/checkin/:token/staff', requireAuth, (req, res) => res.redirect(`/checkin/${req.params.token}`));

app.post('/checkin/:token', requireAuth, requireRole('admin', 'staff'), async (req, res) => {
  const result = await validateQRToken(req.params.token);
  if (!result.valid) return renderInvalidQR(res, result.reason);

  const resId = result.qr.reservation_id;
  const checkedIn = await db.transaction(async () => {
    if (!(await consumeQRToken(req.params.token))) return false;
    await db.prepare(`UPDATE reservations SET status='checked_in', updated_at=NOW() WHERE id=?`).run(resId);
    await db.prepare(`
      INSERT INTO reservation_status_history (reservation_id, from_status, to_status, changed_by, notes)
      VALUES (?, ?, 'checked_in', ?, 'Checked in via QR scan')
    `).run(resId, result.qr.status, req.session.user.id);
    const items = await db.prepare(`SELECT item_type, item_id FROM reservation_items WHERE reservation_id = ?`).all(resId);
    for (const item of items) {
      if (item.item_type === 'room')    await db.prepare(`UPDATE rooms SET status='occupied' WHERE id=?`).run(item.item_id);
      if (item.item_type === 'venue')   await db.prepare(`UPDATE venues SET status='occupied' WHERE id=?`).run(item.item_id);
      if (item.item_type === 'cottage') await db.prepare(`UPDATE cottages SET status='occupied' WHERE id=?`).run(item.item_id);
    }
    await db.prepare(`INSERT INTO check_ins (reservation_id, method, checked_in_by) VALUES (?, 'qr', ?)`).run(resId, req.session.user.id);
    await db.prepare(`UPDATE guests SET status='checked_in' WHERE reservation_id=?`).run(resId);
    return true;
  });
  if (!checkedIn) return renderInvalidQR(res, 'This QR code has already been used or is no longer valid.');

  await notifyReservationCustomer(resId, 'reservation', 'Checked In',
    `You are checked in for booking ${result.qr.booking_ref}. Enjoy your stay!`, `/portal/my-reservations/${resId}`);
  await req.audit('qr_checkin', 'reservations', resId, null, { token: req.params.token });

  res.render('guests/checkin-success', {
    title: 'Check-in Successful', layout: 'layouts/minimal', reservationId: resId, bookingRef: result.qr.booking_ref,
  });
});

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

app.listen(PORT, () => {
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