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
    WHERE status NOT IN ('completed', 'cancelled', 'rejected', 'no_show', 'checked_out')
      AND (
        (reservation_type = 'room' AND check_out_date IS NOT NULL AND check_out_date <= ?)
        OR
        (reservation_type = 'cottage' AND check_in_date IS NOT NULL AND (
          (check_out_date IS NOT NULL AND check_out_date <= ?)
          OR
          (check_out_date IS NULL AND end_time IS NOT NULL AND (
            check_in_date < ? OR (check_in_date = ? AND end_time <= ?)
          ))
        ))
        OR
        (reservation_type IN ('venue', 'event') AND event_date IS NOT NULL AND event_date <= ?)
      )
  `).all(today, today, today, today, currentTime, today);

  const completeReservation = (reservation) => db.transaction(async () => {
    const row = await db.prepare(`
      SELECT status FROM reservations WHERE id = ?
    `).get(reservation.id);

    const previousStatus = row ? row.status : null;
    if (!previousStatus || FINAL_RESERVATION_STATUSES.has(previousStatus)) return false;

    const result = await db.prepare(`
      UPDATE reservations
      SET status = 'completed', updated_at = NOW()
      WHERE id = ?
        AND status NOT IN ('completed', 'cancelled', 'rejected', 'no_show', 'checked_out')
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
  releaseReservationItems,
  reconcileExpiredReservations,
  startReservationAvailabilityReconciler,
};
