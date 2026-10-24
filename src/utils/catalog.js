'use strict';

const fs   = require('fs');
const path = require('path');

const ROOT_DIR   = path.resolve(__dirname, '..', '..');
const PUBLIC_DIR = path.join(ROOT_DIR, 'public');

function uniqueCatalogRows(rows, keyForRow = row => row.name, preferredId = null) {
  const winners = new Map();

  for (const [index, row] of rows.entries()) {
    const normalizedKey = String(keyForRow(row) || '').trim().toLowerCase();
    const key = normalizedKey || `__unnamed_${row.id ?? index}`;
    const current = winners.get(key);

    if (!current) {
      winners.set(key, row);
      continue;
    }

    const rowIsPreferred = preferredId != null && String(row.id) === String(preferredId);
    const currentIsPreferred = preferredId != null && String(current.id) === String(preferredId);
    const rowIsAvailable = row.status === 'available';
    const currentIsAvailable = current.status === 'available';

    if (
      (rowIsPreferred && !currentIsPreferred) ||
      (rowIsPreferred === currentIsPreferred && rowIsAvailable && !currentIsAvailable) ||
      (rowIsPreferred === currentIsPreferred && rowIsAvailable === currentIsAvailable && row.id < current.id)
    ) {
      winners.set(key, row);
    }
  }

  const winningRows = new Set(winners.values());
  return rows.filter(row => winningRows.has(row));
}

// Does a stored image path point at a file that actually exists?
// /uploads/... is served from the project root, everything else from public/.
function imageExists(src) {
  if (typeof src !== 'string' || !src.startsWith('/')) return false;
  const rel  = decodeURIComponent(src.split('?')[0]).replace(/^\/+/, '');
  const base = rel.startsWith('uploads/') ? path.join(ROOT_DIR, 'uploads') : PUBLIC_DIR;
  const abs  = path.resolve(base, rel.startsWith('uploads/') ? rel.slice('uploads/'.length) : rel);
  if (!abs.startsWith(base + path.sep)) return false;
  try { return fs.statSync(abs).isFile(); } catch { return false; }
}

/**
 * Keep only photos whose files exist, so guests never see a broken image —
 * a listing with none left shows the honest "Photos coming soon" state.
 * Sets row.imagesList and rewrites row.images (views parse either).
 */
function withExistingPhotos(rows) {
  for (const row of rows) {
    let list;
    try { list = JSON.parse(row.images || '[]'); } catch { list = []; }
    if (!Array.isArray(list)) list = [];
    row.imagesList = list.filter(imageExists);
    row.images     = JSON.stringify(row.imagesList);
  }
  return rows;
}

// Curated previews lead with listings that have real photos (stable order otherwise).
function photosFirst(rows) {
  return rows
    .map((row, index) => ({ row, index }))
    .sort((a, b) => (b.row.imagesList.length > 0) - (a.row.imagesList.length > 0) || a.index - b.index)
    .map(x => x.row);
}

module.exports = { uniqueCatalogRows, imageExists, withExistingPhotos, photosFirst };
