/**
 * Tables and columns added after a database was first set up. Runs once at start-up and only adds what
 * is missing, so the live database catches up on deploy without a manual migration.
 */
'use strict';
const db = require('../config/database');

const TABLES = [
  // The function hall, rooms and cottages an event package includes (managed on /packages).
  `CREATE TABLE IF NOT EXISTS event_package_items (
    id          INT AUTO_INCREMENT PRIMARY KEY,
    package_id  INT NOT NULL,
    item_type   VARCHAR(20) NOT NULL,
    item_id     INT NOT NULL,
    quantity    INT NOT NULL DEFAULT 1,
    note        VARCHAR(255) NULL,
    sort_order  INT NOT NULL DEFAULT 0,
    KEY idx_epi_package (package_id),
    FOREIGN KEY (package_id) REFERENCES event_packages(id) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  // One-time links sent by email: confirm an email address, reset a password (src/utils/accountEmails.js).
  // Only a hash of the token is stored.
  `CREATE TABLE IF NOT EXISTS email_tokens (
    id          INT AUTO_INCREMENT PRIMARY KEY,
    user_id     INT NOT NULL,
    purpose     VARCHAR(20) NOT NULL,
    token_hash  CHAR(64) NOT NULL,
    expires_at  DATETIME NOT NULL,
    used_at     DATETIME NULL,
    created_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uq_email_token (token_hash),
    KEY idx_email_tokens_user (user_id, purpose),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  // Every email the app tried to send and what happened (src/utils/mailer.js; Settings → Email).
  `CREATE TABLE IF NOT EXISTS email_log (
    id          INT AUTO_INCREMENT PRIMARY KEY,
    to_address  VARCHAR(255) NOT NULL,
    subject     VARCHAR(255) NOT NULL,
    status      VARCHAR(10) NOT NULL,
    detail      VARCHAR(500) NULL,
    created_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
    KEY idx_email_log_created (created_at)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
];

// One-time data steps, each recorded in settings so it never runs twice.
const STEPS = [
  {
    // Email confirmation starts now: accounts that already exist (guests and staff) count as confirmed,
    // so nobody is suddenly asked to verify; only new sign-ups are.
    key: 'schema_step_email_verified_existing',
    run: () => db.prepare('UPDATE users SET email_verified = 1 WHERE email_verified = 0').run(),
  },
];

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
  for (const ddl of TABLES) await db.prepare(ddl).run();
  await db.prepare('DELETE FROM email_log WHERE created_at < NOW() - INTERVAL 90 DAY').run();
  for (const step of STEPS) {
    const done = await db.prepare('SELECT 1 AS d FROM settings WHERE `key` = ?').get(step.key);
    if (done) continue;
    const result = await step.run();
    await db.prepare("INSERT IGNORE INTO settings (`key`, value, label, group_name) VALUES (?, NOW(), 'Database update applied', 'system')").run(step.key);
    console.log(`[schema] ${step.key}: ${result && result.changes != null ? result.changes + ' row(s)' : 'done'}`);
  }
}

module.exports = { ensureSchema };
