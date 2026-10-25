/**
 * Where uploaded files live on disk.
 *
 * UPLOAD_PATH (absolute, or relative to the project root) moves them out of the
 * app folder. Hosts that deploy each build into a fresh folder (Hostinger) need
 * this, or every deploy would lose the uploaded photos, QR codes and proofs.
 * Public URLs stay /uploads/... either way.
 */
'use strict';

require('dotenv').config();
const fs   = require('fs');
const path = require('path');

const ROOT_DIR    = path.resolve(__dirname, '..', '..');
const UPLOAD_ROOT = path.resolve(ROOT_DIR, process.env.UPLOAD_PATH || 'uploads');
// Catalog photos shipped with the code so a fresh server shows the rooms and cottages.
const SEED_DIR    = path.join(ROOT_DIR, 'src', 'database', 'seed-uploads');

// uploadDir('rooms') -> <UPLOAD_ROOT>/rooms
function uploadDir(...parts) {
  return path.join(UPLOAD_ROOT, ...parts);
}

// '/uploads/rooms/a.jpg' -> <UPLOAD_ROOT>/rooms/a.jpg; null for anything outside UPLOAD_ROOT.
function uploadFileFromUrl(url) {
  if (typeof url !== 'string') return null;
  const rel = decodeURIComponent(url.split('?')[0]).replace(/^\/+/, '');
  if (!rel.startsWith('uploads/')) return null;
  const abs = path.resolve(UPLOAD_ROOT, rel.slice('uploads/'.length));
  return abs.startsWith(UPLOAD_ROOT + path.sep) ? abs : null;
}

// Copy seed photos into UPLOAD_ROOT where missing. Never overwrites, so files
// replaced or deleted through the admin stay as the admin left them.
function seedUploads(dir = SEED_DIR) {
  let copied = 0;
  if (!fs.existsSync(dir)) return copied;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const from = path.join(dir, entry.name);
    if (entry.isDirectory()) { copied += seedUploads(from); continue; }
    const to = path.join(UPLOAD_ROOT, path.relative(SEED_DIR, from));
    if (fs.existsSync(to)) continue;
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.copyFileSync(from, to);
    copied++;
  }
  return copied;
}

module.exports = { ROOT_DIR, UPLOAD_ROOT, uploadDir, uploadFileFromUrl, seedUploads };
