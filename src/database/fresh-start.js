/**
 * Balai-Reserve — FRESH START (production reset)
 * ----------------------------------------------
 * Wipes ALL transactional & demo data from the LIVE database while
 * keeping the essential setup:
 *
 *   KEPT:  roles, admin + staff users, room types, rooms, venues,
 *          cottages, event packages, inventory items/categories,
 *          equipment, and system settings.
 *
 *   REMOVED: every reservation, payment, guest, event, check-in/out,
 *            QR code, feedback, CRM activity, sales call, marketing
 *            email, support ticket, inquiry, notification, follow-up,
 *            inventory transaction, equipment assignment, AI insight,
 *            audit log, ALL customer accounts, and every session.
 *            Uploaded payment-proof files and generated QR images are
 *            also deleted from disk.
 *
 * After running, rooms/venues/cottages are reset to "available" and
 * inventory reserved/damaged counts are zeroed.
 *
 * Run: node src/database/fresh-start.js   (or: npm run fresh-start)
 *
 * ⚠️  This is DESTRUCTIVE and irreversible. Back up the DB first if unsure.
 */
'use strict';

require('dotenv').config();
const fs   = require('fs');
const path = require('path');
const db   = require('../config/database');

// Tables whose rows are ALL transactional / demo → clear completely
const CLEAR_TABLES = [
  'reservation_items',
  'reservation_status_history',
  'payments',
  'refund_requests',
  'check_ins',
  'check_outs',
  'qr_codes',
  'guests',
  'events',
  'feedback',
  'crm_activities',
  'sales_calls',
  'marketing_emails',
  'support_tickets',
  'inquiries',
  'notifications',
  'follow_ups',
  'inventory_transactions',
  'equipment_assignments',
  'ai_insights',
  'audit_logs',
  'reservations',
  'customers',
  'sessions',
];

// FOREIGN_KEY_CHECKS is a per-connection setting, so the whole reset runs
// on ONE dedicated connection taken from the pool.
async function resetDatabase(conn) {
  await conn.query('SET FOREIGN_KEY_CHECKS = 0');   // disable FK checks while we truncate
  try {
    await conn.beginTransaction();
    try {
      // 1. Clear all transactional / demo tables
      for (const table of CLEAR_TABLES) {
        try {
          const [info] = await conn.query(`DELETE FROM \`${table}\``);
          console.log(`[Fresh Start]  cleared ${table} (${info.affectedRows} row(s))`);
        } catch (e) {
          // Table may not exist in some deployments — non-fatal
          console.log(`[Fresh Start]  skipped ${table} (${e.message})`);
        }
      }

      // 2. Remove all CUSTOMER user accounts (keep admin + staff)
      const [delUsers] = await conn.query(`
        DELETE FROM users
        WHERE role_id IN (SELECT id FROM roles WHERE name = 'customer')
      `);
      console.log(`[Fresh Start]  removed ${delUsers.affectedRows} customer user account(s)`);

      // 3. Reset accommodation availability
      await conn.query(`UPDATE rooms    SET status = 'available' WHERE is_active = 1`);
      await conn.query(`UPDATE venues   SET status = 'available' WHERE is_active = 1`);
      await conn.query(`UPDATE cottages SET status = 'available' WHERE is_active = 1`);
      console.log('[Fresh Start]  reset rooms/venues/cottages to "available"');

      // 4. Zero out inventory reserved/damaged, make everything available
      try {
        await conn.query(`UPDATE inventory_items SET available_qty = total_qty, reserved_qty = 0, damaged_qty = 0`);
        console.log('[Fresh Start]  reset inventory counts (all available, 0 reserved/damaged)');
      } catch { /* column set may vary */ }

      // 5. Reset equipment availability
      try {
        await conn.query(`UPDATE equipment SET available_qty = quantity`);
        console.log('[Fresh Start]  reset equipment availability');
      } catch { /* non-critical */ }

      await conn.commit();
    } catch (err) {
      await conn.rollback().catch(() => {});
      throw err;
    }

    // 6. Reset AUTO_INCREMENT counters for the cleared tables so IDs start fresh.
    //    (ALTER TABLE is DDL and commits implicitly, so it runs after the transaction.)
    let resetCount = 0;
    for (const table of CLEAR_TABLES) {
      try {
        await conn.query(`ALTER TABLE \`${table}\` AUTO_INCREMENT = 1`);
        resetCount++;
      } catch { /* table may not exist / have no AUTO_INCREMENT column */ }
    }
    console.log(`[Fresh Start]  reset ID counters for cleared tables (${resetCount} table(s))`);
  } finally {
    await conn.query('SET FOREIGN_KEY_CHECKS = 1');
  }
}

// 7. Delete uploaded payment-proof files and generated QR images from disk
function emptyDir(dirRel, label) {
  const dir = path.join(process.cwd(), dirRel);
  if (!fs.existsSync(dir)) return;
  let count = 0;
  for (const f of fs.readdirSync(dir)) {
    const full = path.join(dir, f);
    try {
      if (fs.statSync(full).isFile()) { fs.unlinkSync(full); count++; }
    } catch { /* ignore */ }
  }
  console.log(`[Fresh Start]  deleted ${count} file(s) from ${label}`);
}

async function main() {
  const conn = await db.pool.getConnection();
  try {
    const [[{ name: dbName }]] = await conn.query('SELECT DATABASE() AS name');
    console.log(`[Fresh Start] Using MySQL database: ${dbName}`);
    console.log('[Fresh Start] Beginning production reset...');
    await resetDatabase(conn);
  } finally {
    conn.release();
  }

  emptyDir('uploads/payment_proofs', 'payment proofs');
  emptyDir('public/qrcodes',         'QR codes');

  // Report final state
  console.log('\n[Fresh Start] Remaining users:');
  (await db.prepare(`
    SELECT CONCAT(u.first_name, ' ', u.last_name) AS name, u.email, r.name AS role
    FROM users u JOIN roles r ON r.id = u.role_id ORDER BY r.name, u.id
  `).all()).forEach(u => console.log(`   [${u.role}] ${u.name} — ${u.email}`));

  const count = async (sql) => (await db.prepare(sql).get()).c;
  const counts = {
    rooms:    await count('SELECT COUNT(*) c FROM rooms WHERE is_active=1'),
    venues:   await count('SELECT COUNT(*) c FROM venues WHERE is_active=1'),
    cottages: await count('SELECT COUNT(*) c FROM cottages WHERE is_active=1'),
    packages: await count('SELECT COUNT(*) c FROM event_packages WHERE is_active=1'),
    reservations: await count('SELECT COUNT(*) c FROM reservations'),
    customers:    await count('SELECT COUNT(*) c FROM customers'),
  };
  console.log('\n[Fresh Start] Data snapshot:');
  console.log(`   active rooms=${counts.rooms}, venues=${counts.venues}, cottages=${counts.cottages}, packages=${counts.packages}`);
  console.log(`   reservations=${counts.reservations}, customers=${counts.customers}  (should both be 0)`);

  console.log('\n[Fresh Start] Done. The database is clean and ready for deployment.');
}

main()
  .catch((err) => {
    console.error('[Fresh Start] Error:', err.message);
    process.exitCode = 1;
  })
  .finally(() => db.close());
