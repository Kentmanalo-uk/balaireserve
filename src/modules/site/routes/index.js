/**
 * Public site essentials — what search engines, web filters (FortiGuard, Cisco, Palo Alto …) and their
 * reviewers look for when they decide what kind of site this is:
 *   GET /robots.txt     what crawlers may index (private back-office and account pages excluded)
 *   GET /sitemap.xml    every public page, including each room, cottage, hall and event package
 *   GET /privacy        privacy policy (Data Privacy Act of 2012)
 *   GET /terms          booking terms, built from the live booking settings
 *   GET /.well-known/security.txt   where to report a security problem
 */
'use strict';

const express = require('express');
const db      = require('../../../config/database');
const { publicSettings } = require('../../../utils/publicSettings');
const stay    = require('../../stay/routes');

const router = express.Router();
const UPDATED = '2026-10-28';   // change when the policy text below changes

function baseUrl(req) {
  const configured = (process.env.APP_URL || '').replace(/\/+$/, '');
  if (configured && !/\/\/(localhost|127\.0\.0\.1)/i.test(configured)) return configured;
  return `${req.protocol}://${req.get('host')}`;
}

router.get('/robots.txt', (req, res) => {
  res.type('text/plain').set('Cache-Control', 'public, max-age=86400').send([
    'User-agent: *',
    'Allow: /',
    // Back office, accounts and one-off links: nothing for a search engine there.
    ...['/dashboard', '/reservations', '/guests', '/payments', '/rooms', '/venues', '/cottages', '/events', '/packages',
        '/inventory', '/crm', '/inquiries', '/feedback', '/reports', '/analytics', '/users', '/settings', '/profile',
        '/notifications', '/checkin', '/arrive', '/auth', '/portal/my-reservations', '/portal/notifications',
        '/portal/profile', '/portal/book'].map(p => 'Disallow: ' + p),
    '',
    `Sitemap: ${baseUrl(req)}/sitemap.xml`,
    '',
  ].join('\n'));
});

router.get('/sitemap.xml', async (req, res) => {
  const base = baseUrl(req);
  const urls = [
    ['/', 'daily', '1.0'], ['/portal/rooms', 'daily', '0.9'], ['/portal/cottages', 'daily', '0.9'],
    ['/portal/venues', 'daily', '0.9'], ['/portal/calendar', 'daily', '0.7'], ['/portal/inquire', 'monthly', '0.5'],
    ['/privacy', 'yearly', '0.3'], ['/terms', 'yearly', '0.3'],
  ].map(([path, freq, pri]) => ({ loc: base + path, freq, pri }));
  const lists = [
    ['room', 'SELECT id, updated_at FROM rooms WHERE is_active = 1'],
    ['cottage', 'SELECT id, updated_at FROM cottages WHERE is_active = 1'],
    ['venue', 'SELECT id, updated_at FROM venues WHERE is_active = 1'],
    ['package', 'SELECT id, updated_at FROM event_packages WHERE is_active = 1'],
  ];
  for (const [kind, sql] of lists) {
    for (const r of await db.prepare(sql).all()) {
      urls.push({ loc: `${base}/stay/${kind}/${r.id}`, freq: 'weekly', pri: '0.8', mod: r.updated_at ? String(r.updated_at).slice(0, 10) : null });
    }
  }
  const xml = '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
    urls.map(u => `  <url><loc>${u.loc}</loc>${u.mod ? `<lastmod>${u.mod}</lastmod>` : ''}<changefreq>${u.freq}</changefreq><priority>${u.pri}</priority></url>`).join('\n') +
    '\n</urlset>\n';
  res.type('application/xml').set('Cache-Control', 'public, max-age=3600').send(xml);
});

router.get('/.well-known/security.txt', async (req, res) => {
  const site = publicSettings(await stay.siteSettings());
  const contact = site.resort_email ? `mailto:${site.resort_email}` : `${baseUrl(req)}/portal/inquire`;
  const expires = new Date(Date.now() + 365 * 86400000).toISOString().slice(0, 10) + 'T00:00:00.000Z';
  res.type('text/plain').send(`Contact: ${contact}\nExpires: ${expires}\nPreferred-Languages: en, fil\nCanonical: ${baseUrl(req)}/.well-known/security.txt\n`);
});

async function legalPage(req, res, view, title, metaDescription) {
  const settings = await stay.siteSettings();
  const site = publicSettings(settings);
  res.render('site/' + view, {
    title: `${title} – Balai-Reserve`, layout: 'layouts/landing',
    site, fmtTime: stay.fmtTime, updated: UPDATED, metaDescription,
    ...(await stay.layoutData(settings)),
  });
}
router.get('/privacy', (req, res) => legalPage(req, res, 'privacy', 'Privacy policy',
  'How Balai-Reserve, a beach resort in Gloria, Oriental Mindoro, collects, uses and protects guest information.'));
router.get('/terms', (req, res) => legalPage(req, res, 'terms', 'Booking terms',
  'Booking terms at Balai-Reserve, Gloria, Oriental Mindoro: downpayment, balance, check-in and check-out times, cancellations and event packages.'));

module.exports = router;
