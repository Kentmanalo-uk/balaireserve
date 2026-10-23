/**
 * Inquiries Routes (including automated assistant logic)
 */
'use strict';

const express = require('express');
const { body, validationResult } = require('express-validator');
const db      = require('../../../config/database');
const { requireAuth, requireRole } = require('../../../middleware/auth');
const { generateTicketNumber } = require('../../../utils/bookingRef');
const { notifyAllAdmins } = require('../../../utils/notifications');

const router = express.Router();

// GET /inquiries
router.get('/', requireAuth, async (req, res) => {
  const { search='', status='', category='', page=1 } = req.query;
  const limit  = 20;
  const offset = (parseInt(page)-1)*limit;
  let   where  = 'WHERE 1=1';
  const params = [];

  if (search)   { where += ` AND (i.subject LIKE ? OR i.name LIKE ? OR i.email LIKE ?)`; params.push(`%${search}%`,`%${search}%`,`%${search}%`); }
  if (status)   { where += ` AND i.status = ?`;   params.push(status); }
  if (category) { where += ` AND i.category = ?`; params.push(category); }

  const total     = (await db.prepare(`SELECT COUNT(*) AS cnt FROM inquiries i ${where}`).get(...params)).cnt;
  const inquiries = await db.prepare(`
    SELECT i.*, u.first_name || ' ' || u.last_name AS assigned_name
    FROM inquiries i LEFT JOIN users u ON u.id=i.assigned_to
    ${where}
    ORDER BY CASE i.status WHEN 'open' THEN 1 WHEN 'in_progress' THEN 2 ELSE 3 END, i.created_at DESC
    LIMIT ? OFFSET ?
  `).all(...params, limit, offset);

  const statuses   = ['open','in_progress','escalated','resolved','closed'];
  const categories = ['general','room','venue','event','pricing','complaint','other'];
  const staffList  = await db.prepare(`SELECT id, first_name || ' ' || last_name AS name FROM users WHERE is_active=1`).all();

  // Count per status for the summary strip
  const statusCountRows = await db.prepare(`SELECT status, COUNT(*) AS cnt FROM inquiries GROUP BY status`).all();
  const statusCounts = {};
  for (const r of statusCountRows) statusCounts[r.status] = r.cnt;

  res.render('inquiries/index', {
    title: 'Inquiries – Balai-Reserve', layout: 'layouts/main',
    inquiries, statuses, categories, staffList, statusCounts,
    filters: { search, status, category },
    pagination: { total, page: parseInt(page), limit, totalPages: Math.ceil(total/limit) },
  });
});

// GET /inquiries/:id
router.get('/:id', requireAuth, async (req, res) => {
  const inquiry = await db.prepare(`
    SELECT i.*, u.first_name || ' ' || u.last_name AS assigned_name,
           c.first_name || ' ' || c.last_name AS customer_full_name
    FROM inquiries i
    LEFT JOIN users u ON u.id=i.assigned_to
    LEFT JOIN customers c ON c.id=i.customer_id
    WHERE i.id=?
  `).get(req.params.id);
  if (!inquiry) { req.session.flash = { error: 'Inquiry not found.' }; return res.redirect('/inquiries'); }

  const staffList = await db.prepare(`SELECT id, first_name || ' ' || last_name AS name FROM users WHERE is_active=1`).all();
  const ticket    = await db.prepare(`SELECT * FROM support_tickets WHERE inquiry_id=? LIMIT 1`).get(inquiry.id);

  res.render('inquiries/show', { title: `Inquiry #${inquiry.id}`, layout: 'layouts/main', inquiry, staffList, ticket });
});

// POST /inquiries/:id/assign
router.post('/:id/assign', requireAuth, requireRole('admin','staff'), async (req, res) => {
  const { assigned_to } = req.body;
  await db.prepare(`UPDATE inquiries SET assigned_to=?, status='in_progress', updated_at=NOW() WHERE id=?`).run(assigned_to || null, req.params.id);
  req.session.flash = { success: 'Inquiry assigned.' };
  res.redirect(`/inquiries/${req.params.id}`);
});

// POST /inquiries/:id/resolve
router.post('/:id/resolve', requireAuth, requireRole('admin','staff'), async (req, res) => {
  const { resolution } = req.body;
  // Auto-assign to the staff member who resolves — no manual selection needed
  await db.prepare(`UPDATE inquiries SET status='resolved', resolution=?, assigned_to=?, resolved_at=NOW(), updated_at=NOW() WHERE id=?`).run(resolution || '', req.session.user.id, req.params.id);
  req.session.flash = { success: 'Inquiry marked as resolved.' };
  res.redirect(`/inquiries/${req.params.id}`);
});

// POST /inquiries/:id/escalate – escalate to ticket
router.post('/:id/escalate', requireAuth, requireRole('admin','staff'), async (req, res) => {
  const inquiry = await db.prepare(`SELECT * FROM inquiries WHERE id=?`).get(req.params.id);
  if (!inquiry) return res.redirect('/inquiries');

  const ticketNum = await generateTicketNumber();
  await db.prepare(`
    INSERT INTO support_tickets (ticket_number, customer_id, inquiry_id, subject, description, category, priority, status, assigned_to)
    VALUES (?, ?, ?, ?, ?, ?, 'normal', 'open', ?)
  `).run(ticketNum, inquiry.customer_id, inquiry.id, inquiry.subject, inquiry.message, inquiry.category || 'general', req.session.user.id);

  await db.prepare(`UPDATE inquiries SET status='escalated', updated_at=NOW() WHERE id=?`).run(inquiry.id);
  req.session.flash = { success: `Escalated to support ticket ${ticketNum}.` };
  res.redirect(`/inquiries/${inquiry.id}`);
});

// ΓöÇΓöÇ Public / Bot inquiry submission ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ
// POST /inquiries/submit  (from booking assistant / public form)
router.post('/submit',
  [
    body('subject').trim().notEmpty().withMessage('Subject is required.'),
    body('message').trim().notEmpty().withMessage('Message is required.'),
    body('name').trim().notEmpty().withMessage('Your name is required.'),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ success: false, errors: errors.array() });
    }
    const { name, email, phone, subject, message, category, source } = req.body;

    // Link to the customer record when the submitter is logged in, so it shows
    // up under their "My Inquiries" in the portal.
    const customerId = req.session?.user
      ? ((await db.prepare('SELECT id FROM customers WHERE user_id = ?').get(req.session.user.id))?.id || null)
      : null;

    const id = (await db.prepare(`
      INSERT INTO inquiries (customer_id, name, email, phone, subject, message, category, source, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'open')
    `).run(customerId, name, email||'', phone||'', subject, message, category||'general', source||'website')).lastInsertRowid;

    await notifyAllAdmins('inquiry', 'New Inquiry', `${name} sent a new inquiry: "${subject}"`, `/inquiries/${id}`);

    // Check if auto-answer is possible (simple chatbot logic)
    const autoReply = await autoAnswer(subject + ' ' + message);

    res.json({ success: true, inquiryId: id, autoReply });
  }
);

// ΓöÇΓöÇ Chatbot / Automated Assistant ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ
// POST /inquiries/chat
router.post('/chat', async (req, res) => {
  const { message } = req.body;
  if (!message) return res.json({ reply: 'Please type your question.' });

  const reply = await autoAnswer(message);
  if (typeof reply !== 'string') {
    console.error('[Inquiries] Chat assistant returned a non-text reply.');
    return res.status(500).json({ error: 'Unable to generate a reply.' });
  }

  res.set('Cache-Control', 'no-store').json({ reply });
});

/**
 * Simple keyword-based automated response engine.
 * Uses real DB data wherever possible.
 */
async function autoAnswer(message) {
  const msg = message.toLowerCase();

  // Room availability
  if (msg.includes('room') && (msg.includes('available') || msg.includes('vacancy') || msg.includes('free'))) {
    const available = (await db.prepare(`SELECT COUNT(*) AS cnt FROM rooms WHERE status='available' AND is_active=1`).get()).cnt;
    return `We currently have ${available} room(s) available. You can check our room listings or speak with our reservations team to find the perfect room for your stay.`;
  }

  // Room prices
  if (msg.includes('room') && (msg.includes('price') || msg.includes('rate') || msg.includes('cost'))) {
    const types = await db.prepare(`SELECT name, base_price FROM room_types ORDER BY base_price`).all();
    const list  = types.map(t => `${t.name}: ₱${t.base_price.toLocaleString()}/night`).join(', ');
    return `Our room rates start from: ${list}. Prices may vary per specific room. Contact us for detailed pricing.`;
  }

  // Venue availability
  if (msg.includes('venue') && (msg.includes('available') || msg.includes('book') || msg.includes('reserve'))) {
    const available = (await db.prepare(`SELECT COUNT(*) AS cnt FROM venues WHERE status='available' AND is_active=1`).get()).cnt;
    return `We have ${available} venue(s) currently available. Our venues include function halls, garden areas, poolside, and more. Please contact our team to check availability for your preferred date.`;
  }

  // Event packages
  if (msg.includes('package') || msg.includes('wedding') || msg.includes('birthday') || msg.includes('event')) {
    const packages = await db.prepare(`SELECT name, price FROM event_packages WHERE is_active=1 ORDER BY price`).all();
    const list     = packages.map(p => `${p.name}: ₱${p.price.toLocaleString()}`).join(', ');
    return `Our event packages include: ${list}. Each package can be customized to fit your needs. Please contact our events team for details.`;
  }

  // Check-in / check-out time
  if (msg.includes('check-in') || msg.includes('check in') || msg.includes('check-out') || msg.includes('checkout')) {
    const cin  = (await db.prepare(`SELECT value FROM settings WHERE \`key\`='check_in_time'`).get())?.value  || '2:00 PM';
    const cout = (await db.prepare(`SELECT value FROM settings WHERE \`key\`='check_out_time'`).get())?.value || '12:00 PM';
    return `Check-in time is ${cin} and check-out time is ${cout}. Early check-in or late check-out may be available upon request, subject to availability.`;
  }

  // Payment / downpayment
  if (msg.includes('payment') || msg.includes('downpayment') || msg.includes('deposit')) {
    const pct = (await db.prepare(`SELECT value FROM settings WHERE \`key\`='downpayment_percent'`).get())?.value || '50';
    return `A ${pct}% downpayment is required to confirm your reservation. We accept cash, GCash, bank transfer, check, and credit card. Full payment is required upon check-in or before the event.`;
  }

  // Cancellation
  if (msg.includes('cancel') || msg.includes('refund')) {
    const policy = (await db.prepare(`SELECT value FROM settings WHERE \`key\`='cancellation_policy'`).get())?.value || 'Please contact us regarding our cancellation policy.';
    return policy;
  }

  // Contact information
  if (msg.includes('contact') || msg.includes('phone') || msg.includes('email') || msg.includes('address')) {
    const phone   = (await db.prepare(`SELECT value FROM settings WHERE \`key\`='resort_phone'`).get())?.value   || '';
    const email   = (await db.prepare(`SELECT value FROM settings WHERE \`key\`='resort_email'`).get())?.value   || '';
    const address = (await db.prepare(`SELECT value FROM settings WHERE \`key\`='resort_address'`).get())?.value || '';
    return `You can reach us at: Phone: ${phone}, Email: ${email}, Address: ${address}. Our team is available during office hours.`;
  }

  // How to book
  if (msg.includes('how to book') || msg.includes('reservation process') || msg.includes('how do i reserve')) {
    return 'To make a reservation: (1) Browse our available rooms or venues, (2) Select your preferred dates, (3) Fill in your details and submit, (4) Pay the downpayment to confirm. You will receive a booking reference and QR code by email.';
  }

  // Amenities
  if (msg.includes('ameniti') || msg.includes('facilities') || msg.includes('pool') || msg.includes('wifi')) {
    return 'Our resort offers various amenities including swimming pool, WiFi, air-conditioned rooms, function halls, garden areas, and more. Specific amenities vary by room and venue type.';
  }

  // Default — escalate to staff
  return "Thank you for your inquiry! I can help with general information about our rooms, venues, event packages, pricing, and reservations. For more specific questions or to arrange a booking, please use our Contact form and our team will get back to you shortly.";
}

module.exports = router;
