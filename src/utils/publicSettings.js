/**
 * Settings shown to the public (landing page, guest portal, chatbot).
 *
 * The seed script fills contact and bank settings with placeholders. Until the
 * resort replaces them, they must not be presented as real contact details or
 * payment accounts, so they are treated as "not set" here.
 */
'use strict';

// Values written by src/database/seed.js that are not real resort details.
const SEED_PLACEHOLDERS = {
  resort_phone: '(02) 8123-4567',
  resort_email: 'info@balai-reserve.com',
};

// Keys that hold contact or payment details guests might act on.
const PUBLIC_DETAIL_KEYS = [
  'resort_phone', 'resort_email',
  'gcash_number', 'maya_number',
  'bank_bdo', 'bank_bpi',
];

function isPlaceholder(key, value) {
  const v = String(value ?? '').trim();
  if (!v) return true;
  if (/x{4}/i.test(v)) return true;                 // masked numbers like XXXX-XXXX-XXXX
  return SEED_PLACEHOLDERS[key] !== undefined && v === SEED_PLACEHOLDERS[key];
}

/**
 * Copy of a settings object with placeholder contact/payment values blanked.
 */
function publicSettings(settings) {
  const out = { ...settings };
  for (const key of PUBLIC_DETAIL_KEYS) {
    if (key in out && isPlaceholder(key, out[key])) out[key] = '';
  }
  return out;
}

module.exports = { publicSettings, isPlaceholder };
