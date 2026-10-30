/**
 * Resized photos: GET /img/<width>/<path> → a WebP no wider than <width>, e.g.
 *   /img/640/uploads/rooms/room-1.jpg   /img/1600/images/landing/beachfront-gazebo.jpg
 *
 * Each size is made once (sharp) and kept in <UPLOAD_ROOT>/.cache/img, which survives deploys;
 * browsers and the CDN may keep it for a year (a replaced photo has a new file name or mtime, and
 * the cache key includes both). Payment proofs and QR codes never go through here. If sharp is
 * unavailable or a file can't be read, the original photo is sent instead.
 */
'use strict';
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const crypto = require('crypto');
const { ROOT_DIR, UPLOAD_ROOT } = require('../config/paths');

let sharp = null;
try { sharp = require('sharp'); sharp.cache(false); sharp.concurrency(1); } catch { sharp = null; }

const WIDTHS = [320, 480, 640, 800, 1200, 1600];
const CACHE_DIR = path.join(UPLOAD_ROOT, '.cache', 'img');
const PUBLIC_IMAGES = path.join(ROOT_DIR, 'public', 'images');
const PHOTO = /^(uploads|images)\/[\w./-]+\.(jpe?g|png|webp)$/i;
const PRIVATE = /(^|\/)(payment_proofs|refund_proofs|payments|proofs?|qrcodes?|qr)(\/|$)|qr[-_]/i;
const YEAR = 'public, max-age=31536000, immutable';
const inFlight = new Map();
let queue = Promise.resolve();   // one resize at a time

// '/uploads/rooms/a.jpg' (or 'images/landing/a.jpg') → absolute file path, or null if not a public photo.
function sourceFile(rel) {
  rel = String(rel || '').replace(/^\/+/, '');
  if (!PHOTO.test(rel) || rel.includes('..') || PRIVATE.test(rel)) return null;
  const abs = rel.startsWith('uploads/')
    ? path.resolve(UPLOAD_ROOT, rel.slice('uploads/'.length))
    : path.resolve(PUBLIC_IMAGES, rel.slice('images/'.length));
  const base = rel.startsWith('uploads/') ? UPLOAD_ROOT : PUBLIC_IMAGES;
  return abs.startsWith(base + path.sep) ? abs : null;
}

function isResizable(src) { return !!sourceFile(src); }

async function resized(abs, width) {
  const st = await fsp.stat(abs);
  const key = crypto.createHash('sha1').update(`${abs}|${st.size}|${st.mtimeMs}|${width}`).digest('hex');
  const out = path.join(CACHE_DIR, String(width), key + '.webp');
  try { await fsp.access(out); return out; } catch { /* make it */ }
  if (inFlight.has(out)) return inFlight.get(out);
  const job = (queue = queue.catch(() => {}).then(async () => {
    await fsp.mkdir(path.dirname(out), { recursive: true });
    const tmp = out + '.' + process.pid + '.tmp';
    await sharp(abs, { failOn: 'none' }).rotate().resize({ width, withoutEnlargement: true }).webp({ quality: 72, effort: 4 }).toFile(tmp);
    await fsp.rename(tmp, out);
    return out;
  })).finally(() => inFlight.delete(out));
  inFlight.set(out, job);
  return job;
}

// Express handler for /img/:w/*
async function imageRoute(req, res, next) {
  const width = Number(req.params.w);
  const rel = req.params[0];
  const abs = sourceFile(rel);
  if (!abs || !WIDTHS.includes(width)) return next();
  try {
    if (!sharp) throw new Error('sharp unavailable');
    const file = await resized(abs, width);
    res.set('Cache-Control', YEAR);
    res.type('image/webp');
    return res.sendFile(file);
  } catch (e) {
    if (e && e.code === 'ENOENT') return res.status(404).end();
    res.set('Cache-Control', 'public, max-age=3600');
    return res.sendFile(abs, err => { if (err) next(); });
  }
}

// srcset for a photo path, e.g. '/img/480/uploads/a.jpg 480w, …'
function srcsetFor(src, widths = [480, 800, 1200, 1600]) {
  const rel = src.replace(/^\/+/, '');
  return widths.map(w => `/img/${w}/${rel} ${w}w`).join(', ');
}
function resizedUrl(src, width) { return `/img/${width}/${String(src).replace(/^\/+/, '')}`; }

module.exports = { imageRoute, isResizable, srcsetFor, resizedUrl, WIDTHS };
