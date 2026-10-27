/**
 * Columns added after a database was first set up. Runs once at start-up and only adds what is
 * missing, so the live database catches up on deploy without a manual migration.
 */
'use strict';
const db = require('../config/database');

const COLUMNS = [
  // Event packages can have photos (managed on /packages).
  { table: 'event_packages', column: 'images', ddl: 'ALTER TABLE event_packages ADD COLUMN images TEXT NULL AFTER inclusions' },
];

async function ensureSchema() {
  for (const c of COLUMNS) {
    const row = await db.prepare(`
      SELECT COUNT(*) AS n FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?
    `).get(c.table, c.column);
    if (!Number(row.n)) {
      try {
        await db.prepare(c.ddl).run();
        console.log(`[schema] added ${c.table}.${c.column}`);
      } catch (err) {
        if (err.errno !== 1060) throw err;   // another instance starting at the same moment added it first
      }
    }
  }
}

module.exports = { ensureSchema };
