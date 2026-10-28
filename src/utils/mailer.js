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

// Notification → a simple, readable email (table layout + inline styles so mail apps render it).
// buttonText / note: account emails (verify, reset) use their own button label and closing note.
function renderNotification({ title, message, link, name, buttonText = 'Open in Balai-Reserve', note }) {
  const s = settings();
  const url = link ? (/^https?:\/\//i.test(link) ? link : s.appUrl + (link.startsWith('/') ? link : '/' + link)) : '';
  const hello = name ? `Hi ${name},` : 'Hello,';
  const foot = note || 'You’re getting this because you have an account or a booking at Balai-Reserve. The same message is in your notifications when you sign in.';
  const text = [hello, '', title, '', message, url ? `\n${buttonText}: ${url}` : '', '', foot, '', '— Balai-Reserve, Gloria, Oriental Mindoro'].join('\n');
  const html = `<!doctype html><html><body style="margin:0;padding:0;background:#f4f2ec;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f2ec;padding:24px 12px;font-family:Segoe UI,Roboto,Helvetica,Arial,sans-serif;">
<tr><td align="center">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:14px;overflow:hidden;border:1px solid #e6e2d8;">
    <tr><td style="background:#10282c;padding:18px 24px;color:#ffffff;font-size:18px;font-weight:700;letter-spacing:.2px;">Balai-Reserve<div style="font-size:12px;font-weight:400;color:#b9d3d0;margin-top:2px;">Gloria, Oriental Mindoro</div></td></tr>
    <tr><td style="padding:24px;color:#1d2b2e;font-size:15px;line-height:1.55;">
      <p style="margin:0 0 12px;">${esc(hello)}</p>
      <h1 style="margin:0 0 10px;font-size:20px;line-height:1.3;color:#10282c;">${esc(title)}</h1>
      <p style="margin:0 0 18px;white-space:pre-line;">${esc(message)}</p>
      ${url ? `<p style="margin:0 0 6px;"><a href="${esc(url)}" style="display:inline-block;background:#0f5c66;color:#ffffff;text-decoration:none;font-weight:600;padding:11px 20px;border-radius:9px;">${esc(buttonText)}</a></p>
      <p style="margin:10px 0 0;font-size:12px;color:#6b7a7d;">Or copy this link: ${esc(url)}</p>` : ''}
    </td></tr>
    <tr><td style="padding:14px 24px;background:#faf9f6;color:#6b7a7d;font-size:12px;line-height:1.5;border-top:1px solid #eeeae0;">${esc(foot)}</td></tr>
  </table>
</td></tr></table></body></html>`;
  return { html, text };
}

/**
 * Send one email in the background. Returns a promise that resolves to { ok, id?, skipped?, error? }
 * (callers don't need to wait for it).
 */
function sendMail({ to, subject, html, text, devLink }) {
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
    body: JSON.stringify({ from: s.from, to: [addr], subject, html, text }),
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

function mailNotification({ to, name, title, message, link, buttonText, note, subject }) {
  const { html, text } = renderNotification({ title, message, link, name, buttonText, note });
  return sendMail({ to, subject: subject || `${title} — Balai-Reserve`, html, text, devLink: link && /^https?:/i.test(link) ? link : undefined });
}

module.exports = { sendMail, mailNotification, renderNotification, settings, status };
