/**
 * Balai-Reserve Database Migration
 * Creates the database (if missing) and applies schema.sql to MySQL.
 * Run: node src/database/migrate.js
 */
'use strict';

require('dotenv').config();
const mysql = require('mysql2/promise');
const fs    = require('fs');
const path  = require('path');

const DB_NAME = process.env.DB_NAME || 'balai_reserve';

async function connect() {
  return mysql.createConnection({
    host:     process.env.DB_HOST || 'localhost',
    port:     parseInt(process.env.DB_PORT || '3306', 10),
    user:     process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    charset:  'utf8mb4',
    multipleStatements: true,
  });
}

async function applySchema(conn) {
  await conn.query(
    `CREATE DATABASE IF NOT EXISTS \`${DB_NAME}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`
  );
  await conn.query(`USE \`${DB_NAME}\``);
  const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  await conn.query(schema);
}

async function main() {
  console.log(`[Migrate] Using MySQL database: ${DB_NAME}`);
  const conn = await connect();
  try {
    await applySchema(conn);
    console.log('[Migrate] Schema applied successfully.');
  } finally {
    await conn.end();
  }
  console.log('[Migrate] Done.');
}

if (require.main === module) {
  main().catch((err) => {
    console.error('[Migrate] Error applying schema:', err.message);
    process.exit(1);
  });
}

module.exports = { connect, applySchema, DB_NAME };
