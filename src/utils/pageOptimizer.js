/**
 * Lighter pages, applied to every HTML response just before it is sent:
 *  - Photos (<img src="/uploads/…" | "/images/landing/…">) get a srcset of resized WebP copies
 *    (src/utils/images.js), so phones download a few hundred KB instead of several MB. A template can
 *    set `sizes` for its layout; without one the photo is assumed to be as wide as the screen.
 *  - Images without a loading attribute are lazy-loaded (except the page's priority image).
 *  - Our own CSS and JS links get ?v=<content hash>, so browsers and the CDN can keep them for a year
 *    and still get the new file right after a deploy.
 * Inline <script> blocks are left alone.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { isResizable, srcsetFor, resizedUrl } = require('./images');

const PUBLIC = path.join(__dirname, '..', '..', 'public');
const versions = new Map();   // '/css/x.css' → { mtimeMs, v }

function assetVersion(url) {
  const file = path.join(PUBLIC, url);
  if (!file.startsWith(PUBLIC + path.sep)) return null;
  let st;
  try { st = fs.statSync(file); } catch { return null; }
  const known = versions.get(url);
  if (known && known.mtimeMs === st.mtimeMs) return known.v;
  const v = crypto.createHash('sha1').update(fs.readFileSync(file)).digest('hex').slice(0, 10);
  versions.set(url, { mtimeMs: st.mtimeMs, v });
  return v;
}

const attr = (tag, name) => { const m = new RegExp(`\\s${name}="([^"]*)"`, 'i').exec(tag); return m ? m[1] : null; };

// data-maxw="800" caps the widths offered (small cards); data-src marks a photo a script loads later
// (e.g. hidden carousel slides): it gets data-srcset, and the script copies both over when needed.
function optimizeImg(tag) {
  const deferred = !attr(tag, 'src') && attr(tag, 'data-src');
  const src = attr(tag, 'src') || attr(tag, 'data-src');
  let out = tag;
  if (src && !attr(tag, 'srcset') && !attr(tag, 'data-srcset') && /^\/(uploads|images\/landing)\//.test(src) && isResizable(src)) {
    const maxw = Number(attr(tag, 'data-maxw')) || 1600;
    const widths = [480, 800, 1200, 1600].filter(w => w <= maxw);
    const fallback = resizedUrl(src, Math.min(1200, widths[widths.length - 1]));
    const sizes = attr(tag, 'sizes') ? '' : ' sizes="100vw"';
    out = deferred
      ? out.replace(/\sdata-src="[^"]*"/i, ` data-src="${fallback}" data-srcset="${srcsetFor(src, widths)}"` + sizes)
      : out.replace(/\ssrc="[^"]*"/i, ` src="${fallback}" srcset="${srcsetFor(src, widths)}"` + sizes);
  }
  const priority = /\sfetchpriority="high"/i.test(out) || /^\/images\/brand\//.test(src || '');   // the logo is always on screen
  if (!priority && !/\sloading=/i.test(out)) out = out.replace(/^<img\b/i, '<img loading="lazy"');
  if (!/\sdecoding=/i.test(out)) out = out.replace(/^<img\b/i, '<img decoding="async"');
  return out;
}

function optimizeFragment(html) {
  return html
    .replace(/<img\b[^>]*>/gi, optimizeImg)
    .replace(/(<(?:link|script)\b[^>]*?\s(?:href|src)=")(\/(?:css|js)\/[\w./-]+\.(?:css|js))(")/gi, (whole, a, url, b) => {
      const v = assetVersion(url);
      return v ? `${a}${url}?v=${v}${b}` : whole;
    });
}

function optimizeHtml(html) {
  const parts = html.split(/(<script\b[^>]*>[\s\S]*?<\/script>)/i);
  for (let i = 0; i < parts.length; i++) {
    if (i % 2 === 0) parts[i] = optimizeFragment(parts[i]);
    else parts[i] = parts[i].replace(/^<script\b[^>]*>/i, open => optimizeFragment(open));   // external script src only
  }
  return parts.join('');
}

function pageOptimizerMiddleware(req, res, next) {
  const send = res.send;
  res.send = function (body) {
    if (typeof body === 'string' && /html/i.test(String(this.get('Content-Type') || 'text/html')) && /<(img|link|script)\b/i.test(body)) {
      body = optimizeHtml(body);
    }
    return send.call(this, body);
  };
  next();
}

module.exports = { optimizeHtml, pageOptimizerMiddleware, assetVersion };
