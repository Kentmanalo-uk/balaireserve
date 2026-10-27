/**
 * Event packages (Birthday, Wedding, Debut …): the occasions they can be for, and their inclusions.
 *
 * event_packages.inclusions is a JSON array of { name, price, is_default, is_optional }:
 *   - included in the price:  is_default 1, price 0 (is_optional 1 = the guest may leave it out when booking)
 *   - paid add-on:            is_default 0, is_optional 1, price > 0 (added to the total and downpayment)
 * Older rows may hold plain strings; those count as included items.
 */
'use strict';

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

module.exports = { OCCASIONS, OCCASION_KEYS, occasionLabel, parseInclusions, buildInclusions };
