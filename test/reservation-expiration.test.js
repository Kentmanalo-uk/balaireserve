'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Database = require('better-sqlite3');

const { reconcileExpiredReservations } = require('../src/utils/reservationAvailability');

function createTestDatabase() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'balai-reservation-expiry-'));
  const db = new Database(path.join(directory, 'test.db'));
  db.exec(`
    CREATE TABLE reservations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      booking_ref TEXT UNIQUE,
      reservation_type TEXT,
      check_in_date TEXT,
      check_out_date TEXT,
      event_date TEXT,
      start_time TEXT,
      end_time TEXT,
      status TEXT,
      payment_status TEXT,
      updated_at TEXT
    );
    CREATE TABLE reservation_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      reservation_id INTEGER,
      item_type TEXT,
      item_id INTEGER
    );
    CREATE TABLE reservation_status_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      reservation_id INTEGER,
      from_status TEXT,
      to_status TEXT,
      changed_by INTEGER,
      notes TEXT
    );
    CREATE TABLE rooms (id INTEGER PRIMARY KEY, status TEXT, updated_at TEXT);
    CREATE TABLE venues (id INTEGER PRIMARY KEY, status TEXT, updated_at TEXT);
    CREATE TABLE cottages (id INTEGER PRIMARY KEY, status TEXT, updated_at TEXT);
  `);
  return { db, directory };
}

// Mirrors the async src/config/database.js API (MySQL) on top of SQLite.
function asAppDatabase(db) {
  const toSqlite = sql => sql.replace(/NOW\(\)/g,"datetime('now')");
  return {
    prepare(sql) {
      const statement = db.prepare(toSqlite(sql));
      return {
        get: async (...params) => statement.get(...params),
        all: async (...params) => statement.all(...params),
        run: async (...params) => statement.run(...params),
      };
    },
    async transaction(fn) {
      db.exec('BEGIN');
      try {
        const result = await fn();
        db.exec('COMMIT');
        return result;
      } catch (error) {
        db.exec('ROLLBACK');
        throw error;
      }
    },
  };
}

test('expired checked-in and confirmed reservations release their resources', async () => {
  const { db, directory } = createTestDatabase();
  try {
    const today = new Date();
    const yesterday = new Date(today);
    yesterday.setDate(today.getDate() - 1);
    const tomorrow = new Date(today);
    tomorrow.setDate(today.getDate() + 1);
    const date = (value = today) => value.toISOString().slice(0, 10);

    db.prepare(`INSERT INTO rooms (id, status) VALUES (1, 'occupied')`).run();
    db.prepare(`INSERT INTO venues (id, status) VALUES (2, 'reserved')`).run();
    db.prepare(`INSERT INTO cottages (id, status) VALUES (3, 'occupied'), (4, 'occupied'), (5, 'occupied')`).run();
    db.prepare(`INSERT INTO reservations (booking_ref, reservation_type, check_in_date, check_out_date, event_date, start_time, end_time, status, payment_status) VALUES
      (?, 'room', ?, ?, NULL, NULL, NULL, 'checked_in', 'fully_paid'),
      (?, 'venue', NULL, NULL, ?, NULL, NULL, 'confirmed', 'fully_paid'),
      (?, 'cottage', ?, NULL, NULL, '00:00', '00:01', 'checked_in', 'fully_paid'),
      (?, 'cottage', ?, NULL, NULL, '23:00', '23:30', 'checked_in', 'fully_paid'),
      (?, 'cottage', ?, NULL, NULL, '14:00', '16:00', 'checked_in', 'fully_paid')
    `).run(
      'ROOM-EXPIRED', date(yesterday), date(yesterday),
      'VENUE-EXPIRED', date(yesterday),
      'COTTAGE-EXPIRED', date(),
      'COTTAGE-FUTURE', date(tomorrow),
      'COTTAGE-PAST', date(yesterday)
    );
    db.prepare(`INSERT INTO reservation_items (reservation_id, item_type, item_id) VALUES
      (1, 'room', 1),
      (2, 'venue', 2),
      (3, 'cottage', 3),
      (4, 'cottage', 4),
      (5, 'cottage', 5)
    `).run();

    await assert.doesNotReject(() => reconcileExpiredReservations(asAppDatabase(db)));

    assert.equal(db.prepare('SELECT status FROM reservations WHERE booking_ref = ?').get('ROOM-EXPIRED').status, 'completed');
    assert.equal(db.prepare('SELECT status FROM reservations WHERE booking_ref = ?').get('VENUE-EXPIRED').status, 'completed');
    assert.equal(db.prepare('SELECT status FROM reservations WHERE booking_ref = ?').get('COTTAGE-EXPIRED').status, 'completed');
    assert.equal(db.prepare('SELECT status FROM reservations WHERE booking_ref = ?').get('COTTAGE-PAST').status, 'completed');
    assert.equal(db.prepare('SELECT status FROM reservations WHERE booking_ref = ?').get('COTTAGE-FUTURE').status, 'checked_in');
    assert.equal(db.prepare('SELECT status FROM rooms WHERE id = 1').get().status, 'available');
    assert.equal(db.prepare('SELECT status FROM venues WHERE id = 2').get().status, 'available');
    assert.equal(db.prepare('SELECT status FROM cottages WHERE id = 3').get().status, 'available');
    assert.equal(db.prepare('SELECT status FROM cottages WHERE id = 4').get().status, 'occupied');
    assert.equal(db.prepare('SELECT status FROM cottages WHERE id = 5').get().status, 'available');
  } finally {
    db.close();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('checked-out reservations are not re-marked as completed by the expiry reconciler', async () => {
  const { db, directory } = createTestDatabase();
  try {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const date = d => d.toISOString().slice(0, 10);

    db.prepare(`INSERT INTO rooms (id, status) VALUES (1, 'occupied')`).run();
    db.prepare(`INSERT INTO reservations (booking_ref, reservation_type, check_in_date, check_out_date, status, payment_status) VALUES
      ('ROOM-CHECKEDOUT', 'room', ?, ?, 'checked_out', 'fully_paid')
    `).run(date(yesterday), date(yesterday));
    db.prepare(`INSERT INTO reservation_items (reservation_id, item_type, item_id) VALUES (1, 'room', 1)`).run();

    await assert.doesNotReject(() => reconcileExpiredReservations(asAppDatabase(db)));
    assert.equal(db.prepare('SELECT status FROM reservations WHERE booking_ref = ?').get('ROOM-CHECKEDOUT').status, 'checked_out');
    assert.equal(db.prepare('SELECT status FROM rooms WHERE id = 1').get().status, 'occupied');
  } finally {
    db.close();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('pencil and on-hold reservations wait for an admin even after their date passed', async () => {
  const { db, directory } = createTestDatabase();
  try {
    const lastWeek = new Date();
    lastWeek.setDate(lastWeek.getDate() - 7);
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const date = d => d.toISOString().slice(0, 10);

    db.prepare(`INSERT INTO rooms (id, status) VALUES (1, 'reserved')`).run();
    db.prepare(`INSERT INTO venues (id, status) VALUES (2, 'reserved')`).run();
    db.prepare(`INSERT INTO cottages (id, status) VALUES (3, 'reserved')`).run();
    db.prepare(`INSERT INTO reservations (booking_ref, reservation_type, check_in_date, check_out_date, event_date, start_time, end_time, status, payment_status) VALUES
      ('ROOM-PENCIL', 'room', ?, ?, NULL, NULL, NULL, 'pencil', 'unpaid'),
      ('VENUE-ON-HOLD', 'venue', ?, ?, ?, '10:00', '15:00', 'on_hold', 'partially_paid'),
      ('COTTAGE-PENCIL', 'cottage', ?, ?, NULL, '08:00', '17:00', 'pencil', 'unpaid')
    `).run(
      date(lastWeek), date(yesterday),
      date(yesterday), date(yesterday), date(yesterday),
      date(yesterday), date(yesterday)
    );
    db.prepare(`INSERT INTO reservation_items (reservation_id, item_type, item_id) VALUES
      (1, 'room', 1),
      (2, 'venue', 2),
      (3, 'cottage', 3)
    `).run();

    assert.equal(await reconcileExpiredReservations(asAppDatabase(db)), 0);
    assert.equal(db.prepare('SELECT status FROM reservations WHERE booking_ref = ?').get('ROOM-PENCIL').status, 'pencil');
    assert.equal(db.prepare('SELECT status FROM reservations WHERE booking_ref = ?').get('VENUE-ON-HOLD').status, 'on_hold');
    assert.equal(db.prepare('SELECT status FROM reservations WHERE booking_ref = ?').get('COTTAGE-PENCIL').status, 'pencil');
    assert.equal(db.prepare('SELECT status FROM rooms WHERE id = 1').get().status, 'reserved');
    assert.equal(db.prepare('SELECT status FROM venues WHERE id = 2').get().status, 'reserved');
    assert.equal(db.prepare('SELECT status FROM cottages WHERE id = 3').get().status, 'reserved');
    assert.equal(db.prepare('SELECT COUNT(*) AS c FROM reservation_status_history').get().c, 0);
  } finally {
    db.close();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('same-day and multi-day venue/cottage bookings complete only after their last day or time-out', async () => {
  const { db, directory } = createTestDatabase();
  try {
    const today = new Date();
    const yesterday = new Date(today);
    yesterday.setDate(today.getDate() - 1);
    const tomorrow = new Date(today);
    tomorrow.setDate(today.getDate() + 1);
    const date = (value = today) => value.toISOString().slice(0, 10);

    db.prepare(`INSERT INTO reservations (booking_ref, reservation_type, check_in_date, check_out_date, event_date, start_time, end_time, status, payment_status) VALUES
      ('VENUE-TODAY-NO-TIME', 'venue', ?, ?, ?, NULL, NULL, 'confirmed', 'unpaid'),
      ('EVENT-TODAY-ENDED', 'event', ?, ?, ?, '00:00', '00:00', 'confirmed', 'unpaid'),
      ('COTTAGE-MULTI-DAY', 'cottage', ?, ?, NULL, '08:00', '17:00', 'confirmed', 'unpaid'),
      ('COTTAGE-ENDED-YESTERDAY', 'cottage', ?, ?, NULL, '08:00', '17:00', 'confirmed', 'unpaid')
    `).run(
      date(), date(), date(),
      date(), date(), date(),
      date(yesterday), date(tomorrow),
      date(yesterday), date(yesterday)
    );

    assert.equal(await reconcileExpiredReservations(asAppDatabase(db)), 2);
    assert.equal(db.prepare('SELECT status FROM reservations WHERE booking_ref = ?').get('VENUE-TODAY-NO-TIME').status, 'confirmed');
    assert.equal(db.prepare('SELECT status FROM reservations WHERE booking_ref = ?').get('EVENT-TODAY-ENDED').status, 'completed');
    assert.equal(db.prepare('SELECT status FROM reservations WHERE booking_ref = ?').get('COTTAGE-MULTI-DAY').status, 'confirmed');
    assert.equal(db.prepare('SELECT status FROM reservations WHERE booking_ref = ?').get('COTTAGE-ENDED-YESTERDAY').status, 'completed');
  } finally {
    db.close();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
