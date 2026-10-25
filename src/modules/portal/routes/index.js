/**
 * Customer Portal Routes  (/portal)
 */
'use strict';

const express = require('express');
const path    = require('path');
const fs      = require('fs');
const crypto  = require('crypto');
const multer  = require('multer');
const bcrypt  = require('bcryptjs');
const { body, validationResult } = require('express-validator');
const db      = require('../../../config/database');
const { uploadDir, uploadFileFromUrl } = require('../../../config/paths');
const { requireAuth, requireRole } = require('../../../middleware/auth');
const { generateBookingRef }       = require('../../../utils/bookingRef');
const { generateReservationQR }    = require('../../../utils/qrGenerator');
const { notifyAllAdmins, notifyUser } = require('../../../utils/notifications');
const { validateGcashScreenshot }     = require('../../../utils/gcashValidator');
const { calculateCottageTotal, validateCottageTimeRange } = require('../../../utils/cottagePricing');
const { publicSettings } = require('../../../utils/publicSettings');
const { uniqueCatalogRows, imageExists, withExistingPhotos, photosFirst } = require('../../../utils/catalog');

const router = express.Router();

const PROOF_DIR = uploadDir('payment_proofs');
if (!fs.existsSync(PROOF_DIR)) fs.mkdirSync(PROOF_DIR, { recursive: true });

const proofStorage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, PROOF_DIR),
  filename:    (_req, file, cb) => {
    const ext   = path.extname(file.originalname).toLowerCase();
    const token = crypto.randomBytes(24).toString('hex');
    cb(null, 'proof-' + token + ext);
  },
});
const proofUpload = multer({
  storage: proofStorage,
  limits:  { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ok = ['.jpg','.jpeg','.png','.webp','.gif','.pdf'].includes(
      path.extname(file.originalname).toLowerCase()
    );
    cb(ok ? null : new Error('Only images and PDF files are allowed.'), ok);
  },
});

const STAFF_ROLES = ['admin','staff'];
const BOOKABLE_RESOURCE_STATUSES = new Set(['available', 'reserved', 'occupied', 'cleaning']);
async function activeItemReservations(itemType) {
  return await db.prepare(`
    SELECT ri.item_id, r.reservation_type, r.check_in_date, r.check_out_date,
           r.event_date, r.start_time, r.end_time
    FROM reservation_items ri
    JOIN reservations r ON r.id = ri.reservation_id
    WHERE ri.item_type = ?
      AND r.status NOT IN ('cancelled', 'rejected', 'completed', 'no_show', 'checked_out')
  `).all(itemType);
}

function reservationOverlaps(itemType, reservation, requested) {
  if (itemType === 'room') {
    return Boolean(
      requested.checkIn && requested.checkOut &&
      reservation.check_in_date && reservation.check_out_date &&
      reservation.check_in_date < requested.checkOut &&
      reservation.check_out_date > requested.checkIn
    );
  }

  const reservationDate = itemType === 'venue' ? reservation.event_date : reservation.check_in_date;
  if (!requested.date || reservationDate !== requested.date) return false;
  if (!requested.startTime || !requested.endTime ||
      !reservation.start_time || !reservation.end_time) return true;
  return reservation.start_time < requested.endTime &&
    reservation.end_time > requested.startTime;
}

async function unavailableItemIds(itemType, requested) {
  const unavailable = new Set();
  for (const reservation of await activeItemReservations(itemType)) {
    if (reservationOverlaps(itemType, reservation, requested)) unavailable.add(reservation.item_id);
  }
  return unavailable;
}

async function resourceDetails(reservationType, itemId) {
  const table = {
    room: 'rooms',
    venue: 'venues',
    event: 'venues',
    cottage: 'cottages',
  }[reservationType];
  if (!table || !Number.isInteger(itemId) || itemId < 1) return null;
  return (await db.prepare(`SELECT id, name, price, capacity, status, is_active FROM ${table} WHERE id = ?`).get(itemId)) || null;
}

async function resourceConflict(reservationType, itemId, requested) {
  const itemType = reservationType === 'event' ? 'venue' : reservationType;
  return (await activeItemReservations(itemType)).some(reservation =>
    reservation.item_id === itemId && reservationOverlaps(itemType, reservation, requested)
  );
}

function removeUploadedProof(file) {
  if (!file) return;
  try {
    fs.unlinkSync(file.path);
  } catch (error) {
    if (error.code !== 'ENOENT') console.error('[Portal] Could not remove rejected payment proof:', error.message);
  }
}

// Display-only: first existing photo of each booking's main room / cottage / venue (rows need main_item_type + main_item_id).
async function attachItemPhotos(rows) {
  const table = { room: 'rooms', cottage: 'cottages', venue: 'venues' };
  for (const row of rows || []) {
    row.photo = null;
    if (!table[row.main_item_type] || !row.main_item_id) continue;
    const item = await db.prepare(`SELECT id, name, images FROM ${table[row.main_item_type]} WHERE id = ?`).get(row.main_item_id);
    if (!item) continue;
    const [withPhotos] = withExistingPhotos([item]);
    if (withPhotos && withPhotos.imagesList && withPhotos.imagesList.length) row.photo = withPhotos.imagesList[0];
  }
  return rows;
}

function getDownpaymentPercent(value) {
  const percent = Number.parseFloat(value || '50');
  return Number.isFinite(percent) && percent > 0 && percent <= 100 ? percent : 50;
}

async function requireCustomerOrGuest(req, res, next) {
  if (req.session?.user && STAFF_ROLES.includes(req.session.user.role)) {
    return res.redirect('/dashboard');
  }
  next();
}

async function requireCustomer(req, res, next) {
  if (!req.session?.user) {
    req.session.flash    = { error: 'Please sign in to continue.' };
    req.session.returnTo = req.originalUrl;
    return res.redirect('/auth/login');
  }
  if (STAFF_ROLES.includes(req.session.user.role)) {
    return res.redirect('/dashboard');
  }
  next();
}

router.use(async (req, res, next) => {
  res.locals.portalLayout = 'layouts/portal';
  try {
    const settingKeys = ['gcash_number','gcash_name','maya_number','maya_name','bank_bdo','bank_bpi','bank_name','gcash_qr_path','maya_qr_path','downpayment_percent',
      'resort_phone','resort_email','resort_address','check_in_time','check_out_time'];
    const rows = await db.prepare(
      `SELECT \`key\`, value FROM settings WHERE \`key\` IN (${settingKeys.map(() => '?').join(',')})`
    ).all(...settingKeys);
    let pm = {};
    for (const r of rows) pm[r.key] = r.value || '';
    pm = publicSettings(pm);   // seed placeholders / XXXX numbers are not real accounts
    res.locals.paymentInfo = {
      gcash_number: pm.gcash_number  || '—',
      gcash_name:   pm.gcash_name    || 'Balai Miciano Resort',
      maya_number:  pm.maya_number   || '—',
      maya_name:    pm.maya_name     || 'Balai Miciano Resort',
      bank_bdo:     pm.bank_bdo      || '—',
      bank_bpi:     pm.bank_bpi      || '—',
      bank_name:    pm.bank_name     || 'Balai Miciano Resort',
      // A QR whose file is gone is treated as not uploaded, so guests never see a broken image.
      gcash_qr_path: imageExists(pm.gcash_qr_path) ? pm.gcash_qr_path : '',
      maya_qr_path:  imageExists(pm.maya_qr_path)  ? pm.maya_qr_path  : '',
    };
    // Guest-facing price cards show the downpayment from the current setting.
    res.locals.downpaymentPercent = getDownpaymentPercent(pm.downpayment_percent);
    // Display-only: verified contact details (placeholders are blanked by publicSettings) for portal pages.
    res.locals.resortContact = {
      phone: pm.resort_phone || '', email: pm.resort_email || '',
      address: pm.resort_address || 'Brgy. San Antonio, Gloria, Oriental Mindoro, Philippines',
      checkIn: pm.check_in_time || '14:00', checkOut: pm.check_out_time || '12:00',
    };
  } catch (error) {
    return next(error);
  }
  next();
});

async function calculateServerTotal(reservation_type, roomId, venueId, pkgId, ciDate, coDate, startTime, endTime, selectedInclusions = []) {
  let total = 0;
  if (reservation_type === 'room' && roomId) {
    const room = await db.prepare('SELECT price FROM rooms WHERE id = ?').get(roomId);
    if (room && ciDate && coDate) {
      const nights = Math.ceil((new Date(coDate) - new Date(ciDate)) / 86400000);
      total = (room.price || 0) * Math.max(nights, 1);
    } else if (room) {
      total = room.price || 0;
    }
  } else if (reservation_type === 'venue' && venueId) {
    const venue = await db.prepare('SELECT price FROM venues WHERE id = ?').get(venueId);
    total = venue ? (venue.price || 0) : 0;
  } else if (reservation_type === 'cottage' && roomId) {
    const cottage = await db.prepare('SELECT price FROM cottages WHERE id = ?').get(roomId);
    total = cottage && validateCottageTimeRange(startTime, endTime)
      ? calculateCottageTotal(cottage.price)
      : 0;
  } else if (reservation_type === 'event' && venueId) {
    const venue = await db.prepare('SELECT price FROM venues WHERE id = ?').get(venueId);
    total = venue ? (venue.price || 0) : 0;
  }
  if (pkgId) {
    const pkg = await db.prepare('SELECT price, inclusions FROM event_packages WHERE id = ? AND is_active = 1').get(pkgId);
    if (pkg) {
      total += pkg.price || 0;
      if (selectedInclusions.length > 0) {
        let allInclusions = [];
        try { allInclusions = JSON.parse(pkg.inclusions || '[]'); } catch { allInclusions = []; }
        const addonMap = new Map();
        for (const inc of allInclusions) {
          if (inc.is_optional && inc.price > 0) addonMap.set(inc.name, inc.price);
        }
        for (const sel of selectedInclusions) {
          const name = (sel.name || '').trim();
          if (addonMap.has(name)) total += addonMap.get(name);
        }
      }
    }
  }
  return total;
}

router.get('/', requireCustomerOrGuest, async (req, res) => {
  const availableRooms  = (await db.prepare("SELECT COUNT(*) AS c FROM rooms  WHERE status='available' AND is_active=1").get()).c;
  const availableVenues = (await db.prepare("SELECT COUNT(DISTINCT lower(trim(name))) AS c FROM venues WHERE status='available' AND is_active=1").get()).c;
  const availableCottages = (await db.prepare("SELECT COUNT(DISTINCT lower(trim(name))) AS c FROM cottages WHERE status='available' AND is_active=1").get()).c;
  const featuredRooms = photosFirst(withExistingPhotos(await db.prepare("SELECT r.*, rt.name AS type_name FROM rooms r JOIN room_types rt ON rt.id=r.room_type_id WHERE r.status='available' AND r.is_active=1 ORDER BY r.price").all())).slice(0, 3);
  for (const r of featuredRooms) { try { r.imagesList = JSON.parse(r.images || '[]'); } catch { r.imagesList = []; } }
  const featuredVenues = photosFirst(withExistingPhotos(uniqueCatalogRows(await db.prepare("SELECT * FROM venues WHERE status='available' AND is_active=1 ORDER BY price").all()))).slice(0, 3);
  for (const v of featuredVenues) { try { v.imagesList = JSON.parse(v.images || '[]'); } catch { v.imagesList = []; } }
  const featuredCottages = photosFirst(withExistingPhotos(uniqueCatalogRows(await db.prepare("SELECT * FROM cottages WHERE status='available' AND is_active=1 ORDER BY price").all()))).slice(0, 3);
  for (const c of featuredCottages) { try { c.imagesList = JSON.parse(c.images || '[]'); } catch { c.imagesList = []; } }
  const packages = uniqueCatalogRows(await db.prepare('SELECT * FROM event_packages WHERE is_active=1 ORDER BY price').all(), p => `${p.event_type || ''}:${p.name}`).slice(0, 4);
  // The guest's active bookings, so the home page can lead with their next step (pay, upload proof, upcoming stay).
  let activeBookings = [];
  if (req.session?.user) {
    activeBookings = await db.prepare(`
      SELECT r.id, r.booking_ref, r.reservation_type, r.status, r.payment_status, r.check_in_date, r.check_out_date,
             r.event_date, r.start_time, r.end_time, r.total_amount, r.downpayment_req, r.payment_method, r.num_guests,
             (SELECT GROUP_CONCAT(ri.item_name SEPARATOR ', ') FROM reservation_items ri
               WHERE ri.reservation_id = r.id AND ri.item_type IN ('room','cottage','venue','event_package')) AS item_names,
             (SELECT COUNT(*) FROM payments p WHERE p.reservation_id = r.id AND p.submitted_by = 'customer' AND p.status = 'received') AS proofs_pending,
             (SELECT COALESCE(SUM(p.amount),0) FROM payments p WHERE p.reservation_id = r.id AND p.status IN ('received','verified')) AS amount_paid,
             (SELECT COALESCE(SUM(p.amount),0) FROM payments p WHERE p.reservation_id = r.id AND p.status = 'verified') AS verified_paid,
             (SELECT p.status = 'refunded' AND p.notes LIKE '%Rejected by staff%' FROM payments p WHERE p.reservation_id = r.id AND p.submitted_by = 'customer' ORDER BY p.id DESC LIMIT 1) AS last_proof_rejected,
             (SELECT ri.item_type FROM reservation_items ri WHERE ri.reservation_id = r.id AND ri.item_type IN ('room','cottage','venue') ORDER BY ri.id LIMIT 1) AS main_item_type,
             (SELECT ri.item_id FROM reservation_items ri WHERE ri.reservation_id = r.id AND ri.item_type IN ('room','cottage','venue') ORDER BY ri.id LIMIT 1) AS main_item_id
      FROM reservations r JOIN customers c ON c.id = r.customer_id
      WHERE c.user_id = ? AND r.status IN ('pending','pencil','on_hold','awaiting_payment','confirmed','checked_in')
      ORDER BY COALESCE(r.check_in_date, r.event_date) ASC, r.id ASC LIMIT 6
    `).all(req.session.user.id);
    await attachItemPhotos(activeBookings);
  }
  // Display-only: the guest's most recent past bookings (completed, cancelled …) for the home page.
  let pastBookings = [];
  if (req.session?.user) {
    pastBookings = await db.prepare(`
      SELECT r.id, r.booking_ref, r.reservation_type, r.status, r.payment_status, r.check_in_date, r.check_out_date,
             r.event_date, r.start_time, r.end_time, r.total_amount, r.num_guests,
             (SELECT GROUP_CONCAT(ri.item_name SEPARATOR ', ') FROM reservation_items ri
               WHERE ri.reservation_id = r.id AND ri.item_type IN ('room','cottage','venue','event_package')) AS item_names,
             (SELECT COALESCE(SUM(p.amount),0) FROM payments p WHERE p.reservation_id = r.id AND p.status IN ('received','verified')) AS amount_paid,
             (SELECT ri.item_type FROM reservation_items ri WHERE ri.reservation_id = r.id AND ri.item_type IN ('room','cottage','venue') ORDER BY ri.id LIMIT 1) AS main_item_type,
             (SELECT ri.item_id FROM reservation_items ri WHERE ri.reservation_id = r.id AND ri.item_type IN ('room','cottage','venue') ORDER BY ri.id LIMIT 1) AS main_item_id
      FROM reservations r JOIN customers c ON c.id = r.customer_id
      WHERE c.user_id = ? AND r.status NOT IN ('pending','pencil','on_hold','awaiting_payment','confirmed','checked_in')
      ORDER BY COALESCE(r.check_in_date, r.event_date) DESC, r.id DESC LIMIT 3
    `).all(req.session.user.id);
    await attachItemPhotos(pastBookings);
  }
  // Display-only: the guest's latest inquiries (with reply state) for the home page's messages block.
  let recentInquiries = [];
  if (req.session?.user) {
    const cust = await db.prepare('SELECT id, email FROM customers WHERE user_id = ?').get(req.session.user.id);
    if (cust) recentInquiries = await db.prepare(`SELECT id, subject, status, resolution, created_at, resolved_at FROM inquiries WHERE customer_id = ? OR (email != '' AND email = ?) ORDER BY created_at DESC LIMIT 3`).all(cust.id, cust.email || '');
  }
  res.render('portal/home', { title: 'Welcome to Balai-Reserve', layout: 'layouts/portal', availableRooms, availableVenues, availableCottages, featuredRooms, featuredVenues, featuredCottages, packages, activeBookings, pastBookings, recentInquiries });
});

router.get('/rooms', requireCustomerOrGuest, async (req, res) => {
  const { checkin = '', checkout = '', guests = '', type = '', sort = 'price_asc' } = req.query;
  let where = 'WHERE r.is_active=1';
  const params = [];
  if (type)   { where += ' AND rt.name=?';    params.push(type); }
  if (guests) { where += ' AND r.capacity>=?'; params.push(parseInt(guests)); }
  let bookedIds = new Set();
  if (checkin && checkout) {
    bookedIds = await unavailableItemIds('room', { checkIn: checkin, checkOut: checkout });
  }
  const orderBy = sort === 'price_desc' ? 'r.price DESC' : 'r.price ASC';
  const rooms = withExistingPhotos(await db.prepare(`SELECT r.*, rt.name AS type_name FROM rooms r JOIN room_types rt ON rt.id=r.room_type_id ${where} ORDER BY ${orderBy}`).all(...params));
  for (const r of rooms) {
    try { r.imagesList = JSON.parse(r.images || '[]'); } catch { r.imagesList = []; }
    r.isAvailable = BOOKABLE_RESOURCE_STATUSES.has(r.status) &&
      (checkin && checkout ? !bookedIds.has(r.id) : true);
  }
  const roomTypes = await db.prepare('SELECT DISTINCT rt.name FROM room_types rt JOIN rooms r ON r.room_type_id = rt.id WHERE r.is_active = 1 ORDER BY rt.name').all();
  res.render('portal/rooms', { title: 'Browse Rooms – Balai-Reserve', layout: 'layouts/portal', rooms, roomTypes, filters: { checkin, checkout, guests, type, sort } });
});

router.get('/venues', requireCustomerOrGuest, async (req, res) => {
  const { date = '', guests = '', type = '', sort = 'price_asc', start_time = '', end_time = '' } = req.query;
  const okTimes = /^\d{2}:\d{2}$/.test(start_time) && /^\d{2}:\d{2}$/.test(end_time) && end_time > start_time;
  let where = 'WHERE is_active=1';
  const params = [];
  if (type)   { where += ' AND venue_type=?'; params.push(type); }
  if (guests) { where += ' AND capacity>=?';  params.push(parseInt(guests)); }
  const orderBy = sort === 'price_desc' ? 'price DESC' : 'price ASC';
  const venues = withExistingPhotos(uniqueCatalogRows(await db.prepare(`SELECT * FROM venues ${where} ORDER BY ${orderBy}`).all(...params), row => row.name, req.query.item_id));
  const bookedIds = date ? await unavailableItemIds('venue', okTimes ? { date, startTime: start_time, endTime: end_time } : { date }) : new Set();
  for (const v of venues) {
    try { v.imagesList = JSON.parse(v.images || '[]'); } catch { v.imagesList = []; }
    try { v.amenitiesList = JSON.parse(v.amenities || '[]'); } catch { v.amenitiesList = []; }
    v.isAvailable = BOOKABLE_RESOURCE_STATUSES.has(v.status) &&
      (date ? !bookedIds.has(v.id) : true);
  }
  const venueTypes = (await db.prepare(`SELECT DISTINCT venue_type FROM venues WHERE is_active = 1 ORDER BY venue_type`).all()).map(r => r.venue_type);
  const packages = uniqueCatalogRows(await db.prepare('SELECT * FROM event_packages WHERE is_active=1 ORDER BY price').all(), p => `${p.event_type || ''}:${p.name}`);
  for (const p of packages) { try { p.inclusionsList = JSON.parse(p.inclusions || '[]'); } catch { p.inclusionsList = []; } }
  res.render('portal/venues', { title: 'Browse Venues – Balai-Reserve', layout: 'layouts/portal', venues, venueTypes, packages, filters: { date, guests, type, sort, start_time: okTimes ? start_time : '', end_time: okTimes ? end_time : '' } });
});

router.get('/cottages', requireCustomerOrGuest, async (req, res) => {
  const { date = '', guests = '', sort = 'price_asc', max_price = '', start_time = '', end_time = '' } = req.query;
  const okTimes = /^\d{2}:\d{2}$/.test(start_time) && /^\d{2}:\d{2}$/.test(end_time) && end_time > start_time;
  let where = 'WHERE is_active=1';
  const params = [];
  if (guests)    { where += ' AND capacity>=?'; params.push(parseInt(guests)); }
  if (max_price) { where += ' AND price<=?';    params.push(parseFloat(max_price)); }
  const orderBy = sort === 'price_desc' ? 'price DESC' : 'price ASC';
  const cottages = withExistingPhotos(uniqueCatalogRows(await db.prepare(`SELECT * FROM cottages ${where} ORDER BY ${orderBy}`).all(...params), row => row.name, req.query.item_id));
  const bookedIds = date ? await unavailableItemIds('cottage', okTimes ? { date, startTime: start_time, endTime: end_time } : { date }) : new Set();
  for (const c of cottages) {
    try { c.imagesList = JSON.parse(c.images || '[]'); } catch { c.imagesList = []; }
    try { c.amenitiesList = JSON.parse(c.amenities || '[]'); } catch { c.amenitiesList = []; }
    c.isAvailable = BOOKABLE_RESOURCE_STATUSES.has(c.status) &&
      (date ? !bookedIds.has(c.id) : true);
  }
  res.render('portal/cottages', { title: 'Browse Cottages – Balai-Reserve', layout: 'layouts/portal', cottages, filters: { date, guests, sort, max_price, start_time: okTimes ? start_time : '', end_time: okTimes ? end_time : '' } });
});

router.get('/book', requireCustomer, async (req, res) => {
  const { type = '', item_id = '', package_id = '', checkin = '', checkout = '', date = '', start_time = '', end_time = '', guests = '' } = req.query;
  const rooms = await db.prepare("SELECT r.*, rt.name AS type_name FROM rooms r JOIN room_types rt ON rt.id=r.room_type_id WHERE r.status IN ('available','reserved','occupied','cleaning') AND r.is_active=1 ORDER BY r.price").all();
  const venues = uniqueCatalogRows(await db.prepare("SELECT * FROM venues WHERE status IN ('available','reserved','occupied','cleaning') AND is_active=1 ORDER BY price").all(), row => row.name, item_id);
  const rawPkgs = uniqueCatalogRows(await db.prepare('SELECT * FROM event_packages WHERE is_active=1 ORDER BY price').all(), p => `${p.event_type || ''}:${p.name}`, package_id);
  const parseImgs = (row) => withExistingPhotos([row])[0];
  rooms.forEach(parseImgs);
  venues.forEach(parseImgs);
  const packages = rawPkgs.map(p => {
    let inclusions = [];
    try { inclusions = JSON.parse(p.inclusions || '[]'); } catch { inclusions = []; }
    if (inclusions.length > 0 && typeof inclusions[0] === 'string') inclusions = inclusions.map(s => ({ name: s, price: 0, is_default: 1, is_optional: 0 }));
    return { ...p, inclusionsList: inclusions, defaultInclusions: inclusions.filter(i => i.is_default), addonInclusions: inclusions.filter(i => i.is_optional && i.price > 0) };
  });
  let selectedItem = null;
  if (item_id && type === 'room')    selectedItem = await db.prepare('SELECT r.*, rt.name AS type_name FROM rooms r JOIN room_types rt ON rt.id=r.room_type_id WHERE r.id=? AND r.is_active=1').get(item_id);
  if (item_id && type === 'venue')   selectedItem = await db.prepare('SELECT * FROM venues WHERE id=? AND is_active=1').get(item_id);
  if (item_id && type === 'cottage') selectedItem = await db.prepare('SELECT * FROM cottages WHERE id=? AND is_active=1').get(item_id);
  const cottages = uniqueCatalogRows(await db.prepare("SELECT * FROM cottages WHERE status IN ('available','reserved','occupied','cleaning') AND is_active=1 ORDER BY price").all(), row => row.name, item_id);
  cottages.forEach(parseImgs);
  if (selectedItem) parseImgs(selectedItem);
  // Display-only: the dates/times other bookings hold for each item, for the booking form's date picker
  // (same data as the /stay detail pages; the POST below still checks conflicts itself).
  const { blockedPeriods } = require('../../stay/routes');
  for (const r of rooms) r.blocked = await blockedPeriods('room', r.id);
  for (const c of cottages) c.blocked = await blockedPeriods('cottage', c.id);
  for (const v of venues) v.blocked = await blockedPeriods('venue', v.id);
  const policyKeys = ['cancellation_policy','downpayment_percent','check_in_time','check_out_time','resort_name'];
  const policyRows = await db.prepare(`SELECT \`key\`, value FROM settings WHERE \`key\` IN (${policyKeys.map(() => '?').join(',')})`).all(...policyKeys);
  const ps = {};
  for (const r of policyRows) ps[r.key] = r.value || '';
  const terms = { resortName: ps.resort_name || 'Balai Miciano Resort', downpaymentPercent: getDownpaymentPercent(ps.downpayment_percent), checkInTime: ps.check_in_time || '14:00', checkOutTime: ps.check_out_time || '12:00', cancellationPolicy: ps.cancellation_policy || 'Cancellations made 7 days before the reservation date are eligible for a 50% refund. No refund for cancellations within 48 hours of the reservation date.' };
  res.render('portal/book', { title: 'Book Now – Balai-Reserve', layout: 'layouts/portal', rooms, venues, packages, cottages, filters: { type, item_id, package_id, checkin, checkout, date, start_time, end_time, guests }, selectedItem, lockedSelection: !!(selectedItem && ['room','venue','cottage'].includes(type)), terms, errors: [], old: {} });
});

// ═══════════════════════════════════════════════════════════════════════════
// POST /portal/book — THE FINAL FIXED VERSION
// ═══════════════════════════════════════════════════════════════════════════
router.post('/book',
  requireCustomer,
  [
    body('reservation_type').isIn(['room','venue','event','cottage']).withMessage('Please select what you want to book.'),
    body('item_id').custom((value, { req: r }) => {
      const needsResource = ['room','venue','cottage'].includes(r.body.reservation_type);
      if (needsResource && !/^[1-9]\d*$/.test(String(value || ''))) {
        throw new Error('Please select a valid room, venue, or cottage.');
      }
      if (value && !/^[1-9]\d*$/.test(String(value))) {
        throw new Error('Please select a valid room, venue, or cottage.');
      }
      return true;
    }),
    body('num_guests').isInt({ min: 1, max: 500 }).withMessage('Number of guests must be between 1 and 500.'),
    body('payment_method').isIn(['gcash','bank_transfer','maya']).withMessage('Please select a valid payment method.'),
    body('contact_phone').trim().notEmpty().withMessage('Please enter your mobile number.').bail().matches(/^(?:\+639|09)\d{9}$/).withMessage('Enter a valid Philippine mobile number.'),
    body('check_in_date').custom((val, { req: r }) => {
      const today = new Date().toISOString().slice(0, 10);
      const v = Array.isArray(val) ? val.find(x => x && String(x).trim()) : val;
      const s = v != null ? String(v).trim() : '';
      if (['room','cottage'].includes(r.body.reservation_type)) {
        if (!s) throw new Error('Please select a valid date.');
        if (isNaN(Date.parse(s))) throw new Error('Please select a valid date.');
        if (s < today) throw new Error('Please select a valid date. The check-in date cannot be in the past.');
      }
      return true;
    }),
    body('check_out_date').custom((val, { req: r }) => {
      const today = new Date().toISOString().slice(0, 10);
      const v = Array.isArray(val) ? val.find(x => x && String(x).trim()) : val;
      const s = v != null ? String(v).trim() : '';
      if (['room'].includes(r.body.reservation_type)) {
        if (!s) throw new Error('Please select a valid date.');
        if (isNaN(Date.parse(s))) throw new Error('Please select a valid date.');
        if (s < today) throw new Error('Please select a valid date. The check-out date cannot be in the past.');
        const ci = Array.isArray(r.body.check_in_date) ? r.body.check_in_date[0] : r.body.check_in_date;
        if (ci && s <= String(ci).trim()) throw new Error('Check-out date must be after check-in date.');
      }
      return true;
    }),
    body('start_time').custom((val, { req: r }) => {
      const needsTimeRange = r.body.reservation_type === 'cottage' ||
        (['venue','event'].includes(r.body.reservation_type) && (val || r.body.end_time));
      if (needsTimeRange && !validateCottageTimeRange(val, r.body.end_time)) throw new Error('Time out must be after time in.');
      return true;
    }),
    body('end_time').custom((val, { req: r }) => {
      const needsTimeRange = r.body.reservation_type === 'cottage' ||
        (['venue','event'].includes(r.body.reservation_type) && (val || r.body.start_time));
      if (needsTimeRange && !validateCottageTimeRange(r.body.start_time, val)) throw new Error('Time out must be after time in.');
      return true;
    }),
    body('event_date').custom((val, { req: r }) => {
      const today = new Date().toISOString().slice(0, 10);
      const v = Array.isArray(val) ? val.find(x => x && String(x).trim()) : val;
      const s = v != null ? String(v).trim() : '';
      if (['venue','event'].includes(r.body.reservation_type)) {
        if (!s) throw new Error('Please select a valid date.');
        if (isNaN(Date.parse(s))) throw new Error('Please select a valid date.');
        if (s < today) throw new Error('Please select a valid date. The event date cannot be in the past.');
      }
      return true;
    }),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) { req.session.flash = { error: errors.array()[0].msg }; return res.redirect('/portal/book'); }

    const user = req.session.user;
    function first(v) {
      if (Array.isArray(v)) return v.find(x => typeof x === 'string' && x.trim() !== '') || '';
      return typeof v === 'string' ? v : '';
    }

    const reservation_type = first(req.body.reservation_type);
    const item_id          = first(req.body.item_id);
    const package_id       = first(req.body.package_id);
    const check_in_date    = first(req.body.check_in_date);
    const check_out_date   = first(req.body.check_out_date);
    const event_date       = first(req.body.event_date);
    const start_time       = first(req.body.start_time);
    const end_time         = first(req.body.end_time);
    const num_guests       = first(req.body.num_guests);
    const special_requests = first(req.body.special_requests);
    const payment_method   = first(req.body.payment_method);
    const contact_phone    = first(req.body.contact_phone).trim();

    let selectedInclusions = [];
    // urlencoded({ extended: true }) parses `selected_inclusions[]` fields into `selected_inclusions`.
    const inclusionField = req.body.selected_inclusions ?? req.body['selected_inclusions[]'];
    const rawInclusions = Array.isArray(inclusionField) ? inclusionField : inclusionField ? [inclusionField] : [];
    for (const raw of rawInclusions) {
      try {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed.name === 'string') selectedInclusions.push({ name: parsed.name.trim(), price: Number(parsed.price) || 0 });
      } catch { /* skip */ }
    }

    const roomId     = item_id    ? parseInt(item_id,    10) : null;
    const venueId    = item_id    ? parseInt(item_id,    10) : null;
    const pkgId      = package_id ? parseInt(package_id, 10) : null;
    const guestCount = parseInt(num_guests, 10) || 1;
    const ciDate     = (check_in_date  || '').trim() || null;
    const coDate     = (check_out_date || '').trim() || null;
    const evDate     = (event_date     || '').trim() || null;
    const stTime     = (start_time     || '').trim() || null;
    const enTime     = (end_time       || '').trim() || null;
    const notes      = (special_requests || '').trim() || null;
    const pmMethod   = (payment_method || 'gcash').trim();

    let itemId = null;
    if (['room','cottage'].includes(reservation_type))   itemId = roomId;
    if (['venue','event'].includes(reservation_type))    itemId = venueId;

    const resource = await resourceDetails(reservation_type, itemId);
    const requiresResource = reservation_type !== 'event' || itemId != null;
    if (requiresResource && (!resource || !resource.is_active || !BOOKABLE_RESOURCE_STATUSES.has(resource.status))) {
      req.session.flash = { error: 'That selection is no longer available. Please choose another option.' };
      return res.redirect('/portal/book');
    }
    if (resource && guestCount > resource.capacity) {
      req.session.flash = { error: 'The selected option cannot accommodate that many guests.' };
      return res.redirect('/portal/book');
    }

    const totalAmt = await calculateServerTotal(reservation_type, roomId, venueId, pkgId, ciDate, coDate, stTime, enTime, selectedInclusions);
    if (totalAmt <= 0) { req.session.flash = { error: 'Could not calculate the booking price. Please select a valid room, venue, or package.' }; return res.redirect('/portal/book'); }

    const downpaymentSetting = await db.prepare("SELECT value FROM settings WHERE `key` = 'downpayment_percent'").get();
    const downpaymentPercent = getDownpaymentPercent(downpaymentSetting?.value);
    const dpAmt   = Math.ceil(totalAmt * downpaymentPercent / 100);
    const pmLabel = { gcash:'GCash', bank_transfer:'Bank Transfer (BDO/BPI)', maya:'Maya', cash:'Cash (Walk-in / Front Desk)' }[pmMethod] || pmMethod;

    let customer = await db.prepare('SELECT * FROM customers WHERE user_id = ?').get(user.id);
    if (!customer) {
      const code = 'CUS-' + String(Date.now()).slice(-6);
      await db.prepare('INSERT IGNORE INTO customers (user_id, customer_code, first_name, last_name, email, status) VALUES (?, ?, ?, ?, ?, ?)').run(user.id, code, user.firstName, user.lastName, user.email || '', 'active');
      customer = await db.prepare('SELECT * FROM customers WHERE user_id = ?').get(user.id);
    }
    if (!customer) { req.session.flash = { error: 'Could not create customer record.' }; return res.redirect('/portal/book'); }

    const bookingRef = await generateBookingRef();

    // ═══════════════════════════════════════════════════════════════════════
    // 🔧 THE FINAL FIX: Sanitize ALL values (including user fields) before SQLite binding
    // ══════════════════════════════════════════════════════════════════════
    const V = {
      bookingRef:       bookingRef       != null ? String(bookingRef)       : null,
      customerId:       customer?.id     != null ? Number(customer.id)      : null,
      reservation_type: reservation_type != null ? String(reservation_type) : null,
      ciDate:           ciDate           != null ? String(ciDate)           : null,
      coDate:           coDate           != null ? String(coDate)           : null,
      evDate:           evDate           != null ? String(evDate)           : null,
      stTime:           stTime           != null ? String(stTime)           : null,
      enTime:           enTime           != null ? String(enTime)           : null,
      guestCount:       Number(guestCount) || 1,
      notes:            notes            != null ? String(notes)            : null,
      totalAmt:         Number(totalAmt) || 0,
      dpAmt:            Number(dpAmt)    || 0,
      pmMethod:         pmMethod         != null ? String(pmMethod)         : 'cash',
      contactPhone:     String(contact_phone || ''),
      // ADDED: Safe fallbacks for user session data to prevent undefined SQLite binding
      firstName:        String(user?.firstName || ''),
      lastName:         String(user?.lastName || ''),
      email:            String(user?.email || '')
    };
    const submission = await db.transaction(async () => {
      const currentResource = await resourceDetails(reservation_type, itemId);
      const requested = reservation_type === 'room'
        ? { checkIn: ciDate, checkOut: coDate }
        : reservation_type === 'cottage'
          ? { date: ciDate, startTime: stTime, endTime: enTime }
          : { date: evDate, startTime: stTime, endTime: enTime };
      const resourceItemType = reservation_type === 'event' ? 'venue' : reservation_type;
      if (requiresResource && (!currentResource || !currentResource.is_active || !BOOKABLE_RESOURCE_STATUSES.has(currentResource.status))) {
        return { error: 'That selection is no longer available. Please choose another option.' };
      }
      if (currentResource && guestCount > currentResource.capacity) {
        return { error: 'The selected option cannot accommodate that many guests.' };
      }
      if (itemId != null && await resourceConflict(reservation_type, itemId, requested)) {
        return { error: `That ${resourceItemType} is already reserved for the selected date or time.` };
      }

      const newId = (await db.prepare(
        'INSERT INTO reservations (booking_ref, customer_id, reservation_type, check_in_date, check_out_date, event_date, start_time, end_time, num_guests, special_requests, total_amount, downpayment_req, status, payment_status, source, payment_method) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
      ).run(
        V.bookingRef, V.customerId, V.reservation_type,
        V.ciDate, V.coDate, V.evDate, V.stTime, V.enTime,
        V.guestCount, V.notes,
        V.totalAmt, V.dpAmt,
        'awaiting_payment', 'unpaid', 'online',
        V.pmMethod
      )).lastInsertRowid;

      if (reservation_type === 'room' && roomId) {
        const row = await db.prepare('SELECT name, price FROM rooms WHERE id = ?').get(roomId);
        await db.prepare('INSERT INTO reservation_items (reservation_id, item_type, item_id, item_name, quantity, unit_price, total_price) VALUES (?, ?, ?, ?, ?, ?, ?)').run(newId, 'room', roomId, row?.name||'', 1, row?.price||0, V.totalAmt);
        await db.prepare("UPDATE rooms SET status='reserved', updated_at=NOW() WHERE id=? AND status IN ('available','reserved')").run(roomId);
      } else if (reservation_type === 'venue' && venueId) {
        const row = await db.prepare('SELECT name, price FROM venues WHERE id = ?').get(venueId);
        await db.prepare('INSERT INTO reservation_items (reservation_id, item_type, item_id, item_name, quantity, unit_price, total_price) VALUES (?, ?, ?, ?, ?, ?, ?)').run(newId, 'venue', venueId, row?.name||'', 1, row?.price||0, V.totalAmt);
        await db.prepare("UPDATE venues SET status='reserved', updated_at=NOW() WHERE id=? AND status IN ('available','reserved')").run(venueId);
      } else if (reservation_type === 'event' && venueId && currentResource) {
        // Event in the function hall: record the hall so its date and time stay blocked
        // for other bookings. The hall line carries its own price; the package line follows.
        const row = await db.prepare('SELECT name, price FROM venues WHERE id = ?').get(venueId);
        await db.prepare('INSERT INTO reservation_items (reservation_id, item_type, item_id, item_name, quantity, unit_price, total_price) VALUES (?, ?, ?, ?, ?, ?, ?)').run(newId, 'venue', venueId, row?.name||'', 1, row?.price||0, row?.price||0);
        await db.prepare("UPDATE venues SET status='reserved', updated_at=NOW() WHERE id=? AND status IN ('available','reserved')").run(venueId);
      } else if (reservation_type === 'cottage' && roomId) {
        const row = await db.prepare('SELECT name, price FROM cottages WHERE id = ?').get(roomId);
        await db.prepare('INSERT INTO reservation_items (reservation_id, item_type, item_id, item_name, quantity, unit_price, total_price) VALUES (?, ?, ?, ?, ?, ?, ?)').run(newId, 'cottage', roomId, row?.name||'', 1, row?.price||0, V.totalAmt);
        await db.prepare("UPDATE cottages SET status='reserved', updated_at=NOW() WHERE id=? AND status IN ('available','reserved')").run(roomId);
      }

      if (pkgId) {
        const pkg = await db.prepare('SELECT name, price, inclusions FROM event_packages WHERE id = ? AND is_active = 1').get(pkgId);
        if (pkg) {
          await db.prepare('INSERT INTO reservation_items (reservation_id, item_type, item_id, item_name, quantity, unit_price, total_price) VALUES (?, ?, ?, ?, ?, ?, ?)').run(newId, 'event_package', pkgId, pkg.name, 1, pkg.price, pkg.price);
          if (selectedInclusions.length > 0) {
            let allInclusions = [];
            try { allInclusions = JSON.parse(pkg.inclusions || '[]'); } catch { allInclusions = []; }
            const addonMap = new Map();
            for (const inc of allInclusions) { if (inc.is_optional && inc.price > 0) addonMap.set(inc.name, inc.price); }
            for (const sel of selectedInclusions) {
              const name = (sel.name || '').trim();
              if (addonMap.has(name)) {
                const addonPrice = addonMap.get(name);
                await db.prepare('INSERT INTO reservation_items (reservation_id, item_type, item_id, item_name, quantity, unit_price, total_price, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(newId, 'inclusion', pkgId, name, 1, addonPrice, addonPrice, 'Event package add-on');
              }
            }
          }
        }
      }

      await db.prepare("INSERT INTO reservation_status_history (reservation_id, from_status, to_status) VALUES (?, NULL, 'awaiting_payment')").run(newId);
      // FIXED: Using V.firstName, V.lastName, V.email to prevent undefined binding
      await db.prepare("INSERT INTO guests (reservation_id, customer_id, first_name, last_name, email, phone, num_guests, status) VALUES (?, ?, ?, ?, ?, ?, ?, 'expected')").run(newId, V.customerId, V.firstName, V.lastName, V.email, V.contactPhone, V.guestCount);
      await db.prepare("UPDATE customers SET phone = ?, updated_at = NOW() WHERE id = ?").run(V.contactPhone, V.customerId);

      await db.prepare("INSERT INTO crm_activities (customer_id, activity_type, subject, description, status) VALUES (?, 'inquiry', ?, ?, 'completed')").run(V.customerId, 'Online booking submitted', 'Booking ' + bookingRef + ' — ' + reservation_type + ' — ' + V.totalAmt.toLocaleString() + ' total. Downpayment ' + V.dpAmt.toLocaleString() + ' via ' + pmLabel);
      return { id: newId };
    });
    if (submission.error) {
      req.session.flash = { error: submission.error };
      return res.redirect('/portal/book');
    }
    const resId = submission.id;

    try { await generateReservationQR(resId, bookingRef); } catch (e) { console.error('[Portal] QR generation failed:', e.message); }

    await notifyAllAdmins('reservation', 'New Online Booking', bookingRef + ' submitted by ' + (user.firstName || '') + ' ' + (user.lastName || '') + ' via ' + pmLabel, '/reservations/' + resId);
    await notifyUser(user.id, 'reservation', 'Booking Submitted', 'Your booking ' + bookingRef + ' is awaiting payment. Pay the downpayment via ' + pmLabel + ' and upload your proof on the booking page; staff confirm it once verified.', '/portal/my-reservations/' + resId);

    req.session.flash = { success: 'Booking ' + bookingRef + ' submitted — it is awaiting payment. Pay the downpayment via ' + pmLabel + ', then upload a screenshot below. Your booking is confirmed once staff verify it.' };
    res.redirect('/portal/my-reservations/' + resId);
  }
);

// ═══════════════════════════════════════════════════════════════════════════
// POST /portal/my-reservations/:id/submit-payment
// ═══════════════════════════════════════════════════════════════════════════
router.post('/my-reservations/:id/submit-payment', requireCustomer, proofUpload.single('proof_image'), async (req, res) => {
  const user = req.session.user;
  const customer = await db.prepare('SELECT * FROM customers WHERE user_id = ?').get(user.id);
  if (!customer) { removeUploadedProof(req.file); req.session.flash = { error: 'Session error.' }; return res.redirect('/auth/login'); }
  const reservation = await db.prepare('SELECT * FROM reservations WHERE id = ? AND customer_id = ?').get(req.params.id, customer.id);
  if (!reservation) { removeUploadedProof(req.file); req.session.flash = { error: 'Booking not found.' }; return res.redirect('/portal/my-reservations'); }
  const allowedStatuses = ['awaiting_payment', 'pending'];
  if (!allowedStatuses.includes(reservation.status)) { removeUploadedProof(req.file); req.session.flash = { error: 'Payment cannot be submitted for status: ' + reservation.status + '.' }; return res.redirect('/portal/my-reservations/' + req.params.id); }
  const { payment_method, amount_sent, reference_number, notes } = req.body;
  const amount = Number.parseFloat(typeof amount_sent === 'string' ? amount_sent : '');
  const methodSel = typeof payment_method === 'string' ? payment_method.trim().toLowerCase() : '';
  const expectedMethod = (reservation.payment_method || 'cash').toLowerCase();
  if (!Number.isFinite(amount) || amount <= 0) { removeUploadedProof(req.file); req.session.flash = { error: 'Please enter a valid payment amount.' }; return res.redirect('/portal/my-reservations/' + req.params.id); }
  if (!['gcash','bank_transfer','maya','cash'].includes(methodSel) || methodSel !== expectedMethod) {
    removeUploadedProof(req.file);
    req.session.flash = { error: 'The payment method must match the method selected for this booking.' };
    return res.redirect('/portal/my-reservations/' + req.params.id);
  }
  let ocrRef = '';
  let amtMismatch = null;
  if (methodSel === 'gcash') {
    if (!req.file) { req.session.flash = { error: 'Please upload your GCash payment screenshot.' }; return res.redirect('/portal/my-reservations/' + req.params.id); }
    let check;
    try {
      check = await validateGcashScreenshot(req.file.path);
    } catch (error) {
      console.error('[Portal] GCash screenshot validation failed:', error.message);
      check = { valid: false, reasons: ['We could not read the image.'] };
    }
    if (!check.valid) { removeUploadedProof(req.file); req.session.flash = { error: 'That does not look like a real GCash payment screenshot.' }; return res.redirect('/portal/my-reservations/' + req.params.id); }
    if (check.extracted && typeof check.extracted.amount === 'number') {
      const diff = Math.abs(check.extracted.amount - amount);
      if (diff > 1) amtMismatch = check.extracted.amount;
    }
    if (check.extracted && check.extracted.refNo) ocrRef = check.extracted.refNo;
  }
  const existingPending = await db.prepare("SELECT id FROM payments WHERE reservation_id = ? AND submitted_by = 'customer' AND status = 'received'").get(reservation.id);
  if (existingPending) { removeUploadedProof(req.file); req.session.flash = { warning: 'You already submitted a payment notification.' }; return res.redirect('/portal/my-reservations/' + req.params.id); }
  const pmMethod = expectedMethod;
  const referenceNumber = typeof reference_number === 'string' ? reference_number.trim() : '';
  const note = typeof notes === 'string' ? notes.trim() : '';
  const refNum = referenceNumber || (ocrRef || '').trim() || ('CUST-PROOF-' + Date.now());
  const proofPath = req.file ? req.file.filename : null;
  const noteText = ['Customer payment notification submitted online.', referenceNumber ? 'Transaction Ref: ' + referenceNumber : (ocrRef ? 'GCash Ref (auto-read): ' + ocrRef : ''), (methodSel === 'gcash') ? 'GCash screenshot passed automatic verification.' : '', (amtMismatch != null) ? ('NOTE: screenshot amount (' + amtMismatch + ') differs from entered amount (' + amount + ').') : '', note ? 'Note: ' + note : '', 'Awaiting staff verification.'].filter(Boolean).join(' ');
  const payType = amount >= reservation.total_amount ? 'full_payment' : 'downpayment';
  try {
    await db.transaction(async () => {
      await db.prepare("INSERT INTO payments (reservation_id, reference_number, amount, payment_method, payment_date, payment_type, status, notes, proof_image, submitted_by) VALUES (?, ?, ?, ?, DATE(DATE_ADD(UTC_TIMESTAMP(), INTERVAL 8 HOUR)), ?, 'received', ?, ?, 'customer')").run(reservation.id, refNum, amount, pmMethod, payType, noteText, proofPath);
      const totalPaid = (await db.prepare("SELECT COALESCE(SUM(amount),0) AS t FROM payments WHERE reservation_id = ? AND status = 'received'").get(reservation.id)).t;
      let newPayStatus = 'partially_paid';
      if (totalPaid >= reservation.total_amount && reservation.total_amount > 0) newPayStatus = 'fully_paid';
      await db.prepare("UPDATE reservations SET payment_status = ?, updated_at = NOW() WHERE id = ?").run(newPayStatus, reservation.id);
    });
  } catch (error) {
    removeUploadedProof(req.file);
    if (error.code !== 'ER_DUP_ENTRY') throw error;
    req.session.flash = { error: 'That transaction/reference number has already been submitted.' };
    return res.redirect('/portal/my-reservations/' + req.params.id);
  }
  await notifyAllAdmins('payment', 'Payment Proof Submitted: ' + reservation.booking_ref, (customer.first_name || '') + ' ' + (customer.last_name || '') + ' submitted via ' + pmMethod.replace(/_/g,' ') + (proofPath ? ' (with screenshot)' : ''), '/reservations/' + reservation.id);
  await notifyUser(user.id, 'payment', 'Payment Proof Received', 'We received your payment proof for ' + reservation.booking_ref + '. Our team will verify it within 24 hours.', '/portal/my-reservations/' + reservation.id);
  req.session.flash = { success: 'Payment proof submitted for review. Staff will check it against the resort’s account — your booking is confirmed only after they verify it.' };
  res.redirect('/portal/my-reservations/' + reservation.id);
});

// ═══════════════════════════════════════════════════════════════════════════
// GET /portal/profile
// ═══════════════════════════════════════════════════════════════════════════
router.get('/profile', requireCustomer, async (req, res) => {
  const user = req.session.user;
  const account = await db.prepare('SELECT * FROM users WHERE id = ?').get(user.id);
  let customer = await db.prepare('SELECT * FROM customers WHERE user_id = ?').get(user.id);
  if (!customer) {
    const code = 'CUS-' + String(Date.now()).slice(-6);
    await db.prepare('INSERT IGNORE INTO customers (user_id, customer_code, first_name, last_name, email, status) VALUES (?, ?, ?, ?, ?, ?)').run(user.id, code, user.firstName, user.lastName, user.email || '', 'active');
    customer = await db.prepare('SELECT * FROM customers WHERE user_id = ?').get(user.id);
  }
  res.render('portal/profile', { title: 'Profile Settings – Balai-Reserve', layout: 'layouts/portal', account, customer, errors: [], pwErrors: [], old: {}, activeTab: req.query.tab || 'profile' });
});

router.post('/profile', requireCustomer, [
  body('first_name').trim().notEmpty().withMessage('First name is required.'),
  body('last_name').trim().notEmpty().withMessage('Last name is required.'),
  body('phone').optional({ checkFalsy: true }).trim(),
  body('address').optional({ checkFalsy: true }).trim(),
  body('preferred_contact').optional({ checkFalsy: true }).isIn(['email','phone','sms']),
], async (req, res) => {
  const user = req.session.user;
  const account = await db.prepare('SELECT * FROM users WHERE id = ?').get(user.id);
  const customer = await db.prepare('SELECT * FROM customers WHERE user_id = ?').get(user.id);
  const errors = validationResult(req);
  if (!errors.isEmpty()) { return res.render('portal/profile', { title: 'Profile Settings – Balai-Reserve', layout: 'layouts/portal', account, customer, errors: errors.array(), pwErrors: [], old: req.body, activeTab: 'profile' }); }
  const { first_name, last_name, phone, address, preferred_contact } = req.body;
  await db.transaction(async () => {
    await db.prepare(`UPDATE users SET first_name=?, last_name=?, phone=?, updated_at=NOW() WHERE id=?`).run(first_name, last_name, phone || '', user.id);
    if (customer) await db.prepare(`UPDATE customers SET first_name=?, last_name=?, phone=?, address=?, preferred_contact=?, updated_at=NOW() WHERE id=?`).run(first_name, last_name, phone || '', address || '', preferred_contact || 'email', customer.id);
  });
  req.session.user.firstName = first_name;
  req.session.user.lastName = last_name;
  req.session.flash = { success: 'Your profile has been updated.' };
  res.redirect('/portal/profile');
});

router.post('/profile/password', requireCustomer, [
  body('current_password').notEmpty().withMessage('Current password is required.'),
  body('new_password').isLength({ min: 8 }).withMessage('New password must be at least 8 characters.'),
  body('confirm_password').custom((val, { req: r }) => { if (val !== r.body.new_password) throw new Error('Passwords do not match.'); return true; }),
], async (req, res) => {
  const user = req.session.user;
  const account = await db.prepare('SELECT * FROM users WHERE id = ?').get(user.id);
  const customer = await db.prepare('SELECT * FROM customers WHERE user_id = ?').get(user.id);
  const errors = validationResult(req);
  const allErrors = errors.array();
  const currentOk = bcrypt.compareSync(req.body.current_password || '', account.password_hash || '');
  if (!currentOk) allErrors.unshift({ msg: 'Current password is incorrect.' });
  if (allErrors.length > 0) { return res.render('portal/profile', { title: 'Profile Settings – Balai-Reserve', layout: 'layouts/portal', account, customer, errors: [], pwErrors: allErrors, old: {}, activeTab: 'password' }); }
  const hash = bcrypt.hashSync(req.body.new_password, 12);
  await db.prepare(`UPDATE users SET password_hash=?, updated_at=NOW() WHERE id=?`).run(hash, user.id);
  req.session.flash = { success: 'Your password has been changed.' };
  res.redirect('/portal/profile');
});

router.get('/notifications', requireCustomer, async (req, res) => {
  const uid = req.session.user.id;
  const notifications = await db.prepare(`SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT 100`).all(uid);
  await db.prepare(`UPDATE notifications SET is_read = 1 WHERE user_id = ?`).run(uid);
  res.render('portal/notifications', { title: 'Notifications – Balai-Reserve', layout: 'layouts/portal', notifications });
});

router.post('/notifications/clear', requireCustomer, async (req, res) => {
  await db.prepare(`DELETE FROM notifications WHERE user_id = ? AND is_read = 1`).run(req.session.user.id);
  req.session.flash = { success: 'Notifications cleared.' };
  res.redirect('/portal/notifications');
});

router.get('/payment-proof/:paymentId', async (req, res) => {
  const sessionUser = req.session?.user;
  if (!sessionUser) { req.session.flash = { error: 'Please sign in to view this file.' }; req.session.returnTo = req.originalUrl; return res.redirect('/auth/login'); }
  const payment = await db.prepare(`SELECT p.proof_image, p.reservation_id, r.customer_id, c.user_id AS owner_user_id FROM payments p JOIN reservations r ON r.id = p.reservation_id LEFT JOIN customers c ON c.id = r.customer_id WHERE p.id = ?`).get(req.params.paymentId);
  if (!payment || !payment.proof_image) return res.status(404).send('Proof not found.');
  const isStaff = STAFF_ROLES.includes(sessionUser.role);
  const isOwner = payment.owner_user_id && payment.owner_user_id === sessionUser.id;
  if (!isStaff && !isOwner) return res.status(403).send('You are not authorized to view this file.');
  const bareName = path.basename(payment.proof_image);
  const absPath = path.join(PROOF_DIR, bareName);
  if (!absPath.startsWith(PROOF_DIR) || !fs.existsSync(absPath)) return res.status(404).send('Proof file missing.');
  res.setHeader('Cache-Control', 'private, no-store');
  return res.sendFile(absPath);
});

router.get('/my-reservations', requireCustomer, async (req, res) => {
  const user = req.session.user;
  const customer = await db.prepare('SELECT * FROM customers WHERE user_id = ?').get(user.id);
  let reservations = [];
  if (customer) reservations = await db.prepare(`SELECT r.*,
      (SELECT GROUP_CONCAT(ri.item_name SEPARATOR ', ') FROM reservation_items ri WHERE ri.reservation_id = r.id AND ri.item_type IN ('room','cottage','venue','event_package')) AS item_names,
      (SELECT COALESCE(SUM(p.amount),0) FROM payments p WHERE p.reservation_id = r.id AND p.status IN ('received','verified')) AS amount_paid,
      (SELECT COALESCE(SUM(p.amount),0) FROM payments p WHERE p.reservation_id = r.id AND p.status = 'verified') AS verified_paid,
      (SELECT COUNT(*) FROM payments p WHERE p.reservation_id = r.id AND p.submitted_by = 'customer' AND p.status = 'received') AS proofs_pending,
      (SELECT p.status = 'refunded' AND p.notes LIKE '%Rejected by staff%' FROM payments p WHERE p.reservation_id = r.id AND p.submitted_by = 'customer' ORDER BY p.id DESC LIMIT 1) AS last_proof_rejected,
      (SELECT ri.item_type FROM reservation_items ri WHERE ri.reservation_id = r.id AND ri.item_type IN ('room','cottage','venue') ORDER BY ri.id LIMIT 1) AS main_item_type,
      (SELECT ri.item_id FROM reservation_items ri WHERE ri.reservation_id = r.id AND ri.item_type IN ('room','cottage','venue') ORDER BY ri.id LIMIT 1) AS main_item_id
    FROM reservations r WHERE r.customer_id = ? ORDER BY r.created_at DESC`).all(customer.id);
  await attachItemPhotos(reservations);   // display-only thumbnails
  res.render('portal/my-reservations', { title: 'My Bookings – Balai-Reserve', layout: 'layouts/portal', reservations, customer, tab: typeof req.query.tab === 'string' ? req.query.tab : '' });
});

router.get('/my-reservations/:id', requireCustomer, async (req, res) => {
  const user = req.session.user;
  const customer = await db.prepare('SELECT * FROM customers WHERE user_id = ?').get(user.id);
  if (!customer) { req.session.flash = { error: 'No booking found.' }; return res.redirect('/portal/my-reservations'); }
  const reservation = await db.prepare('SELECT * FROM reservations WHERE id = ? AND customer_id = ?').get(req.params.id, customer.id);
  if (!reservation) { req.session.flash = { error: 'Booking not found.' }; return res.redirect('/portal/my-reservations'); }
  const items = await db.prepare('SELECT * FROM reservation_items WHERE reservation_id = ?').all(reservation.id);
  const payments = await db.prepare("SELECT * FROM payments WHERE reservation_id = ? AND status != 'refunded' ORDER BY payment_date ASC").all(reservation.id);
  const amountPaid = payments.reduce((s, p) => s + (p.amount || 0), 0);
  const totalAmount = reservation.total_amount || 0;
  const balance = totalAmount - amountPaid;
  const isFullyPaid = totalAmount > 0 && balance <= 0;
  const hasAnyPayment = amountPaid > 0;
  const qrCode = await db.prepare('SELECT * FROM qr_codes WHERE reservation_id = ? AND used = 0 ORDER BY created_at DESC LIMIT 1').get(reservation.id);
  const pendingProof = await db.prepare("SELECT * FROM payments WHERE reservation_id = ? AND submitted_by = 'customer' AND status = 'received' ORDER BY created_at DESC LIMIT 1").get(reservation.id);
  const feedback = await db.prepare('SELECT * FROM feedback WHERE reservation_id = ? AND customer_id = ?').get(reservation.id, customer.id);
  const refundRequest = await db.prepare('SELECT * FROM refund_requests WHERE reservation_id = ? ORDER BY created_at DESC LIMIT 1').get(reservation.id);
  const canRequestRefund = hasAnyPayment && !['cancelled','rejected'].includes(reservation.status) && (!refundRequest || refundRequest.status === 'rejected');
  // Display-only: the most recent proof staff did not accept (stored as 'refunded' with a staff note), and the policy text.
  const rejectedProof = await db.prepare("SELECT id, amount, payment_method, payment_date, created_at FROM payments WHERE reservation_id = ? AND submitted_by = 'customer' AND status = 'refunded' AND notes LIKE '%Rejected by staff%' ORDER BY id DESC LIMIT 1").get(reservation.id);
  const policyRow = await db.prepare("SELECT value FROM settings WHERE `key` = 'cancellation_policy'").get();
  const cancellationPolicy = (policyRow && policyRow.value) || '';
  // Display-only: status timeline, every payment record (incl. rejected proofs and refunds) and the main item's photo.
  const statusHistory = await db.prepare('SELECT from_status, to_status, notes, created_at FROM reservation_status_history WHERE reservation_id = ? ORDER BY created_at ASC, id ASC').all(reservation.id);
  const paymentActivity = await db.prepare('SELECT id, amount, payment_method, payment_type, payment_date, status, submitted_by, reference_number, proof_image, notes, verified_at, created_at FROM payments WHERE reservation_id = ? ORDER BY created_at ASC, id ASC').all(reservation.id);
  const mainItem = items.find(i => ['room', 'cottage', 'venue'].includes(i.item_type));
  const [photoRow] = await attachItemPhotos([{ main_item_type: mainItem && mainItem.item_type, main_item_id: mainItem && mainItem.item_id }]);
  const itemPhoto = photoRow.photo;
  res.render('portal/reservation-detail', { title: 'Booking ' + reservation.booking_ref, layout: 'layouts/portal', reservation, items, payments, qrCode, amountPaid, totalAmount, balance, isFullyPaid, hasAnyPayment, pendingProof, feedback, customer, refundRequest, canRequestRefund, rejectedProof, cancellationPolicy, statusHistory, paymentActivity, itemPhoto });
});

router.get('/feedback/:reservationId', requireCustomer, async (req, res) => {
  const user = req.session.user;
  const customer = await db.prepare('SELECT * FROM customers WHERE user_id = ?').get(user.id);
  if (!customer) return res.redirect('/portal');
  const reservation = await db.prepare('SELECT * FROM reservations WHERE id = ? AND customer_id = ?').get(req.params.reservationId, customer.id);
  if (!reservation || !['completed','checked_in'].includes(reservation.status)) { req.session.flash = { error: 'Feedback can only be submitted for completed reservations.' }; return res.redirect('/portal/my-reservations'); }
  const existing = await db.prepare('SELECT * FROM feedback WHERE reservation_id = ? AND customer_id = ?').get(reservation.id, customer.id);
  if (existing) { req.session.flash = { info: 'You have already submitted feedback.' }; return res.redirect('/portal/my-reservations/' + reservation.id); }
  res.render('portal/feedback', { title: 'Leave Feedback', layout: 'layouts/portal', reservation, errors: [], old: {} });
});

router.post('/my-reservations/:id/cancel', requireCustomer, async (req, res) => {
  const user = req.session.user;
  const customer = await db.prepare('SELECT * FROM customers WHERE user_id = ?').get(user.id);
  if (!customer) { req.session.flash = { error: 'Session error.' }; return res.redirect('/auth/login'); }
  const reservation = await db.prepare('SELECT * FROM reservations WHERE id = ? AND customer_id = ?').get(req.params.id, customer.id);
  if (!reservation) { req.session.flash = { error: 'Booking not found.' }; return res.redirect('/portal/my-reservations'); }
  const cancellableStatuses = ['pending', 'awaiting_payment'];
  if (!cancellableStatuses.includes(reservation.status)) { req.session.flash = { error: 'This booking cannot be cancelled — status: ' + reservation.status.replace(/_/g,' ') + '.' }; return res.redirect('/portal/my-reservations/' + reservation.id); }
  const totalPaid = (await db.prepare("SELECT COALESCE(SUM(amount),0) AS t FROM payments WHERE reservation_id = ? AND status IN ('received','verified')").get(reservation.id)).t;
  const hasPayment = totalPaid > 0;
  await db.transaction(async () => {
    await db.prepare(`UPDATE reservations SET status='cancelled', updated_at=NOW() WHERE id=?`).run(reservation.id);
    await db.prepare(`INSERT INTO reservation_status_history (reservation_id, from_status, to_status, notes) VALUES (?,?,?,'Cancelled by guest via portal')`).run(reservation.id, reservation.status, 'cancelled');
    const items = await db.prepare(`SELECT * FROM reservation_items WHERE reservation_id=?`).all(reservation.id);
    for (const item of items) {
      const table = { room: 'rooms', venue: 'venues', cottage: 'cottages' }[item.item_type];
      if (!table) continue;
      const stillReserved = await db.prepare(`
        SELECT 1
        FROM reservation_items ri
        JOIN reservations r ON r.id = ri.reservation_id
        WHERE ri.item_type = ? AND ri.item_id = ? AND r.id != ?
          AND r.status NOT IN ('cancelled', 'rejected', 'completed', 'no_show', 'checked_out')
        LIMIT 1
      `).get(item.item_type, item.item_id, reservation.id);
      if (!stillReserved) {
        await db.prepare(`UPDATE ${table} SET status='available', updated_at=NOW() WHERE id=? AND status='reserved'`).run(item.item_id);
      }
    }
    await db.prepare(`UPDATE guests SET status='no_show', updated_at=NOW() WHERE reservation_id=?`).run(reservation.id);
  });
  await notifyAllAdmins('reservation', 'Booking Cancelled by Guest', `${reservation.booking_ref} was cancelled by ${(user.firstName || '')} ${(user.lastName || '')}` + (hasPayment ? ` — ₱${totalPaid.toLocaleString('en-PH')} already paid (NON-REFUNDABLE).` : '.'), '/reservations/' + reservation.id);
  await notifyUser(user.id, 'reservation', 'Booking Cancelled', `Your booking ${reservation.booking_ref} has been cancelled` + (hasPayment ? '. Payments already made are non-refundable.' : '.'), '/portal/my-reservations/' + reservation.id);
  req.session.flash = { success: `Your booking ${reservation.booking_ref} has been cancelled.` + (hasPayment ? ' Payments already made are non-refundable.' : '') };
  res.redirect('/portal/my-reservations');
});

router.post('/my-reservations/:id/request-refund', requireCustomer, async (req, res) => {
  const user = req.session.user;
  const customer = await db.prepare('SELECT * FROM customers WHERE user_id = ?').get(user.id);
  if (!customer) { req.session.flash = { error: 'Session error.' }; return res.redirect('/auth/login'); }
  const reservation = await db.prepare('SELECT * FROM reservations WHERE id = ? AND customer_id = ?').get(req.params.id, customer.id);
  if (!reservation) { req.session.flash = { error: 'Booking not found.' }; return res.redirect('/portal/my-reservations'); }
  const amountPaid = (await db.prepare("SELECT COALESCE(SUM(amount),0) AS t FROM payments WHERE reservation_id = ? AND status IN ('received','verified')").get(reservation.id)).t;
  if (amountPaid <= 0) { req.session.flash = { error: 'There is no payment on record to refund.' }; return res.redirect('/portal/my-reservations/' + reservation.id); }
  if (['cancelled','rejected'].includes(reservation.status)) { req.session.flash = { error: 'A refund cannot be requested for a cancelled or rejected booking.' }; return res.redirect('/portal/my-reservations/' + reservation.id); }
  const existing = await db.prepare("SELECT * FROM refund_requests WHERE reservation_id = ? AND status = 'pending' ORDER BY created_at DESC LIMIT 1").get(reservation.id);
  if (existing) { req.session.flash = { info: 'You already have a refund request under review.' }; return res.redirect('/portal/my-reservations/' + reservation.id); }
  const reason = (req.body.reason || '').trim();
  if (!reason) { req.session.flash = { error: 'Please provide a reason.' }; return res.redirect('/portal/my-reservations/' + reservation.id); }
  const gcashNumber = (req.body.gcash_number || '').trim();
  if (gcashNumber && !/^09\d{9}$/.test(gcashNumber)) { req.session.flash = { error: 'Please enter a valid GCash number (11 digits starting with 09).' }; return res.redirect('/portal/my-reservations/' + reservation.id); }
  await db.prepare(`INSERT INTO refund_requests (reservation_id, customer_id, amount, reason, gcash_number, status) VALUES (?, ?, ?, ?, ?, 'pending')`).run(reservation.id, customer.id, amountPaid, reason, gcashNumber || null);
  await notifyAllAdmins('payment', 'Refund Requested', `${(user.firstName || '')} ${(user.lastName || '')} requested a refund of ₱${amountPaid.toLocaleString('en-PH')} for ${reservation.booking_ref}.`, '/reservations/' + reservation.id);
  req.session.flash = { success: 'Your refund request has been submitted.' };
  res.redirect('/portal/my-reservations/' + reservation.id);
});

router.post('/feedback/:reservationId', requireCustomer, [
  body('rating').isInt({ min: 1, max: 5 }).withMessage('Please select a rating from 1 to 5.'),
  body('comments').trim().notEmpty().withMessage('Please write a short comment.'),
], async (req, res) => {
  const user = req.session.user;
  const customer = await db.prepare('SELECT * FROM customers WHERE user_id = ?').get(user.id);
  const reservation = await db.prepare('SELECT * FROM reservations WHERE id = ? AND customer_id = ?').get(req.params.reservationId, customer?.id);
  if (!reservation || !customer) return res.redirect('/portal/my-reservations');
  const errors = validationResult(req);
  if (!errors.isEmpty()) { return res.render('portal/feedback', { title: 'Leave Feedback', layout: 'layouts/portal', reservation, errors: errors.array(), old: req.body }); }
  const { rating, category, comments, suggestions } = req.body;
  await db.prepare('INSERT INTO feedback (reservation_id, customer_id, rating, category, comments, suggestions) VALUES (?,?,?,?,?,?)').run(reservation.id, customer.id, rating, category || 'overall', comments, suggestions || '');
  req.session.flash = { success: 'Thank you for your feedback!' };
  res.redirect('/portal/my-reservations/' + reservation.id);
});

router.get('/inquire', requireCustomerOrGuest, async (req, res) => {
  res.render('portal/inquire', { title: 'Contact Us – Balai-Reserve', layout: 'layouts/portal', errors: [], old: {} });
});

router.post('/inquire', [
  body('name').trim().notEmpty().withMessage('Name is required.'),
  body('subject').trim().notEmpty().withMessage('Subject is required.'),
  body('message').trim().notEmpty().withMessage('Message is required.'),
  body('email').optional({ checkFalsy: true }).isEmail().withMessage('Enter a valid email.'),
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) { return res.render('portal/inquire', { title: 'Contact Us', layout: 'layouts/portal', errors: errors.array(), old: req.body }); }
  const { name, email, phone, subject, message, category } = req.body;
  const customerId = req.session?.user ? ((await db.prepare('SELECT id FROM customers WHERE user_id = ?').get(req.session.user.id))?.id || null) : null;
  const inquiry = await db.prepare("INSERT INTO inquiries (customer_id, name, email, phone, subject, message, category, source, status) VALUES (?,?,?,?,?,?,?,'website','open')").run(customerId, name, email||'', phone||'', subject, message, category||'general');
  await notifyAllAdmins('inquiry', 'New Inquiry', name + ': ' + subject, '/inquiries/' + inquiry.lastInsertRowid);
  req.session.flash = { success: 'Your inquiry has been received.' };
  res.redirect(req.session?.user ? '/portal/my-inquiries' : '/portal/inquire');
});

router.get('/calendar', requireCustomerOrGuest, async (req, res) => {
  res.render('portal/calendar', { title: 'Availability Calendar – Balai-Reserve', layout: 'layouts/portal' });
});

router.get('/calendar/feed', requireCustomerOrGuest, async (req, res) => {
  const ACTIVE = "r.status NOT IN ('cancelled','rejected','completed','no_show')";
  const stays = await db.prepare(`SELECT r.reservation_type, r.status, r.check_in_date, r.check_out_date, ri.item_name FROM reservations r LEFT JOIN reservation_items ri ON ri.reservation_id = r.id AND ri.item_type IN ('room','cottage') WHERE r.reservation_type IN ('room','cottage') AND r.check_in_date IS NOT NULL AND ${ACTIVE}`).all();
  // Venue / event bookings span check-in..check-out; older rows only have event_date.
  const venueEvents = await db.prepare(`SELECT r.reservation_type, r.status, COALESCE(r.check_in_date, r.event_date) AS start_date, COALESCE(r.check_out_date, r.check_in_date, r.event_date) AS end_date, ri.item_name FROM reservations r LEFT JOIN reservation_items ri ON ri.reservation_id = r.id AND ri.item_type = 'venue' WHERE r.reservation_type IN ('venue','event') AND COALESCE(r.check_in_date, r.event_date) IS NOT NULL AND ${ACTIVE}`).all();
  const colorFor = (t) => t === 'room' ? '#6366f1' : t === 'cottage' ? '#f97316' : '#10b981';
  // Pencil bookings and bookings on hold still block their dates, with their own colour and label.
  const HELD = { pencil: { label: 'Pencil Booking', color: '#a855f7' }, on_hold: { label: 'On Hold', color: '#475569' } };
  const nextDay = (d) => { const x = new Date(String(d).slice(0, 10) + 'T00:00:00Z'); x.setUTCDate(x.getUTCDate() + 1); return x.toISOString().slice(0, 10); };
  const events = [];
  const push = (name, status, type, start, end) => {
    const held = HELD[status];
    events.push({ title: name + ' — ' + (held ? held.label : 'Booked'), start, end, allDay: true, color: held ? held.color : colorFor(type), display: 'block', extendedProps: { status: held ? status : 'booked' } });
  };
  // All-day end dates are exclusive: rooms free up on the check-out day, cottages are used through it.
  for (const s of stays) push(s.item_name ? s.item_name : (s.reservation_type === 'cottage' ? 'Cottage' : 'Room'), s.status, s.reservation_type, s.check_in_date,
    s.reservation_type === 'cottage' ? nextDay(s.check_out_date || s.check_in_date) : (s.check_out_date || s.check_in_date));
  for (const v of venueEvents) push(v.item_name ? v.item_name : (v.reservation_type === 'event' ? 'Event' : 'Venue'), v.status, v.reservation_type === 'event' ? 'event' : 'venue', v.start_date, nextDay(v.end_date));
  res.json(events);
});

router.get('/my-inquiries', requireCustomer, async (req, res) => {
  const customer = await db.prepare('SELECT * FROM customers WHERE user_id = ?').get(req.session.user.id);
  let inquiries = [];
  if (customer) inquiries = await db.prepare(`SELECT * FROM inquiries WHERE customer_id = ? OR (email != '' AND email = ?) ORDER BY created_at DESC`).all(customer.id, customer.email || '');
  // Display-only: the guest's own booking references, so an inquiry that mentions one can link to it.
  const bookingLinks = {};
  if (customer) for (const r of await db.prepare('SELECT id, booking_ref FROM reservations WHERE customer_id = ?').all(customer.id)) bookingLinks[r.booking_ref] = r.id;
  res.render('portal/my-inquiries', { title: 'My Inquiries – Balai-Reserve', layout: 'layouts/portal', inquiries, bookingLinks });
});

module.exports = router;