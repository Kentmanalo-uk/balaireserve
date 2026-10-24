/**
 * Balai-Reserve — shared listing behaviours (landing page, /stay detail pages, portal catalogue)
 *   1. Photo carousels on listings / detail gallery (CSS scroll-snap + arrow buttons + counter)
 *   2. Photo viewer (<dialog id="brLightbox">): arrows, swipe, Esc, focus return
 *   3. Sheets ([data-sheet]): booking panel / search become focused bottom sheets on phones
 *   4. Booking panel ([data-booking-panel]): live total (+ package add-ons), downpayment, balance, blocked-date check
 *   5. Availability calendars ([data-datepicker]) via public/js/br-datepicker.js, bound to the native inputs
 */
(function () {
  'use strict';
  if (window.__brListing) return;
  window.__brListing = true;

  var reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var behavior = reduceMotion ? 'auto' : 'smooth';

  // ── Money and dates (Philippine peso, dates as YYYY-MM-DD strings) ─────────
  function price(n) {   // guest-facing rate: ₱3,500 / ₱3,500.50
    var whole = Math.round(n * 100) % 100 === 0;
    return '₱' + Number(n).toLocaleString('en-PH', { minimumFractionDigits: whole ? 0 : 2, maximumFractionDigits: 2 });
  }
  function peso(n) {    // amounts due: ₱1,900.00
    return '₱' + Number(n).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  function nice(ymd, withYear) {
    var d = new Date(ymd + 'T00:00:00');
    if (isNaN(d)) return ymd;
    var o = { weekday: 'short', month: 'short', day: 'numeric' };
    if (withYear) o.year = 'numeric';
    return d.toLocaleDateString('en-US', o);
  }
  function nights(a, b) { return Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 86400000); }
  function time12(t) {
    var m = /^(\d{1,2}):(\d{2})/.exec(t || ''); if (!m) return t || '';
    var h = +m[1]; return (h % 12 || 12) + ':' + m[2] + ' ' + (h >= 12 ? 'PM' : 'AM');
  }
  function localToday() {
    var now = new Date();
    return new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  }

  // "Please select <date> onward." for any past date (the hero fields are handled by landing.js).
  document.querySelectorAll('input[type="date"]').forEach(function (field) {
    if (field.id === 'heroCheckin' || field.id === 'heroCheckout') return;
    if (!field.min) field.min = localToday();
    field.addEventListener('invalid', function () {
      if (!field.min || !field.validity.rangeUnderflow) return;
      field.setCustomValidity('Please select ' + nice(field.min, true).replace(/^\w+, /, '') + ' onward.');
    });
    field.addEventListener('input', function () { field.setCustomValidity(''); });
  });

  // ── 1. Carousels ───────────────────────────────────────────────────────────
  document.querySelectorAll('[data-carousel]').forEach(function (box) {
    var track = box.querySelector('.lst-track');
    if (!track) return;
    var prev = box.querySelector('[data-carousel-step="-1"]');
    var next = box.querySelector('[data-carousel-step="1"]');
    var out  = box.querySelector('[data-carousel-index]');
    var slides = track.children;
    function index() { return Math.round(track.scrollLeft / Math.max(1, track.clientWidth)); }
    function sync() {
      var i = index();
      if (out) out.textContent = String(Math.min(slides.length, i + 1));
      if (prev) prev.disabled = track.scrollLeft < 4;
      if (next) next.disabled = track.scrollLeft + track.clientWidth >= track.scrollWidth - 4;
    }
    var t;
    track.addEventListener('scroll', function () { clearTimeout(t); t = setTimeout(sync, 60); }, { passive: true });
    box.addEventListener('click', function (e) {
      var b = e.target.closest('[data-carousel-step]');
      if (!b || !box.contains(b)) return;
      e.preventDefault();
      var step = parseInt(b.getAttribute('data-carousel-step'), 10);
      var target = Math.max(0, Math.min(slides.length - 1, index() + step));
      track.scrollTo({ left: target * track.clientWidth, behavior: behavior });
    });
    window.addEventListener('resize', sync);
    sync();
  });

  // ── 2. Photo viewer ────────────────────────────────────────────────────────
  var lb = document.getElementById('brLightbox');
  if (lb && typeof lb.showModal === 'function') {
    var lbImg = document.getElementById('brLbImg');
    var lbCap = document.getElementById('brLbCaption');
    var lbCount = document.getElementById('brLbCount');
    var lbTitle = document.getElementById('brLbTitle');
    var lbPrev = lb.querySelector('[data-lb-step="-1"]');
    var lbNext = lb.querySelector('[data-lb-step="1"]');
    var list = [], cur = 0, opener = null;

    var show = function (i) {
      cur = (i + list.length) % list.length;
      var p = list[cur];
      lbImg.src = p.src;
      lbImg.alt = p.alt || '';
      lbCap.textContent = p.caption || '';
      lbCap.hidden = !p.caption;
      lbCount.textContent = list.length > 1 ? (cur + 1) + ' / ' + list.length : '';
      // warm the neighbours so stepping feels instant
      [cur + 1, cur - 1].forEach(function (k) { var q = list[(k + list.length) % list.length]; if (q) { var im = new Image(); im.src = q.src; } });
    };
    window.brOpenPhotos = function (photos, start, name, from) {
      list = (photos || []).map(function (p) { return typeof p === 'string' ? { src: p, alt: (name || 'Photo') } : p; })
        .filter(function (p) { return p && p.src; });
      if (!list.length) return;
      opener = from || document.activeElement;
      lbTitle.textContent = name ? 'Photos of ' + name : 'Photos';
      lbPrev.hidden = lbNext.hidden = list.length < 2;
      show(start || 0);
      lb.showModal();
      document.body.classList.add('lb-open');
    };

    document.addEventListener('click', function (e) {
      var trigger = e.target.closest('[data-photo-index]');
      if (!trigger) return;
      var host = trigger.closest('[data-photos]');
      if (!host) return;
      var photos = [];
      try { photos = JSON.parse(host.getAttribute('data-photos') || '[]'); } catch (err) { photos = []; }
      if (!photos.length) return;
      e.preventDefault();
      window.brOpenPhotos(photos, parseInt(trigger.getAttribute('data-photo-index'), 10) || 0, host.getAttribute('data-photos-name') || '', trigger);
    });
    lb.addEventListener('click', function (e) {
      var s = e.target.closest('[data-lb-step]');
      if (s) { show(cur + parseInt(s.getAttribute('data-lb-step'), 10)); return; }
      if (e.target.closest('[data-lb-close]') || e.target === lb) lb.close();
    });
    lb.addEventListener('keydown', function (e) {
      if (list.length < 2) return;
      if (e.key === 'ArrowLeft') { e.preventDefault(); show(cur - 1); }
      if (e.key === 'ArrowRight') { e.preventDefault(); show(cur + 1); }
    });
    // Swipe left/right on the photo
    var x0 = null;
    lb.addEventListener('pointerdown', function (e) { if (e.pointerType !== 'mouse') x0 = e.clientX; });
    lb.addEventListener('pointerup', function (e) {
      if (x0 === null) return;
      var dx = e.clientX - x0; x0 = null;
      if (Math.abs(dx) > 40 && list.length > 1) show(cur + (dx < 0 ? 1 : -1));
    });
    lb.addEventListener('close', function () {
      lbImg.removeAttribute('src');
      document.body.classList.remove('lb-open');
      if (opener && opener.focus) opener.focus();
    });
  }

  // ── 3. Sheets ──────────────────────────────────────────────────────────────
  // On small screens a [data-sheet] panel opens as a focused sheet (dialog semantics,
  // focus trap, Esc, backdrop). On wider screens the same opener just brings the
  // panel into view and focuses its first field.
  var backdrop = null;
  var openSheet = null, sheetOpener = null;
  function sheetMode(sheet) {
    var q = sheet.getAttribute('data-sheet-media') || '(max-width: 991.98px)';
    return window.matchMedia(q).matches;
  }
  function focusables(root) {
    return Array.prototype.filter.call(root.querySelectorAll('a[href], button:not([disabled]), input:not([type="hidden"]):not([disabled]), select:not([disabled]), textarea, [tabindex]:not([tabindex="-1"])'),
      function (el) { return el.offsetParent !== null || el === document.activeElement; });
  }
  function firstField(sheet) {
    return sheet.querySelector('input:not([type="hidden"]), select, button[type="submit"]') || focusables(sheet)[0];
  }
  function setOpeners(sheet, open) {
    document.querySelectorAll('[data-sheet-open="' + sheet.id + '"]').forEach(function (b) { b.setAttribute('aria-expanded', open ? 'true' : 'false'); });
  }
  function closeSheet(restore) {
    if (!openSheet) return;
    var s = openSheet; openSheet = null;
    s.classList.remove('is-open');
    s.removeAttribute('role'); s.removeAttribute('aria-modal');
    if (s.dataset.role) s.setAttribute('role', s.dataset.role);
    document.body.classList.remove('sheet-open');
    if (backdrop) backdrop.hidden = true;
    setOpeners(s, false);
    if (restore !== false && sheetOpener && sheetOpener.focus) sheetOpener.focus();
  }
  window.brOpenSheet = function (sheet, from) {
    if (!sheet) return;
    sheetOpener = from || document.activeElement;
    if (!sheetMode(sheet)) {
      sheet.scrollIntoView({ behavior: behavior, block: 'center' });
      var f = firstField(sheet);
      if (f) setTimeout(function () { f.focus({ preventScroll: true }); }, reduceMotion ? 0 : 350);
      return;
    }
    if (!backdrop) {
      backdrop = document.createElement('div');
      backdrop.className = 'sheet-backdrop';
      backdrop.addEventListener('click', function () { closeSheet(); });
      document.body.appendChild(backdrop);
    }
    if (sheet.getAttribute('role') && !sheet.dataset.role) sheet.dataset.role = sheet.getAttribute('role');
    sheet.setAttribute('role', 'dialog');
    sheet.setAttribute('aria-modal', 'true');
    sheet.classList.add('is-open');
    backdrop.hidden = false;
    document.body.classList.add('sheet-open');
    openSheet = sheet;
    setOpeners(sheet, true);
    var first = firstField(sheet);
    if (first) first.focus({ preventScroll: true });
  };
  document.addEventListener('click', function (e) {
    var o = e.target.closest('[data-sheet-open]');
    if (o) { e.preventDefault(); window.brOpenSheet(document.getElementById(o.getAttribute('data-sheet-open')), o); return; }
    var c = e.target.closest('[data-sheet-close]');
    if (c) { e.preventDefault(); closeSheet(); return; }
    // Header / drawer "Check availability" links that point at a sheet on this page
    var a = e.target.closest('a[data-open-search]');
    if (a) {
      var hash = (a.getAttribute('href') || '').replace(/^\/(?=#)/, location.pathname === '/' ? '' : '/');
      if (hash.charAt(0) !== '#') return;
      var target = document.getElementById(hash.slice(1));
      if (!target || !target.hasAttribute('data-sheet')) return;
      e.preventDefault();
      if (window.closeMobileMenu) window.closeMobileMenu(false);
      window.brOpenSheet(target, a);
    }
  });
  document.addEventListener('keydown', function (e) {
    if (!openSheet) return;
    if (e.key === 'Escape') { e.preventDefault(); closeSheet(); return; }
    if (e.key !== 'Tab') return;
    var items = focusables(openSheet);
    if (!items.length) return;
    var first = items[0], last = items[items.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  });
  // Keep the focused field visible above the on-screen keyboard.
  document.addEventListener('focusin', function (e) {
    if (openSheet && openSheet.contains(e.target) && /INPUT|SELECT|TEXTAREA/.test(e.target.tagName)) {
      setTimeout(function () { e.target.scrollIntoView({ block: 'nearest' }); }, 250);
    }
  });
  window.addEventListener('resize', function () { if (openSheet && !sheetMode(openSheet)) closeSheet(false); });

  // ── 4. Booking panel ───────────────────────────────────────────────────────
  document.querySelectorAll('[data-booking-panel]').forEach(function (form) {
    var kind  = form.getAttribute('data-kind');
    var rate  = parseFloat(form.getAttribute('data-price')) || 0;
    var dp    = parseFloat(form.getAttribute('data-dp')) || 50;
    var cap   = parseInt(form.getAttribute('data-cap'), 10) || 0;
    var name  = form.getAttribute('data-name') || 'This place';
    var today = form.getAttribute('data-today') || localToday();
    if (localToday() > today) today = localToday();
    var blocked = [];
    try { blocked = JSON.parse(form.getAttribute('data-blocked') || '[]'); } catch (e) { blocked = []; }
    var isRoom = kind === 'room';
    var $ = function (id) { return document.getElementById(id); };
    var ci = $('bpCheckin'), co = $('bpCheckout'), dt = $('bpDate'), st = $('bpStart'), en = $('bpEnd'), gu = $('bpGuests');
    var err = $('bpError'), barSub = $('bpBarSub');
    var out = { label: $('bpLineLabel'), line: $('bpLine'), total: $('bpTotal'), down: $('bpDown'), bal: $('bpBalance'),
                addRow: $('bpAddonRow'), addLabel: $('bpAddonLabel'), add: $('bpAddon') };
    var addons = Array.prototype.slice.call(form.querySelectorAll('input[data-addon-price]'));
    var timed = kind === 'venue' || kind === 'event';
    function addonTotal() {
      return addons.reduce(function (t, a) { return t + (a.checked ? (parseFloat(a.getAttribute('data-addon-price')) || 0) : 0); }, 0);
    }
    var touched = false;

    function conflict() {
      if (isRoom) {
        if (!ci.value || !co.value || co.value <= ci.value) return null;
        return blocked.filter(function (b) { return b.start < co.value && b.end > ci.value; })[0] || null;
      }
      if (!dt.value) return null;
      var s = dt.value + ' ' + (st && st.value ? st.value : '00:00');
      var f = dt.value + ' ' + (en && en.value ? en.value : '24:00');
      return blocked.filter(function (b) {
        var bs = b.start + ' ' + (b.from || '00:00'), be = b.end + ' ' + (b.to || '24:00');
        return bs < f && be > s;
      })[0] || null;
    }
    function describe(b) {
      if (isRoom) return nice(b.start) + ' – ' + nice(b.end, true);
      var d = b.end > b.start ? nice(b.start) + ' – ' + nice(b.end, true) : nice(b.start, true);
      return d + (b.from && b.to ? ', ' + time12(b.from) + ' – ' + time12(b.to) : ' (whole day)');
    }
    // First problem with the current selection: { field, msg } or null
    function problem(final) {
      if (isRoom) {
        if (ci.value && ci.value < today) return { field: ci, msg: 'Please select ' + nice(today, true).replace(/^\w+, /, '') + ' onward.' };
        if (co.value && ci.value && co.value <= ci.value) return { field: co, msg: 'Check-out must be at least one night after check-in.' };
        if (final && (!ci.value || !co.value)) return { field: ci.value ? co : ci, msg: 'Choose your check-in and check-out dates.' };
      } else {
        if (dt.value && dt.value < today) return { field: dt, msg: 'Please select ' + nice(today, true).replace(/^\w+, /, '') + ' onward.' };
        if (st && en && st.value && en.value && en.value <= st.value) return { field: en, msg: (timed ? 'End time' : 'Time out') + ' must be later than ' + (timed ? 'start time' : 'time in') + '.' };
        if (final && !dt.value) return { field: dt, msg: 'Choose a date.' };
        if (final && st && en && (!st.value || !en.value)) return { field: st.value ? en : st, msg: 'Choose your ' + (timed ? 'start and end times' : 'time in and time out') + '.' };
      }
      if (gu && gu.value) {
        var n = parseInt(gu.value, 10);
        if (!(n >= 1)) return { field: gu, msg: 'Enter at least 1 guest.' };
        if (cap && n > cap) return { field: gu, msg: 'The ' + name + ' fits up to ' + cap + ' guests. Lower the number or choose a larger option.' };
      }
      var c = conflict();
      if (c) return { field: isRoom ? ci : dt, msg: 'Already booked: ' + describe(c) + '. Choose ' + (isRoom ? 'other dates' : 'another date or time') + '.' };
      return null;
    }
    function render(final) {
      [ci, co, dt, st, en, gu].forEach(function (f) { if (f) f.removeAttribute('aria-invalid'); });
      var p = problem(final);
      if (p && (touched || final)) {
        err.textContent = p.msg; err.hidden = false;
        p.field.setAttribute('aria-invalid', 'true');
        p.field.setAttribute('aria-errormessage', 'bpError');
      } else { err.hidden = true; err.textContent = ''; }

      var total = null, label = 'Flat rate', line = '';
      if (isRoom) {
        if (ci.value && co.value && co.value > ci.value) {
          var n = nights(ci.value, co.value);
          total = rate * n;
          label = price(rate) + ' × ' + n + ' night' + (n === 1 ? '' : 's');
          line = peso(total);
        } else { label = 'Add your dates to see the total'; }
      } else {
        // Same rule as the server: flat rate (+ each chosen package add-on).
        var extra = addonTotal();
        total = rate + extra; line = peso(rate);
        label = (kind === 'event' ? 'Package price' : 'Flat rate') + (dt.value ? ', ' + nice(dt.value) : '');
        if (out.addRow) {
          var n2 = addons.filter(function (a) { return a.checked; }).length;
          out.addRow.hidden = !n2;
          if (out.addLabel) out.addLabel.textContent = n2 + ' add-on' + (n2 === 1 ? '' : 's');
          if (out.add) out.add.textContent = '+' + peso(extra);
        }
      }
      out.label.textContent = label;
      out.line.textContent = line;
      if (total === null) {
        out.total.textContent = out.down.textContent = out.bal.textContent = '—';
        if (barSub) barSub.textContent = 'Add dates for the total';
      } else {
        var down = Math.ceil(total * dp / 100);
        out.total.textContent = peso(total);
        out.down.textContent = peso(down);
        out.bal.textContent = peso(total - down);
        if (barSub) barSub.textContent = isRoom ? price(total) + ' for ' + nights(ci.value, co.value) + ' night' + (nights(ci.value, co.value) === 1 ? '' : 's')
          : (total > rate ? 'Total ' + peso(total) + ' · ' : '') + dp + '% down: ' + peso(down);
      }
      return p;
    }
    if (ci && co) {
      ci.addEventListener('change', function () {
        if (ci.value) {
          var d = new Date(ci.value + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + 1);
          co.min = d.toISOString().slice(0, 10);
          if (co.value && co.value <= ci.value) co.value = '';
        }
      });
    }
    form.addEventListener('input', function () { touched = true; render(false); });
    form.addEventListener('change', function () { touched = true; render(false); });
    form.addEventListener('submit', function (e) {
      var p = render(true);
      if (p) { e.preventDefault(); p.field.focus(); return; }
      if (gu && !gu.value) gu.disabled = true;      // leave the guest count for the booking form
      var b = form.querySelector('[type="submit"]');
      if (b) { b.setAttribute('aria-busy', 'true'); b.textContent = 'Opening the booking form…'; }
    });
    window.addEventListener('pageshow', function () {   // back/forward cache: restore the button
      if (gu) gu.disabled = false;
      var b = form.querySelector('[type="submit"]');
      if (b && b.getAttribute('aria-busy')) { b.removeAttribute('aria-busy'); b.textContent = b.getAttribute('data-label') || b.textContent; }
    });
    var sb = form.querySelector('[type="submit"]'); if (sb) sb.setAttribute('data-label', sb.textContent);
    touched = !!((ci && ci.value) || (dt && dt.value));
    render(false);
  });

  // ── 5. Availability calendars ─────────────────────────────────────────────
  // [data-datepicker data-dp-start="#id" data-dp-end="#id" data-dp-nightly data-dp-months="1"]
  // Blocked periods come from the booking panel's data-blocked (the item's real bookings).
  function initPickers() {
    if (!window.BrDatePicker) return;
    document.querySelectorAll('[data-datepicker]').forEach(function (box) {
      if (box.__dp) return;
      var start = document.querySelector(box.getAttribute('data-dp-start'));
      if (!start) return;
      var endSel = box.getAttribute('data-dp-end');
      var host = start.closest('[data-booking-panel]');
      var blocked = [];
      try { blocked = JSON.parse((host && host.getAttribute('data-blocked')) || box.getAttribute('data-dp-blocked') || '[]'); } catch (e) { blocked = []; }
      var months = box.getAttribute('data-dp-months');
      box.__dp = window.BrDatePicker.create(box, {
        start: start,
        end: endSel ? document.querySelector(endSel) : null,
        nightly: box.hasAttribute('data-dp-nightly'),
        blocked: blocked,
        min: (host && host.getAttribute('data-today')) || start.min || '',
        months: months ? parseInt(months, 10) : 'auto'
      });
    });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initPickers); else initPickers();
})();
