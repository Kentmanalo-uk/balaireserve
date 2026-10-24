/**
 * MySQL database connection singleton.
 *
 * Exposes a small better-sqlite3-style API on top of a mysql2 pool:
 *   await db.prepare(sql).get(...params)   -> first row or undefined
 *   await db.prepare(sql).all(...params)   -> array of rows
 *   await db.prepare(sql).run(...params)   -> { changes, lastInsertRowid }
 *   await db.transaction(async () => {...}) -> runs the callback in a transaction
 *
 * Queries issued inside a db.transaction() callback automatically use the
 * transaction's connection, so helpers don't need a connection argument.
 */
'use strict';

require('dotenv').config();

const { AsyncLocalStorage } = require('node:async_hooks');
const mysql = require('mysql2/promise');

const connectionConfig = process.env.DATABASE_URL && process.env.DATABASE_URL.startsWith('mysql')
  ? { uri: process.env.DATABASE_URL }
  : {
      host:     process.env.DB_HOST || 'localhost',
      port:     parseInt(process.env.DB_PORT || '3306', 10),
      user:     process.env.DB_USER || 'root',
      password: process.env.DB_PASSWORD || '',
      database: process.env.DB_NAME || 'balai_reserve',
    };

const pool = mysql.createPool({
  ...connectionConfig,
  waitForConnections: true,
  connectionLimit:    parseInt(process.env.DB_CONNECTION_LIMIT || '10', 10),
  charset:            'utf8mb4',
  // Keep values shaped the way the app has always seen them:
  // dates as 'YYYY-MM-DD[ HH:MM:SS]' strings and DECIMAL/SUM/AVG as numbers.
  dateStrings:        true,
  decimalNumbers:     true,
  timezone:           'Z',
  // UPDATE ... changes = rows matched (not only rows whose values changed).
  flags:              ['FOUND_ROWS'],
});

// Stored timestamps are UTC (as they were with SQLite's datetime('now')).
// PIPES_AS_CONCAT keeps `a || b` as string concatenation.
pool.pool.on('connection', (conn) => {
  conn.query("SET time_zone = '+00:00', sql_mode = 'PIPES_AS_CONCAT,NO_ENGINE_SUBSTITUTION'");
});

const txStorage = new AsyncLocalStorage();

// '2026-10-23T05:00:00.000Z' / '2026-10-23T14:30' -> MySQL DATETIME literal.
const ISO_DATETIME = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2}(?::\d{2})?)(?:\.\d+)?(Z|[+-]\d{2}:?\d{2})?$/;

function toMySqlDateTime(date) {
  return date.toISOString().slice(0, 19).replace('T', ' ');
}

function normalizeParam(value) {
  if (value instanceof Date) return toMySqlDateTime(value);
  if (typeof value === 'string') {
    const m = ISO_DATETIME.exec(value);
    if (m) return m[3] ? toMySqlDateTime(new Date(value)) : `${m[1]} ${m[2]}`;
  }
  return value;
}

// Accept .all(a, b) or .all([a, b]) like better-sqlite3. Arrays are NOT flattened
// when mixed with other params, so a stray array (e.g. a duplicated form field)
// can't silently shift every later placeholder.
function normalizeParams(params) {
  const list = params.length === 1 && Array.isArray(params[0]) ? params[0] : params;
  return list.map(normalizeParam);
}

function executor() {
  return txStorage.getStore() || pool;
}

// Query errors keep mysql2's message (which routes may show to users);
// the failing statement is available as err.sql for logging.
async function execute(sql, params) {
  const [result] = await executor().query(sql, normalizeParams(params));
  return result;
}

class Statement {
  constructor(sql) {
    this.sql = sql;
  }

  async get(...params) {
    const rows = await execute(this.sql, params);
    return rows[0];
  }

  async all(...params) {
    return execute(this.sql, params);
  }

  async run(...params) {
    const result = await execute(this.sql, params);
    return { changes: result.affectedRows, lastInsertRowid: result.insertId || null };
  }
}

const db = {
  prepare(sql) {
    return new Statement(sql);
  },

  /**
   * Run `fn` inside a transaction; commits on success, rolls back on throw.
   * Nested calls join the outer transaction.
   */
  async transaction(fn) {
    if (txStorage.getStore()) return fn();

    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      const result = await txStorage.run(conn, fn);
      await conn.commit();
      return result;
    } catch (err) {
      await conn.rollback().catch(() => {});
      throw err;
    } finally {
      conn.release();
    }
  },

  pool,

  async close() {
    await pool.end();
  },
};

module.exports = db;
