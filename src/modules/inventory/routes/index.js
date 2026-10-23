/**
 * Inventory Management Routes
 */
'use strict';

const express = require('express');
const { body, validationResult } = require('express-validator');
const db      = require('../../../config/database');
const { requireAuth, requireRole } = require('../../../middleware/auth');

const router     = express.Router();
const CAN_MANAGE = ['admin','staff'];

// GET /inventory
router.get('/', requireAuth, async (req, res) => {
  const { search='', category='', alert='' } = req.query;
  let   where  = 'WHERE i.is_active = 1';
  const params = [];

  if (search)   { where += ` AND (i.name LIKE ? OR i.item_code LIKE ?)`; params.push(`%${search}%`, `%${search}%`); }
  if (category) { where += ` AND i.category_id = ?`; params.push(category); }
  if (alert === 'low') where += ` AND i.available_qty <= i.reorder_level`;

  const items = await db.prepare(`
    SELECT i.*, c.name AS category_name
    FROM inventory_items i JOIN inventory_categories c ON c.id=i.category_id
    ${where}
    ORDER BY c.name, i.name
  `).all(...params);

  const categories = await db.prepare(`SELECT * FROM inventory_categories ORDER BY name`).all();
  const alertCount = (await db.prepare(`SELECT COUNT(*) AS cnt FROM inventory_items WHERE available_qty <= reorder_level AND is_active=1`).get()).cnt;

  // Equipment list
  const equipment = await db.prepare(`
    SELECT e.*, c.name AS category_name
    FROM equipment e LEFT JOIN inventory_categories c ON c.id=e.category_id
    WHERE e.is_active=1 ORDER BY e.name
  `).all();

  res.render('inventory/index', {
    title: 'Inventory – Balai-Reserve',
    layout: 'layouts/main',
    items, categories, equipment, alertCount,
    filters: { search, category, alert },
  });
});

// GET /inventory/new
router.get('/new', requireAuth, requireRole(...CAN_MANAGE), async (req, res) => {
  const categories = await db.prepare(`SELECT * FROM inventory_categories ORDER BY name`).all();
  res.render('inventory/form', { title: 'Add Inventory Item', layout: 'layouts/main', item: null, categories, errors: [], old: {} });
});

// POST /inventory
router.post('/',
  requireAuth, requireRole(...CAN_MANAGE),
  [
    body('name').trim().notEmpty().withMessage('Item name is required.'),
    body('category_id').isInt().withMessage('Select a category.'),
    body('total_qty').isInt({ min: 0 }).withMessage('Total quantity must be 0 or more.'),
    body('reorder_level').optional({ values: 'falsy' }).isInt({ min: 0 }).withMessage('Reorder level must be 0 or more.'),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    const categories = await db.prepare(`SELECT * FROM inventory_categories ORDER BY name`).all();
    if (!errors.isEmpty()) return res.render('inventory/form', { title: 'Add Item', layout: 'layouts/main', item: null, categories, errors: errors.array(), old: req.body });

    const { name, description, category_id, unit, total_qty, reorder_level, location } = req.body;
    const qty = parseInt(total_qty, 10);
    const safeReorderLevel = parseInt(reorder_level || '5', 10);
    const code = `ITEM-${Date.now()}`;

    await db.prepare(`
      INSERT INTO inventory_items (category_id, item_code, name, description, unit, total_qty, available_qty, reserved_qty, damaged_qty, reorder_level, location)
      VALUES (?, ?, ?, ?, ?, ?, ?, 0, 0, ?, ?)
    `).run(category_id, code, name, description || '', unit || 'pcs', qty, qty, safeReorderLevel, location || '');

    req.session.flash = { success: `"${name}" added to inventory.` };
    res.redirect('/inventory');
  }
);

// POST /inventory/:id/adjust — adjust quantities
router.post('/:id/adjust', requireAuth, requireRole(...CAN_MANAGE), async (req, res) => {
  const { adjust_type, quantity, notes } = req.body;
  const validAdjustTypes = new Set(['add', 'remove', 'damage', 'repair']);
  const qty = Number.parseInt(quantity, 10);
  const item = await db.prepare(`SELECT * FROM inventory_items WHERE id=?`).get(req.params.id);

  if (!item || !validAdjustTypes.has(String(adjust_type || '').trim()) || !Number.isInteger(qty) || qty <= 0) {
    req.session.flash = { error: 'Invalid adjustment.' };
    return res.redirect('/inventory');
  }

  await db.transaction(async () => {
    let newAvail = item.available_qty;
    let newDamaged = item.damaged_qty;
    let newTotal = item.total_qty;

    if (adjust_type === 'add') {
      newAvail += qty;
      newTotal += qty;
    }
    if (adjust_type === 'remove') {
      newAvail = Math.max(0, newAvail - qty);
      newTotal = Math.max(0, newTotal - qty);
    }
    if (adjust_type === 'damage') {
      newAvail = Math.max(0, newAvail - qty);
      newDamaged += qty;
    }
    if (adjust_type === 'repair') {
      const repaired = Math.min(qty, newDamaged);
      newDamaged = Math.max(0, newDamaged - repaired);
      newAvail += repaired;
    }

    await db.prepare(`UPDATE inventory_items SET available_qty=?, damaged_qty=?, total_qty=?, updated_at=NOW() WHERE id=?`).run(newAvail, newDamaged, newTotal, item.id);
    await db.prepare(`INSERT INTO inventory_transactions (item_id, transaction_type, quantity, performed_by, notes) VALUES (?,?,?,?,?)`).run(item.id, adjust_type, qty, req.session.user.id, notes || '');
  });

  req.session.flash = { success: 'Inventory adjusted successfully.' };
  res.redirect('/inventory');
});

// GET /inventory/equipment/new
router.get('/equipment/new', requireAuth, requireRole(...CAN_MANAGE), async (req, res) => {
  const categories = await db.prepare(`SELECT * FROM inventory_categories ORDER BY name`).all();
  res.render('inventory/equipment-form', { title: 'Add Equipment', layout: 'layouts/main', equipment: null, categories, errors: [], old: {} });
});

// POST /inventory/equipment
router.post('/equipment',
  requireAuth, requireRole(...CAN_MANAGE),
  [
    body('name').trim().notEmpty().withMessage('Equipment name is required.'),
    body('quantity').isInt({ min: 1 }).withMessage('Quantity must be at least 1.'),
    body('category_id').optional({ values: 'falsy' }).isInt().withMessage('Select a valid category.'),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    const categories = await db.prepare(`SELECT * FROM inventory_categories ORDER BY name`).all();
    if (!errors.isEmpty()) return res.render('inventory/equipment-form', { title: 'Add Equipment', layout: 'layouts/main', equipment: null, categories, errors: errors.array(), old: req.body });

    const { name, description, category_id, quantity, condition } = req.body;
    const safeQuantity = parseInt(quantity, 10);
    const code = `EQ-${Date.now()}`;

    await db.prepare(`
      INSERT INTO equipment (category_id, equipment_code, name, description, quantity, \`condition\`, available_qty)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(category_id || null, code, name, description || '', safeQuantity, condition || 'good', safeQuantity);

    req.session.flash = { success: `Equipment "${name}" added.` };
    res.redirect('/inventory');
  }
);

module.exports = router;