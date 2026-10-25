/**
 * Settings Routes  (/settings)
 * Admin-only: manage site-wide settings including payment account details.
 */
'use strict';

const express = require('express');
const path    = require('path');
const fs      = require('fs');
const crypto  = require('crypto');
const multer  = require('multer');
const db      = require('../../../config/database');
const { uploadDir, uploadFileFromUrl } = require('../../../config/paths');
const { requireAuth, requireRole } = require('../../../middleware/auth');

const router     = express.Router();
const ADMIN_ONLY = requireRole('admin');

// ΓöÇΓöÇ Multer: QR code image upload ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ
const QR_UPLOAD_DIR = uploadDir('settings');
if (!fs.existsSync(QR_UPLOAD_DIR)) fs.mkdirSync(QR_UPLOAD_DIR, { recursive: true });

const qrStorage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, QR_UPLOAD_DIR),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, file.fieldname.replace(/_image$/, '') + '-' + Date.now() + ext);
  },
});
const qrUpload = multer({
  storage: qrStorage,
  limits:  { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (LANDING_IMAGE_TYPES[ext] && Object.values(LANDING_IMAGE_TYPES).includes(file.mimetype)) return cb(null, true);
    const err = new Error('Only JPG, PNG, or WEBP images are allowed.');
    err.code = 'UPLOAD_FILE_TYPE';
    cb(err);
  },
});

// ΓöÇΓöÇ Multer: landing page images (hero, about, gallery) ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ
// Kept in their own folder so replaced/removed files are only ever deleted from there.
const LANDING_UPLOAD_DIR  = path.join(QR_UPLOAD_DIR, 'landing');
const LANDING_URL_PREFIX  = '/uploads/settings/landing/';
const DEFAULT_HERO_IMAGE  = '/images/landing/beachfront-gazebo.jpg';
const GALLERY_MAX_ITEMS   = 24;
const GALLERY_MAX_UPLOAD  = 10;
const CAPTION_MAX_LENGTH  = 140;
const LANDING_IMAGE_TYPES = {
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp',
};
if (!fs.existsSync(LANDING_UPLOAD_DIR)) fs.mkdirSync(LANDING_UPLOAD_DIR, { recursive: true });

const landingUpload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, LANDING_UPLOAD_DIR),
    filename: (_req, file, cb) => {
      const ext    = path.extname(file.originalname).toLowerCase();
      const prefix = { hero_image: 'hero', about_image: 'about' }[file.fieldname] || 'gallery';
      cb(null, `${prefix}-${Date.now()}-${crypto.randomBytes(4).toString('hex')}${ext}`);
    },
  }),
  limits: { fileSize: 5 * 1024 * 1024, files: GALLERY_MAX_UPLOAD },
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (LANDING_IMAGE_TYPES[ext] && Object.values(LANDING_IMAGE_TYPES).includes(file.mimetype)) return cb(null, true);
    const err = new Error('Only JPG, PNG, or WEBP images are allowed.');
    err.code = 'UPLOAD_FILE_TYPE';
    cb(err);
  },
});

// Run a multer middleware and turn upload errors into a flash message on the
// given Settings tab instead of the generic 500 page.
function withUpload(upload, tab) {
  return (req, res, next) => upload(req, res, (err) => {
    if (!err) return next();
    uploadedFiles(req).forEach(f => fs.unlink(f.path, () => {}));
    const tooMany = tab === 'landing'
      ? `You can upload up to ${GALLERY_MAX_UPLOAD} images at a time.`
      : 'Please choose only one image for each QR code.';
    const messages = {
      LIMIT_FILE_SIZE:       'Each image must be 5 MB or smaller.',
      LIMIT_FILE_COUNT:      tooMany,
      LIMIT_UNEXPECTED_FILE: tooMany,
      UPLOAD_FILE_TYPE:      err.message,
    };
    req.session.flash = { error: messages[err.code] || 'The image could not be uploaded. Please try again.' };
    res.redirect(`/settings?tab=${tab}`);
  });
}

function uploadedFiles(req) {
  if (req.file) return [req.file];
  if (Array.isArray(req.files)) return req.files;
  return req.files ? Object.values(req.files).flat() : [];
}

// The extension/MIME check trusts the browser, so also confirm the file
// actually starts with a JPEG, PNG, or WEBP signature.
function isImageFile(filePath) {
  let head;
  try {
    const fd = fs.openSync(filePath, 'r');
    head = Buffer.alloc(12);
    fs.readSync(fd, head, 0, 12, 0);
    fs.closeSync(fd);
  } catch { return false; }
  const jpeg = head[0] === 0xFF && head[1] === 0xD8 && head[2] === 0xFF;
  const png  = head.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]));
  const webp = head.toString('ascii', 0, 4) === 'RIFF' && head.toString('ascii', 8, 12) === 'WEBP';
  return jpeg || png || webp;
}

// Delete a landing image from disk, but only if it is a file directly inside
// LANDING_UPLOAD_DIR (never the bundled default image or anything else).
function deleteLandingFile(webPath) {
  if (typeof webPath !== 'string' || !webPath.startsWith(LANDING_URL_PREFIX)) return;
  const name = webPath.slice(LANDING_URL_PREFIX.length);
  if (!name || name !== path.basename(name)) return;
  const abs = path.resolve(LANDING_UPLOAD_DIR, name);
  if (path.dirname(abs) !== path.resolve(LANDING_UPLOAD_DIR)) return;
  fs.unlink(abs, () => {});
}

function parseGallery(value) {
  let list;
  try { list = JSON.parse(value || '[]'); } catch { return []; }
  if (!Array.isArray(list)) return [];
  return list
    .filter(g => g && typeof g.path === 'string' && g.path.startsWith(LANDING_URL_PREFIX))
    .map(g => ({ path: g.path, caption: typeof g.caption === 'string' ? g.caption : '' }));
}

async function getSetting(key) {
  return (await db.prepare('SELECT value FROM settings WHERE `key` = ?').get(key))?.value || '';
}

// ΓöÇΓöÇ Helper: load all settings into a keyed object ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ
async function loadSettings() {
  const rows = await db.prepare('SELECT `key`, value FROM settings').all();
  const s = {};
  for (const r of rows) s[r.key] = r.value;
  return s;
}

// ΓöÇΓöÇ Helper: upsert a single setting key ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ
async function saveSetting(key, value) {
  await db.prepare(`
    INSERT INTO settings (\`key\`, value) VALUES (?, ?)
    ON DUPLICATE KEY UPDATE value = VALUES(value), updated_at = NOW()
  `).run(key, value);
}

// ΓöÇΓöÇ GET /settings ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ
router.get('/', requireAuth, ADMIN_ONLY, async (req, res) => {
  const siteSettings = await loadSettings();
  const activeTab = req.query.tab || 'payment';
  res.render('settings/index', {
    title: 'Settings – Balai-Reserve',
    layout: 'layouts/main',
    siteSettings,
    activeTab,
    landingGallery:   parseGallery(siteSettings.landing_gallery),
    defaultHeroImage: DEFAULT_HERO_IMAGE,
    galleryLimits:    { maxItems: GALLERY_MAX_ITEMS, maxUpload: GALLERY_MAX_UPLOAD, captionLength: CAPTION_MAX_LENGTH },
  });
});

// ΓöÇΓöÇ POST /settings/payment ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ
// Update payment account details. Handles optional QR image upload.
router.post('/payment',
  requireAuth, ADMIN_ONLY,
  withUpload(qrUpload.fields([
    { name: 'gcash_qr_image', maxCount: 1 },
    { name: 'maya_qr_image', maxCount: 1 },
  ]), 'payment'),
  async (req, res) => {
    const {
      gcash_number, gcash_name,
      maya_number,  maya_name,
      bank_bdo,     bank_bpi,  bank_name,
    } = req.body;

    // ΓöÇΓöÇ Validate mobile-number formats before saving ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ
    const gcash = (gcash_number || '').trim();
    const maya  = (maya_number  || '').trim();
    const gcashQrFile = req.files?.gcash_qr_image?.[0];
    const mayaQrFile  = req.files?.maya_qr_image?.[0];
    const uploadedQrFiles = [gcashQrFile, mayaQrFile].filter(Boolean);
    const phoneOk = (v) => v === '' || /^09\d{9}$/.test(v);
    // The extension/MIME check trusts the browser; make sure each QR really is an image.
    if (uploadedQrFiles.some(file => !isImageFile(file.path))) {
      uploadedQrFiles.forEach(file => { try { fs.unlinkSync(file.path); } catch { /* ignore */ } });
      req.session.flash = { error: 'The QR code must be a real JPG, PNG, or WEBP image.' };
      return res.redirect('/settings?tab=payment');
    }
    if (!phoneOk(gcash)) {
      // If a new QR file was uploaded in this same request, discard it since we abort.
      uploadedQrFiles.forEach(file => { try { fs.unlinkSync(file.path); } catch { /* ignore */ } });
      req.session.flash = { error: 'Please enter a valid GCash number (11 digits starting with 09), e.g. 09171234567.' };
      return res.redirect('/settings?tab=payment');
    }
    if (!phoneOk(maya)) {
      uploadedQrFiles.forEach(file => { try { fs.unlinkSync(file.path); } catch { /* ignore */ } });
      req.session.flash = { error: 'Please enter a valid Maya number (11 digits starting with 09).' };
      return res.redirect('/settings?tab=payment');
    }

    await db.transaction(async () => {
      await saveSetting('gcash_number', (gcash_number || '').trim());
      await saveSetting('gcash_name',   (gcash_name   || '').trim());
      await saveSetting('maya_number',  (maya_number  || '').trim());
      await saveSetting('maya_name',    (maya_name    || '').trim());
      await saveSetting('bank_bdo',     (bank_bdo     || '').trim());
      await saveSetting('bank_bpi',    (bank_bpi     || '').trim());
      await saveSetting('bank_name',    (bank_name    || '').trim());

      // Replace only the QR images included in this request.
      for (const { file, key } of [
        { file: gcashQrFile, key: 'gcash_qr_path' },
        { file: mayaQrFile, key: 'maya_qr_path' },
      ]) {
        if (file) {
          const oldQR = (await db.prepare('SELECT value FROM settings WHERE `key` = ?').get(key))?.value || '';
          if (oldQR) {
            const oldAbs = uploadFileFromUrl(oldQR);
            if (fs.existsSync(oldAbs)) fs.unlink(oldAbs, () => {});
          }
          await saveSetting(key, '/uploads/settings/' + file.filename);
        }
      }
    });

    req.audit && await req.audit('update', 'settings', null, null, { group: 'payment' });
    req.session.flash = { success: 'Payment settings saved successfully.' };
    res.redirect('/settings?tab=payment');
  }
);

// ΓöÇΓöÇ POST /settings/payment/remove-qr ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ
// Remove the GCash QR image
router.post('/payment/remove-qr', requireAuth, ADMIN_ONLY, async (req, res) => {
  const oldQR = (await db.prepare("SELECT value FROM settings WHERE `key` = 'gcash_qr_path'").get())?.value || '';
  if (oldQR) {
    const oldAbs = uploadFileFromUrl(oldQR);
    if (fs.existsSync(oldAbs)) fs.unlink(oldAbs, () => {});
    await saveSetting('gcash_qr_path', '');
  }
  req.session.flash = { success: 'QR code removed.' };
  res.redirect('/settings?tab=payment');
});

router.post('/payment/remove-maya-qr', requireAuth, ADMIN_ONLY, async (req, res) => {
  const oldQR = (await db.prepare("SELECT value FROM settings WHERE `key` = 'maya_qr_path'").get())?.value || '';
  if (oldQR) {
    const oldAbs = uploadFileFromUrl(oldQR);
    if (fs.existsSync(oldAbs)) fs.unlink(oldAbs, () => {});
    await saveSetting('maya_qr_path', '');
  }
  req.session.flash = { success: 'Maya QR code removed.' };
  res.redirect('/settings?tab=payment');
});

// ΓöÇΓöÇ POST /settings/general ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ
router.post('/general', requireAuth, ADMIN_ONLY, async (req, res) => {
  const { resort_name, resort_tagline, resort_address, resort_phone, resort_email } = req.body;
  await db.transaction(async () => {
    await saveSetting('resort_name',    (resort_name    || '').trim());
    await saveSetting('resort_tagline', (resort_tagline || '').trim());
    await saveSetting('resort_address', (resort_address || '').trim());
    await saveSetting('resort_phone',   (resort_phone   || '').trim());
    await saveSetting('resort_email',   (resort_email   || '').trim());
  });
  req.session.flash = { success: 'General settings saved.' };
  res.redirect('/settings?tab=general');
});

// ΓöÇΓöÇ POST /settings/booking ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ
router.post('/booking', requireAuth, ADMIN_ONLY, async (req, res) => {
  const { check_in_time, check_out_time, downpayment_percent, cancellation_policy } = req.body;
  await db.transaction(async () => {
    await saveSetting('check_in_time',       (check_in_time       || '').trim());
    await saveSetting('check_out_time',      (check_out_time      || '').trim());
    await saveSetting('downpayment_percent', (downpayment_percent || '50').trim());
    await saveSetting('cancellation_policy', (cancellation_policy || '').trim());
  });
  req.session.flash = { success: 'Booking settings saved.' };
  res.redirect('/settings?tab=booking');
});

// ΓöÇΓöÇ Landing page images ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ
const INVALID_IMAGE_MSG = 'That file is not a valid JPG, PNG, or WEBP image.';
const LANDING_TAB       = '/settings?tab=landing';
const GALLERY_ANCHOR    = LANDING_TAB + '#landing-gallery';

// POST /settings/landing/hero  and  /settings/landing/about
// Upload/replace one image. The About image also has a description (alt text)
// that can be saved on its own once an image exists.
const LANDING_SINGLE_IMAGES = [
  { slot: 'hero',  key: 'landing_hero_image',  label: 'Hero background image' },
  { slot: 'about', key: 'landing_about_image', label: 'About section image', altKey: 'landing_about_alt' },
];

for (const { slot, key, label, altKey } of LANDING_SINGLE_IMAGES) {
  router.post(`/landing/${slot}`,
    requireAuth, ADMIN_ONLY,
    withUpload(landingUpload.single(`${slot}_image`), 'landing'),
    async (req, res) => {
      const file = req.file;
      if (file && !isImageFile(file.path)) {
        fs.unlink(file.path, () => {});
        req.session.flash = { error: INVALID_IMAGE_MSG };
        return res.redirect(LANDING_TAB);
      }
      const oldPath = await getSetting(key);
      if (!file && !(altKey && oldPath)) {
        req.session.flash = { error: 'Choose an image to upload first.' };
        return res.redirect(LANDING_TAB);
      }

      const changes = {};
      await db.transaction(async () => {
        if (file) {
          changes[key] = LANDING_URL_PREFIX + file.filename;
          await saveSetting(key, changes[key]);
        }
        if (altKey) {
          changes[altKey] = String(req.body[altKey] || '').trim().slice(0, CAPTION_MAX_LENGTH);
          await saveSetting(altKey, changes[altKey]);
        }
      });
      if (file) deleteLandingFile(oldPath);

      req.audit && await req.audit('update', 'settings', null,
        file ? { [key]: oldPath || null } : null, { group: 'landing', ...changes });
      req.session.flash = { success: file ? `${label} updated.` : `${label} description saved.` };
      res.redirect(LANDING_TAB);
    }
  );

  router.post(`/landing/${slot}/remove`, requireAuth, ADMIN_ONLY, async (req, res) => {
    const oldPath = await getSetting(key);
    if (oldPath) {
      await saveSetting(key, '');
      deleteLandingFile(oldPath);
      req.audit && await req.audit('update', 'settings', null, { [key]: oldPath }, { group: 'landing', [key]: null });
    }
    req.session.flash = { success: `${label} removed.` };
    res.redirect(LANDING_TAB);
  });
}

// ΓöÇΓöÇ POST /settings/landing/gallery ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ
// Add one or more photos to the end of the gallery.
router.post('/landing/gallery',
  requireAuth, ADMIN_ONLY,
  withUpload(landingUpload.array('gallery_images', GALLERY_MAX_UPLOAD), 'landing'),
  async (req, res) => {
    const files   = uploadedFiles(req);
    const discard = () => files.forEach(f => fs.unlink(f.path, () => {}));
    if (!files.length) {
      req.session.flash = { error: 'Choose at least one photo to add to the gallery.' };
      return res.redirect(LANDING_TAB);
    }
    if (!files.every(f => isImageFile(f.path))) {
      discard();
      req.session.flash = { error: INVALID_IMAGE_MSG + ' No photos were added.' };
      return res.redirect(LANDING_TAB);
    }

    const gallery = parseGallery(await getSetting('landing_gallery'));
    if (gallery.length + files.length > GALLERY_MAX_ITEMS) {
      discard();
      const room = GALLERY_MAX_ITEMS - gallery.length;
      req.session.flash = { error: `The gallery holds up to ${GALLERY_MAX_ITEMS} photos. ` +
        (room > 0 ? `You can add ${room} more.` : 'Remove a photo before adding another.') };
      return res.redirect(LANDING_TAB);
    }

    const added = files.map(f => ({ path: LANDING_URL_PREFIX + f.filename, caption: '' }));
    await saveSetting('landing_gallery', JSON.stringify(gallery.concat(added)));
    req.audit && await req.audit('update', 'settings', null, null,
      { group: 'landing', landing_gallery_added: added.map(a => a.path) });
    req.session.flash = { success: `${added.length} photo${added.length === 1 ? '' : 's'} added to the gallery. ` +
      'Add a caption so visitors and screen readers know what each one shows.' };
    res.redirect(GALLERY_ANCHOR);
  }
);

// ΓöÇΓöÇ POST /settings/landing/gallery/update ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ
// Saves all captions, then applies the clicked row action (if any): the
// button's name is move_up / move_down / remove and its value is the photo path.
// Captions come in pairs (path_N, caption_N) and are matched by path so a
// stale form can't attach a caption to the wrong photo.
router.post('/landing/gallery/update', requireAuth, ADMIN_ONLY, async (req, res) => {
  const { move_up: moveUp, move_down: moveDown, remove } = req.body;
  const gallery  = parseGallery(await getSetting('landing_gallery'));
  const before   = JSON.stringify(gallery);
  const captions = new Map();
  for (let i = 0; i < GALLERY_MAX_ITEMS && req.body[`path_${i}`] !== undefined; i++) {
    captions.set(String(req.body[`path_${i}`]), String(req.body[`caption_${i}`] || '').trim().slice(0, CAPTION_MAX_LENGTH));
  }
  for (const item of gallery) {
    if (captions.has(item.path)) item.caption = captions.get(item.path);
  }

  let message = 'Gallery captions saved.';
  let removed = null;
  const actionPath = remove || moveUp || moveDown;
  if (actionPath) {
    const index = gallery.findIndex(g => g.path === actionPath);
    if (index === -1) {
      message = 'Captions saved. That photo was no longer in the gallery.';
    } else if (remove) {
      [removed] = gallery.splice(index, 1);
      message = 'Photo removed from the gallery.';
    } else {
      const target = moveUp ? index - 1 : index + 1;
      if (target >= 0 && target < gallery.length) {
        [gallery[index], gallery[target]] = [gallery[target], gallery[index]];
      }
      message = 'Gallery order updated.';
    }
  }

  if (JSON.stringify(gallery) !== before) {
    await saveSetting('landing_gallery', JSON.stringify(gallery));
    if (removed) deleteLandingFile(removed.path);
    req.audit && await req.audit('update', 'settings', null,
      { landing_gallery: JSON.parse(before) }, { group: 'landing', landing_gallery: gallery });
  }
  req.session.flash = { success: message };
  res.redirect(GALLERY_ANCHOR);
});

// POST /settings/landing/amenities
// Plain-text list (one amenity per line) shown in the public Amenities section.
// Lines are trimmed and blank lines dropped; the whole list is capped at 2000 characters.
const AMENITIES_MAX_LENGTH = 2000;
router.post('/landing/amenities', requireAuth, ADMIN_ONLY, async (req, res) => {
  const value = String(req.body.landing_amenities || '')
    .split(/\r?\n/).map(line => line.trim()).filter(Boolean)
    .join('\n').slice(0, AMENITIES_MAX_LENGTH).trim();
  const oldValue = await getSetting('landing_amenities');
  await saveSetting('landing_amenities', value);
  req.audit && await req.audit('update', 'settings', null,
    { landing_amenities: oldValue || null }, { group: 'landing', landing_amenities: value });
  req.session.flash = { success: value ? 'Amenities list saved.' : 'Amenities list cleared.' };
  res.redirect(LANDING_TAB + '#landing-amenities');
});

module.exports = router;
