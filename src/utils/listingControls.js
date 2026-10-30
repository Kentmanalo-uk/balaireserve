/**
 * Controls shared by rooms, cottages, venues and event packages:
 *   POST <base>/:id/visibility     show on / hide from the website. Nothing is deleted, so a place under
 *                                  maintenance can be hidden and brought back in one click.
 *   POST <base>/:id/guest-booking  let guests reserve it online, or leave reservations to the resort.
 * settings.guest_booking_enabled = '0' turns online booking off for the whole site (Settings → Booking).
 * Staff can always book from the back office.
 */
'use strict';

const db = require('../config/database');
const { requireAuth, requireRole } = require('../middleware/auth');

async function guestBookingOn() {
  const row = await db.prepare("SELECT value FROM settings WHERE `key` = 'guest_booking_enabled'").get();
  return !row || row.value !== '0';
}

function attachListingControls(router, { table, base, noun, visibility = true }) {
  const CAN_MANAGE = [requireAuth, requireRole('admin', 'staff')];
  const load = id => db.prepare(`SELECT id, name, is_active, guest_booking FROM ${table} WHERE id = ?`).get(id);
  const back = (req) => {
    const ref = req.get('Referer') || '';
    return ref.includes(base) ? ref : base;
  };

  if (visibility) {
    router.post('/:id/visibility', ...CAN_MANAGE, async (req, res) => {
      const row = await load(req.params.id);
      if (!row) { req.session.flash = { error: `${noun} not found.` }; return res.redirect(base); }
      const show = req.body.show === '1';
      if (show) {
        // Two shown listings with one name would look like one on the website.
        const twin = await db.prepare(`SELECT id FROM ${table} WHERE is_active = 1 AND id <> ? AND LOWER(TRIM(name)) = LOWER(TRIM(?))`).get(row.id, row.name);
        if (twin) { req.session.flash = { error: `Another shown ${noun.toLowerCase()} is already called "${row.name}". Hide or rename it first.` }; return res.redirect(back(req)); }
      }
      await db.prepare(`UPDATE ${table} SET is_active = ?, updated_at = NOW() WHERE id = ?`).run(show ? 1 : 0, row.id);
      await req.audit(show ? 'show' : 'hide', table, row.id, { is_active: row.is_active }, { is_active: show ? 1 : 0 });
      req.session.flash = { success: show ? `"${row.name}" is back on the website.` : `"${row.name}" is hidden. Bookings already made are not affected.` };
      res.redirect(back(req));
    });
  }

  router.post('/:id/guest-booking', ...CAN_MANAGE, async (req, res) => {
    const row = await load(req.params.id);
    if (!row) { req.session.flash = { error: `${noun} not found.` }; return res.redirect(base); }
    const on = req.body.on === '1';
    await db.prepare(`UPDATE ${table} SET guest_booking = ?, updated_at = NOW() WHERE id = ?`).run(on ? 1 : 0, row.id);
    await req.audit('guest_booking', table, row.id, { guest_booking: row.guest_booking }, { guest_booking: on ? 1 : 0 });
    req.session.flash = { success: on ? `Guests can book "${row.name}" online again.` : `"${row.name}" stays on the website, but only the resort can reserve it now.` };
    res.redirect(back(req));
  });
}

module.exports = { guestBookingOn, attachListingControls };
