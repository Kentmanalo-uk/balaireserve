/**
 * Email through Resend (https://resend.com) — every in-app notification is also sent to the
 * recipient's inbox (src/utils/notifications.js).
 *
 * Settings (environment variables; locally they can live in resend.env, which is not committed):
 *   RESEND_API_KEY   the API key (a "sending access" key is enough)
 *   MAIL_FROM        sender. Default "Balai-Reserve <no-reply@<the site's domain>>" (the domain from APP_URL,
 *                    which must be verified in Resend — balairesort.site is). On localhost the Resend test
 *                    sender is used, which can only email the Resend account's own address.
 *   MAIL_SKIP_DOMAINS  never email these domains (comma-separated). Default "balai.com": the seeded staff
 *                    accounts use it, and it is someone else's domain.
 *   MAIL_MODE        "live" sends to everyone; "dev" sends only to MAIL_DEV_ALLOW (comma-separated) and logs
 *                    the rest. Default: dev only when APP_URL is a localhost / home-network address (so local
 *                    testing never emails real guests), live otherwise.
 * Sending never blocks or breaks a page: mail goes out in the background. Every attempt — sent, failed or
 * skipped, with the reason — is recorded in email_log and shown on Settings → Email (/settings/email).
 */
'use strict';

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '..', 'resend.env') });   // never overrides real env vars
const db = require('../config/database');

const API = 'https://api.resend.com/emails';
const RESERVED = /@(?:[^@]+\.)?(example\.(?:com|org|net)|example|test|invalid|localhost|local)$/i;
const LOCAL_URL = /\/\/(localhost|127\.0\.0\.1|\[::1\]|192\.168\.\d+\.\d+|10\.\d+\.\d+\.\d+)(:|\/|$)/i;
const SITE_URL = 'https://balairesort.site';   // the public address when APP_URL isn't set

function settings() {
  const configured = (process.env.APP_URL || '').replace(/\/+$/, '');
  const isLocal = !!configured && LOCAL_URL.test(configured);
  const appUrl = configured || SITE_URL;
  let domain = '';
  try { domain = new URL(appUrl).hostname.replace(/^www\./, ''); } catch {}
  return {
    key: process.env.RESEND_API_KEY || '',
    from: process.env.MAIL_FROM || (isLocal || !domain ? 'Balai-Reserve <onboarding@resend.dev>' : `Balai-Reserve <no-reply@${domain}>`),
    mode: (process.env.MAIL_MODE || (isLocal ? 'dev' : 'live')).toLowerCase(),
    skip: (process.env.MAIL_SKIP_DOMAINS == null ? 'balai.com' : process.env.MAIL_SKIP_DOMAINS).split(',').map(s => s.trim().toLowerCase()).filter(Boolean),
    allow: (process.env.MAIL_DEV_ALLOW || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean),
    appUrl,
  };
}

// One row per attempt, for Settings → Email. Never lets a logging problem affect sending.
function record(to, subject, status, detail) {
  db.prepare('INSERT INTO email_log (to_address, subject, status, detail) VALUES (?, ?, ?, ?)')
    .run(String(to || '').slice(0, 255), String(subject || '').slice(0, 255), status, detail ? String(detail).slice(0, 500) : null)
    .catch(() => {});
  return { ok: status === 'sent', [status === 'sent' ? 'id' : status === 'failed' ? 'error' : 'skipped']: detail };
}

const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// Emails never use em dashes: notification text written elsewhere in the app is tidied on the way out
// ("Balance due: ₱500 — collect it" → "Balance due: ₱500, collect it"). En dashes in date ranges stay.
const tidy = s => String(s == null ? '' : s).replace(/\s*—\s*/g, ', ').replace(/,\s*,/g, ',').replace(/^,\s*/, '');

const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";
const SERIF = "Georgia,'Times New Roman',serif";
const C = { page: '#f3f0e9', card: '#ffffff', line: '#e8e3d8', ink: '#13292d', text: '#33464a', muted: '#6f7d80', brand: '#0f5c66', brandDark: '#0b4850', sand: '#faf8f3' };

/**
 * A notification as a clean, branded email. Built with tables and inline styles so it looks the same in
 * Gmail, Outlook and phone mail apps. buttonText / note: account emails use their own label and note.
 * contact: the resort's public phone / email / address for the footer (see mailNotification).
 */
function renderNotification({ title, message, link, name, buttonText = 'View in Balai-Reserve', note, contact = {} }) {
  const s = settings();
  const url = link ? (/^https?:\/\//i.test(link) ? link : s.appUrl + (link.startsWith('/') ? link : '/' + link)) : '';
  title = tidy(title); message = tidy(message); note = note ? tidy(note) : '';
  const hello = name ? `Hi ${tidy(name)},` : 'Hello,';
  const foot = note || 'You’re receiving this because you have an account or a booking at Balai-Reserve. You’ll also find this message in your notifications when you sign in.';
  const paras = message.split(/\n+/).map(p => p.trim()).filter(Boolean);
  const preview = paras[0] || title;
  const year = new Date().getFullYear();
  const contactBits = [contact.phone, contact.email].filter(Boolean);
  const address = contact.address || 'Brgy. San Antonio, Gloria, Oriental Mindoro, Philippines';

  const text = [
    hello, '', title, '', ...paras.flatMap(p => [p, '']),
    url ? `${buttonText}: ${url}` : '', url ? '' : null,
    foot, '', 'Balai-Reserve', address, contactBits.join(' · '), s.appUrl,
  ].filter(l => l !== null).join('\n').replace(/\n{3,}/g, '\n\n').trim();

  const button = url ? `
          <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:28px 0 0;">
            <tr><td align="center" bgcolor="${C.brand}" style="border-radius:10px;background:${C.brand};">
              <a href="${esc(url)}" target="_blank" style="display:inline-block;padding:14px 30px;font-family:${FONT};font-size:15px;font-weight:600;line-height:1.2;color:#ffffff;text-decoration:none;border-radius:10px;">${esc(buttonText)}</a>
            </td></tr>
          </table>
          <p style="margin:18px 0 0;font-family:${FONT};font-size:12px;line-height:1.6;color:${C.muted};">Button not working? Copy this link into your browser:<br><a href="${esc(url)}" target="_blank" style="color:${C.brand};text-decoration:underline;word-break:break-all;">${esc(url)}</a></p>` : '';

  const html = `<!doctype html>
<html lang="en" xmlns="http://www.w3.org/1999/xhtml">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light">
<meta name="supported-color-schemes" content="light">
<title>${esc(title)}</title>
<style>
  body { margin: 0; padding: 0; -webkit-text-size-adjust: 100%; }
  a { color: ${C.brand}; }
  @media (max-width: 620px) {
    .wrap { padding: 20px 12px !important; }
    .card-body { padding: 28px 22px !important; }
    .card-foot { padding: 18px 22px 20px !important; }
    .title { font-size: 23px !important; }
  }
</style>
</head>
<body style="margin:0;padding:0;background:${C.page};">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;mso-hide:all;">${esc(preview)}&#8199;&#847;&#8199;&#847;&#8199;&#847;&#8199;&#847;&#8199;&#847;&#8199;&#847;</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${C.page};">
  <tr><td align="center" class="wrap" style="padding:36px 16px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;">

      <tr><td align="center" style="padding:0 0 22px;">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
          <td style="padding-right:12px;vertical-align:middle;"><img src="${esc(s.appUrl)}/images/brand/balai-icon-96.png" width="44" height="44" alt="" style="display:block;border:0;border-radius:50%;"></td>
          <td style="vertical-align:middle;">
            <div style="font-family:${SERIF};font-size:22px;font-weight:700;line-height:1.1;color:${C.ink};">Balai-Reserve</div>
            <div style="font-family:${FONT};font-size:11px;letter-spacing:1.4px;text-transform:uppercase;color:${C.muted};padding-top:3px;">Gloria, Oriental Mindoro</div>
          </td>
        </tr></table>
      </td></tr>

      <tr><td style="background:${C.card};border:1px solid ${C.line};border-radius:16px;overflow:hidden;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
          <tr><td height="5" bgcolor="${C.brand}" style="height:5px;line-height:5px;font-size:0;background:${C.brand};">&nbsp;</td></tr>
          <tr><td class="card-body" style="padding:40px 44px 38px;">
            <p style="margin:0 0 10px;font-family:${FONT};font-size:15px;line-height:1.5;color:${C.muted};">${esc(hello)}</p>
            <h1 class="title" style="margin:0 0 18px;font-family:${SERIF};font-size:27px;font-weight:700;line-height:1.25;color:${C.ink};">${esc(title)}</h1>
            ${paras.map(p => `<p style="margin:0 0 14px;font-family:${FONT};font-size:16px;line-height:1.65;color:${C.text};">${esc(p)}</p>`).join('\n            ')}
            ${button}
          </td></tr>
          <tr><td class="card-foot" style="padding:20px 44px 24px;background:${C.sand};border-top:1px solid ${C.line};font-family:${FONT};font-size:13px;line-height:1.6;color:${C.muted};">${esc(foot)}</td></tr>
        </table>
      </td></tr>

      <tr><td align="center" style="padding:26px 12px 0;font-family:${FONT};font-size:12px;line-height:1.7;color:${C.muted};">
        <div style="font-weight:600;color:${C.text};">Balai-Reserve</div>
        <div>${esc(address)}</div>
        ${contactBits.length ? `<div>${contactBits.map(esc).join(' &nbsp;·&nbsp; ')}</div>` : ''}
        <div style="padding-top:10px;">
          <a href="${esc(s.appUrl)}/" target="_blank" style="color:${C.brand};text-decoration:none;">Website</a> &nbsp;·&nbsp;
          <a href="${esc(s.appUrl)}/portal/my-reservations" target="_blank" style="color:${C.brand};text-decoration:none;">My reservations</a> &nbsp;·&nbsp;
          <a href="${esc(s.appUrl)}/privacy" target="_blank" style="color:${C.brand};text-decoration:none;">Privacy</a>
        </div>
        <div style="padding-top:10px;color:#9aa5a7;">&copy; ${year} Balai-Reserve. All rights reserved.</div>
      </td></tr>

    </table>
  </td></tr>
</table>
</body>
</html>`;
  return { html, text };
}

// The resort's public contact details for the email footer and Reply-To (cached for 5 minutes).
let contactCache = { at: 0, value: {} };
async function resortContact() {
  if (Date.now() - contactCache.at < 300000) return contactCache.value;
  try {
    const { publicSettings } = require('./publicSettings');
    const rows = await db.prepare("SELECT `key`, value FROM settings WHERE `key` IN ('resort_phone','resort_email','resort_address')").all();
    const site = publicSettings(Object.fromEntries(rows.map(r => [r.key, r.value])));
    contactCache = { at: Date.now(), value: { phone: site.resort_phone || '', email: site.resort_email || '', address: site.resort_address || '' } };
  } catch { /* keep the last value */ }
  return contactCache.value;
}

/**
 * Send one email in the background. Returns a promise that resolves to { ok, id?, skipped?, error? }
 * (callers don't need to wait for it).
 */
function sendMail({ to, subject, html, text, devLink, replyTo }) {
  const s = settings();
  const addr = String(to || '').trim();
  if (!addr || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(addr)) return Promise.resolve({ ok: false, skipped: 'no address' });
  if (RESERVED.test(addr)) return Promise.resolve({ ok: false, skipped: 'reserved test address' });   // test runs: not logged
  if (s.skip.includes(addr.split('@')[1].toLowerCase())) return Promise.resolve(record(addr, subject, 'skipped', 'placeholder domain (MAIL_SKIP_DOMAINS)'));
  if (!s.key) {
    console.error(`[mail] not sent to ${addr}: RESEND_API_KEY is not set`);
    return Promise.resolve(record(addr, subject, 'skipped', 'RESEND_API_KEY is not set on this server'));
  }
  if (s.mode !== 'live' && !s.allow.includes(addr.toLowerCase())) {
    console.log(`[mail] dev mode — not sent to ${addr}: ${subject}${devLink ? ' — link: ' + devLink : ''}`);
    return Promise.resolve(record(addr, subject, 'skipped', 'local dev mode (APP_URL is a local address)'));
  }
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 10000);
  return fetch(API, {
    method: 'POST',
    headers: { Authorization: `Bearer ${s.key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: s.from, to: [addr], subject, html, text, ...(replyTo ? { reply_to: replyTo } : {}) }),
    signal: ctrl.signal,
  }).then(async r => {
    const body = await r.json().catch(() => ({}));
    if (!r.ok) {
      const why = `Resend ${r.status}: ${body.message || body.name || 'error'}`;
      console.error(`[mail] not sent to ${addr} — ${why}`);
      return record(addr, subject, 'failed', why);
    }
    return record(addr, subject, 'sent', body.id || 'accepted by Resend');
  }).catch(err => {
    const why = err.name === 'AbortError' ? 'timed out reaching Resend' : err.message;
    console.error(`[mail] not sent to ${addr}: ${why}`);
    return record(addr, subject, 'failed', why);
  }).finally(() => clearTimeout(timer));
}

// For Settings → Email: how sending is set up on this server (never the key itself).
function status() {
  const s = settings();
  return { keySet: !!s.key, from: s.from, mode: s.mode, appUrl: s.appUrl, appUrlSet: !!process.env.APP_URL, skip: s.skip };
}

// Replies go to the resort's own address (Settings → General), not to the no-reply sender.
async function mailNotification({ to, name, title, message, link, buttonText, note, subject }) {
  const contact = await resortContact();
  const { html, text } = renderNotification({ title, message, link, name, buttonText, note, contact });
  return sendMail({
    to, subject: tidy(subject || `${title} | Balai-Reserve`), html, text, replyTo: contact.email || undefined,
    devLink: link && /^https?:/i.test(link) ? link : undefined,
  });
}

module.exports = { sendMail, mailNotification, renderNotification, settings, status };
