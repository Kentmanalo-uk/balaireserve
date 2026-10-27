/**
 * Public listing detail pages  (/stay)
 *
 *   GET /stay/room/:id     GET /stay/cottage/:id     GET /stay/venue/:id     GET /stay/package/:id
 *
 * No login. Active catalogue items / packages only (404 otherwise). One detail template
 * (views/stay/show.xian) shows the item's real photos, what is included, live price,
 * booking policies from Settings and the dates other bookings already hold. Booking itself
 * happens in /portal/book, which re-checks availability and recalculates the total on submit.
 */
'use strict';

const express = require('express');
const db      = require('../../../config/database');
const { withExistingPhotos, photosFirst, uniqueCatalogRows } = require('../../../utils/catalog');
const { publicSettings } = require('../../../utils/publicSettings');

const router = express.Router();

const KINDS = {
  room:    { table: 'rooms',    label: 'Room' },
  cottage: { table: 'cottages', label: 'Day-use cottage' },
  venue:   { table: 'venues',   label: 'Function hall' },
  package: { table: 'event_packages', label: 'Event package' },
};
const OCCASIONS = { wedding: 'Wedding', birthday: 'Birthday', debut: 'Debut', corporate: 'Corporate event', meeting: 'Meeting' };

// Statuses that keep an item's dates blocked (same set the booking checks use).
const ACTIVE_STATUSES = ['pending', 'pencil', 'on_hold', 'awaiting_payment', 'confirmed', 'checked_in'];
// Resource statuses that can still take future bookings.
const BOOKABLE_STATUSES = new Set(['available', 'reserved', 'occupied', 'cleaning']);

// Today's date in Philippine time (UTC+8), whatever the server's timezone.
const phToday = () => new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10);

// '14:00' → '2:00 PM' (Philippine time as stored; no timezone conversion).
const fmtTime = (t) => {
  const m = /^(\d{1,2}):(\d{2})/.exec(String(t || ''));
  if (!m) return t || '';
  const h = Number(m[1]);
  return (h % 12 || 12) + ':' + m[2] + ' ' + (h >= 12 ? 'PM' : 'AM');
};

const hhmm = (t) => (/^\d{1,2}:\d{2}/.test(String(t || '')) ? String(t).slice(0, 5).padStart(5, '0') : '');

/**
 * Upcoming periods other bookings hold for one item, oldest first.
 * Rooms block nights [check-in, check-out); cottages and the hall block a
 * date (or date range) and time window — no times means the whole day.
 */
async function blockedPeriods(kind, itemId) {
  const rows = await db.prepare(`
    SELECT r.check_in_date, r.check_out_date, r.event_date, r.start_time, r.end_time
    FROM reservation_items ri
    JOIN reservations r ON r.id = ri.reservation_id
    WHERE ri.item_type = ? AND ri.item_id = ?
      AND r.status IN (${ACTIVE_STATUSES.map(() => '?').join(',')})
  `).all(kind, itemId, ...ACTIVE_STATUSES);

  const today = phToday();
  const out = [];
  for (const r of rows) {
    if (kind === 'room') {
      const start = String(r.check_in_date || '').slice(0, 10);
      const end   = String(r.check_out_date || '').slice(0, 10);
      if (!start || !end || end <= today) continue;
      out.push({ start, end });
    } else {
      const start = String((kind === 'venue' ? (r.event_date || r.check_in_date) : (r.check_in_date || r.event_date)) || '').slice(0, 10);
      if (!start) continue;
      const end = String(r.check_out_date || start).slice(0, 10) < start ? start : String(r.check_out_date || start).slice(0, 10);
      if (end < today) continue;
      out.push({ start, end, from: hhmm(r.start_time), to: hhmm(r.end_time) });
    }
  }
  out.sort((a, b) => (a.start + (a.from || '')).localeCompare(b.start + (b.from || '')));
  return out;
}

function parseList(v) {
  try { const a = JSON.parse(v || '[]'); return Array.isArray(a) ? a : []; } catch { return []; }
}

// Package inclusions are {name, price, is_default, is_optional}; old rows may be strings.
// Add-ons follow the booking form: optional items with a price (charged by the server when chosen).
function withInclusions(p) {
  const list = parseList(p.inclusions)
    .map(i => (typeof i === 'string' ? { name: i, price: 0, is_default: 1, is_optional: 0 } : i))
    .filter(i => i && typeof i.name === 'string' && i.name.trim());
  p.inclusionsList = list;
  p.includedItems  = list.filter(i => Number(i.is_default) === 1 || !Number(i.is_optional));
  p.addonItems     = list.filter(i => Number(i.is_default) !== 1 && Number(i.is_optional) && Number(i.price) > 0);
  return p;
}

async function activePackages() {
  return uniqueCatalogRows(
    await db.prepare('SELECT * FROM event_packages WHERE is_active = 1 ORDER BY price').all(),
    p => `${p.event_type || ''}:${p.name}`
  ).map(withInclusions);
}

async function loadItem(kind, id) {
  if (kind === 'room') {
    return db.prepare(`SELECT r.*, rt.name AS type_name FROM rooms r JOIN room_types rt ON rt.id = r.room_type_id
                       WHERE r.id = ? AND r.is_active = 1`).get(id);
  }
  return db.prepare(`SELECT * FROM ${KINDS[kind].table} WHERE id = ? AND is_active = 1`).get(id);
}

async function siblings(kind, id) {
  let rows;
  if (kind === 'room') {
    rows = await db.prepare(`SELECT r.*, rt.name AS type_name FROM rooms r JOIN room_types rt ON rt.id = r.room_type_id
                             WHERE r.is_active = 1 AND r.id <> ? ORDER BY r.price`).all(id);
  } else {
    rows = uniqueCatalogRows(await db.prepare(`SELECT * FROM ${KINDS[kind].table} WHERE is_active = 1 AND id <> ? ORDER BY price`).all(id));
  }
  return photosFirst(withExistingPhotos(rows)).slice(0, 3);
}

// Shared layout data: nav shows Events / Gallery only when there is something there.
async function layoutData(settings) {
  const hasEvents = (await db.prepare('SELECT COUNT(*) AS c FROM event_packages WHERE is_active = 1').get()).c > 0;
  let hasGallery = parseList(settings.landing_gallery).some(g => g && typeof g.path === 'string' && g.path.startsWith('/uploads/settings/landing/'));
  if (!hasGallery) {
    const rows = [
      ...await db.prepare('SELECT images FROM rooms WHERE is_active = 1').all(),
      ...await db.prepare('SELECT images FROM cottages WHERE is_active = 1').all(),
    ];
    hasGallery = withExistingPhotos(rows).some(r => r.imagesList && r.imagesList.length);
  }
  return { hasEvents, hasGallery };
}

async function siteSettings() {
  const settingsRows = await db.prepare('SELECT `key`, value FROM settings').all();
  const settings = {};
  for (const s of settingsRows) settings[s.key] = s.value;
  return settings;
}

// Selections carried from a search or catalogue page (validated client-side again).
function prefillFrom(q, kind) {
  const isDate = (v) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);
  const isTime = (v) => typeof v === 'string' && /^\d{2}:\d{2}$/.test(v);
  return {
    checkin:    isDate(q.checkin) ? q.checkin : '',
    checkout:   isDate(q.checkout) ? q.checkout : '',
    date:       isDate(q.date) ? q.date : (kind !== 'room' && isDate(q.checkin) ? q.checkin : ''),
    start_time: isTime(q.start_time) ? q.start_time : '',
    end_time:   isTime(q.end_time) ? q.end_time : '',
    guests:     /^\d{1,3}$/.test(String(q.guests || '')) ? String(q.guests) : '',
  };
}

router.get('/:kind(room|cottage|venue)/:id', async (req, res, next) => {
  const { kind } = req.params;
  const id = Number.parseInt(req.params.id, 10);
  if (!Number.isInteger(id) || id < 1 || String(id) !== req.params.id) return next();

  const item = await loadItem(kind, id);
  if (!item) return next();   // inactive or missing → the app's 404 page
  withExistingPhotos([item]);
  item.amenitiesList = parseList(item.amenities).filter(a => typeof a === 'string' && a.trim());

  const settings = await siteSettings();
  const site = publicSettings(settings);

  const blocked = await blockedPeriods(kind, id);
  const others  = await siblings(kind, id);

  // The hall page lists the event packages whose guest count it can hold.
  let packages = [];
  if (kind === 'venue') {
    packages = (await activePackages())
      .filter(p => !p.capacity || !item.capacity || Number(p.capacity) <= Number(item.capacity));
  }

  res.render('stay/show', {
    title:  `${item.name} – Balai-Reserve`,
    layout: 'layouts/landing',
    kind, kindLabel: KINDS[kind].label,
    item, blocked, others, packages, relatedPackages: [],
    prefill: prefillFrom(req.query, kind),
    bookable: BOOKABLE_STATUSES.has(item.status),
    today: phToday(),
    fmtTime,
    ...(await layoutData(settings)),
    ctaHref: '#book',
    bodyClass: BOOKABLE_STATUSES.has(item.status) ? 'has-book-bar' : '',
    metaDescription: `${item.name} at Balai-Reserve, Gloria, Oriental Mindoro: photos, what is included, live price and open dates.`,
    site,
  });
});

// Event package detail — same template. Packages are not tied to one room, so there are no
// blocked dates to show; the booking form and staff review handle the schedule.
router.get('/package/:id', async (req, res, next) => {
  const id = Number.parseInt(req.params.id, 10);
  if (!Number.isInteger(id) || id < 1 || String(id) !== req.params.id) return next();

  const pkg = await loadItem('package', id);
  if (!pkg) return next();   // inactive or missing → 404
  withInclusions(pkg);
  withExistingPhotos([pkg]);   // photos added on /packages (none → the occasion drawing)
  pkg.amenitiesList = [];

  const settings = await siteSettings();
  const site = publicSettings(settings);

  const all = (await activePackages()).filter(p => p.id !== pkg.id);
  const sameOccasion = all.filter(p => (p.event_type || 'other') === (pkg.event_type || 'other'));
  const relatedPackages = [...sameOccasion, ...all.filter(p => !sameOccasion.includes(p))].slice(0, 3);

  // The function hall that can hold this package's guest count, if any (offered as an alternative).
  const halls = photosFirst(withExistingPhotos(uniqueCatalogRows(
    await db.prepare('SELECT * FROM venues WHERE is_active = 1 ORDER BY price').all()
  ))).filter(v => !pkg.capacity || !v.capacity || Number(v.capacity) >= Number(pkg.capacity));

  const occasion = OCCASIONS[pkg.event_type] || 'Gathering';
  res.render('stay/show', {
    title:  `${pkg.name} – Balai-Reserve`,
    layout: 'layouts/landing',
    kind: 'package', kindLabel: occasion + ' package',
    item: pkg, blocked: [], others: halls.slice(0, 1), packages: [], relatedPackages,
    prefill: prefillFrom(req.query, 'package'),
    bookable: true,
    today: phToday(),
    fmtTime,
    ...(await layoutData(settings)),
    ctaHref: '#book',
    bodyClass: 'has-book-bar',
    metaDescription: `${pkg.name} at Balai-Reserve, Gloria, Oriental Mindoro: what is included, optional add-ons and the live price.`,
    site,
  });
});

module.exports = router;
module.exports.blockedPeriods = blockedPeriods;
