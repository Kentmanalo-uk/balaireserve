/**
 * Payments Routes  (/payments)
 *
 *  GET  /payments            — list all payments (admin + staff)
 *  GET  /payments/:id        — payment detail
 *  POST /payments/:id/verify — mark payment as verified (admin only)
 *  POST /payments/:id/refund — process a refund (admin only)
 */
'use strict';

const express = require('express');
const path    = require('path');
const fs      = require('fs');
const crypto  = require('crypto');
const multer  = require('multer');
const { body, validationResult } = require('express-validator');
const db      = require('../../../config/database');
const { requireAuth, requireRole } = require('../../../middleware/auth');
const { notifyAllAdmins, notifyReservationCustomer } = require('../../../utils/notifications');

const router = express.Router();

// ΓöÇΓöÇ Multer: refund payout proof screenshots ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ
const REFUND_PROOF_DIR = path.join(process.cwd(), 'uploads', 'refund_proofs');
if (!fs.existsSync(REFUND_PROOF_DIR)) fs.mkdirSync(REFUND_PROOF_DIR, { recursive: true });

const refundProofStorage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, REFUND_PROOF_DIR),
  filename:    (_req, file, cb) => {
    const ext   = path.extname(file.originalname).toLowerCase();
    const token = crypto.randomBytes(24).toString('hex');
    cb(null, 'refund-' + token + ext);
  },
});
const refundProofUpload = multer({
  storage: refundProofStorage,
  limits:  { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ok = ['.jpg','.jpeg','.png','.webp','.gif','.pdf'].includes(path.extname(file.originalname).toLowerCase());
    cb(ok ? null : new Error('Only images and PDF files are allowed.'), ok);
  },
});

// GET /payments
router.get('/', requireAuth, requireRole('admin', 'staff'), async (req, res) => {
  const { search = '', method = '', status = '', from = '', to = '', page = 1 } = req.query;
  const limit  = 20;
  const offset = (parseInt(page) - 1) * limit;
  let   where  = 'WHERE 1=1';
  const params = [];

  if (search) {
    where += ` AND (p.reference_number LIKE ? OR r.booking_ref LIKE ? OR c.first_name LIKE ? OR c.last_name LIKE ?)`;
    params.push(`%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`);
  }
  if (method) { where += ` AND p.payment_method = ?`; params.push(method); }
  if (status) { where += ` AND p.status = ?`;         params.push(status); }
  if (from)   { where += ` AND p.payment_date >= ?`;  params.push(from); }
  if (to)     { where += ` AND p.payment_date <= ?`;  params.push(to + ' 23:59:59'); }

  const total = (await db.prepare(`
    SELECT COUNT(*) AS cnt
    FROM payments p
    JOIN reservations r ON r.id = p.reservation_id
    JOIN customers c    ON c.id = r.customer_id
    ${where}
  `).get(...params)).cnt;

  const payments = await db.prepare(`
    SELECT p.*,
           r.booking_ref, r.reservation_type,
           c.first_name || ' ' || c.last_name AS customer_name,
           u.first_name || ' ' || u.last_name AS received_by_name
    FROM payments p
    JOIN reservations r ON r.id = p.reservation_id
    JOIN customers c    ON c.id = r.customer_id
    LEFT JOIN users u   ON u.id = p.received_by
    ${where}
    ORDER BY p.payment_date DESC
    LIMIT ? OFFSET ?
  `).all(...params, limit, offset);

  // Summary stats for current filter
  const summaryParams = params.slice(); // same WHERE params without limit/offset
  const summary = await db.prepare(`
    SELECT
      COALESCE(SUM(CASE WHEN p.status != 'refunded' THEN p.amount ELSE 0 END), 0) AS collected,
      COALESCE(SUM(CASE WHEN p.status = 'refunded'  THEN p.amount ELSE 0 END), 0) AS refunded,
      COUNT(*)                                                                       AS txn_count
    FROM payments p
    JOIN reservations r ON r.id = p.reservation_id
    JOIN customers c    ON c.id = r.customer_id
    ${where}
  `).get(...summaryParams);

  const totalCollected = (await db.prepare(`SELECT COALESCE(SUM(amount),0) AS t FROM payments WHERE status IN ('received','verified')`).get()).t;
  const methods  = ['cash', 'gcash', 'bank_transfer', 'credit_card', 'check'];
  const statuses = ['received', 'verified', 'refunded'];

  res.render('payments/index', {
    title:  'Payments – Balai-Reserve',
    layout: 'layouts/main',
    payments, methods, statuses, totalCollected, summary,
    filters: { search, method, status, from, to },
    pagination: { total, page: parseInt(page), limit, totalPages: Math.ceil(total / limit) },
  });
});

// GET /payments/:id
router.get('/:id', requireAuth, requireRole('admin', 'staff'), async (req, res) => {
  const payment = await db.prepare(`
    SELECT p.*,
           r.booking_ref, r.reservation_type, r.total_amount AS res_total,
           r.status AS res_status, r.payment_status AS res_payment_status,
           c.first_name || ' ' || c.last_name AS customer_name,
           c.email AS customer_email, c.id AS customer_id,
           u.first_name || ' ' || u.last_name AS received_by_name
    FROM payments p
    JOIN reservations r ON r.id = p.reservation_id
    JOIN customers c    ON c.id = r.customer_id
    LEFT JOIN users u   ON u.id = p.received_by
    WHERE p.id = ?
  `).get(req.params.id);

  if (!payment) {
    req.session.flash = { error: 'Payment not found.' };
    return res.redirect('/payments');
  }

  // All payments for the same reservation (for balance calculation)
  const siblingPayments = await db.prepare(`
    SELECT p.*, u.first_name || ' ' || u.last_name AS received_by_name
    FROM payments p
    LEFT JOIN users u ON u.id = p.received_by
    WHERE p.reservation_id = ?
    ORDER BY p.payment_date ASC
  `).all(payment.reservation_id);

  const totalPaid    = siblingPayments.filter(p => p.status !== 'refunded').reduce((s, p) => s + p.amount, 0);
  const totalRefunded= siblingPayments.filter(p => p.status === 'refunded').reduce((s, p) => s + p.amount, 0);
  const netPaid      = totalPaid - totalRefunded;
  const balance      = payment.res_total - netPaid;

  res.render('payments/show', {
    title:  `Payment ${payment.reference_number}`,
    layout: 'layouts/main',
    payment, siblingPayments, totalPaid, totalRefunded, netPaid, balance,
  });
});

// POST /payments/:id/verify  — mark as verified
router.post('/:id/verify', requireAuth, requireRole('admin'), async (req, res) => {
  const payment = await db.prepare(`SELECT * FROM payments WHERE id = ?`).get(req.params.id);
  if (!payment) return res.redirect('/payments');

  await db.prepare(`UPDATE payments SET status = 'verified' WHERE id = ?`).run(payment.id);
  await req.audit('verify', 'payments', payment.id, { status: payment.status }, { status: 'verified' });
  req.session.flash = { success: `Payment ${payment.reference_number} marked as verified.` };
  res.redirect(`/payments/${payment.id}`);
});

// POST /payments/:id/refund
router.post('/:id/refund',
  requireAuth, requireRole('admin'),
  [
    body('refund_amount').isFloat({ min: 0.01 }).withMessage('Enter a valid refund amount.'),
    body('refund_reason').trim().notEmpty().withMessage('Refund reason is required.'),
  ],
  async (req, res) => {
    const payment = await db.prepare(`
      SELECT p.*, r.total_amount AS res_total, r.payment_status, r.booking_ref
      FROM payments p JOIN reservations r ON r.id = p.reservation_id
      WHERE p.id = ?
    `).get(req.params.id);

    if (!payment) return res.redirect('/payments');

    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      req.session.flash = { error: errors.array()[0].msg };
      return res.redirect(`/payments/${payment.id}`);
    }

    const refundAmt = parseFloat(req.body.refund_amount);
    if (refundAmt > payment.amount) {
      req.session.flash = { error: `Refund amount cannot exceed the original payment of ${payment.amount}.` };
      return res.redirect(`/payments/${payment.id}`);
    }

    const refundRef = `REF-${Date.now()}`;

    await db.transaction(async () => {
      // Insert a negative/refund payment record
      await db.prepare(`
        INSERT INTO payments
          (reservation_id, reference_number, amount, payment_method, payment_date,
           payment_type, status, received_by, notes)
        VALUES (?, ?, ?, ?, CURDATE(), 'refund', 'refunded', ?, ?)
      `).run(
        payment.reservation_id,
        refundRef,
        refundAmt,
        payment.payment_method,
        req.session.user.id,
        `Refund for ${payment.reference_number}. Reason: ${req.body.refund_reason}`
      );

      // Mark the original payment as refunded
      await db.prepare(`UPDATE payments SET status = 'refunded', notes = COALESCE(notes,'') || ' [Refunded: ' || ? || ']' WHERE id = ?`).run(refundRef, payment.id);

      // Recalculate reservation payment_status
      const allPay = await db.prepare(`SELECT * FROM payments WHERE reservation_id = ?`).all(payment.reservation_id);
      const net    = allPay.filter(p => p.status !== 'refunded').reduce((s, p) => s + p.amount, 0);
      let   newPs  = 'unpaid';
      if (net >= payment.res_total) newPs = 'fully_paid';
      else if (net > 0)             newPs = 'partially_paid';

      await db.prepare(`UPDATE reservations SET payment_status = ?, updated_at = NOW() WHERE id = ?`).run(newPs, payment.reservation_id);
    });

    await req.audit('refund', 'payments', payment.id, { amount: payment.amount }, { refunded: refundAmt, reason: req.body.refund_reason });
    await notifyAllAdmins('payment', 'Refund Processed', `₱${refundAmt.toLocaleString()} refunded on ${payment.booking_ref}`, `/payments/${payment.id}`);

    req.session.flash = { success: `Refund of ₱${refundAmt.toLocaleString()} processed. Reference: ${refundRef}` };
    res.redirect(`/payments/${payment.id}`);
  }
);

// ΓöÇΓöÇ GET /payments/refunds/requests ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ
// Admin/staff review list of customer refund requests.
router.get('/refunds/requests', requireAuth, requireRole('admin', 'staff'), async (req, res) => {
  const { status = 'pending' } = req.query;
  let where = '';
  const params = [];
  if (['pending', 'approved', 'rejected'].includes(status)) {
    where = 'WHERE rr.status = ?';
    params.push(status);
  }

  const requests = await db.prepare(`
    SELECT rr.*,
           r.booking_ref, r.reservation_type, r.total_amount, r.payment_status,
           c.first_name || ' ' || c.last_name AS customer_name,
           c.email AS customer_email,
           u.first_name || ' ' || u.last_name AS reviewed_by_name
    FROM refund_requests rr
    JOIN reservations r ON r.id = rr.reservation_id
    LEFT JOIN customers c ON c.id = rr.customer_id
    LEFT JOIN users u ON u.id = rr.reviewed_by
    ${where}
    ORDER BY rr.created_at DESC
  `).all(...params);

  const counts = (await db.prepare(`SELECT status, COUNT(*) AS c FROM refund_requests GROUP BY status`).all())
    .reduce((acc, r) => { acc[r.status] = r.c; return acc; }, {});

  res.render('payments/refund-requests', {
    title: 'Refund Requests',
    layout: 'layouts/main',
    requests, counts, filter: status,
  });
});

// ΓöÇΓöÇ POST /payments/refunds/requests/:id/review ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ
// Admin/staff approve or reject a refund request. Approving records the refund
// against the reservation's payments and marks it refunded.
router.post('/refunds/requests/:id/review',
  requireAuth, requireRole('admin', 'staff'),
  refundProofUpload.single('payout_proof'),
  async (req, res) => {
    const action    = (req.body.action || '').trim();       // 'approve' | 'reject'
    const adminNote = (req.body.admin_note || '').trim();
    const payoutMethod = (req.body.payout_method || 'gcash').trim();  // gcash | cash | bank
    const payoutRef    = (req.body.payout_ref || '').trim();          // transaction reference of the payout
    const payoutProof  = req.file ? req.file.filename : null;         // uploaded refund receipt

    // Clean up an orphaned upload if we bail out before saving it.
    const discardUpload = () => { if (req.file) { try { fs.unlinkSync(req.file.path); } catch { /* ignore */ } } };

    const rr = await db.prepare('SELECT * FROM refund_requests WHERE id = ?').get(req.params.id);
    if (!rr) { discardUpload(); req.session.flash = { error: 'Refund request not found.' }; return res.redirect('/payments/refunds/requests'); }
    if (rr.status !== 'pending') {
      discardUpload();
      req.session.flash = { info: 'This refund request has already been reviewed.' };
      return res.redirect('/payments/refunds/requests');
    }

    const reservation = await db.prepare('SELECT * FROM reservations WHERE id = ?').get(rr.reservation_id);
    if (!reservation) { discardUpload(); req.session.flash = { error: 'Related booking not found.' }; return res.redirect('/payments/refunds/requests'); }

    if (action === 'approve') {
      // A GCash/bank payout MUST have a transaction reference so the refund is
      // traceable. Cash payouts may proceed without one.
      if ((payoutMethod === 'gcash' || payoutMethod === 'bank') && !payoutRef) {
        discardUpload();
        req.session.flash = { error: 'Enter the GCash/bank transaction reference to record this refund payout.' };
        return res.redirect('/payments/refunds/requests');
      }
      if (payoutRef && await db.prepare('SELECT 1 FROM payments WHERE reference_number = ?').get(payoutRef)) {
        discardUpload();
        req.session.flash = { error: 'That payout reference is already recorded. Enter a unique transaction reference.' };
        return res.redirect('/payments/refunds/requests');
      }

      await db.transaction(async () => {
        // Refund amount = net paid on the booking (can't exceed what's collected).
        const netPaid = (await db.prepare(
          "SELECT COALESCE(SUM(amount),0) AS t FROM payments WHERE reservation_id = ? AND status IN ('received','verified')"
        ).get(rr.reservation_id)).t;
        const refundAmt = Math.min(rr.amount || netPaid, netPaid);

        if (refundAmt > 0) {
          // Record a refund payment row (traceable) and mark collected payments refunded.
          const refundRef = payoutRef || `REF-${Date.now()}`;
          const payNote   = `Refund approved for request #${rr.id} via ${payoutMethod.toUpperCase()}`
            + (payoutRef ? ` (ref: ${payoutRef})` : '')
            + (rr.gcash_number ? ` to GCash ${rr.gcash_number}` : '')
            + (adminNote ? `. ${adminNote}` : '');
          await db.prepare(`
            INSERT INTO payments (reservation_id, reference_number, amount, payment_method, payment_date, payment_type, status, received_by, notes, submitted_by)
            VALUES (?, ?, ?, ?, CURDATE(), 'refund', 'refunded', ?, ?, 'staff')
          `).run(rr.reservation_id, refundRef, refundAmt, payoutMethod, req.session.user.id, payNote);

          // Mark all previously collected payments as refunded so they leave the balance.
          await db.prepare(
            "UPDATE payments SET status = 'refunded', notes = COALESCE(notes,'') || ' [Refunded via request #' || ? || ']' WHERE reservation_id = ? AND status IN ('received','verified')"
          ).run(rr.id, rr.reservation_id);
        }

        // A refunded booking is cancelled: mark it cancelled + refunded so it
        // can no longer be checked in, and log the status change.
        const prevStatus = reservation.status;
        await db.prepare(
          "UPDATE reservations SET status = 'cancelled', payment_status = 'refunded', updated_at = NOW() WHERE id = ?"
        ).run(rr.reservation_id);
        if (prevStatus !== 'cancelled') {
          await db.prepare(
            "INSERT INTO reservation_status_history (reservation_id, from_status, to_status, changed_by, notes) VALUES (?, ?, 'cancelled', ?, 'Auto-cancelled after refund approval')"
          ).run(rr.reservation_id, prevStatus, req.session.user.id);
        }

        // Free up the booked room/venue/cottage so it shows as available again.
        const items = await db.prepare('SELECT * FROM reservation_items WHERE reservation_id = ?').all(rr.reservation_id);
        for (const item of items) {
          if (item.item_type === 'room')    await db.prepare("UPDATE rooms SET status='available', updated_at=NOW() WHERE id=?").run(item.item_id);
          if (item.item_type === 'venue')   await db.prepare("UPDATE venues SET status='available', updated_at=NOW() WHERE id=?").run(item.item_id);
          if (item.item_type === 'cottage') await db.prepare("UPDATE cottages SET status='available', updated_at=NOW() WHERE id=?").run(item.item_id);
        }

        // Invalidate any check-in QR codes so they can no longer be scanned.
        await db.prepare("UPDATE qr_codes SET used = 1, used_at = NOW() WHERE reservation_id = ?").run(rr.reservation_id);

        // Any guest records for this booking should no longer be "expected".
        await db.prepare("UPDATE guests SET status='no_show', updated_at=NOW() WHERE reservation_id=? AND status NOT IN ('checked_out')").run(rr.reservation_id);

        await db.prepare(`
          UPDATE refund_requests
          SET status = 'approved', admin_note = ?, payout_method = ?, payout_ref = ?, payout_proof = ?, payout_date = CURDATE(),
              reviewed_by = ?, reviewed_at = NOW()
          WHERE id = ?
        `).run(adminNote || null, payoutMethod, payoutRef || null, payoutProof, req.session.user.id, rr.id);
      });

      await req.audit('refund_approve', 'refund_requests', rr.id, { status: 'pending' }, { status: 'approved', payout_method: payoutMethod, payout_ref: payoutRef });
      await notifyReservationCustomer(
        rr.reservation_id, 'payment', 'Refund Approved',
        `Your refund request for ${reservation.booking_ref} has been approved and paid out via ${payoutMethod.toUpperCase()}`
          + (payoutRef ? ` (ref: ${payoutRef})` : '') + '. This booking has been cancelled.'
          + (adminNote ? ` Note: ${adminNote}` : ''),
        '/portal/my-reservations/' + rr.reservation_id
      );
      req.session.flash = { success: `Refund approved for ${reservation.booking_ref} via ${payoutMethod.toUpperCase()}. The booking was cancelled and the room/venue/cottage is now available.` };

    } else if (action === 'reject') {
      discardUpload();   // no payout proof needed for a rejection
      if (!adminNote) {
        req.session.flash = { error: 'Please provide a reason when rejecting a refund request.' };
        return res.redirect('/payments/refunds/requests');
      }
      await db.prepare(`
        UPDATE refund_requests SET status = 'rejected', admin_note = ?, reviewed_by = ?, reviewed_at = NOW() WHERE id = ?
      `).run(adminNote, req.session.user.id, rr.id);

      await req.audit('refund_reject', 'refund_requests', rr.id, { status: 'pending' }, { status: 'rejected' });
      await notifyReservationCustomer(
        rr.reservation_id, 'payment', 'Refund Request Declined',
        `Your refund request for ${reservation.booking_ref} was declined. Reason: ${adminNote}`,
        '/portal/my-reservations/' + rr.reservation_id
      );
      req.session.flash = { warning: `Refund request for ${reservation.booking_ref} was declined.` };

    } else {
      discardUpload();
      req.session.flash = { error: 'Invalid action.' };
    }

    res.redirect('/payments/refunds/requests');
  }
);

// ΓöÇΓöÇ GET /payments/refunds/requests/:id/proof ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ
// Access-controlled delivery of a refund payout proof. Staff/admin OR the
// owning customer may view it. Never served publicly.
router.get('/refunds/requests/:id/proof', requireAuth, async (req, res) => {
  const rr = await db.prepare(`
    SELECT rr.payout_proof, c.user_id AS owner_user_id
    FROM refund_requests rr
    JOIN reservations r ON r.id = rr.reservation_id
    LEFT JOIN customers c ON c.id = rr.customer_id
    WHERE rr.id = ?
  `).get(req.params.id);

  if (!rr || !rr.payout_proof) return res.status(404).send('Proof not found.');

  const isStaff = ['admin','staff'].includes(req.session.user.role);
  const isOwner = rr.owner_user_id && rr.owner_user_id === req.session.user.id;
  if (!isStaff && !isOwner) return res.status(403).send('You are not authorized to view this file.');

  const bareName = path.basename(rr.payout_proof);
  const absPath  = path.join(REFUND_PROOF_DIR, bareName);
  if (!absPath.startsWith(REFUND_PROOF_DIR) || !fs.existsSync(absPath)) return res.status(404).send('Proof file missing.');

  res.setHeader('Cache-Control', 'private, no-store');
  return res.sendFile(absPath);
});

module.exports = router;