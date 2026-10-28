/**
 * Event packages management  (/packages) — Birthday, Wedding, Debut and other event packages.
 *   GET  /packages                 every package (shown and hidden), with how often it was booked
 *   GET  /packages/new             POST /packages              add a package
 *   GET  /packages/:id/edit        POST /packages/:id/edit     edit name, occasion, price, guests,
 *                                                              places included (hall, rooms, cottages),
 *                                                              what's included, paid add-ons, photos
 *   POST /packages/:id/visibility  show on / hide from the website and booking forms
 *   POST /packages/:id/delete      only for packages never booked; booked ones are hidden instead
 * Changes show on the website and booking forms at once. A booking keeps the name and prices it
 * was made with (copied into reservation_items), so editing a package never changes past bookings.
 */
'use strict';

const express = require('express');
const path    = require('path');
const fs      = require('fs');
const multer  = require('multer');
const { body, validationResult } = require('express-validator');
const db      = require('../../../config/database');
const { uploadDir, uploadFileFromUrl } = require('../../../config/paths');
const { requireAuth, requireRole } = require('../../../middleware/auth');
const { OCCASIONS, OCCASION_KEYS, parseInclusions, buildInclusions, loadPlaces, placeText, buildPlaces, savePlaces } = require('../../../utils/eventPackages');

const router     = express.Router();
const CAN_MANAGE = ['admin', 'staff'];

const UPLOAD_DIR = uploadDir('packages');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });
const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, UPLOAD_DIR),
    filename: (req, file, cb) => cb(null, `package-${Date.now()}-${Math.round(Math.random() * 1e6)}${path.extname(file.originalname).toLowerCase()}`),
  }),
  fileFilter: (req, file, cb) => {
    if (['.jpg', '.jpeg', '.png', '.webp', '.gif'].includes(path.extname(file.originalname).toLowerCase())) cb(null, true);
    else cb(new Error('Only image files (jpg, png, webp, gif) are allowed.'));
  },
  limits: { fileSize: 5 * 1024 * 1024, files: 5 },
});
// A bad file shows on the form instead of the error page.
const withUpload = (req, res, next) => upload.array('images', 5)(req, res, err => { if (err) req.uploadError = err.message; next(); });

const placeLine = r => (r.quantity > 1 ? r.quantity + ' × ' : '') + r.name;
const parseImages = raw => { try { const l = JSON.parse(raw || '[]'); return Array.isArray(l) ? l : []; } catch { return []; } };
const dropFiles = files => (files || []).forEach(f => fs.unlink(f.path, () => {}));

const VALIDATE = [
  body('name').trim().notEmpty().withMessage('Package name is required.').isLength({ max: 255 }).withMessage('The name is too long.'),
  body('event_type').isIn(OCCASION_KEYS).withMessage('Choose what the package is for.'),
  body('price').isFloat({ min: 0 }).withMessage('Enter a valid package price.'),
  body('capacity').optional({ values: 'falsy' }).isInt({ min: 1, max: 5000 }).withMessage('Guests must be a whole number from 1.'),
];

async function bookingCount(id) {
  const row = await db.prepare(`
    SELECT (SELECT COUNT(DISTINCT reservation_id) FROM reservation_items WHERE item_type = 'event_package' AND item_id = ?)
         + (SELECT COUNT(*) FROM events WHERE event_package_id = ?) AS n
  `).get(id, id);
  return Number(row.n) || 0;
}

// Two shown packages with the same name would look like one on the website (it hides look-alikes).
async function nameTaken(name, exceptId) {
  return !!(await db.prepare('SELECT id FROM event_packages WHERE is_active = 1 AND LOWER(TRIM(name)) = LOWER(TRIM(?)) AND id <> ?').get(name, exceptId || 0));
}

// Every hall, room and cottage for the "Places included" picker (hidden ones marked, so an existing link still shows).
async function placeOptions() {
  const groups = [
    ['venue', 'Function halls', 'SELECT id, name, capacity, is_active FROM venues ORDER BY is_active DESC, name'],
    ['room', 'Rooms', 'SELECT id, name, capacity, is_active FROM rooms ORDER BY is_active DESC, name'],
    ['cottage', 'Cottages', 'SELECT id, name, capacity, is_active FROM cottages ORDER BY is_active DESC, name'],
  ];
  const out = [];
  for (const [type, label, sql] of groups) {
    const rows = await db.prepare(sql).all();
    out.push({ label, options: rows.map(r => ({ ref: type + ':' + r.id, text: r.name + (r.capacity ? ' · up to ' + r.capacity : '') + (Number(r.is_active) ? '' : ' (hidden)') })) });
  }
  return out;
}

async function formLocals(pkg, old, errors) {
  // A form sent back with errors keeps what was typed (_form marks a submitted form, even with no rows).
  const inc = old._form ? null : parseInclusions(pkg ? pkg.inclusions : '[]');
  const rows = v => (Array.isArray(v) ? v : v && typeof v === 'object' ? Object.values(v) : []);
  return {
    title: pkg ? `Edit ${pkg.name}` : 'Add event package', layout: 'layouts/main',
    pkg, errors, occasions: OCCASIONS, old,
    included: inc ? inc.included : rows(old.included).map(r => ({ name: r.name || '', removable: !!r.removable })),
    addons: inc ? inc.addons : rows(old.addons).map(r => ({ name: r.name || '', price: r.price || '' })),
    images: pkg ? parseImages(pkg.images) : [],
    places: old._form
      ? rows(old.places).map(r => ({ ref: r.ref || '', qty: r.qty || 1, note: r.note || '' }))
      : pkg ? ((await loadPlaces([pkg.id])).get(pkg.id) || []).map(pl => ({ ref: pl.item_type + ':' + pl.item_id, qty: pl.quantity, note: pl.note })) : [],
    placeGroups: await placeOptions(),
  };
}

// ── List ─────────────────────────────────────────────────────────────────────
router.get('/', requireAuth, requireRole(...CAN_MANAGE), async (req, res) => {
  const packages = await db.prepare(`
    SELECT p.*,
      (SELECT COUNT(DISTINCT ri.reservation_id) FROM reservation_items ri WHERE ri.item_type = 'event_package' AND ri.item_id = p.id) AS bookings
    FROM event_packages p
    ORDER BY p.is_active DESC, p.price, p.name, p.id
  `).all();
  const places = await loadPlaces(packages.map(p => p.id));
  for (const p of packages) {
    p.placesText = (places.get(p.id) || []).map(placeText).join(', ');
    // A hidden hall stops the package being booked; hidden rooms / cottages just drop off its page.
    p.placesHidden = (places.get(p.id) || []).filter(pl => !Number(pl.row.is_active)).map(pl => pl.row.name);
    const inc = parseInclusions(p.inclusions);
    p.includedCount = inc.included.length;
    p.addonCount = inc.addons.length;
    p.imagesList = parseImages(p.images);
  }
  res.render('packages/index', { title: 'Event packages', layout: 'layouts/main', packages, occasions: OCCASIONS });
});

// ── Add ──────────────────────────────────────────────────────────────────────
router.get('/new', requireAuth, requireRole(...CAN_MANAGE), async (req, res) => {
  res.render('packages/form', await formLocals(null, { event_type: 'birthday', is_active: '1' }, []));
});

router.post('/', requireAuth, requireRole(...CAN_MANAGE), withUpload, VALIDATE, async (req, res) => {
  const errors = validationResult(req).array();
  if (req.uploadError) errors.push({ msg: req.uploadError });
  const inc = buildInclusions(req.body.included, req.body.addons);
  inc.errors.forEach(msg => errors.push({ msg }));
  const places = await buildPlaces(req.body.places);
  places.errors.forEach(msg => errors.push({ msg }));
  const show = req.body.is_active === '1';
  if (!errors.length && show && await nameTaken(req.body.name)) errors.push({ msg: `Another shown package is already called "${req.body.name.trim()}". Use a different name.` });
  if (errors.length) { dropFiles(req.files); return res.status(422).render('packages/form', await formLocals(null, req.body, errors)); }

  const { name, description, event_type, price, capacity } = req.body;
  const images = (req.files || []).map(f => `/uploads/packages/${f.filename}`);
  const id = await db.transaction(async () => {
    const newId = (await db.prepare(`
    INSERT INTO event_packages (name, description, event_type, price, inclusions, images, capacity, is_active)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(name.trim(), (description || '').trim(), event_type, price, inc.json, JSON.stringify(images), capacity || null, show ? 1 : 0)).lastInsertRowid;
    await savePlaces(newId, places.rows);
    return newId;
  });

  await req.audit('create', 'event_packages', id, null, { name: name.trim(), price: Number(price), is_active: show ? 1 : 0, places: places.rows.map(placeLine) });
  req.session.flash = { success: `Package "${name.trim()}" ${show ? 'is now on the website' : 'saved as hidden'}.` };
  res.redirect('/packages');
});

// ── Edit ─────────────────────────────────────────────────────────────────────
router.get('/:id/edit', requireAuth, requireRole(...CAN_MANAGE), async (req, res) => {
  const pkg = await db.prepare('SELECT * FROM event_packages WHERE id = ?').get(req.params.id);
  if (!pkg) { req.session.flash = { error: 'Package not found.' }; return res.redirect('/packages'); }
  res.render('packages/form', await formLocals(pkg, { ...pkg, is_active: String(pkg.is_active) }, []));
});

router.post('/:id/edit', requireAuth, requireRole(...CAN_MANAGE), withUpload, VALIDATE, async (req, res) => {
  const pkg = await db.prepare('SELECT * FROM event_packages WHERE id = ?').get(req.params.id);
  if (!pkg) { dropFiles(req.files); req.session.flash = { error: 'Package not found.' }; return res.redirect('/packages'); }
  const errors = validationResult(req).array();
  if (req.uploadError) errors.push({ msg: req.uploadError });
  const inc = buildInclusions(req.body.included, req.body.addons);
  inc.errors.forEach(msg => errors.push({ msg }));
  const places = await buildPlaces(req.body.places);
  places.errors.forEach(msg => errors.push({ msg }));
  const show = req.body.is_active === '1';
  if (!errors.length && show && await nameTaken(req.body.name, pkg.id)) errors.push({ msg: `Another shown package is already called "${req.body.name.trim()}". Use a different name.` });

  const existing = parseImages(pkg.images);
  const keep = [].concat(req.body.keep_images || []).filter(img => existing.includes(img));
  if (!errors.length && keep.length + (req.files || []).length > 5) errors.push({ msg: 'A package can have up to 5 photos. Remove some before adding more.' });
  if (errors.length) { dropFiles(req.files); return res.status(422).render('packages/form', await formLocals(pkg, req.body, errors)); }

  for (const img of existing) if (!keep.includes(img)) { const p = uploadFileFromUrl(img); if (p) fs.unlink(p, () => {}); }
  const images = [...keep, ...(req.files || []).map(f => `/uploads/packages/${f.filename}`)];
  const { name, description, event_type, price, capacity } = req.body;
  const oldPlaces = ((await loadPlaces([pkg.id])).get(pkg.id) || []).map(placeText);
  await db.transaction(async () => {
    await db.prepare(`
      UPDATE event_packages SET name = ?, description = ?, event_type = ?, price = ?, inclusions = ?, images = ?, capacity = ?, is_active = ?, updated_at = NOW()
      WHERE id = ?
    `).run(name.trim(), (description || '').trim(), event_type, price, inc.json, JSON.stringify(images), capacity || null, show ? 1 : 0, pkg.id);
    await savePlaces(pkg.id, places.rows);
  });

  await req.audit('update', 'event_packages', pkg.id,
    { name: pkg.name, price: Number(pkg.price), capacity: pkg.capacity, is_active: pkg.is_active, places: oldPlaces },
    { name: name.trim(), price: Number(price), capacity: capacity ? Number(capacity) : null, is_active: show ? 1 : 0, places: places.rows.map(placeLine) });
  req.session.flash = { success: `Package "${name.trim()}" saved.` };
  res.redirect('/packages');
});

// ── Show / hide ──────────────────────────────────────────────────────────────
router.post('/:id/visibility', requireAuth, requireRole(...CAN_MANAGE), async (req, res) => {
  const pkg = await db.prepare('SELECT id, name, is_active FROM event_packages WHERE id = ?').get(req.params.id);
  if (!pkg) { req.session.flash = { error: 'Package not found.' }; return res.redirect('/packages'); }
  const show = req.body.show === '1';
  if (show && await nameTaken(pkg.name, pkg.id)) {
    req.session.flash = { error: `Another shown package is already called "${pkg.name}". Rename one of them first.` };
    return res.redirect('/packages');
  }
  await db.prepare('UPDATE event_packages SET is_active = ?, updated_at = NOW() WHERE id = ?').run(show ? 1 : 0, pkg.id);
  await req.audit(show ? 'show' : 'hide', 'event_packages', pkg.id, { is_active: pkg.is_active }, { is_active: show ? 1 : 0 });
  req.session.flash = { success: show ? `"${pkg.name}" is now on the website.` : `"${pkg.name}" is hidden. Existing bookings are not affected.` };
  res.redirect('/packages');
});

// ── Delete (never booked only) ───────────────────────────────────────────────
router.post('/:id/delete', requireAuth, requireRole(...CAN_MANAGE), async (req, res) => {
  const pkg = await db.prepare('SELECT * FROM event_packages WHERE id = ?').get(req.params.id);
  if (!pkg) { req.session.flash = { error: 'Package not found.' }; return res.redirect('/packages'); }
  if (await bookingCount(pkg.id)) {
    req.session.flash = { error: `"${pkg.name}" has bookings, so it can't be deleted — hide it instead.` };
    return res.redirect('/packages');
  }
  await db.prepare('DELETE FROM event_packages WHERE id = ?').run(pkg.id);
  for (const img of parseImages(pkg.images)) { const p = uploadFileFromUrl(img); if (p) fs.unlink(p, () => {}); }
  await req.audit('delete', 'event_packages', pkg.id, { name: pkg.name, price: Number(pkg.price) }, null);
  req.session.flash = { success: `Package "${pkg.name}" deleted.` };
  res.redirect('/packages');
});

module.exports = router;
