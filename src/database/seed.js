/**
 * Balai-Reserve Database Seed (PRODUCTION / FRESH START)
 * ------------------------------------------------------
 * Seeds ONLY the essential setup data needed to run the system:
 *   - roles (admin, staff, customer)
 *   - the admin + staff user accounts
 *   - room types, rooms, venues, cottages
 *   - event packages
 *   - inventory categories, items, equipment
 *   - system settings (incl. payment account settings)
 *
 * It does NOT insert any demo customers, reservations, payments,
 * events, feedback, inquiries, notifications, or AI insights —
 * the app starts clean, ready for real bookings.
 *
 * Run: node src/database/seed.js   (or: npm run seed)
 */
'use strict';

require('dotenv').config();
const bcrypt   = require('bcryptjs');
const db       = require('../config/database');

const seedAll = async () => {

  // ── ROLES ─────────────────────────────────────────────────────────────────
  console.log('[Seed] Inserting roles...');
  const insertRole = db.prepare(`INSERT IGNORE INTO roles (name, label) VALUES (?, ?)`);
  await insertRole.run('admin',    'Administrator');
  await insertRole.run('staff',    'Staff');
  await insertRole.run('customer', 'Customer / Guest');

  const roles = {};
  (await db.prepare('SELECT id, name FROM roles').all()).forEach(r => roles[r.name] = r.id);

  // ── USERS (admin + staff only — NO demo customers) ─────────────────────────
  console.log('[Seed] Inserting staff accounts...');
  const insertUser = db.prepare(`
    INSERT IGNORE INTO users (role_id, first_name, last_name, email, password_hash, phone, is_active)
    VALUES (?, ?, ?, ?, ?, ?, 1)
  `);
  const pw = bcrypt.hashSync('password123', 10);

  // Admin account
  await insertUser.run(roles.admin, 'Ryan',   'Miciano',   'admin@balai.com', pw, '09171234567');
  // Staff accounts
  await insertUser.run(roles.staff, 'Maria',  'Santos',    'maria@balai.com', pw, '09181234567');
  await insertUser.run(roles.staff, 'Jose',   'Reyes',     'jose@balai.com',  pw, '09191234567');

  // ── ROOM TYPES ────────────────────────────────────────────────────────────
  console.log('[Seed] Inserting room types...');
  const insertRoomType = db.prepare(`INSERT IGNORE INTO room_types (name, description, base_price) VALUES (?, ?, ?)`);
  await insertRoomType.run('Casa Standard Room',          'Casa standard room with essential amenities',        3500);
  await insertRoomType.run('Casa Deluxe Room',            'Casa deluxe room with premium amenities',            5500);
  await insertRoomType.run('Villa with Private Pool',     'Private villa featuring an exclusive pool',          8500);
  await insertRoomType.run('Main House with Private Pool','Spacious main house with a dedicated private pool', 12000);

  const roomTypes = {};
  (await db.prepare('SELECT id, name FROM room_types').all()).forEach(rt => roomTypes[rt.name] = rt.id);

  // ── ROOMS ─────────────────────────────────────────────────────────────────
  console.log('[Seed] Inserting rooms...');
  const insertRoom = db.prepare(`
    INSERT IGNORE INTO rooms
      (room_type_id, room_number, name, description, capacity, price, amenities, floor, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'available')
  `);
  const amenStandard = JSON.stringify(['WiFi','AC','TV','Hot Shower','Breakfast']);
  const amenDeluxe   = JSON.stringify(['WiFi','AC','TV','Hot Shower','Breakfast','Mini-bar','Balcony']);
  const amenVilla    = JSON.stringify(['WiFi','AC','TV','Hot Shower','Breakfast','Private Pool','Kitchen','Living Area']);
  const amenMain     = JSON.stringify(['WiFi','AC','TV','Hot Shower','Breakfast','Private Pool','Full Kitchen','Living Area','Dining Area','Multiple Rooms']);
  const roomsData = [
    [roomTypes['Casa Standard Room'],          'CS-01', 'Casa Standard Room',         'Cozy casa standard room with essential amenities', 4, 3500,  amenStandard, ''],
    [roomTypes['Casa Deluxe Room'],            'CD-01', 'Casa Deluxe Room',           'Spacious casa deluxe room with premium amenities', 4, 5500,  amenDeluxe,   ''],
    [roomTypes['Villa with Private Pool'],     'VP-01', 'Villa with Private Pool',    'Private villa featuring an exclusive pool',         8, 8500,  amenVilla,    ''],
    [roomTypes['Main House with Private Pool'],'MH-01', 'Main House with Private Pool','Full main house with a dedicated private pool',   20, 12000, amenMain,     ''],
  ];
  for (const r of roomsData) await insertRoom.run(...r);

  // ── VENUES ────────────────────────────────────────────────────────────────
  console.log('[Seed] Inserting venues...');
  const insertVenue = db.prepare(`
    INSERT INTO venues
      (name, venue_type, capacity, description, location, price, amenities, status)
    SELECT ?, ?, ?, ?, ?, ?, ?, 'available' FROM DUAL
    WHERE NOT EXISTS (SELECT 1 FROM venues WHERE name = ?)   -- utf8mb4_unicode_ci is case-insensitive
  `);
  const seedVenue = (name, ...values) => insertVenue.run(name, ...values, name);
  await seedVenue('Main House Function Hall',    'function_hall', 150, 'Elegant air-conditioned main house function hall for events', 'Main House',     15000, JSON.stringify(['Sound System','Projector','AC','Stage','Tables','Chairs']));
  await seedVenue('Villa Isabella Function Hall','function_hall', 100, 'Beautiful Villa Isabella function hall for celebrations',     'Villa Isabella', 12000, JSON.stringify(['Sound System','Projector','AC','Tables','Chairs']));
  await seedVenue('Pavillion Function Hall',     'pavilion',      200, 'Open-air pavilion perfect for large gatherings and events',   'Pavilion Area',  10000, JSON.stringify(['Stage','Sound System','Outdoor Lighting','Tables','Chairs']));

  // ── COTTAGES ──────────────────────────────────────────────────────────────
  console.log('[Seed] Inserting cottages...');
  const insertCottage = db.prepare(`
    INSERT INTO cottages (name, description, capacity, price, amenities, status)
    SELECT ?, ?, ?, ?, ?, 'available' FROM DUAL
    WHERE NOT EXISTS (SELECT 1 FROM cottages WHERE name = ?)
  `);
  const seedCottage = (name, ...values) => insertCottage.run(name, ...values, name);
  await seedCottage('Cottage',        'Shaded cottage near the pool — ideal for small groups',    5, 500,  JSON.stringify(['Fan','Table','Chairs']));
  await seedCottage('Umbrella Table', 'Beachside umbrella table perfect for a cozy group outing', 4, 300, JSON.stringify(['Umbrella','Table','Chairs']));
  await seedCottage('Pavillion',      'Large open pavilion accommodating big gatherings',        60, 2000, JSON.stringify(['Tables','Chairs','Outdoor Lighting']));

  // ── EVENT PACKAGES ────────────────────────────────────────────────────────
  console.log('[Seed] Inserting event packages...');
  const insertPackage = db.prepare(`
    INSERT INTO event_packages (name, description, event_type, price, inclusions, capacity)
    SELECT ?, ?, ?, ?, ?, ? FROM DUAL
    WHERE NOT EXISTS (
      SELECT 1 FROM event_packages
      WHERE name = ? AND COALESCE(event_type, '') = COALESCE(?, '')
    )
  `);
  const seedPackage = (name, description, eventType, price, inclusions, capacity) =>
    insertPackage.run(name, description, eventType, price, inclusions, capacity, name, eventType);
  await seedPackage('Wedding Package A', 'Basic wedding package for intimate celebrations', 'wedding', 50000,
    JSON.stringify([
      { name: 'Venue (4 hrs)',          price: 0,    is_default: 1, is_optional: 0 },
      { name: 'Catering (50 pax)',       price: 0,    is_default: 1, is_optional: 0 },
      { name: 'Floral Arrangement',      price: 0,    is_default: 1, is_optional: 1 },
      { name: 'Sound System',            price: 0,    is_default: 1, is_optional: 1 },
      { name: 'Projector & Screen',      price: 0,    is_default: 1, is_optional: 1 },
      { name: 'Photo / Video Coverage',  price: 8000, is_default: 0, is_optional: 1 },
      { name: 'Catering (100 pax)',       price: 8000, is_default: 0, is_optional: 1 },
      { name: 'Wedding Cake (3-tier)',    price: 4500, is_default: 0, is_optional: 1 },
      { name: 'Bridal Car Decoration',   price: 2500, is_default: 0, is_optional: 1 },
      { name: 'Emcee / Host',            price: 3000, is_default: 0, is_optional: 1 },
    ]), 50);

  await seedPackage('Wedding Package B', 'Premium wedding package with full decoration', 'wedding', 80000,
    JSON.stringify([
      { name: 'Venue (8 hrs)',          price: 0,    is_default: 1, is_optional: 0 },
      { name: 'Catering (100 pax)',      price: 0,    is_default: 1, is_optional: 0 },
      { name: 'Floral Arrangement',      price: 0,    is_default: 1, is_optional: 1 },
      { name: 'Sound System',            price: 0,    is_default: 1, is_optional: 1 },
      { name: 'Projector & Screen',      price: 0,    is_default: 1, is_optional: 1 },
      { name: 'Photo / Video Coverage',  price: 0,    is_default: 1, is_optional: 1 },
      { name: 'Catering (150 pax)',       price: 6000, is_default: 0, is_optional: 1 },
      { name: 'Wedding Cake (3-tier)',    price: 4500, is_default: 0, is_optional: 1 },
      { name: 'Bridal Car Decoration',   price: 2500, is_default: 0, is_optional: 1 },
      { name: 'Emcee / Host',            price: 3000, is_default: 0, is_optional: 1 },
      { name: 'Live Band (3 hrs)',        price: 12000,is_default: 0, is_optional: 1 },
      { name: 'Photo Booth (4 hrs)',      price: 5000, is_default: 0, is_optional: 1 },
    ]), 100);

  await seedPackage('Birthday Package', 'Fun birthday celebration package', 'birthday', 15000,
    JSON.stringify([
      { name: 'Venue (4 hrs)',           price: 0,    is_default: 1, is_optional: 0 },
      { name: 'Catering (30 pax)',        price: 0,    is_default: 1, is_optional: 0 },
      { name: 'Birthday Cake',            price: 0,    is_default: 1, is_optional: 1 },
      { name: 'Balloons & Decoration',    price: 0,    is_default: 1, is_optional: 1 },
      { name: 'Sound System',             price: 0,    is_default: 1, is_optional: 1 },
      { name: 'Catering (50 pax)',         price: 4000, is_default: 0, is_optional: 1 },
      { name: 'Photo / Video Coverage',   price: 5000, is_default: 0, is_optional: 1 },
      { name: 'Photo Booth (3 hrs)',       price: 3500, is_default: 0, is_optional: 1 },
      { name: 'Emcee / Host',             price: 2500, is_default: 0, is_optional: 1 },
      { name: 'Custom Backdrop',          price: 1500, is_default: 0, is_optional: 1 },
    ]), 30);

  await seedPackage('Debut Package', 'Elegant 18th birthday debut celebration', 'debut', 35000,
    JSON.stringify([
      { name: 'Venue (6 hrs)',           price: 0,    is_default: 1, is_optional: 0 },
      { name: 'Catering (80 pax)',        price: 0,    is_default: 1, is_optional: 0 },
      { name: 'Floral Arrangement',       price: 0,    is_default: 1, is_optional: 1 },
      { name: 'Sound System',             price: 0,    is_default: 1, is_optional: 1 },
      { name: 'Projector & Screen',       price: 0,    is_default: 1, is_optional: 1 },
      { name: 'Photo / Video Coverage',   price: 0,    is_default: 1, is_optional: 1 },
      { name: 'Catering (120 pax)',        price: 6000, is_default: 0, is_optional: 1 },
      { name: '18 Roses Ceremony Setup',  price: 3500, is_default: 0, is_optional: 1 },
      { name: '18 Candles Ceremony Setup',price: 3500, is_default: 0, is_optional: 1 },
      { name: 'Photo Booth (4 hrs)',       price: 4000, is_default: 0, is_optional: 1 },
      { name: 'Live Band (3 hrs)',         price: 12000,is_default: 0, is_optional: 1 },
      { name: 'Emcee / Host',             price: 3000, is_default: 0, is_optional: 1 },
    ]), 80);

  await seedPackage('Corporate Package', 'Professional corporate event package', 'corporate', 25000,
    JSON.stringify([
      { name: 'Venue (8 hrs)',           price: 0,    is_default: 1, is_optional: 0 },
      { name: 'Catering (50 pax)',        price: 0,    is_default: 1, is_optional: 0 },
      { name: 'Projector & Screen',       price: 0,    is_default: 1, is_optional: 1 },
      { name: 'Sound System',             price: 0,    is_default: 1, is_optional: 1 },
      { name: 'Tables & Chairs',          price: 0,    is_default: 1, is_optional: 1 },
      { name: 'High-Speed WiFi',          price: 0,    is_default: 1, is_optional: 1 },
      { name: 'Catering (100 pax)',        price: 8000, is_default: 0, is_optional: 1 },
      { name: 'Live Streaming Setup',     price: 6000, is_default: 0, is_optional: 1 },
      { name: 'Whiteboard & Markers',     price: 500,  is_default: 0, is_optional: 1 },
      { name: 'Printer / Photocopier',    price: 1000, is_default: 0, is_optional: 1 },
      { name: 'Photo / Video Coverage',   price: 5000, is_default: 0, is_optional: 1 },
    ]), 50);

  await seedPackage('Meeting Package', 'Half-day meeting room package', 'meeting', 5000,
    JSON.stringify([
      { name: 'Conference Room (4 hrs)', price: 0,    is_default: 1, is_optional: 0 },
      { name: 'Water & Coffee',          price: 0,    is_default: 1, is_optional: 1 },
      { name: 'Projector & Screen',      price: 0,    is_default: 1, is_optional: 1 },
      { name: 'Whiteboard',              price: 0,    is_default: 1, is_optional: 1 },
      { name: 'Full-Day Extension (+4 hrs)', price: 3000, is_default: 0, is_optional: 1 },
      { name: 'Lunch Catering (20 pax)', price: 4000, is_default: 0, is_optional: 1 },
      { name: 'Live Streaming Setup',    price: 3500, is_default: 0, is_optional: 1 },
      { name: 'Printer / Photocopier',   price: 800,  is_default: 0, is_optional: 1 },
    ]), 20);

  // ── INVENTORY CATEGORIES ──────────────────────────────────────────────────
  console.log('[Seed] Inserting inventory categories...');
  const insertCat = db.prepare(`INSERT IGNORE INTO inventory_categories (name, description) VALUES (?, ?)`);
  await insertCat.run('Furniture',         'Tables, chairs, sofas, and other furniture items');
  await insertCat.run('Linens & Bedding',  'Bed sheets, pillowcases, towels, and table cloths');
  await insertCat.run('Audio Visual',      'Sound systems, projectors, microphones, screens');
  await insertCat.run('Lighting',          'Event lighting, fairy lights, spotlights');
  await insertCat.run('Decor',             'Floral arrangements, centerpieces, backdrops');
  await insertCat.run('Kitchen',           'Plates, glasses, cutlery, serving equipment');
  await insertCat.run('Outdoor',           'Tents, umbrellas, outdoor furniture');
  await insertCat.run('Safety',            'Life vests, first aid kits, fire extinguishers');

  const cats = {};
  (await db.prepare('SELECT id, name FROM inventory_categories').all()).forEach(c => cats[c.name] = c.id);

  // ── INVENTORY ITEMS ───────────────────────────────────────────────────────
  console.log('[Seed] Inserting inventory items...');
  const insertInv = db.prepare(`
    INSERT IGNORE INTO inventory_items
      (category_id, item_code, name, unit, total_qty, available_qty, reserved_qty, damaged_qty, reorder_level)
    VALUES (?, ?, ?, ?, ?, ?, 0, 0, ?)
  `);
  await insertInv.run(cats.Furniture,          'FUR-001', 'Monobloc Chair',      'pcs',  150, 150, 20);
  await insertInv.run(cats.Furniture,          'FUR-002', 'Folding Table (6ft)', 'pcs',   40,  40,  5);
  await insertInv.run(cats.Furniture,          'FUR-003', 'Round Table',         'pcs',   20,  20,  3);
  await insertInv.run(cats['Linens & Bedding'],'LIN-001', 'Queen Bed Sheet Set', 'sets',  30,  30,  5);
  await insertInv.run(cats['Linens & Bedding'],'LIN-002', 'Pillow',              'pcs',   60,  60, 10);
  await insertInv.run(cats['Linens & Bedding'],'LIN-003', 'Bath Towel',          'pcs',   80,  80, 10);
  await insertInv.run(cats['Linens & Bedding'],'LIN-004', 'Table Cloth (White)', 'pcs',   50,  50,  8);
  await insertInv.run(cats['Audio Visual'],    'AV-001',  'Wireless Microphone', 'pcs',   10,  10,  2);
  await insertInv.run(cats['Audio Visual'],    'AV-002',  'Projector Screen',    'pcs',    4,   4,  1);
  await insertInv.run(cats.Lighting,           'LGT-001', 'String Lights (10m)', 'rolls', 20,  20,  3);
  await insertInv.run(cats.Outdoor,            'OUT-001', 'Patio Umbrella',      'pcs',   10,  10,  2);

  // ── EQUIPMENT ─────────────────────────────────────────────────────────────
  console.log('[Seed] Inserting equipment...');
  const insertEq = db.prepare(`
    INSERT IGNORE INTO equipment
      (category_id, equipment_code, name, description, quantity, \`condition\`, available_qty)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  await insertEq.run(cats['Audio Visual'], 'EQ-001', 'Main Sound System',    '5000W PA System with subwoofer',              1, 'excellent', 1);
  await insertEq.run(cats['Audio Visual'], 'EQ-002', 'Portable Sound System','Portable Bluetooth speaker set',              2, 'good',      2);
  await insertEq.run(cats['Audio Visual'], 'EQ-003', 'Projector (4K)',       'Epson 4K event projector',                    2, 'good',      2);
  await insertEq.run(cats['Audio Visual'], 'EQ-004', 'Wireless Mic Set',     'Set of 4 wireless microphones',               3, 'good',      3);
  await insertEq.run(cats.Lighting,        'EQ-005', 'LED Par Lights',       'Set of 12 LED par lights with controller',    2, 'excellent', 2);
  await insertEq.run(cats.Decor,           'EQ-006', 'Photo Booth Set',      'Complete photo booth with backdrop and props',1, 'good',      1);
  await insertEq.run(cats.Decor,           'EQ-007', 'Arch Frame (Gold)',    'Gold floral arch frame 3m x 2m',              2, 'good',      2);
  await insertEq.run(cats.Outdoor,         'EQ-008', 'Event Tent (5x5m)',    'Canopy tent for outdoor events',              3, 'good',      3);

  // ── SYSTEM SETTINGS ───────────────────────────────────────────────────────
  console.log('[Seed] Inserting system settings...');
  const insertSetting = db.prepare(`
    INSERT IGNORE INTO settings (\`key\`, value, label, group_name) VALUES (?, ?, ?, ?)
  `);
  // General
  await insertSetting.run('resort_name',         'Balai-Reserve',                                           'Resort Name',                'general');
  await insertSetting.run('resort_tagline',      'Your Home Away From Home',                                'Resort Tagline',             'general');
  await insertSetting.run('resort_address',      'Brgy. San Antonio, Gloria, Oriental Mindoro, Philippines','Resort Address',             'general');
  await insertSetting.run('resort_phone',        '(02) 8123-4567',                                          'Resort Phone',               'general');
  await insertSetting.run('resort_email',        'info@balai-reserve.com',                                  'Resort Email',               'general');
  await insertSetting.run('currency_symbol',     '₱',                                                       'Currency Symbol',            'general');
  // Booking
  await insertSetting.run('check_in_time',       '14:00',                                                   'Default Check-in Time',      'booking');
  await insertSetting.run('check_out_time',      '12:00',                                                   'Default Check-out Time',     'booking');
  await insertSetting.run('downpayment_percent', '50',                                                      'Downpayment Percentage (%)', 'booking');
  await insertSetting.run('cancellation_policy', 'Cancellations made 7 days before the event are eligible for a 50% refund. No refund for cancellations within 48 hours.', 'Cancellation Policy', 'booking');
  // Automation / display
  await insertSetting.run('followup_days',       '3',                                                       'Follow-up Wait Days',        'automation');
  await insertSetting.run('records_per_page',    '20',                                                      'Records Per Page',           'display');
  // Payment account details (fill in real values via Admin → Settings → Payment)
  await insertSetting.run('gcash_number',        '09XXXXXXXXXX',        'GCash Number',             'payment');
  await insertSetting.run('gcash_name',          'Balai Miciano Resort','GCash Account Name',       'payment');
  await insertSetting.run('maya_number',         '09XXXXXXXXXX',        'Maya Number',              'payment');
  await insertSetting.run('maya_name',           'Balai Miciano Resort','Maya Account Name',        'payment');
  await insertSetting.run('bank_bdo',            'XXXX-XXXX-XXXX',      'BDO Account Number',       'payment');
  await insertSetting.run('bank_bpi',            'XXXX-XXXX-XXXX',      'BPI Account Number',       'payment');
  await insertSetting.run('bank_name',           'Balai Miciano Resort','Bank Account Name',        'payment');
  await insertSetting.run('gcash_qr_path',       '',                    'GCash QR Code Image Path', 'payment');
  await insertSetting.run('maya_qr_path',        '',                    'Maya QR Code Image Path',  'payment');

};

async function main() {
  const { name: dbName } = await db.prepare('SELECT DATABASE() AS name').get();
  console.log(`[Seed] Using MySQL database: ${dbName}`);
  console.log('[Seed] Starting production seeding (setup data only)...');

  await db.transaction(seedAll);

  console.log('[Seed] Setup data seeded successfully. The system is ready for real bookings.');
  console.log('');
  console.log('  Login Credentials (change passwords after first login):');
  console.log('  ─────────────────────────────────────────────');
  console.log('  Admin:  admin@balai.com  / password123');
  console.log('  Staff:  maria@balai.com  / password123');
  console.log('  Staff:  jose@balai.com   / password123');
  console.log('  ─────────────────────────────────────────────');
  console.log('  NOTE: Set real payment account details in Admin → Settings → Payment.');
}

main()
  .catch((err) => {
    console.error('[Seed] Error:', err.message);
    process.exitCode = 1;
  })
  .finally(() => db.close());
