/**
 * One-time data copy: SQLite (balai_reserve.db) -> MySQL.
 *
 * DROPS every table in the MySQL database, re-creates them from schema.sql,
 * then copies all rows from the SQLite file. Sessions are not copied
 * (everyone simply logs in again).
 *
 * Run: node src/database/sqlite-to-mysql.js [path/to/balai_reserve.db]
 */
'use strict';

require('dotenv').config();
const Database = require('better-sqlite3');
const path     = require('path');
const { connect, applySchema, DB_NAME } = require('./migrate');

const SQLITE_PATH = path.resolve(process.argv[2] || './src/database/balai_reserve.db');
const SKIP_TABLES = new Set(['sessions']);
const BATCH_SIZE  = 200;

// '2026-11-22T05:30:51.123Z' -> '2026-11-22 05:30:51' (UTC)
function toMySqlValue(value) {
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(value)) {
    const date = new Date(value);
    if (!Number.isNaN(date.getTime())) return date.toISOString().slice(0, 19).replace('T', ' ');
  }
  return value;
}

async function main() {
  console.log(`[sqlite-to-mysql] Source: ${SQLITE_PATH}`);
  console.log(`[sqlite-to-mysql] Target: MySQL database ${DB_NAME}`);

  const sqlite = new Database(SQLITE_PATH, { readonly: true, fileMustExist: true });
  const conn   = await connect();

  try {
    await conn.query(
      `CREATE DATABASE IF NOT EXISTS \`${DB_NAME}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci`
    );
    await conn.query(`USE \`${DB_NAME}\``);
    await conn.query("SET time_zone = '+00:00', FOREIGN_KEY_CHECKS = 0");

    const [existing] = await conn.query('SHOW TABLES');
    for (const row of existing) {
      await conn.query(`DROP TABLE \`${Object.values(row)[0]}\``);
    }
    console.log(`[sqlite-to-mysql] Dropped ${existing.length} existing MySQL table(s).`);

    await applySchema(conn);
    await conn.query('SET FOREIGN_KEY_CHECKS = 0');

    const tables = sqlite.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
    ).all().map(r => r.name);

    for (const table of tables) {
      if (SKIP_TABLES.has(table)) continue;

      const [mysqlColumns] = await conn.query(
        'SELECT column_name AS name FROM information_schema.columns WHERE table_schema = ? AND table_name = ?',
        [DB_NAME, table]
      );
      if (!mysqlColumns.length) {
        console.warn(`[sqlite-to-mysql] WARNING: table "${table}" is not in schema.sql — skipped.`);
        continue;
      }
      const targetColumns = new Set(mysqlColumns.map(c => c.name));
      const columns = sqlite.pragma(`table_info("${table}")`).map(c => c.name);
      const missing = columns.filter(c => !targetColumns.has(c));
      if (missing.length) {
        throw new Error(`Table "${table}" has SQLite columns missing from schema.sql: ${missing.join(', ')}`);
      }

      const rows = sqlite.prepare(`SELECT * FROM "${table}"`).all();
      const columnList = columns.map(c => `\`${c}\``).join(', ');
      for (let i = 0; i < rows.length; i += BATCH_SIZE) {
        const batch = rows.slice(i, i + BATCH_SIZE).map(row => columns.map(c => toMySqlValue(row[c])));
        await conn.query(`INSERT INTO \`${table}\` (${columnList}) VALUES ?`, [batch]);
      }

      const [[{ cnt }]] = await conn.query(`SELECT COUNT(*) AS cnt FROM \`${table}\``);
      if (cnt !== rows.length) {
        throw new Error(`Row count mismatch for "${table}": SQLite ${rows.length}, MySQL ${cnt}`);
      }
      console.log(`[sqlite-to-mysql] ${table.padEnd(28)} ${rows.length} row(s)`);
    }

    await conn.query('SET FOREIGN_KEY_CHECKS = 1');
    console.log('[sqlite-to-mysql] Done.');
  } finally {
    sqlite.close();
    await conn.end();
  }
}

main().catch((err) => {
  console.error('[sqlite-to-mysql] Failed:', err.message);
  process.exit(1);
});
