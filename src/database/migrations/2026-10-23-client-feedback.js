/**
 * Data update for the October 2026 client feedback round. Safe to re-run.
 *
 *  - Venues:    keep one "Pavilion Function Hall"; hide the rest.
 *  - Cottages:  keep one each of Cottage, Umbrella Cottage, Pavilion; hide duplicates.
 *  - Packages:  hide duplicate event packages; add "Events with Caterer" (20 pax, ₱25,000).
 *  - Inventory: keep only Chairs and Tables active.
 *  - Staff:     add Maria Nora Miciano (role: staff) if missing.
 *  - QR codes:  point images at the on-demand renderer and expire them after the stay.
 *
 * Hidden rows are deactivated (is_active = 0), never deleted, so past
 * reservations and reports keep their history.
 *
 * Run: node src/database/migrations/2026-10-23-client-feedback.js
 */
'use strict';

require('dotenv').config();
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const db     = require('../../config/database');

const norm = (name) => String(name || '').trim().toLowerCase();

/**
 * Keep one active row per wanted name (preferring rows that aren't marked
 * unavailable, then the oldest), rename it, and deactivate every other row.
 */
async function keepOnly(table, wanted) {
  const rows = await db.prepare(`SELECT id, name, status, is_active FROM ${table} ORDER BY id`).all();
  const keepIds = [];
  for (const { match, name } of wanted) {
    const candidates = rows
      .filter(r => match.includes(norm(r.name)))
      .sort((a, b) => (a.status === 'unavailable') - (b.status === 'unavailable') || a.id - b.id);
    const keeper = candidates[0];
    if (!keeper) {
      console.warn(`[client-feedback] ${table}: no row matching ${match.join(' / ')} — skipped.`);
      continue;
    }
    keepIds.push(keeper.id);
    await db.prepare(`UPDATE ${table} SET name = ?, is_active = 1, status = 'available', updated_at = NOW() WHERE id = ?`)
      .run(name, keeper.id);
  }
  if (keepIds.length) {
    const hidden = await db.prepare(`UPDATE ${table} SET is_active = 0, updated_at = NOW() WHERE id NOT IN (?) AND is_active = 1`)
      .run([keepIds]);
    console.log(`[client-feedback] ${table}: kept ${keepIds.join(', ')}, hid ${hidden.changes} row(s).`);
  }
}

async function main() {
  await db.transaction(async () => {
    await keepOnly('venues', [
      { match: ['pavilion function hall', 'pavillion function hall'], name: 'Pavilion Function Hall' },
    ]);

    await keepOnly('cottages', [
      { match: ['cottage'], name: 'Cottage' },
      { match: ['umbrella cottage', 'umbrella table'], name: 'Umbrella Cottage' },
      { match: ['pavilion', 'pavillion'], name: 'Pavilion' },
    ]);

    // Duplicate event packages: keep the oldest of each name.
    const dupes = await db.prepare(`
      UPDATE event_packages p
      JOIN (SELECT name, MIN(id) AS keep_id FROM event_packages GROUP BY name) k ON k.name = p.name
      SET p.is_active = 0, p.updated_at = NOW()
      WHERE p.id <> k.keep_id AND p.is_active = 1
    `).run();
    console.log(`[client-feedback] event_packages: hid ${dupes.changes} duplicate(s).`);

    const caterer = await db.prepare(`SELECT id FROM event_packages WHERE name = 'Events with Caterer'`).get();
    if (!caterer) {
      await db.prepare(`
        INSERT INTO event_packages (name, description, event_type, price, inclusions, capacity, is_active)
        VALUES ('Events with Caterer', 'Event package with catering, good for up to 20 guests.', 'other', 25000, '[]', 20, 1)
      `).run();
      console.log('[client-feedback] event_packages: added "Events with Caterer".');
    }

    // Inventory: only Chairs and Tables stay active.
    await db.prepare(`UPDATE inventory_items SET name = 'Tables', updated_at = NOW() WHERE LOWER(TRIM(name)) = 'table'`).run();
    const items = await db.prepare(`
      UPDATE inventory_items SET is_active = 0, updated_at = NOW()
      WHERE LOWER(TRIM(name)) NOT IN ('chairs', 'tables') AND is_active = 1
    `).run();
    console.log(`[client-feedback] inventory_items: hid ${items.changes} item(s).`);

    // QR images are now rendered on demand; tokens stay valid until after the stay.
    const qr = await db.prepare(`
      UPDATE qr_codes q JOIN reservations r ON r.id = q.reservation_id
      SET q.qr_path = CONCAT('/checkin/', q.token, '/qr.png'),
          q.expires_at = DATE_ADD(COALESCE(r.check_out_date, r.event_date, r.check_in_date, CURDATE()), INTERVAL 2 DAY)
    `).run();
    console.log(`[client-feedback] qr_codes: updated ${qr.changes} row(s).`);
  });

  // Staff account (role details to be confirmed by the resort).
  const staff = await db.prepare(`SELECT id FROM users WHERE first_name = 'Maria Nora' AND last_name = 'Miciano'`).get();
  if (!staff) {
    const role = await db.prepare(`SELECT id FROM roles WHERE name = 'staff'`).get();
    const tempPassword = crypto.randomBytes(9).toString('base64url');
    await db.prepare(`
      INSERT INTO users (role_id, first_name, last_name, email, password_hash, is_active)
      VALUES (?, 'Maria Nora', 'Miciano', 'marianora.miciano@balai.com', ?, 1)
    `).run(role.id, bcrypt.hashSync(tempPassword, 12));
    console.log('[client-feedback] users: added staff Maria Nora Miciano');
    console.log(`                  login: marianora.miciano@balai.com / temporary password: ${tempPassword}`);
    console.log('                  (change the email/password from Users → Edit or My Profile.)');
  }
}

main()
  .catch((err) => { console.error('[client-feedback] Failed:', err.message); process.exitCode = 1; })
  .finally(() => db.close());
