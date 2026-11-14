/**
 * Removes resort activity (bookings, payments, messages, logs, guest accounts) made before a cut-off date,
 * keeping the setup: listings, packages, settings, FAQ, inventory items and staff accounts.
 *
 * Every removed row is first copied to a zbak_<tag>_<table> table in the same database, so it can be put
 * back with INSERT INTO <table> SELECT * FROM zbak_<tag>_<table>. The deletes run in one transaction.
 */
'use strict';
const db = require('../config/database');

// What goes, child rows first. ${OLD} = the bookings made before the cut-off; a row tied to a booking goes with it.
const PLAN = [
  ['check_ins',                  "reservation_id IN (${OLD}) OR guest_id IN (SELECT id FROM guests WHERE reservation_id IN (${OLD}))"],
  ['check_outs',                 "reservation_id IN (${OLD}) OR guest_id IN (SELECT id FROM guests WHERE reservation_id IN (${OLD}))"],
  ['equipment_assignments',      "reservation_id IN (${OLD}) OR event_id IN (SELECT id FROM events WHERE reservation_id IN (${OLD})) OR (reservation_id IS NULL AND created_at < ${CUT})"],
  ['events',                     "reservation_id IN (${OLD}) OR (reservation_id IS NULL AND created_at < ${CUT})"],
  ['qr_codes',                   "reservation_id IN (${OLD})"],
  ['payments',                   "reservation_id IN (${OLD}) OR (reservation_id IS NULL AND created_at < ${CUT})"],
  ['refund_requests',            "reservation_id IN (${OLD}) OR (reservation_id IS NULL AND created_at < ${CUT})"],
  ['feedback',                   "reservation_id IN (${OLD}) OR (reservation_id IS NULL AND created_at < ${CUT})"],
  ['follow_ups',                 "reservation_id IN (${OLD}) OR (reservation_id IS NULL AND created_at < ${CUT})"],
  ['reservation_status_history', "reservation_id IN (${OLD})"],
  ['reservation_items',          "reservation_id IN (${OLD})"],
  ['guests',                     "reservation_id IN (${OLD}) OR (reservation_id IS NULL AND created_at < ${CUT})"],
  ['reservations',               "created_at < ${CUT}"],
  ['support_tickets',            "created_at < ${CUT} OR inquiry_id IN (SELECT id FROM inquiries WHERE created_at < ${CUT})"],
  ['inquiries',                  "created_at < ${CUT}"],
  ['crm_activities',             "created_at < ${CUT}"],
  ['sales_calls',                "created_at < ${CUT}"],
  ['marketing_emails',           "created_at < ${CUT}"],
  ['notifications',              "created_at < ${CUT}"],
  ['ai_insights',                "created_at < ${CUT}"],
  ['inventory_transactions',     "created_at < ${CUT}"],
  ['audit_logs',                 "created_at < ${CUT}"],
  ['email_log',                  "created_at < ${CUT}"],
  ['email_tokens',               "created_at < ${CUT}"],
  // Guest accounts made before the cut-off that have nothing left after the deletes above.
  ['customers',                  "created_at < ${CUT}" + ['reservations', 'guests', 'events', 'feedback', 'follow_ups', 'inquiries', 'support_tickets',
                                   'refund_requests', 'crm_activities', 'sales_calls', 'marketing_emails', 'notifications']
                                   .map(t => ` AND NOT EXISTS (SELECT 1 FROM ${t} x WHERE x.customer_id = customers.id)`).join('')],
  ['users',                      "created_at < ${CUT} AND role_id IN (SELECT id FROM roles WHERE name = 'customer')"
                                   + ' AND NOT EXISTS (SELECT 1 FROM customers c WHERE c.user_id = users.id)'
                                   + ' AND NOT EXISTS (SELECT 1 FROM notifications n WHERE n.user_id = users.id)'
                                   + ' AND NOT EXISTS (SELECT 1 FROM audit_logs a WHERE a.user_id = users.id)'],
];

/** cutoff: 'YYYY-MM-DD HH:MM:SS' in UTC (how the database stores times). tag: letters/digits for the backup table names. */
async function removeActivityBefore(cutoff, tag) {
  if (!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(cutoff) || !/^\w+$/.test(tag)) throw new Error('bad cutoff or tag');
  const CUT = `'${cutoff}'`, OLD = `SELECT id FROM reservations WHERE created_at < ${CUT}`;
  const steps = PLAN.map(([table, where]) => ({ table, where: where.replaceAll('${OLD}', OLD).replaceAll('${CUT}', CUT), bak: `zbak_${tag}_${table}` }));
  const present = new Set((await db.prepare('SELECT TABLE_NAME AS t FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE()').all()).map(r => r.t));
  const todo = steps.filter(s => present.has(s.table));
  // CREATE TABLE ends a transaction, so the backup tables are made before it starts. Kept if they exist already.
  for (const s of todo) await db.prepare(`CREATE TABLE IF NOT EXISTS ${s.bak} LIKE ${s.table}`).run();
  const removed = {};
  await db.transaction(async () => {
    for (const s of todo) {
      await db.prepare(`INSERT IGNORE INTO ${s.bak} SELECT * FROM ${s.table} WHERE ${s.where}`).run();
      const r = await db.prepare(`DELETE FROM ${s.table} WHERE ${s.where}`).run();
      if (r.changes) removed[s.table] = r.changes;
    }
  });
  return removed;
}

module.exports = { removeActivityBefore };
