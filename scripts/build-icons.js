/**
 * Balai-Reserve — build the Ikions icon assets (run: npm run build:icons)
 *
 * The app's markup keeps Font Awesome-style class names (<i class="fas fa-bed">); this script maps
 * each one to an Ikions icon (@ikions/icons) and writes:
 *   public/images/icons/ikions.svg        sprite with only the icons the app uses (outline + a few filled)
 *   public/images/icons/<name>.svg        single icons for CSS masks (see MASK_ICONS)
 *   src/utils/ikions-map.json             the mapping + sprite URL, used by the server (src/utils/ikions.js)
 *   public/js/ikions.js                   browser shim for icons added by scripts (same mapping)
 *
 * Ikions License: free for commercial use inside this project, no attribution required; the icons
 * may not be redistributed on their own, which is why the sprite holds only what the app uses.
 * Facebook and Google logos are Font Awesome Free brand icons (CC BY 4.0), as Ikions has no brands.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { toSvg, isIconName } = require('@ikions/icons');

const ROOT = path.join(__dirname, '..');

// Font Awesome name (without "fa-") → Ikions name. Aliases of the same FA icon share a target.
const MAP = {
  'address-book': 'address-book', 'angles-left': 'chevrons-left', archive: 'archive', 'arrow-down': 'arrow-down',
  'arrow-left': 'arrow-left', 'arrow-right': 'arrow-right', 'arrow-right-from-bracket': 'log-out', 'arrow-up': 'arrow-up',
  'arrow-up-right-from-square': 'external-link', ban: 'ban', bars: 'menu', bed: 'bed', bell: 'bell',
  'box-archive': 'archive-box', boxes: 'boxes', 'boxes-stacked': 'boxes', broom: 'sparkles', building: 'building',
  'building-columns': 'bank', calculator: 'calculator', calendar: 'calendar', 'calendar-alt': 'calendar',
  'calendar-check': 'calendar-check', 'calendar-days': 'calendar', 'calendar-plus': 'calendar-plus',
  'calendar-times': 'calendar-x', 'calendar-xmark': 'calendar-x', camera: 'camera', 'cash-register': 'cash-register',
  'champagne-glasses': 'champagne', 'chart-bar': 'bar-chart', 'chart-line': 'line-chart', 'chart-pie': 'pie-chart',
  check: 'check', 'check-circle': 'success', 'chevron-down': 'chevron-down', 'chevron-left': 'chevron-left',
  'chevron-right': 'chevron-right', circle: 'circle', 'circle-check': 'success', 'circle-exclamation': 'error',
  'circle-info': 'info', 'circle-user': 'user-circle', 'circle-xmark': 'error', clock: 'clock',
  'cloud-arrow-up': 'cloud-upload', 'cloud-upload-alt': 'cloud-upload', coins: 'coins', comment: 'comment',
  'comment-dots': 'chat-dots', copy: 'copy', 'credit-card': 'credit-card', crown: 'diamond-value',
  'diamond-turn-right': 'direction-sign', 'door-open': 'log-out', download: 'download', envelope: 'mail',
  'exclamation-circle': 'error', 'exclamation-triangle': 'warning', expand: 'arrows-maximize', 'external-link-alt': 'external-link', eye: 'eye',
  'eye-slash': 'eye-off', 'file-csv': 'file-csv', 'file-excel': 'file-spreadsheet', 'file-lines': 'file-text',
  'file-pdf': 'file-pdf', 'file-word': 'file-text', 'floppy-disk': 'save', gauge: 'speedometer',
  'gauge-high': 'speedometer', gear: 'settings', 'hand-holding-dollar': 'payment', 'heart-crack': 'heart-off',
  history: 'history', 'hourglass-half': 'hourglass', house: 'home', image: 'image', images: 'images', inbox: 'inbox',
  'info-circle': 'info', lightbulb: 'lightbulb', list: 'list', 'location-dot': 'map-pin', lock: 'lock',
  'magnifying-glass': 'search', 'magnifying-glass-plus': 'zoom-in', minus: 'minus', 'money-bill-wave': 'banknote',
  moon: 'moon', 'paper-plane': 'send', pause: 'pause', 'pause-circle': 'circle-pause', pen: 'edit', pencil: 'edit',
  'people-roof': 'users-round', 'peso-sign': 'banknote', phone: 'phone', play: 'play', plus: 'plus', print: 'printer',
  qrcode: 'qr-code', 'question-circle': 'help', receipt: 'receipt', reply: 'reply', 'right-from-bracket': 'log-out',
  'right-to-bracket': 'log-in', robot: 'robot', 'rotate-left': 'rotate-ccw', 'rotate-right': 'rotate-cw', save: 'save',
  'screwdriver-wrench': 'wrench', search: 'search', 'search-plus': 'zoom-in', 'sign-in-alt': 'log-in', sliders: 'sliders',
  star: 'star', 'star-half-alt': 'star-half', 'star-half-stroke': 'star-half', 'suitcase-rolling': 'suitcase-rolling',
  sun: 'sun', tag: 'tag', ticket: 'ticket', times: 'close', tools: 'toolbox', 'trash-alt': 'trash', 'trash-can': 'trash',
  'triangle-exclamation': 'warning', 'umbrella-beach': 'beach-umbrella', undo: 'undo', upload: 'upload',
  'user-check': 'user-check', 'user-group': 'users-round', 'user-plus': 'user-add', 'user-tie': 'employee',
  users: 'users', 'users-gear': 'users-settings', wallet: 'wallet', xmark: 'close',
  // brands
  facebook: 'brand-facebook', 'facebook-f': 'brand-facebook-f', google: 'brand-google',
};
// Shown filled when written as "fas" (solid); everything else uses the Ikions outline style.
const FILLED_WHEN_SOLID = ['star', 'circle'];
// Single files for CSS mask-image icons (pseudo-elements can't use the sprite).
const MASK_ICONS = ['info', 'error', 'chevron-down', 'calendar'];

// Font Awesome Free 6.5.0 brand paths (CC BY 4.0, https://fontawesome.com/license/free).
const BRANDS = {
  'brand-facebook': { viewBox: '0 0 512 512', d: 'M512 256C512 114.6 397.4 0 256 0S0 114.6 0 256C0 376 82.7 476.8 194.2 504.5V334.2H141.4V256h52.8V222.3c0-87.1 39.4-127.5 125-127.5c16.2 0 44.2 3.2 55.7 6.4V172c-6-.6-16.5-1-29.6-1c-42 0-58.2 15.9-58.2 57.2V256h83.6l-14.4 78.2H287V510.1C413.8 494.8 512 386.9 512 256h0z' },
  'brand-facebook-f': { viewBox: '0 0 320 512', d: 'M80 299.3V512H196V299.3h86.5l18-97.8H196V166.9c0-51.7 20.3-71.5 72.7-71.5c16.3 0 29.4 .4 37 1.2V7.9C291.4 4 256.4 0 236.2 0C129.3 0 80 50.5 80 159.4v42.1H14v97.8H80z' },
  'brand-google': { viewBox: '0 0 488 512', d: 'M488 261.8C488 403.3 391.1 504 248 504 110.8 504 0 393.2 0 256S110.8 8 248 8c66.8 0 123 24.5 166.3 64.9l-67.5 64.9C258.5 52.6 94.3 116.6 94.3 256c0 86.5 69.1 156.6 153.7 156.6 98.2 0 135-70.4 141.8-106.9H248v-85.3h236.1c2.3 12.7 3.9 24.9 3.9 41.4z' },
};

// One sprite symbol from an Ikions SVG string: outer <svg> attributes move to a <g> inside the symbol.
function symbolFrom(id, svg) {
  const m = /^<svg\b([^>]*)>([\s\S]*)<\/svg>\s*$/.exec(svg.trim());
  if (!m) throw new Error('Unexpected SVG for ' + id);
  const keep = [];
  let viewBox = '0 0 24 24';
  for (const a of m[1].matchAll(/([\w:-]+)="([^"]*)"/g)) {
    if (a[1] === 'viewBox') viewBox = a[2];
    else if (!['xmlns', 'width', 'height', 'class', 'color', 'aria-hidden', 'data-variant'].includes(a[1])) keep.push(`${a[1]}="${a[2]}"`);
  }
  return `<symbol id="${id}" viewBox="${viewBox}"><g ${keep.join(' ')}>${m[2].trim()}</g></symbol>`;
}

function main() {
  const missing = Object.values(MAP).filter(n => !n.startsWith('brand-') && n !== 'star-half' && !isIconName(n));
  if (missing.length) throw new Error('Not in @ikions/icons: ' + missing.join(', '));

  const symbols = [];
  const outline = [...new Set(Object.values(MAP).filter(n => !n.startsWith('brand-') && n !== 'star-half'))].sort();
  for (const n of outline) symbols.push(symbolFrom('i-' + n, toSvg(n, 'outline')));
  for (const n of FILLED_WHEN_SOLID) symbols.push(symbolFrom('i-' + n + '-f', toSvg(n, 'filled')));
  // Half star for ratings: the outline star with the filled star clipped to its left half.
  const starFilled = /<svg\b[^>]*>([\s\S]*)<\/svg>/.exec(toSvg('star', 'filled'))[1].trim();
  const starOutline = /<svg\b([^>]*)>([\s\S]*)<\/svg>/.exec(toSvg('star', 'outline'));
  const outlineAttrs = [...starOutline[1].matchAll(/([\w:-]+)="([^"]*)"/g)].filter(a => !['xmlns', 'width', 'height', 'class', 'color', 'viewBox'].includes(a[1])).map(a => `${a[1]}="${a[2]}"`).join(' ');
  symbols.push(`<symbol id="i-star-half" viewBox="0 0 24 24"><clipPath id="i-star-half-clip"><rect x="0" y="0" width="12" height="24"/></clipPath><g ${outlineAttrs}>${starOutline[2].trim()}</g><g fill="currentColor" clip-path="url(#i-star-half-clip)">${starFilled}</g></symbol>`);
  for (const [id, b] of Object.entries(BRANDS)) symbols.push(`<symbol id="i-${id}" viewBox="${b.viewBox}"><path fill="currentColor" d="${b.d}"/></symbol>`);

  const sprite = `<svg xmlns="http://www.w3.org/2000/svg">\n<!-- Ikions icons (ikions.cloud) used by Balai-Reserve under the Ikions License; brand logos: Font Awesome Free 6.5.0, CC BY 4.0. Generated by scripts/build-icons.js -->\n${symbols.join('\n')}\n</svg>\n`;
  const outDir = path.join(ROOT, 'public', 'images', 'icons');
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, 'ikions.svg'), sprite);
  const hash = crypto.createHash('sha1').update(sprite).digest('hex').slice(0, 10);
  for (const n of MASK_ICONS) fs.writeFileSync(path.join(outDir, n + '.svg'), toSvg(n, 'outline').replace(/ (class|color|aria-hidden|data-variant)="[^"]*"/g, '') + '\n');

  const data = { sprite: `/images/icons/ikions.svg?v=${hash}`, map: MAP, filledWhenSolid: FILLED_WHEN_SOLID };
  fs.writeFileSync(path.join(ROOT, 'src', 'utils', 'ikions-map.json'), JSON.stringify(data, null, 2) + '\n');

  const shim = `/* Generated by scripts/build-icons.js — do not edit. Ikions icons for markup added or changed by scripts
   (the server already converts icons in the page; see src/utils/ikions.js). */
(function () {
  'use strict';
  var SPRITE = ${JSON.stringify(data.sprite)};
  var MAP = ${JSON.stringify(MAP)};
  var FILLED = ${JSON.stringify(FILLED_WHEN_SOLID)};
  var NS = 'http://www.w3.org/2000/svg';
  function symbolFor(el) {
    var cls = el.classList, name = null;
    for (var i = 0; i < cls.length; i++) { var c = cls[i]; if (c.indexOf('fa-') === 0 && MAP[c.slice(3)]) { name = c.slice(3); break; } }
    if (!name) return null;
    var target = MAP[name];
    var solid = cls.contains('fas') || cls.contains('fa-solid');
    return 'i-' + target + (solid && FILLED.indexOf(target) !== -1 ? '-f' : '');
  }
  function render(el) {
    var id = symbolFor(el);
    if (!id) return;
    var svg = el.firstElementChild;
    if (svg && svg.getAttribute('data-ik') === id) return;
    if (!svg || svg.tagName.toLowerCase() !== 'svg') {
      svg = document.createElementNS(NS, 'svg');
      svg.setAttribute('class', 'ik-svg'); svg.setAttribute('aria-hidden', 'true'); svg.setAttribute('focusable', 'false');
      svg.appendChild(document.createElementNS(NS, 'use'));
      el.textContent = '';
      el.appendChild(svg);
    }
    svg.setAttribute('data-ik', id);
    svg.firstChild.setAttribute('href', SPRITE + '#' + id);
    el.classList.add('ik');
  }
  function scan(root) {
    if (root.nodeType !== 1) return;
    if (root.tagName === 'I') render(root);
    var list = root.querySelectorAll('i[class*="fa-"]');
    for (var i = 0; i < list.length; i++) render(list[i]);
  }
  window.ikionsRender = scan;
  scan(document.documentElement);
  new MutationObserver(function (records) {
    records.forEach(function (r) {
      if (r.type === 'attributes') { if (r.target.tagName === 'I') render(r.target); return; }
      r.addedNodes.forEach(scan);
    });
  }).observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });
})();
`;
  fs.writeFileSync(path.join(ROOT, 'public', 'js', 'ikions.js'), shim);
  console.log(`ikions: ${symbols.length} symbols, sprite ${(sprite.length / 1024).toFixed(1)} KB (${data.sprite}), ${Object.keys(MAP).length} names mapped`);
}

main();
