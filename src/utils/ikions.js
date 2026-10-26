/**
 * Ikions icons on every server-rendered page.
 *
 * Templates keep Font Awesome-style markup (<i class="fas fa-bed" aria-hidden="true"></i>). Before an
 * HTML page is sent, each such <i> gets the matching Ikions SVG from the sprite placed inside it, so
 * the <i> keeps its classes and every existing sizing/colour rule still applies. Inline <script>
 * blocks are left alone; icons that scripts add later are handled by public/js/ikions.js.
 * The mapping and sprite come from scripts/build-icons.js (npm run build:icons).
 */
'use strict';
const { sprite, map, filledWhenSolid } = require('./ikions-map.json');

const FILLED = new Set(filledWhenSolid);
const ICON_TAG = /<i(\s[^>]*?)?\sclass="([^"]*\bfa-[^"]*)"([^>]*)>\s*<\/i>/g;

function symbolId(classes) {
  const list = classes.split(/\s+/);
  const name = list.find(c => c.startsWith('fa-') && map[c.slice(3)]);
  if (!name) return null;
  const target = map[name.slice(3)];
  const solid = list.includes('fas') || list.includes('fa-solid');
  return 'i-' + target + (solid && FILLED.has(target) ? '-f' : '');
}

function iconizeFragment(html) {
  return html.replace(ICON_TAG, (whole, before = '', classes, after) => {
    const id = symbolId(classes);
    if (!id) return whole;
    return `<i${before} class="${classes} ik"${after}><svg class="ik-svg" aria-hidden="true" focusable="false" data-ik="${id}"><use href="${sprite}#${id}"/></svg></i>`;
  });
}

// Convert outside <script>…</script> only (icons inside JS strings are converted in the browser).
function iconizeHtml(html) {
  if (html.indexOf('fa-') === -1) return html;
  const parts = html.split(/(<script\b[\s\S]*?<\/script>)/i);
  for (let i = 0; i < parts.length; i += 2) parts[i] = iconizeFragment(parts[i]);
  return parts.join('');
}

// Express middleware: wrap res.send so HTML responses are converted once, just before sending.
function ikionsMiddleware(req, res, next) {
  const send = res.send;
  res.send = function (body) {
    if (typeof body === 'string' && /html/i.test(String(this.get('Content-Type') || 'text/html')) && body.indexOf('fa-') !== -1) {
      body = iconizeHtml(body);
    }
    return send.call(this, body);
  };
  next();
}

module.exports = { iconizeHtml, ikionsMiddleware, sprite };
