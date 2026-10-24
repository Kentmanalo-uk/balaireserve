/**
 * Verifying a payment — one implementation for every screen that does it
 * (reservation detail and the payments page), so the booking's payment
 * status and confirmation always update the same way.
 */
'use strict';

const db = require('../config/database');
const { notifyStaff } = require('./notifications');

/**
 * Mark a payment verified, recalculate the reservation's payment status and
 * promote pending / awaiting-payment bookings (confirmed once fully paid).
 * Runs in its own transaction (or joins the caller's). Notifies the guest.
 * @returns {Promise<{ newPayStatus: string, newResStatus: string, reservation: object }>}
 */
async function verifyPayment(payment, staffUserId) {
  const result = await db.transaction(async () => {
    const reservation = await db.prepare('SELECT * FROM reservations WHERE id = ?').get(payment.reservation_id);

    await db.prepare(`UPDATE payments SET status = 'verified', verified_by = ?, verified_at = NOW() WHERE id = ?`)
      .run(staffUserId, payment.id);

    const totalPaid = (await db.prepare(
      "SELECT COALESCE(SUM(amount),0) AS t FROM payments WHERE reservation_id = ? AND status IN ('received','verified')"
    ).get(reservation.id)).t;
    const totalAmt = reservation.total_amount || 0;
    const newPayStatus = totalAmt > 0 && totalPaid >= totalAmt ? 'fully_paid' : 'partially_paid';

    // Promote reservation status: awaiting_payment / pending → confirmed when fully paid
    let newResStatus = reservation.status;
    if (reservation.status === 'awaiting_payment' || reservation.status === 'pending') {
      newResStatus = newPayStatus === 'fully_paid' ? 'confirmed' : 'awaiting_payment';
    }

    await db.prepare('UPDATE reservations SET payment_status = ?, status = ?, updated_at = NOW() WHERE id = ?')
      .run(newPayStatus, newResStatus, reservation.id);

    if (newResStatus !== reservation.status) {
      await db.prepare('INSERT INTO reservation_status_history (reservation_id, from_status, to_status, changed_by, notes) VALUES (?,?,?,?,?)')
        .run(reservation.id, reservation.status, newResStatus, staffUserId, 'Auto-confirmed after payment verified');
    }

    // Notify the customer's user account if linked
    const customer = await db.prepare('SELECT user_id FROM customers WHERE id = ?').get(reservation.customer_id);
    if (customer?.user_id) {
      const title = newResStatus === 'confirmed' ? 'Booking Verified' : 'Payment Verified';
      await notifyStaff(customer.user_id, 'payment', title,
        'Your payment of ₱' + Number(payment.amount).toLocaleString() + ' for booking ' + reservation.booking_ref +
        ' has been verified. Your booking is now ' + newResStatus.replace(/_/g, ' ') + '.',
        '/portal/my-reservations/' + reservation.id);
    }
    return { newPayStatus, newResStatus, reservation };
  });
  return result;
}

module.exports = { verifyPayment };
