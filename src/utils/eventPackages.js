/**
 * Event packages (Birthday, Wedding, Debut …): the occasions they can be for, and their inclusions.
 *
 * event_packages.inclusions is a JSON array of { name, price, is_default, is_optional }:
 *   - included in the price:  is_default 1, price 0 (is_optional 1 = the guest may leave it out when booking)
 *   - paid add-on:            is_default 0, is_optional 1, price > 0 (added to the total and downpayment)
 * Older rows may hold plain strings; those count as included items.
 */
'use strict';
const db = require('../config/database');

const OCCASIONS = [
  ['wedding', 'Wedding'], ['birthday', 'Birthday'], ['debut', 'Debut'], ['corporate', 'Corporate event'],
  ['meeting', 'Meeting'], ['party', 'Party'], ['family_gathering', 'Family gathering'], ['other', 'Other gathering'],
];
const OCCASION_KEYS = OCCASIONS.map(([k]) => k);
const occasionLabel = key => (OCCASIONS.find(([k]) => k === key) || [null, 'Gathering'])[1];

function parseInclusions(raw) {
  let list;
  try { list = JSON.parse(raw || '[]'); } catch { list = []; }
  if (!Array.isArray(list)) list = [];
  const included = [], addons = [];
  for (const it of list) {
    const item = typeof it === 'string' ? { name: it, price: 0, is_default: 1, is_optional: 0 } : (it || {});
    const name = String(item.name || '').trim();
    if (!name) continue;
    const price = Number(item.price) || 0;
    if (Number(item.is_default) !== 1 && Number(item.is_optional) && price > 0) addons.push({ name, price });
    else included.push({ name, removable: Number(item.is_optional) === 1 });
  }
  return { included, addons };
}

/**
 * Form rows → the stored JSON. Rows: included[i] = { name, removable }, addons[i] = { name, price }.
 * Returns { json, errors[] }. Empty rows are skipped; names must be unique (booking matches add-ons by name).
 */
function buildInclusions(included = [], addons = []) {
  const errors = [], seen = new Set(), out = [];
  const rows = v => (Array.isArray(v) ? v : v && typeof v === 'object' ? Object.values(v) : []);
  const add = (name, entry) => {
    const key = name.toLowerCase();
    if (seen.has(key)) { errors.push(`"${name}" is listed twice. Each item needs its own name.`); return; }
    if (name.length > 120) { errors.push(`"${name.slice(0, 40)}…" is too long (120 characters at most).`); return; }
    seen.add(key); out.push(entry);
  };
  for (const r of rows(included)) {
    const name = String((r && r.name) || '').trim();
    if (name) add(name, { name, price: 0, is_default: 1, is_optional: r.removable ? 1 : 0 });
  }
  for (const r of rows(addons)) {
    const name = String((r && r.name) || '').trim();
    const raw = String((r && r.price) || '').trim();
    if (!name && !raw) continue;
    if (!name) { errors.push('Every add-on needs a name.'); continue; }
    const price = Math.round(Number(raw) * 100) / 100;
    if (!(price > 0)) { errors.push(`Enter a price above ₱0 for the add-on "${name}".`); continue; }
    add(name, { name, price, is_default: 0, is_optional: 1 });
  }
  return { json: JSON.stringify(out), errors, count: out.length };
}

// ── Places included (event_package_items) ───────────────────────────────────
// A package can include one function hall — reserved automatically when the package is booked — and
// any rooms or cottages, which are listed on the booking for staff to assign.
const PLACE_TABLES = { venue: 'venues', room: 'rooms', cottage: 'cottages' };
const PLACE_LABEL = { venue: 'Function hall', room: 'Room', cottage: 'Cottage' };

/** packageIds → Map(packageId → [place]); place = { item_type, item_id, quantity, note, row } (row = the listing). */
async function loadPlaces(packageIds) {
  const ids = [...new Set((packageIds || []).map(Number).filter(n => n > 0))];
  const out = new Map(ids.map(id => [id, []]));
  if (!ids.length) return out;
  const items = await db.prepare(`SELECT * FROM event_package_items WHERE package_id IN (${ids.map(() => '?').join(',')}) ORDER BY package_id, sort_order, id`).all(...ids);
  const rows = {};
  for (const type of Object.keys(PLACE_TABLES)) {
    const want = [...new Set(items.filter(i => i.item_type === type).map(i => i.item_id))];
    rows[type] = new Map();
    if (!want.length) continue;
    const extra = type === 'room' ? ', (SELECT rt.name FROM room_types rt WHERE rt.id = t.room_type_id) AS type_name' : '';
    const list = await db.prepare(`SELECT t.*${extra} FROM ${PLACE_TABLES[type]} t WHERE t.id IN (${want.map(() => '?').join(',')})`).all(...want);
    for (const r of list) rows[type].set(r.id, r);
  }
  for (const i of items) {
    const row = rows[i.item_type] && rows[i.item_type].get(i.item_id);
    if (row) out.get(i.package_id).push({ item_type: i.item_type, item_id: i.item_id, quantity: i.quantity || 1, note: i.note || '', row });
  }
  return out;
}

// Sets p.places (active listings only) and p.hall on each package — for pages guests see.
async function attachPlaces(packages) {
  const map = await loadPlaces((packages || []).map(p => p.id));
  for (const p of packages || []) {
    p.places = (map.get(Number(p.id)) || []).filter(pl => Number(pl.row.is_active) === 1);
    p.hall = (p.places.find(pl => pl.item_type === 'venue') || {}).row || null;
  }
  return packages;
}

const placeText = pl => (pl.quantity > 1 ? pl.quantity + ' × ' : '') + pl.row.name;

/**
 * Form rows → rows to store. Rows: places[i] = { ref: 'venue:3', qty, note }. Returns { rows, errors }.
 * One function hall at most (it is the one reserved); a listing once; quantity 1–20 (a hall is always 1).
 */
async function buildPlaces(input) {
  const list = Array.isArray(input) ? input : input && typeof input === 'object' ? Object.values(input) : [];
  const rows = [], errors = [], seen = new Set();
  for (const r of list) {
    const ref = String((r && r.ref) || '').trim();
    if (!ref) continue;
    const [type, idText] = ref.split(':');
    const id = Number(idText);
    if (!PLACE_TABLES[type] || !Number.isInteger(id) || id < 1) { errors.push('Choose a place from the list.'); continue; }
    const row = await db.prepare(`SELECT id, name, is_active FROM ${PLACE_TABLES[type]} WHERE id = ?`).get(id);
    if (!row) { errors.push('One of the chosen places no longer exists.'); continue; }
    if (!Number(row.is_active)) { errors.push('"' + row.name + '" is hidden on the website. Show it again first, or choose another place.'); continue; }
    if (seen.has(ref)) { errors.push(`"${row.name}" is listed twice. Use the quantity instead.`); continue; }
    seen.add(ref);
    const qty = type === 'venue' ? 1 : Number(r.qty || 1);
    if (!Number.isInteger(qty) || qty < 1 || qty > 20) { errors.push(`Enter a quantity from 1 to 20 for "${row.name}".`); continue; }
    const note = String((r && r.note) || '').trim();
    if (note.length > 255) { errors.push(`The note for "${row.name}" is too long (255 characters at most).`); continue; }
    rows.push({ item_type: type, item_id: id, quantity: qty, note: note || null, name: row.name });
  }
  if (rows.filter(r => r.item_type === 'venue').length > 1) errors.push('A package can include one function hall — that is the one booked for the event.');
  return { rows, errors };
}

async function savePlaces(packageId, rows) {
  await db.prepare('DELETE FROM event_package_items WHERE package_id = ?').run(packageId);
  let n = 0;
  for (const r of rows) {
    await db.prepare('INSERT INTO event_package_items (package_id, item_type, item_id, quantity, note, sort_order) VALUES (?, ?, ?, ?, ?, ?)')
      .run(packageId, r.item_type, r.item_id, r.quantity, r.note, n++);
  }
}

module.exports = {
  OCCASIONS, OCCASION_KEYS, occasionLabel, parseInclusions, buildInclusions,
  PLACE_TABLES, PLACE_LABEL, loadPlaces, attachPlaces, placeText, buildPlaces, savePlaces,
};
