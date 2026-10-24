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

// Adjustment types offered in the Adjust modal -> value stored in
// inventory_transactions.transaction_type (the vocabulary documented in the schema).
const ADJUST_TYPES = {
  add:    'added',
  remove: 'removed',
  damage: 'damaged',
  repair: 'repaired',
};
const ADJUST_LABELS = {
  add:    'Added',
  remove: 'Removed',
  damage: 'Marked as damaged',
  repair: 'Repaired',
};

const itemValidators = [
  body('name').trim().notEmpty().withMessage('Item name is required.'),
  body('category_id').isInt().withMessage('Select a category.'),
  body('total_qty').isInt({ min: 0 }).withMessage('Total quantity must be 0 or more.'),
  body('reorder_level').optional({ values: 'falsy' }).isInt({ min: 0 }).withMessage('Reorder level must be 0 or more.'),
];

function getCategories() {
  return db.prepare(`SELECT * FROM inventory_categories ORDER BY name`).all();
}

function getActiveItem(id) {
  return db.prepare(`SELECT * FROM inventory_items WHERE id=? AND is_active=1`).get(id);
}

function qtySummary(item) {
  return `${item.total_qty} total, ${item.available_qty} available, ${item.damaged_qty} damaged`;
}

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

  const categories = await getCategories();
  const alertCount = (await db.prepare(`SELECT COUNT(*) AS cnt FROM inventory_items WHERE available_qty <= reorder_level AND is_active=1`).get()).cnt;

  // Equipment list
  const equipment = await db.prepare(`
    SELECT e.*, c.name AS category_name
    FROM equipment e LEFT JOIN inventory_categories c ON c.id=e.category_id
    WHERE e.is_active=1 ORDER BY e.name
  `).all();

  // Quantities change on every adjustment, so never show a cached copy of the list
  // (e.g. when the browser restores it with the Back button).
  res.set('Cache-Control', 'no-store');
  res.render('inventory/index', {
    title: 'Inventory – Balai-Reserve',
    layout: 'layouts/main',
    items, categories, equipment, alertCount,
    filters: { search, category, alert },
  });
});

// GET /inventory/new
router.get('/new', requireAuth, requireRole(...CAN_MANAGE), async (req, res) => {
  const categories = await getCategories();
  res.render('inventory/form', { title: 'Add Inventory Item', layout: 'layouts/main', item: null, categories, errors: [], old: {} });
});

// POST /inventory
router.post('/',
  requireAuth, requireRole(...CAN_MANAGE),
  itemValidators,
  async (req, res) => {
    const errors = validationResult(req);
    const categories = await getCategories();
    if (!errors.isEmpty()) return res.render('inventory/form', { title: 'Add Inventory Item', layout: 'layouts/main', item: null, categories, errors: errors.array(), old: req.body });

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

// GET /inventory/:id/edit
router.get('/:id(\\d+)/edit', requireAuth, requireRole(...CAN_MANAGE), async (req, res) => {
  const item = await getActiveItem(req.params.id);
  if (!item) {
    req.session.flash = { error: 'Inventory item not found.' };
    return res.redirect('/inventory');
  }
  const categories = await getCategories();
  res.render('inventory/form', { title: 'Edit Inventory Item', layout: 'layouts/main', item, categories, errors: [], old: item });
});

// POST /inventory/:id/edit
router.post('/:id(\\d+)/edit',
  requireAuth, requireRole(...CAN_MANAGE),
  itemValidators,
  async (req, res) => {
    const item = await getActiveItem(req.params.id);
    if (!item) {
      req.session.flash = { error: 'Inventory item not found.' };
      return res.redirect('/inventory');
    }

    const categories = await getCategories();
    const errors = validationResult(req).array();
    const newTotal = parseInt(req.body.total_qty, 10);
    // Units that are reserved or damaged are still part of the total, so the
    // total can't drop below them; the difference goes to/from available.
    const committed = item.reserved_qty + item.damaged_qty;
    if (Number.isInteger(newTotal) && newTotal < committed) {
      errors.push({ msg: `Total quantity can't be less than ${committed} (${item.reserved_qty} reserved + ${item.damaged_qty} damaged).` });
    }
    if (errors.length) return res.render('inventory/form', { title: 'Edit Inventory Item', layout: 'layouts/main', item, categories, errors, old: req.body });

    const { name, description, category_id, unit, reorder_level, location } = req.body;
    const safeReorderLevel = reorder_level === undefined || reorder_level === '' ? item.reorder_level : parseInt(reorder_level, 10);
    const delta = newTotal - item.total_qty;

    await db.transaction(async () => {
      await db.prepare(`
        UPDATE inventory_items
        SET name=?, category_id=?, unit=?, total_qty=?, available_qty=available_qty+?, reorder_level=?, location=?, description=?, updated_at=NOW()
        WHERE id=?
      `).run(name, category_id, unit || 'pcs', newTotal, delta, safeReorderLevel, location || '', description || '', item.id);

      // Keep the history complete when the total is corrected from the edit form.
      if (delta !== 0) {
        await db.prepare(`INSERT INTO inventory_transactions (item_id, transaction_type, quantity, performed_by, notes) VALUES (?,?,?,?,?)`)
          .run(item.id, delta > 0 ? 'added' : 'removed', Math.abs(delta), req.session.user.id, `Total edited from ${item.total_qty} to ${newTotal}`);
      }
    });

    req.session.flash = { success: `"${name}" updated.` };
    res.redirect(`/inventory#item-${item.id}`);
  }
);

// POST /inventory/:id/remove — soft delete (transactions keep referencing the item)
router.post('/:id(\\d+)/remove', requireAuth, requireRole(...CAN_MANAGE), async (req, res) => {
  const item = await getActiveItem(req.params.id);
  if (!item) {
    req.session.flash = { error: 'Inventory item not found or already removed.' };
    return res.redirect('/inventory');
  }

  await db.prepare(`UPDATE inventory_items SET is_active=0, updated_at=NOW() WHERE id=?`).run(item.id);

  req.session.flash = { success: `"${item.name}" removed from inventory.` };
  res.redirect('/inventory');
});

// GET /inventory/:id/history — recent transactions for one item
router.get('/:id(\\d+)/history', requireAuth, async (req, res) => {
  const item = await db.prepare(`
    SELECT i.*, c.name AS category_name
    FROM inventory_items i JOIN inventory_categories c ON c.id=i.category_id
    WHERE i.id=?
  `).get(req.params.id);
  if (!item) {
    req.session.flash = { error: 'Inventory item not found.' };
    return res.redirect('/inventory');
  }

  const transactions = await db.prepare(`
    SELECT t.*, CONCAT(u.first_name, ' ', u.last_name) AS performed_by_name
    FROM inventory_transactions t LEFT JOIN users u ON u.id=t.performed_by
    WHERE t.item_id=?
    ORDER BY t.created_at DESC, t.id DESC
    LIMIT 50
  `).all(item.id);

  res.set('Cache-Control', 'no-store');
  res.render('inventory/history', {
    title: `${item.name} History – Balai-Reserve`,
    layout: 'layouts/main',
    item, transactions,
  });
});

// POST /inventory/:id/adjust — adjust quantities
router.post('/:id(\\d+)/adjust', requireAuth, requireRole(...CAN_MANAGE), async (req, res) => {
  const { notes } = req.body;
  const adjustType = String(req.body.adjust_type || '').trim();
  const qty = Number.parseInt(req.body.quantity, 10);

  if (!ADJUST_TYPES[adjustType] || !Number.isInteger(qty) || qty <= 0) {
    req.session.flash = { error: 'Invalid adjustment: choose an adjustment type and a quantity of at least 1.' };
    return res.redirect('/inventory');
  }

  // Validate against the locked row so two adjustments can't both pass the
  // check and overdraw the same units.
  const result = await db.transaction(async () => {
    const item = await db.prepare(`SELECT * FROM inventory_items WHERE id=? AND is_active=1 FOR UPDATE`).get(req.params.id);
    if (!item) return { error: 'Inventory item not found.' };

    const next = { total_qty: item.total_qty, available_qty: item.available_qty, damaged_qty: item.damaged_qty };

    if (adjustType === 'add') {
      next.total_qty     += qty;
      next.available_qty += qty;
    }
    if (adjustType === 'remove') {
      if (qty > item.available_qty) return { item, error: `Can't remove ${qty} — only ${item.available_qty} ${item.unit} of "${item.name}" available.` };
      next.total_qty     -= qty;
      next.available_qty -= qty;
    }
    if (adjustType === 'damage') {
      if (qty > item.available_qty) return { item, error: `Can't mark ${qty} as damaged — only ${item.available_qty} ${item.unit} of "${item.name}" available.` };
      next.available_qty -= qty;
      next.damaged_qty   += qty;
    }
    if (adjustType === 'repair') {
      if (item.damaged_qty === 0) return { item, error: `"${item.name}" has no damaged units to repair.` };
      if (qty > item.damaged_qty) return { item, error: `Can't repair ${qty} — only ${item.damaged_qty} ${item.unit} of "${item.name}" are damaged.` };
      next.damaged_qty   -= qty;
      next.available_qty += qty;
    }

    await db.prepare(`UPDATE inventory_items SET available_qty=?, damaged_qty=?, total_qty=?, updated_at=NOW() WHERE id=?`).run(next.available_qty, next.damaged_qty, next.total_qty, item.id);
    await db.prepare(`INSERT INTO inventory_transactions (item_id, transaction_type, quantity, performed_by, notes) VALUES (?,?,?,?,?)`).run(item.id, ADJUST_TYPES[adjustType], qty, req.session.user.id, notes || '');

    return { item: { ...item, ...next } };
  });

  if (result.error) {
    req.session.flash = { error: result.error };
  } else {
    req.session.flash = { success: `${ADJUST_LABELS[adjustType]} ${qty} ${result.item.unit} of "${result.item.name}". Now ${qtySummary(result.item)}.` };
  }
  res.redirect(result.item ? `/inventory#item-${result.item.id}` : '/inventory');
});

// GET /inventory/equipment/new
router.get('/equipment/new', requireAuth, requireRole(...CAN_MANAGE), async (req, res) => {
  const categories = await getCategories();
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
    const categories = await getCategories();
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
