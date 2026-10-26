/**
 * The resort's check-in QR (guests scan it with their own phone when they arrive).
 *
 * Two kinds of code, both signed with a secret kept in settings (arrival_qr_secret):
 *   - Poster:  /arrive/P<sig>            a fixed code for a printed poster at the front desk.
 *   - Live:    /arrive/L<window>.<sig>   shown on the front-desk screen; changes every 30 seconds and
 *                                        is accepted for about 2 minutes, so a photo of it soon stops working.
 * settings.arrival_qr_mode: 'poster' (poster and live screen both work, the default) or 'screen' (only the
 * live screen). Regenerating the secret retires every printed poster and live code at once.
 */
'use strict';
const crypto = require('crypto');
const db = require('../config/database');

const WINDOW_MS = 30 * 1000;
const LIVE_GRACE_WINDOWS = 4;          // a live code works for ~2 minutes after it appears
const PASS_MS = 15 * 60 * 1000;        // after a valid scan, the guest has 15 minutes to sign in and tap Check in

async function getSetting(key) {
  const row = await db.prepare('SELECT value FROM settings WHERE `key` = ?').get(key);
  return row ? row.value : '';
}
async function setSetting(key, value) {
  await db.prepare('INSERT INTO settings (`key`, value) VALUES (?, ?) ON DUPLICATE KEY UPDATE value = VALUES(value), updated_at = NOW()').run(key, value);
}

async function secret() {
  let s = await getSetting('arrival_qr_secret');
  if (!s) { s = crypto.randomBytes(32).toString('hex'); await setSetting('arrival_qr_secret', s); }
  return s;
}
async function mode() { return (await getSetting('arrival_qr_mode')) === 'screen' ? 'screen' : 'poster'; }
async function setMode(m) { await setSetting('arrival_qr_mode', m === 'screen' ? 'screen' : 'poster'); }
async function regenerate() { await setSetting('arrival_qr_secret', crypto.randomBytes(32).toString('hex')); }

const sign = (key, msg) => crypto.createHmac('sha256', key).update(msg).digest('base64url').slice(0, 12);
const windowAt = (t = Date.now()) => Math.floor(t / WINDOW_MS);

async function posterCode() { return 'P' + sign(await secret(), 'poster'); }
async function liveCode(t = Date.now()) {
  const w = windowAt(t);
  return { code: 'L' + w.toString(36) + '.' + sign(await secret(), 'live:' + w), refreshInMs: WINDOW_MS - (t % WINDOW_MS) };
}

/** → { ok, kind: 'poster'|'live', reason } */
async function check(code) {
  const c = String(code || '');
  const key = await secret();
  const same = (a, b) => a.length === b.length && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
  if (c[0] === 'P') {
    if (!same(c, 'P' + sign(key, 'poster'))) return { ok: false, reason: 'This check-in code isn’t valid any more. Scan the QR at the front desk.' };
    if ((await mode()) !== 'poster') return { ok: false, kind: 'poster', reason: 'Please scan the QR on the front-desk screen.' };
    return { ok: true, kind: 'poster' };
  }
  const m = /^L([0-9a-z]+)\.([\w-]{12})$/.exec(c);
  if (m) {
    const w = parseInt(m[1], 36), age = windowAt() - w;
    if (!same(m[2], sign(key, 'live:' + w))) return { ok: false, reason: 'This check-in code isn’t valid. Scan the QR at the front desk.' };
    if (age < 0 || age > LIVE_GRACE_WINDOWS) return { ok: false, kind: 'live', reason: 'This check-in code has expired. Scan the QR on the front-desk screen again.' };
    return { ok: true, kind: 'live' };
  }
  return { ok: false, reason: 'That isn’t the resort’s check-in QR.' };
}

// After a valid scan the guest may need to sign in first: remember the scan for a while in their session.
function grantPass(session) { session.arrivalPass = Date.now() + PASS_MS; }
function hasPass(session) { return !!(session && session.arrivalPass && session.arrivalPass > Date.now()); }

module.exports = { posterCode, liveCode, check, mode, setMode, regenerate, grantPass, hasPass, WINDOW_MS };
