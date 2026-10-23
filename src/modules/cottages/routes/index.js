/**
 * Cottages Management  (/cottages)
 * Full CRUD + availability + status management + image upload.
 */
'use strict';

const express = require('express');
const path    = require('path');
const fs      = require('fs');
const multer  = require('multer');
const { body, validationResult } = require('express-validator');
const db      = require('../../../config/database');
const { requireAuth, requireRole } = require('../../../middleware/auth');

const router     = express.Router();
const CAN_MANAGE = ['admin', 'staff'];

// ΓöÇΓöÇ Multer config: store in uploads/cottages/ ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ
const UPLOAD_DIR = path.join(process.cwd(), 'uploads', 'cottages');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    const ext  = path.extname(file.originalname).toLowerCase();
    const name = `cottage-${Date.now()}-${Math.round(Math.random() * 1e6)}${ext}`;
    cb(null, name);
  },
});

const fileFilter = (req, file, cb) => {
  const allowed = ['.jpg', '.jpeg', '.png', '.webp', '.gif'];
  const ext     = path.extname(file.originalname).toLowerCase();
  if (allowed.includes(ext)) cb(null, true);
  else cb(new Error('Only image files (jpg, png, webp, gif) are allowed.'));
};

const upload = multer({
  storage,
  fileFilter,
  limits: { fileSize: 5 * 1024 * 1024, files: 5 }, // max 5 MB each, up to 5 images
});

// Helper: parse stored images JSON safely
function parseImages(raw) {
  try { return JSON.parse(raw || '[]'); } catch { return []; }
}

// GET /cottages
router.get('/', requireAuth, async (req, res) => {
  const { search = '', status = '', page = 1 } = req.query;
  const limit  = 12;
  const offset = (parseInt(page) - 1) * limit;
  let   where  = 'WHERE is_active = 1';
  const params = [];

  if (search) { where += ` AND (name LIKE ? OR description LIKE ?)`; params.push(`%${search}%`, `%${search}%`); }
  if (status) { where += ` AND status = ?`; params.push(status); }

  const total    = (await db.prepare(`SELECT COUNT(*) AS cnt FROM cottages ${where}`).get(...params)).cnt;
  const cottages = await db.prepare(`SELECT * FROM cottages ${where} ORDER BY name LIMIT ? OFFSET ?`).all(...params, limit, offset);

  // Attach parsed images
  for (const c of cottages) c.imagesList = parseImages(c.images);

  const statuses = ['available', 'reserved', 'occupied', 'maintenance', 'unavailable'];
  const counts   = {};
  for (const s of statuses) {
    counts[s] = (await db.prepare(`SELECT COUNT(*) AS c FROM cottages WHERE status=? AND is_active=1`).get(s)).c;
  }

  res.render('cottages/index', {
    title: 'Cottages – Balai-Reserve', layout: 'layouts/main',
    cottages, statuses, counts,
    filters: { search, status },
    pagination: { total, page: parseInt(page), limit, totalPages: Math.ceil(total / limit) },
  });
});

// GET /cottages/new
router.get('/new', requireAuth, requireRole(...CAN_MANAGE), async (req, res) => {
  res.render('cottages/form', {
    title: 'Add Cottage', layout: 'layouts/main',
    cottage: null, errors: [], old: {},
  });
});

// POST /cottages  — create with optional images
router.post('/',
  requireAuth, requireRole(...CAN_MANAGE),
  upload.array('images', 5),
  async (req, res, next) => {
    // multer errors (file type / size)
    if (req.fileValidationError) {
      return res.render('cottages/form', { title: 'Add Cottage', layout: 'layouts/main', cottage: null, errors: [{ msg: req.fileValidationError }], old: req.body });
    }
    next();
  },
  [
    body('name').trim().notEmpty().withMessage('Cottage name is required.'),
    body('capacity').isInt({ min: 1 }).withMessage('Capacity must be at least 1.'),
    body('price').isFloat({ min: 0 }).withMessage('Enter a valid price.'),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      // Clean up any uploaded files on validation failure
      if (req.files) req.files.forEach(f => fs.unlink(f.path, () => {}));
      return res.render('cottages/form', { title: 'Add Cottage', layout: 'layouts/main', cottage: null, errors: errors.array(), old: req.body });
    }

    const { name, description, capacity, price, amenities, status } = req.body;
    const amenitiesJson = amenities
      ? JSON.stringify(amenities.split(',').map(a => a.trim()).filter(Boolean))
      : '[]';

    // Build public URL paths for the uploaded images
    const imagePaths = (req.files || []).map(f => `/uploads/cottages/${f.filename}`);
    const imagesJson = JSON.stringify(imagePaths);

    const id = (await db.prepare(`
      INSERT INTO cottages (name, description, capacity, price, amenities, images, status)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(name, description || '', capacity, price, amenitiesJson, imagesJson, status || 'available')).lastInsertRowid;

    await req.audit('create', 'cottages', id, null, { name, price });
    req.session.flash = { success: `Cottage "${name}" created successfully.` };
    res.redirect('/cottages');
  }
);

// GET /cottages/:id
router.get('/:id', requireAuth, async (req, res) => {
  const cottage = await db.prepare(`SELECT * FROM cottages WHERE id = ?`).get(req.params.id);
  if (!cottage) { req.session.flash = { error: 'Cottage not found.' }; return res.redirect('/cottages'); }

  try { cottage.amenitiesList = JSON.parse(cottage.amenities || '[]'); } catch { cottage.amenitiesList = []; }
  cottage.imagesList = parseImages(cottage.images);

  const reservations = await db.prepare(`
    SELECT r.*, c.first_name || ' ' || c.last_name AS customer_name
    FROM reservations r
    JOIN reservation_items ri ON ri.reservation_id = r.id
    JOIN customers c ON c.id = r.customer_id
    WHERE ri.item_type = 'cottage' AND ri.item_id = ?
    ORDER BY r.created_at DESC LIMIT 10
  `).all(cottage.id);

  const today = new Date().toISOString().slice(0, 10);
  const activeRes = await db.prepare(`
    SELECT r.*, c.first_name || ' ' || c.last_name AS customer_name
    FROM reservations r
    JOIN reservation_items ri ON ri.reservation_id = r.id
    JOIN customers c ON c.id = r.customer_id
    WHERE ri.item_type = 'cottage' AND ri.item_id = ?
      AND r.status NOT IN ('cancelled','rejected','completed')
      AND r.check_in_date >= ?
    ORDER BY r.check_in_date ASC LIMIT 1
  `).get(cottage.id, today);

  res.render('cottages/show', {
    title: cottage.name, layout: 'layouts/main',
    cottage, reservations, activeRes,
  });
});

// GET /cottages/:id/edit
router.get('/:id/edit', requireAuth, requireRole(...CAN_MANAGE), async (req, res) => {
  const cottage = await db.prepare(`SELECT * FROM cottages WHERE id = ?`).get(req.params.id);
  if (!cottage) { req.session.flash = { error: 'Cottage not found.' }; return res.redirect('/cottages'); }
  try { cottage.amenitiesStr = JSON.parse(cottage.amenities || '[]').join(', '); } catch { cottage.amenitiesStr = ''; }
  cottage.imagesList = parseImages(cottage.images);
  res.render('cottages/form', {
    title: `Edit ${cottage.name}`, layout: 'layouts/main',
    cottage, errors: [], old: cottage,
  });
});

// POST /cottages/:id/edit
router.post('/:id/edit',
  requireAuth, requireRole(...CAN_MANAGE),
  upload.array('images', 5),
  async (req, res, next) => { next(); },
  [
    body('name').trim().notEmpty().withMessage('Cottage name is required.'),
    body('capacity').isInt({ min: 1 }).withMessage('Capacity must be at least 1.'),
    body('price').isFloat({ min: 0 }).withMessage('Enter a valid price.'),
  ],
  async (req, res) => {
    const old    = await db.prepare(`SELECT * FROM cottages WHERE id = ?`).get(req.params.id);
    const errors = validationResult(req);

    if (!errors.isEmpty()) {
      if (req.files) req.files.forEach(f => fs.unlink(f.path, () => {}));
      try { old.amenitiesStr = JSON.parse(old.amenities || '[]').join(', '); } catch { old.amenitiesStr = ''; }
      old.imagesList = parseImages(old.images);
      return res.render('cottages/form', {
        title: 'Edit Cottage', layout: 'layouts/main',
        cottage: old, errors: errors.array(), old: req.body,
      });
    }

    const { name, description, capacity, price, amenities, status } = req.body;
    const amenitiesJson = amenities
      ? JSON.stringify(amenities.split(',').map(a => a.trim()).filter(Boolean))
      : '[]';

    // Determine which existing images to keep (from hidden inputs)
    const keepImages = Array.isArray(req.body.keep_images)
      ? req.body.keep_images
      : req.body.keep_images ? [req.body.keep_images] : [];

    // Delete images that were removed
    const existingImages = parseImages(old.images);
    for (const img of existingImages) {
      if (!keepImages.includes(img)) {
        const filePath = path.join(process.cwd(), img.replace(/^\//, ''));
        fs.unlink(filePath, () => {}); // silent delete
      }
    }

    // Add newly uploaded images
    const newImages  = (req.files || []).map(f => `/uploads/cottages/${f.filename}`);
    const allImages  = [...keepImages, ...newImages];
    const imagesJson = JSON.stringify(allImages);

    await db.prepare(`
      UPDATE cottages SET name=?, description=?, capacity=?, price=?, amenities=?, images=?, status=?, updated_at=NOW()
      WHERE id=?
    `).run(name, description || '', capacity, price, amenitiesJson, imagesJson, status || 'available', req.params.id);

    await req.audit('update', 'cottages', req.params.id, { name: old.name, price: old.price }, { name, price });
    req.session.flash = { success: 'Cottage updated successfully.' };
    res.redirect(`/cottages/${req.params.id}`);
  }
);

// POST /cottages/:id/status — quick status toggle
router.post('/:id/status', requireAuth, requireRole(...CAN_MANAGE), async (req, res) => {
  const { status } = req.body;
  const old = await db.prepare(`SELECT status FROM cottages WHERE id=?`).get(req.params.id);
  await db.prepare(`UPDATE cottages SET status=?, updated_at=NOW() WHERE id=?`).run(status, req.params.id);
  await req.audit('status_change', 'cottages', req.params.id, old, { status });
  req.session.flash = { success: 'Cottage status updated.' };
  res.redirect(req.get('Referer') || '/cottages');
});

module.exports = router;
