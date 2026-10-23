/**
 * Settings Routes  (/settings)
 * Admin-only: manage site-wide settings including payment account details.
 */
'use strict';

const express = require('express');
const path    = require('path');
const fs      = require('fs');
const multer  = require('multer');
const db      = require('../../../config/database');
const { requireAuth, requireRole } = require('../../../middleware/auth');

const router     = express.Router();
const ADMIN_ONLY = requireRole('admin');

// ΓöÇΓöÇ Multer: QR code image upload ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ
const QR_UPLOAD_DIR = path.join(process.cwd(), 'uploads', 'settings');
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
    const ok = ['.jpg', '.jpeg', '.png', '.webp'].includes(
      path.extname(file.originalname).toLowerCase()
    );
    cb(ok ? null : new Error('Only JPG, PNG, or WEBP images are allowed.'), ok);
  },
});

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
    INSERT INTO settings (\`key\`, value) VALUES (?, ?) AS new
    ON DUPLICATE KEY UPDATE value = new.value, updated_at = NOW()
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
  });
});

// ΓöÇΓöÇ POST /settings/payment ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ
// Update payment account details. Handles optional QR image upload.
router.post('/payment',
  requireAuth, ADMIN_ONLY,
  qrUpload.fields([
    { name: 'gcash_qr_image', maxCount: 1 },
    { name: 'maya_qr_image', maxCount: 1 },
  ]),
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
            const oldAbs = path.join(process.cwd(), oldQR.replace(/^\//, ''));
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
    const oldAbs = path.join(process.cwd(), oldQR.replace(/^\//, ''));
    if (fs.existsSync(oldAbs)) fs.unlink(oldAbs, () => {});
    await saveSetting('gcash_qr_path', '');
  }
  req.session.flash = { success: 'QR code removed.' };
  res.redirect('/settings?tab=payment');
});

router.post('/payment/remove-maya-qr', requireAuth, ADMIN_ONLY, async (req, res) => {
  const oldQR = (await db.prepare("SELECT value FROM settings WHERE `key` = 'maya_qr_path'").get())?.value || '';
  if (oldQR) {
    const oldAbs = path.join(process.cwd(), oldQR.replace(/^\//, ''));
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

module.exports = router;
