/**
 * Balai-Reserve — "Around the resort" photo stack.
 * Clicking a gallery photo flies it from where it sits to the centre of the screen, with the
 * other photos stacked behind it like prints. Next swings the front photo aside and tucks it in
 * at the back while the pile steps forward; Previous pulls the last photo back to the front.
 * Drag or flick the front photo (the one behind rises as you pull), use the arrow keys or the
 * buttons; Esc, the × or the backdrop closes it, flying the photo back to its place.
 * Motion runs on the Web Animations API with spring easing and can be interrupted at any time.
 * Only the homepage gallery (#gallery) uses this; detail pages keep the standard photo viewer.
 */
(function () {
  'use strict';

  var host = document.querySelector('#gallery [data-photos]');
  if (!host || !window.matchMedia || !Element.prototype.animate) return;

  var photos = [];
  try { photos = JSON.parse(host.getAttribute('data-photos') || '[]'); } catch (e) { photos = []; }
  photos = photos.filter(function (p) { return p && p.src; });
  if (!photos.length) return;

  var reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var finePointer = window.matchMedia('(hover: hover) and (pointer: fine)').matches;
  // A gentle spring (about 2% overshoot); browsers without linear() get a soft ease-out.
  var SPRING = (window.CSS && CSS.supports && CSS.supports('animation-timing-function', 'linear(0, 1)'))
    ? 'linear(0, 0.006, 0.025 2.8%, 0.101 6.1%, 0.539 18.9%, 0.721 25.3%, 0.849 31.5%, 0.937 38.1%, 0.968 41.8%, 0.991 45.7%, 1.006 50.1%, 1.015 55%, 1.017 63.9%, 1.001)'
    : 'cubic-bezier(.2, .8, .2, 1)';
  var SWING = 'cubic-bezier(.3, .7, .25, 1)';
  var T = function (ms) { return reduce ? 1 : ms; };

  // Where each card sits in the pile: 0 is the front, the rest peek out above it.
  var SLOTS = [
    { x: 0,   y: 0,   r: 0,    s: 1,   b: 1 },
    { x: -22, y: -26, r: -4.5, s: .94, b: .84 },
    { x: 24,  y: -46, r: 4,    s: .88, b: .72 },
    { x: -12, y: -62, r: -2.5, s: .82, b: .6 },
  ];
  var DEPTH = SLOTS.length;
  function slot(d) { return SLOTS[Math.min(d, DEPTH - 1)]; }
  function tf(s) { return 'translate3d(' + s.x + 'px,' + s.y + 'px,0) rotate(' + s.r + 'deg) scale(' + s.s + ')'; }
  function lerpSlot(a, b, t) { return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, r: a.r + (b.r - a.r) * t, s: a.s + (b.s - a.s) * t, b: a.b + (b.b - a.b) * t }; }
  function stateFor(d) {
    var s = slot(d);
    return { transform: tf(s), filter: 'brightness(' + s.b + ')', opacity: d >= DEPTH ? '0' : '1', zIndex: String(100 - d) };
  }

  // ── Build the viewer once ────────────────────────────────────────────────
  var root = document.createElement('div');
  root.className = 'ps';
  root.hidden = true;
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-modal', 'true');
  root.setAttribute('aria-label', (host.getAttribute('data-photos-name') || 'Balai-Reserve') + ' photos');
  root.innerHTML =
    '<div class="ps-backdrop" data-ps-close></div>' +
    '<div class="ps-stage"></div>' +
    '<div class="ps-bar">' +
      '<button type="button" class="ps-btn ps-prev" aria-label="Previous photo"><i class="fas fa-arrow-left" aria-hidden="true"></i></button>' +
      '<div class="ps-info"><p class="ps-caption" aria-live="polite"></p><p class="ps-count"></p></div>' +
      '<button type="button" class="ps-btn ps-next" aria-label="Next photo"><i class="fas fa-arrow-right" aria-hidden="true"></i></button>' +
    '</div>' +
    '<button type="button" class="ps-btn ps-close" aria-label="Close photos" data-ps-close><i class="fas fa-xmark" aria-hidden="true"></i></button>';
  document.body.appendChild(root);

  var stage = root.querySelector('.ps-stage');
  var infoEl = root.querySelector('.ps-info');
  var capEl = root.querySelector('.ps-caption');
  var countEl = root.querySelector('.ps-count');
  var prevBtn = root.querySelector('.ps-prev');
  var nextBtn = root.querySelector('.ps-next');
  var closeBtn = root.querySelector('.ps-close');
  if (photos.length < 2) { prevBtn.hidden = true; nextBtn.hidden = true; }

  var cards = photos.map(function (p, i) {
    var c = document.createElement('figure');
    c.className = 'ps-card';
    c.setAttribute('data-i', i);
    c.innerHTML = '<div class="ps-inner"><img alt="" decoding="async" draggable="false"></div>';
    c.querySelector('img').alt = p.alt || p.caption || '';
    stage.appendChild(c);
    return c;
  });
  var loaded = {};
  function load(i) { if (!loaded[i]) { cards[i].querySelector('img').src = photos[i].src; loaded[i] = true; } }

  var order = [];                 // order[0] is the photo at the front
  var opener = null, openedIndex = 0, isOpen = false;

  // ── Animation bookkeeping: every run can be finished early by the next action ──
  var running = new Set();
  function apply(el, st) { for (var k in st) el.style[k] = st[k]; }
  function run(el, keyframes, opts, finalState) {
    var a = el.animate(keyframes, Object.assign({ fill: 'forwards' }, opts));
    a._done = function () { apply(el, finalState); };
    running.add(a);
    a.onfinish = function () { if (!running.has(a)) return; running.delete(a); a._done(); a.cancel(); };
    return a;
  }
  function settle() {
    running.forEach(function (a) { a._done(); a.cancel(); });
    running.clear();
  }
  function current(el) {
    var cs = getComputedStyle(el);
    return { transform: cs.transform === 'none' ? 'translate3d(0,0,0)' : cs.transform, filter: cs.filter === 'none' ? 'brightness(1)' : cs.filter, opacity: cs.opacity };
  }

  function sizeStage() {
    var vw = window.innerWidth, vh = window.innerHeight;
    var phone = vw < 640;
    var w = Math.min(vw * (phone ? .86 : .74), 980);
    var ratio = phone ? 4 / 3 : 3 / 4;             // height / width
    var maxH = vh * (phone ? .6 : .68);
    var h = w * ratio;
    if (h > maxH) { h = maxH; w = h / ratio; }
    root.style.setProperty('--ps-w', Math.round(w) + 'px');
    root.style.setProperty('--ps-h', Math.round(h) + 'px');
    return { w: w, h: h };
  }

  function markFront() {
    cards.forEach(function (c) { c.classList.remove('is-front'); c.setAttribute('aria-hidden', 'true'); });
    var f = cards[order[0]];
    f.classList.add('is-front');
    f.setAttribute('aria-hidden', 'false');
    order.slice(0, DEPTH + 1).forEach(load);
  }
  function updateInfo(animateIt) {
    var p = photos[order[0]];
    capEl.textContent = p.caption || '';
    countEl.textContent = photos.length > 1 ? (order[0] + 1) + ' / ' + photos.length : '';
    if (animateIt && !reduce) infoEl.animate([{ opacity: 0, transform: 'translateY(10px)' }, { opacity: 1, transform: 'none' }], { duration: 420, easing: SWING });
  }
  // The new front photo settles with a slow, slight zoom.
  function kenBurns() {
    if (reduce || !isOpen) return;
    cards[order[0]].querySelector('img').animate([{ transform: 'scale(1.07)' }, { transform: 'scale(1)' }], { duration: 1400, easing: 'cubic-bezier(.2,.7,.2,1)' });
  }
  // Every card except `skip` glides to its place in the pile, a beat apart.
  function restack(skip, baseDelay) {
    order.forEach(function (idx, depth) {
      if (idx === skip) return;
      var c = cards[idx], st = stateFor(depth), from = current(c);
      c.style.zIndex = st.zIndex;
      if (from.opacity === '0' && st.opacity === '0') { apply(c, st); return; }
      run(c, [from, { transform: st.transform, filter: st.filter, opacity: st.opacity }],
        { duration: T(680), delay: reduce ? 0 : baseDelay + depth * 45, easing: SPRING }, st);
    });
  }

  // ── Next: the front photo swings aside in one arc and tucks in at the back ──
  function next(dir, fromDrag) {
    if (!isOpen || photos.length < 2) return;
    settle();
    var frontIdx = order[0], front = cards[frontIdx];
    var side = dir === 'right' ? 1 : -1;
    var start = fromDrag || current(front);
    order.push(order.shift());
    var backDepth = Math.min(order.length - 1, DEPTH);
    var end = stateFor(backDepth);
    var out = 'translate3d(' + (side * 70) + '%,-5%,0) rotate(' + (side * 15) + 'deg) scale(.93)';
    run(front, [
      { transform: start.transform, filter: 'brightness(1)', opacity: 1, zIndex: 300, offset: 0, easing: SWING },
      { transform: out, filter: 'brightness(.95)', opacity: 1, zIndex: 300, offset: .44 },
      { transform: out, filter: 'brightness(.9)', opacity: 1, zIndex: 0, offset: .45, easing: SPRING },
      { transform: end.transform, filter: end.filter, opacity: end.opacity, zIndex: 0, offset: 1 },
    ], { duration: T(860) }, end);
    restack(frontIdx, 70);
    markFront(); updateInfo(true); kenBurns();
  }

  // ── Previous: the last photo slides out from behind and lands on the front ──
  function prev() {
    if (!isOpen || photos.length < 2) return;
    settle();
    var backIdx = order[order.length - 1], back = cards[backIdx];
    load(backIdx);
    var start = current(back);
    var wasHidden = order.length - 1 >= DEPTH;
    order.unshift(order.pop());
    var end = stateFor(0);
    var out = 'translate3d(-70%,-5%,0) rotate(-15deg) scale(.93)';
    run(back, [
      { transform: wasHidden ? tf(slot(DEPTH - 1)) : start.transform, filter: 'brightness(.85)', opacity: wasHidden ? 0 : 1, zIndex: 0, offset: 0, easing: SWING },
      { transform: out, filter: 'brightness(.95)', opacity: 1, zIndex: 0, offset: .44 },
      { transform: out, filter: 'brightness(1)', opacity: 1, zIndex: 300, offset: .45, easing: SPRING },
      { transform: end.transform, filter: end.filter, opacity: 1, zIndex: 300, offset: 1 },
    ], { duration: T(860) }, end);
    restack(backIdx, 0);
    markFront(); updateInfo(true);
    setTimeout(kenBurns, reduce ? 0 : 380);
  }

  // ── Open: fly the clicked photo from its spot on the page ────────────────
  function open(i, from) {
    if (isOpen) return;
    settle();
    isOpen = true;
    opener = from || null;
    openedIndex = i;
    var size = sizeStage();
    order = [];
    for (var k = 0; k < photos.length; k++) order.push((i + k) % photos.length);
    root.hidden = false;
    document.documentElement.classList.add('ps-lock');
    markFront(); updateInfo(false);
    void root.offsetWidth;
    root.classList.add('is-open');

    var thumb = from && from.querySelector('img');
    var r = thumb && thumb.getBoundingClientRect();
    order.forEach(function (idx, depth) {
      var c = cards[idx], st = stateFor(depth);
      apply(c, { zIndex: st.zIndex });
      if (depth === 0) {
        var startTf = 'translate3d(0,30px,0) scale(.9)';
        if (r && r.width) {
          var dx = (r.left + r.width / 2) - window.innerWidth / 2;
          var dy = (r.top + r.height / 2) - window.innerHeight * .46;
          startTf = 'translate3d(' + dx + 'px,' + dy + 'px,0) scale(' + (r.width / size.w) + ',' + (r.height / size.h) + ')';
        }
        run(c, [{ transform: startTf, filter: 'brightness(1)', opacity: 1, borderRadius: '16px' }, { transform: st.transform, filter: st.filter, opacity: 1, borderRadius: '22px' }],
          { duration: T(760), easing: SPRING }, { transform: st.transform, filter: st.filter, opacity: '1', borderRadius: '' });
      } else if (depth < DEPTH) {
        run(c, [{ transform: 'translate3d(0,40px,0) rotate(0deg) scale(.8)', filter: st.filter, opacity: 0 }, { transform: st.transform, filter: st.filter, opacity: st.opacity }],
          { duration: T(720), delay: reduce ? 0 : 160 + depth * 80, easing: SPRING }, st);
      } else {
        apply(c, st);
      }
    });
    kenBurns();
    closeBtn.focus({ preventScroll: true });
  }

  // ── Close: fly back to the page when the front photo is the one that was opened ──
  function close() {
    if (!isOpen) return;
    settle();
    isOpen = false;
    var size = { w: parseFloat(root.style.getPropertyValue('--ps-w')) || 1, h: parseFloat(root.style.getPropertyValue('--ps-h')) || 1 };
    var front = cards[order[0]];
    var thumb = opener && order[0] === openedIndex && opener.querySelector('img');
    var r = thumb && thumb.getBoundingClientRect();
    root.classList.remove('is-open');
    order.slice(1).forEach(function (idx, j) {
      var c = cards[idx], from = current(c);
      if (from.opacity === '0') return;
      run(c, [from, { transform: 'translate3d(0,30px,0) scale(.85)', opacity: 0 }], { duration: T(260), delay: reduce ? 0 : j * 30, easing: 'ease-in' }, { opacity: '0' });
    });
    var endTf, endOpacity = 1;
    if (r && r.width && r.bottom > 0 && r.top < window.innerHeight) {
      var dx = (r.left + r.width / 2) - window.innerWidth / 2, dy = (r.top + r.height / 2) - window.innerHeight * .46;
      endTf = 'translate3d(' + dx + 'px,' + dy + 'px,0) scale(' + (r.width / size.w) + ',' + (r.height / size.h) + ')';
    } else { endTf = 'translate3d(0,30px,0) scale(.9)'; endOpacity = 0; }
    run(front, [current(front), { transform: endTf, opacity: endOpacity, borderRadius: '16px' }], { duration: T(480), easing: 'cubic-bezier(.5, 0, .2, 1)' }, { opacity: '0' })
      .finished.then(finishClose, finishClose);
  }
  function finishClose() {
    if (isOpen) return;
    root.hidden = true;
    document.documentElement.classList.remove('ps-lock');
    cards.forEach(function (c) { c.style.opacity = '0'; c.style.borderRadius = ''; });
    if (opener) opener.focus({ preventScroll: true });
  }

  // ── Wiring ───────────────────────────────────────────────────────────────
  host.addEventListener('click', function (e) {
    var t = e.target.closest('[data-photo-index]');
    if (!t || !host.contains(t)) return;
    e.preventDefault();
    e.stopPropagation();                 // the standard photo viewer stays closed
    var idx = parseInt(t.getAttribute('data-photo-index'), 10) || 0;
    var from = t.classList.contains('gal-open') ? t : host.querySelector('.gal-open[data-photo-index="' + idx + '"]');
    open(idx, from || t);
  }, true);

  nextBtn.addEventListener('click', function () { next('left'); });
  prevBtn.addEventListener('click', prev);
  root.addEventListener('click', function (e) { if (e.target.closest('[data-ps-close]')) close(); });
  // Keys work while the viewer is open even after a drag moved focus to the page.
  document.addEventListener('keydown', function (e) {
    if (!isOpen) return;
    if (e.key === 'Escape') { e.preventDefault(); close(); return; }
    if (e.key === 'ArrowRight') { e.preventDefault(); next('left'); return; }
    if (e.key === 'ArrowLeft') { e.preventDefault(); prev(); return; }
    if (e.key === 'Tab') {                                   // keep focus inside the viewer
      var f = [prevBtn, nextBtn, closeBtn].filter(function (b) { return !b.hidden; });
      var i = f.indexOf(document.activeElement);
      e.preventDefault();
      f[(i + (e.shiftKey ? -1 : 1) + f.length) % f.length].focus();
    }
  });
  window.addEventListener('resize', function () {
    if (!isOpen) return;
    settle(); sizeStage();
    order.forEach(function (idx, d) { apply(cards[idx], stateFor(d)); });
  });

  // Desktop: the front photo leans gently toward the pointer.
  if (finePointer && !reduce) {
    stage.addEventListener('pointermove', function (e) {
      if (drag) return;
      var c = e.target.closest('.ps-card.is-front');
      if (!c) return;
      var r = c.getBoundingClientRect();
      var px = (e.clientX - r.left) / r.width - .5, py = (e.clientY - r.top) / r.height - .5;
      c.querySelector('.ps-inner').style.transform = 'perspective(1400px) rotateY(' + (px * 7) + 'deg) rotateX(' + (-py * 6) + 'deg)';
    });
    stage.addEventListener('pointerout', function (e) {
      var c = e.target.closest && e.target.closest('.ps-card.is-front');
      if (c && !c.contains(e.relatedTarget)) c.querySelector('.ps-inner').style.transform = '';
    });
  }

  // Drag or flick: the photo follows the finger with a lean, the one behind rises as you pull;
  // far enough (or fast enough) left = next, right = previous; otherwise everything springs back.
  var drag = null;
  stage.addEventListener('pointerdown', function (e) {
    var card = e.target.closest('.ps-card.is-front');
    if (!card) return;
    settle();
    card.querySelector('.ps-inner').style.transform = '';
    drag = { card: card, x0: e.clientX, y0: e.clientY, dx: 0, dy: 0, samples: [{ x: e.clientX, t: e.timeStamp }] };
    card.classList.add('is-dragging');
    card.setPointerCapture(e.pointerId);
  });
  stage.addEventListener('pointermove', function (e) {
    if (!drag) return;
    drag.dx = e.clientX - drag.x0;
    drag.dy = (e.clientY - drag.y0) * .25;
    drag.samples.push({ x: e.clientX, t: e.timeStamp });
    if (drag.samples.length > 6) drag.samples.shift();
    drag.card.style.transform = 'translate3d(' + drag.dx + 'px,' + drag.dy + 'px,0) rotate(' + (drag.dx / 18) + 'deg) scale(1.02)';
    var p = Math.min(Math.abs(drag.dx) / 260, 1);
    var second = order.length > 1 ? cards[order[1]] : null;
    if (second) {
      var s = lerpSlot(slot(1), slot(0), p * .65);
      second.style.transform = tf(s);
      second.style.filter = 'brightness(' + s.b + ')';
    }
  });
  function endDrag() {
    if (!drag) return;
    var d = drag; drag = null;
    d.card.classList.remove('is-dragging');
    // Speed over the last ~100ms of movement, so a short quick flick counts.
    var b = d.samples[d.samples.length - 1], a = b;
    for (var k = d.samples.length - 2; k >= 0; k--) { a = d.samples[k]; if (b.t - a.t >= 100) break; }
    var v = (b.x - a.x) / Math.max(16, b.t - a.t);             // px per ms
    var from = { transform: d.card.style.transform || 'translate3d(0,0,0)' };
    if (d.dx < -70 || (d.dx < -24 && v < -.45)) { next('left', from); return; }
    if (d.dx > 70 || (d.dx > 24 && v > .45)) { prev(); return; }   // the dragged photo glides from the finger to second place
    // Not far enough: spring the front and the one behind back into place.
    var s0 = stateFor(0), s1 = stateFor(1);
    run(d.card, [from, { transform: s0.transform }], { duration: T(620), easing: SPRING }, { transform: s0.transform });
    if (order.length > 1) {
      var second = cards[order[1]];
      run(second, [current(second), { transform: s1.transform, filter: s1.filter }], { duration: T(620), easing: SPRING }, { transform: s1.transform, filter: s1.filter });
    }
  }
  stage.addEventListener('pointerup', endDrag);
  stage.addEventListener('pointercancel', endDrag);
})();
