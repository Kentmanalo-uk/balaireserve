/**
 * Venue Management Routes
 */
'use strict';

const express = require('express');
const path    = require('path');
const fs      = require('fs');
const multer  = require('multer');
const { body, validationResult } = require('express-validator');
const db      = require('../../../config/database');
const { requireAuth, requireRole } = require('../../../middleware/auth');

const router  = express.Router();
const CAN_MANAGE = ['admin', 'staff'];
const UPLOAD_DIR = path.join(process.cwd(), 'uploads', 'venues');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `venue-${Date.now()}-${Math.round(Math.random() * 1e6)}${ext}`);
  },
});
const upload = multer({
  storage,
  fileFilter: (_req, file, cb) => {
    const allowed = ['.jpg', '.jpeg', '.png', '.webp', '.gif'];
    allowed.includes(path.extname(file.originalname).toLowerCase())
      ? cb(null, true)
      : cb(new Error('Only image files are allowed (jpg, png, webp, gif).'));
  },
  limits: { fileSize: 5 * 1024 * 1024, files: 5 },
});

function parseImages(raw) {
  try { return JSON.parse(raw || '[]'); } catch { return []; }
}

function cleanupUploads(files = []) {
  for (const file of files) {
    fs.unlink(file.path, error => {
      if (error && error.code !== 'ENOENT') console.error('[Venues] Could not remove rejected upload:', error.message);
    });
  }
}

function removeVenueImage(imagePath) {
  const filename = path.basename(imagePath);
  if (imagePath !== `/uploads/venues/${filename}`) return;
  fs.unlink(path.join(UPLOAD_DIR, filename), error => {
    if (error && error.code !== 'ENOENT') console.error('[Venues] Could not remove deleted photo:', error.message);
  });
}

// Only venue_types that exist on at least one active venue
async function getActiveVenueTypes() {
  return (await db.prepare(
    `SELECT DISTINCT venue_type FROM venues WHERE is_active = 1 ORDER BY venue_type`
  ).all()).map(r => r.venue_type);
}

// GET /venues
router.get('/', requireAuth, async (req, res) => {
  const { search = '', status = '', type = '', page = 1 } = req.query;
  const limit  = 12;
  const offset = (parseInt(page) - 1) * limit;
  let   where  = 'WHERE is_active = 1';
  const params = [];

  if (search) { where += ` AND (name LIKE ? OR description LIKE ?)`; params.push(`%${search}%`, `%${search}%`); }
  if (status) { where += ` AND status = ?`;     params.push(status); }
  if (type)   { where += ` AND venue_type = ?`; params.push(type); }

  const total  = (await db.prepare(`SELECT COUNT(*) AS cnt FROM venues ${where}`).get(...params)).cnt;
  const venues = await db.prepare(`SELECT * FROM venues ${where} ORDER BY name LIMIT ? OFFSET ?`).all(...params, limit, offset);
  for (const venue of venues) venue.imagesList = parseImages(venue.images);

  const venueTypes = await getActiveVenueTypes();
  const statuses   = ['available','reserved','maintenance','unavailable'];

  res.render('venues/index', {
    title: 'Venues – Balai-Reserve',
    layout: 'layouts/main',
    venues, venueTypes, statuses,
    filters: { search, status, type },
    pagination: { total, page: parseInt(page), limit, totalPages: Math.ceil(total / limit) },
  });
});

// GET /venues/new
router.get('/new', requireAuth, requireRole(...CAN_MANAGE), async (req, res) => {
  const venueTypes = await getActiveVenueTypes();
  res.render('venues/form', { title: 'Add Venue', layout: 'layouts/main', venue: null, venueTypes, errors: [], old: {} });
});

// POST /venues
router.post('/',
  requireAuth, requireRole(...CAN_MANAGE),
  upload.array('images', 5),
  [
    body('name').trim().notEmpty().withMessage('Venue name is required.'),
    body('venue_type').notEmpty().withMessage('Venue type is required.'),
    body('capacity').isInt({ min: 1 }).withMessage('Capacity must be at least 1.'),
    body('price').isFloat({ min: 0 }).withMessage('Enter a valid price.'),
  ],
  async (req, res) => {
    const venueTypes = await getActiveVenueTypes();
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      cleanupUploads(req.files);
      return res.render('venues/form', { title: 'Add Venue', layout: 'layouts/main', venue: null, venueTypes, errors: errors.array(), old: req.body });
    }
    const { name, venue_type, capacity, description, location, price, price_note, amenities, status } = req.body;
    const amenitiesJson = amenities ? JSON.stringify(amenities.split(',').map(a => a.trim()).filter(Boolean)) : '[]';
    const imagesJson = JSON.stringify((req.files || []).map(file => `/uploads/venues/${file.filename}`));

    await db.prepare(`
      INSERT INTO venues (name, venue_type, capacity, description, location, price, price_note, amenities, images, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(name, venue_type, capacity, description || '', location || '', price, price_note || '', amenitiesJson, imagesJson, status || 'available');

    await req.audit('create', 'venues', null, null, { name, venue_type });
    req.session.flash = { success: `Venue "${name}" created successfully.` };
    res.redirect('/venues');
  }
);

// GET /venues/:id
router.get('/:id', requireAuth, async (req, res) => {
  const venue = await db.prepare(`SELECT * FROM venues WHERE id = ?`).get(req.params.id);
  if (!venue) { req.session.flash = { error: 'Venue not found.' }; return res.redirect('/venues'); }
  try { venue.amenitiesList = JSON.parse(venue.amenities || '[]'); } catch { venue.amenitiesList = []; }
  venue.imagesList = parseImages(venue.images);

  const reservations = await db.prepare(`
    SELECT r.*, c.first_name || ' ' || c.last_name AS customer_name
    FROM reservations r
    JOIN reservation_items ri ON ri.reservation_id = r.id
    JOIN customers c ON c.id = r.customer_id
    WHERE ri.item_type = 'venue' AND ri.item_id = ?
    ORDER BY r.created_at DESC LIMIT 10
  `).all(venue.id);

  res.render('venues/show', { title: venue.name, layout: 'layouts/main', venue, reservations });
});

// GET /venues/:id/edit
router.get('/:id/edit', requireAuth, requireRole(...CAN_MANAGE), async (req, res) => {
  const venue = await db.prepare(`SELECT * FROM venues WHERE id = ?`).get(req.params.id);
  if (!venue) { req.session.flash = { error: 'Venue not found.' }; return res.redirect('/venues'); }
  const venueTypes = await getActiveVenueTypes();
  try { venue.amenitiesStr = JSON.parse(venue.amenities || '[]').join(', '); } catch { venue.amenitiesStr = ''; }
  venue.imagesList = parseImages(venue.images);
  res.render('venues/form', { title: `Edit ${venue.name}`, layout: 'layouts/main', venue, venueTypes, errors: [], old: venue });
});

// POST /venues/:id/edit
router.post('/:id/edit',
  requireAuth, requireRole(...CAN_MANAGE),
  upload.array('images', 5),
  [
    body('name').trim().notEmpty().withMessage('Venue name is required.'),
    body('capacity').isInt({ min: 1 }).withMessage('Capacity must be at least 1.'),
    body('price').isFloat({ min: 0 }).withMessage('Enter a valid price.'),
  ],
  async (req, res) => {
    const old = await db.prepare(`SELECT * FROM venues WHERE id = ?`).get(req.params.id);
    if (!old) {
      cleanupUploads(req.files);
      req.session.flash = { error: 'Venue not found.' };
      return res.redirect('/venues');
    }
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      cleanupUploads(req.files);
      const venueTypes = await getActiveVenueTypes();
      old.imagesList = parseImages(old.images);
      return res.render('venues/form', { title: 'Edit Venue', layout: 'layouts/main', venue: old, venueTypes, errors: errors.array(), old: { ...old, ...req.body } });
    }
    const { name, venue_type, capacity, description, location, price, price_note, amenities, status } = req.body;
    const amenitiesJson = amenities ? JSON.stringify(amenities.split(',').map(a => a.trim()).filter(Boolean)) : '[]';
    const existingImages = parseImages(old.images);
    const requestedKeepImages = Array.isArray(req.body.keep_images)
      ? req.body.keep_images
      : req.body.keep_images ? [req.body.keep_images] : [];
    const keepImages = requestedKeepImages.filter(image => existingImages.includes(image));
    const newImages = (req.files || []).map(file => `/uploads/venues/${file.filename}`);
    if (keepImages.length + newImages.length > 5) {
      cleanupUploads(req.files);
      const venueTypes = await getActiveVenueTypes();
      old.imagesList = existingImages;
      return res.status(400).render('venues/form', {
        title: 'Edit Venue', layout: 'layouts/main', venue: old, venueTypes,
        errors: [{ msg: 'A venue can have a maximum of 5 photos.' }],
        old: { ...old, ...req.body },
      });
    }
    const imagesJson = JSON.stringify([...keepImages, ...newImages]);

    await db.prepare(`
      UPDATE venues SET name=?, venue_type=?, capacity=?, description=?, location=?, price=?, price_note=?, amenities=?, images=?, status=?, updated_at=NOW()
      WHERE id=?
    `).run(name, venue_type, capacity, description || '', location || '', price, price_note || '', amenitiesJson, imagesJson, status, req.params.id);
    for (const image of existingImages) {
      if (!keepImages.includes(image)) removeVenueImage(image);
    }

    await req.audit('update', 'venues', req.params.id, old, { name, price, status });
    req.session.flash = { success: 'Venue updated successfully.' };
    res.redirect(`/venues/${req.params.id}`);
  }
);

module.exports = router;
