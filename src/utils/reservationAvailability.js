'use strict';

const RESOURCE_TABLES = {
  room: 'rooms',
  cottage: 'cottages',
  venue: 'venues',
};

const FINAL_RESERVATION_STATUSES = new Set([
  'completed',
  'cancelled',
  'rejected',
  'no_show',
  'checked_out',
]);

// Active statuses that keep their dates blocked but wait for an admin decision,
// so the reconciler never auto-completes them even after the date has passed.
const ADMIN_HELD_STATUSES = new Set([
  'pencil',
  'on_hold',
]);

const SKIPPED_STATUS_SQL = [...FINAL_RESERVATION_STATUSES, ...ADMIN_HELD_STATUSES]
  .map(status => `'${status}'`)
  .join(', ');

async function releaseReservationItems(db, reservationId) {
  const items = await db.prepare(`
    SELECT item_type, item_id
    FROM reservation_items
    WHERE reservation_id = ?
      AND item_type IN ('room', 'cottage', 'venue')
  `).all(reservationId);

  for (const item of items) {
    const table = RESOURCE_TABLES[item.item_type];
    if (!table) continue;

    await db.prepare(`
      UPDATE ${table}
      SET status = 'available', updated_at = NOW()
      WHERE id = ?
    `).run(item.item_id);
  }
}

async function reconcileExpiredReservations(db) {
  const today = new Date().toISOString().slice(0, 10);
  const currentTime = new Date().toTimeString().slice(0, 5);

  const expiredReservations = await db.prepare(`
    SELECT id, check_in_date, check_out_date, event_date, end_time
    FROM reservations
    WHERE status NOT IN (${SKIPPED_STATUS_SQL})
      AND (
        (reservation_type = 'room' AND check_out_date IS NOT NULL AND check_out_date <= ?)
        OR
        -- Cottage / venue / event: finished once the last day has passed, or on
        -- the last day once its time-out has passed. Older venue rows only have
        -- event_date, older cottage rows only check_in_date.
        (reservation_type IN ('cottage', 'venue', 'event')
          AND COALESCE(check_out_date, check_in_date, event_date) IS NOT NULL
          AND (
            COALESCE(check_out_date, check_in_date, event_date) < ?
            OR (
              COALESCE(check_out_date, check_in_date, event_date) = ?
              AND end_time IS NOT NULL AND end_time <> '' AND end_time <= ?
            )
          ))
      )
  `).all(today, today, today, currentTime);

  const completeReservation = (reservation) => db.transaction(async () => {
    const row = await db.prepare(`
      SELECT status FROM reservations WHERE id = ?
    `).get(reservation.id);

    const previousStatus = row ? row.status : null;
    if (!previousStatus || FINAL_RESERVATION_STATUSES.has(previousStatus) || ADMIN_HELD_STATUSES.has(previousStatus)) return false;

    const result = await db.prepare(`
      UPDATE reservations
      SET status = 'completed', updated_at = NOW()
      WHERE id = ?
        AND status NOT IN (${SKIPPED_STATUS_SQL})
    `).run(reservation.id);

    if (result.changes === 0) return false;

    await db.prepare(`
      INSERT INTO reservation_status_history
        (reservation_id, from_status, to_status, changed_by, notes)
      VALUES (?, ?, 'completed', NULL, 'Automatically completed after the reservation date passed')
    `).run(reservation.id, previousStatus);

    await releaseReservationItems(db, reservation.id);
    return true;
  });

  let completed = 0;
  for (const reservation of expiredReservations) {
    try {
      if (await completeReservation(reservation)) completed += 1;
    } catch (error) {
      console.error(`[reconciler] Failed to complete reservation ${reservation.id}:`, error);
    }
  }

  return completed;
}

function startReservationAvailabilityReconciler(db, intervalMs = 60000) {
  const run = async () => {
    try {
      const count = await reconcileExpiredReservations(db);
      if (count > 0) console.log(`[reconciler] Auto-completed ${count} expired reservation(s)`);
    } catch (error) {
      console.error('[reconciler] Error during reconciliation:', error);
    }
  };

  run();
  return setInterval(run, intervalMs);
}

module.exports = {
  FINAL_RESERVATION_STATUSES,
  ADMIN_HELD_STATUSES,
  releaseReservationItems,
  reconcileExpiredReservations,
  startReservationAvailabilityReconciler,
};
