/**
 * Room Management Routes  (/rooms)
 * Full CRUD + image upload via multer + status management.
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

// Only room types that have at least one active room
async function getActiveRoomTypes() {
  return db.prepare(
    `SELECT rt.* FROM room_types rt
     WHERE EXISTS (SELECT 1 FROM rooms r WHERE r.room_type_id = rt.id AND r.is_active = 1)
     ORDER BY rt.name`
  ).all();
}

// ΓöÇΓöÇ Multer — upload up to 5 images per room into uploads/rooms/ ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ
const UPLOAD_DIR = path.join(process.cwd(), 'uploads', 'rooms');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
  filename:    (_req, file, cb) => {
    const ext  = path.extname(file.originalname).toLowerCase();
    const name = `room-${Date.now()}-${Math.round(Math.random() * 1e6)}${ext}`;
    cb(null, name);
  },
});

const fileFilter = (_req, file, cb) => {
  const allowed = ['.jpg', '.jpeg', '.png', '.webp', '.gif'];
  allowed.includes(path.extname(file.originalname).toLowerCase())
    ? cb(null, true)
    : cb(new Error('Only image files are allowed (jpg, png, webp, gif).'));
};

const upload = multer({ storage, fileFilter, limits: { fileSize: 5 * 1024 * 1024, files: 5 } });

function parseImages(raw) {
  try { return JSON.parse(raw || '[]'); } catch { return []; }
}

// GET /rooms
router.get('/', requireAuth, async (req, res) => {
  const { search = '', status = '', type = '', page = 1 } = req.query;
  const limit  = 12;
  const offset = (parseInt(page) - 1) * limit;
  let   where  = 'WHERE r.is_active = 1';
  const params = [];

  if (search) { where += ` AND (r.room_number LIKE ? OR r.name LIKE ?)`; params.push(`%${search}%`, `%${search}%`); }
  if (status) { where += ` AND r.status = ?`;  params.push(status); }
  if (type)   { where += ` AND rt.name = ?`;   params.push(type); }

  const total = (await db.prepare(`SELECT COUNT(*) AS cnt FROM rooms r JOIN room_types rt ON rt.id=r.room_type_id ${where}`).get(...params)).cnt;
  const rooms = await db.prepare(`
    SELECT r.*, rt.name AS type_name
    FROM rooms r JOIN room_types rt ON rt.id=r.room_type_id
    ${where} ORDER BY r.room_number LIMIT ? OFFSET ?
  `).all(...params, limit, offset);

  for (const r of rooms) r.imagesList = parseImages(r.images);

  const roomTypes = await getActiveRoomTypes();
  const statuses  = ['available','reserved','occupied','cleaning','maintenance','unavailable'];

  res.render('rooms/index', {
    title: 'Rooms – Balai-Reserve', layout: 'layouts/main',
    rooms, roomTypes, statuses,
    filters: { search, status, type },
    pagination: { total, page: parseInt(page), limit, totalPages: Math.ceil(total / limit) },
  });
});

// GET /rooms/new
router.get('/new', requireAuth, requireRole(...CAN_MANAGE), async (req, res) => {
  const roomTypes = await getActiveRoomTypes();
  res.render('rooms/form', {
    title: 'Add New Room', layout: 'layouts/main',
    room: null, roomTypes, errors: [], old: {},
  });
});

// POST /rooms
router.post('/',
  requireAuth, requireRole(...CAN_MANAGE),
  upload.array('images', 5),
  async (req, res, next) => next(), // multer errors handled by express error handler
  [
    body('room_number').trim().notEmpty().withMessage('Room number is required.'),
    body('name').trim().notEmpty().withMessage('Room name is required.'),
    body('room_type_id').isInt().withMessage('Select a room type.'),
    body('capacity').isInt({ min: 1 }).withMessage('Capacity must be at least 1.'),
    body('price').isFloat({ min: 0 }).withMessage('Enter a valid price.'),
  ],
  async (req, res) => {
    const errors    = validationResult(req);
    const roomTypes = await getActiveRoomTypes();
    if (!errors.isEmpty()) {
      if (req.files) req.files.forEach(f => fs.unlink(f.path, () => {}));
      return res.render('rooms/form', { title: 'Add New Room', layout: 'layouts/main', room: null, roomTypes, errors: errors.array(), old: req.body });
    }

    const { room_number, name, description, room_type_id, capacity, price, amenities, floor, status } = req.body;
    const amenitiesJson = amenities ? JSON.stringify(amenities.split(',').map(a => a.trim()).filter(Boolean)) : '[]';
    const imagePaths    = (req.files || []).map(f => `/uploads/rooms/${f.filename}`);
    const imagesJson    = JSON.stringify(imagePaths);

    const id = (await db.prepare(`
      INSERT INTO rooms (room_type_id, room_number, name, description, capacity, price, amenities, images, floor, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(room_type_id, room_number, name, description || '', capacity, price, amenitiesJson, imagesJson, floor || '', status || 'available')).lastInsertRowid;

    await req.audit('create', 'rooms', id, null, { room_number, name });
    req.session.flash = { success: `Room ${room_number} created successfully.` };
    res.redirect('/rooms');
  }
);

// GET /rooms/:id
router.get('/:id', requireAuth, async (req, res) => {
  const room = await db.prepare(`
    SELECT r.*, rt.name AS type_name
    FROM rooms r JOIN room_types rt ON rt.id=r.room_type_id
    WHERE r.id = ?
  `).get(req.params.id);
  if (!room) { req.session.flash = { error: 'Room not found.' }; return res.redirect('/rooms'); }

  try { room.amenitiesList = JSON.parse(room.amenities || '[]'); } catch { room.amenitiesList = []; }
  room.imagesList = parseImages(room.images);

  const reservations = await db.prepare(`
    SELECT r.*, c.first_name || ' ' || c.last_name AS customer_name
    FROM reservations r
    JOIN reservation_items ri ON ri.reservation_id=r.id
    JOIN customers c ON c.id=r.customer_id
    WHERE ri.item_type='room' AND ri.item_id=?
    ORDER BY r.check_in_date DESC LIMIT 10
  `).all(room.id);

  res.render('rooms/show', {
    title: `Room ${room.room_number}`, layout: 'layouts/main',
    room, reservations,
  });
});

// GET /rooms/:id/edit
router.get('/:id/edit', requireAuth, requireRole(...CAN_MANAGE), async (req, res) => {
  const room      = await db.prepare(`SELECT r.*, rt.name AS type_name FROM rooms r JOIN room_types rt ON rt.id=r.room_type_id WHERE r.id=?`).get(req.params.id);
  if (!room) { req.session.flash = { error: 'Room not found.' }; return res.redirect('/rooms'); }
  const roomTypes = await getActiveRoomTypes();
  try { room.amenitiesStr = JSON.parse(room.amenities || '[]').join(', '); } catch { room.amenitiesStr = ''; }
  room.imagesList = parseImages(room.images);
  res.render('rooms/form', {
    title: `Edit Room ${room.room_number}`, layout: 'layouts/main',
    room, roomTypes, errors: [], old: room,
  });
});

// POST /rooms/:id/edit
router.post('/:id/edit',
  requireAuth, requireRole(...CAN_MANAGE),
  upload.array('images', 5),
  async (req, res, next) => next(),
  [
    body('name').trim().notEmpty().withMessage('Room name is required.'),
    body('capacity').isInt({ min: 1 }).withMessage('Capacity must be at least 1.'),
    body('price').isFloat({ min: 0 }).withMessage('Enter a valid price.'),
  ],
  async (req, res) => {
    const old       = await db.prepare(`SELECT * FROM rooms WHERE id=?`).get(req.params.id);
    const roomTypes = await getActiveRoomTypes();
    const errors    = validationResult(req);

    if (!errors.isEmpty()) {
      if (req.files) req.files.forEach(f => fs.unlink(f.path, () => {}));
      try { old.amenitiesStr = JSON.parse(old.amenities || '[]').join(', '); } catch { old.amenitiesStr = ''; }
      old.imagesList = parseImages(old.images);
      return res.render('rooms/form', { title: 'Edit Room', layout: 'layouts/main', room: old, roomTypes, errors: errors.array(), old: req.body });
    }

    const { name, description, room_type_id, capacity, price, amenities, floor, status } = req.body;
    const amenitiesJson = amenities ? JSON.stringify(amenities.split(',').map(a => a.trim()).filter(Boolean)) : '[]';

    // Images to keep (not removed by user)
    const keepImages    = Array.isArray(req.body.keep_images)
      ? req.body.keep_images
      : req.body.keep_images ? [req.body.keep_images] : [];

    // Delete images that were removed
    const existingImages = parseImages(old.images);
    for (const img of existingImages) {
      if (!keepImages.includes(img)) {
        fs.unlink(path.join(process.cwd(), img.replace(/^\//, '')), () => {});
      }
    }

    const newImages  = (req.files || []).map(f => `/uploads/rooms/${f.filename}`);
    const imagesJson = JSON.stringify([...keepImages, ...newImages]);

    await db.prepare(`
      UPDATE rooms SET name=?,description=?,room_type_id=?,capacity=?,price=?,amenities=?,images=?,floor=?,status=?,updated_at=NOW()
      WHERE id=?
    `).run(name, description || '', room_type_id, capacity, price, amenitiesJson, imagesJson, floor || '', status, req.params.id);

    await req.audit('update', 'rooms', req.params.id, { name: old.name, price: old.price }, { name, price, status });
    req.session.flash = { success: 'Room updated successfully.' };
    res.redirect(`/rooms/${req.params.id}`);
  }
);

// POST /rooms/:id/status
router.post('/:id/status', requireAuth, requireRole(...CAN_MANAGE), async (req, res) => {
  const { status } = req.body;
  const old = await db.prepare(`SELECT status FROM rooms WHERE id=?`).get(req.params.id);
  await db.prepare(`UPDATE rooms SET status=?,updated_at=NOW() WHERE id=?`).run(status, req.params.id);
  await req.audit('status_change', 'rooms', req.params.id, old, { status });
  req.session.flash = { success: 'Room status updated.' };
  res.redirect(req.get('Referer') || '/rooms');
});

module.exports = router;
