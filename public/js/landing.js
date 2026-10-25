/**
 * Balai-Reserve – public pages (landing + /stay detail pages)
 *   header state on scroll · mobile navigation drawer · hero availability search ·
 *   category tabs (Rooms / Cottages / Venue / Packages) · occasion filter for event packages
 * Shared listing behaviours (carousels, photo viewer, sheets, booking panel) live in listing.js.
 */
(function () {
  'use strict';

  var reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // ── Header: solid surface + hairline once the page scrolls ───────────────
  var nav = document.getElementById('topNav');
  if (nav) {
    var onScroll = function () { nav.classList.toggle('scrolled', window.scrollY > 8); };
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
  }

  // ── Mobile navigation drawer ─────────────────────────────────────────────
  // Toggle sets aria-expanded; Esc and Close close it; Tab stays inside while
  // open; focus returns to the Menu button.
  var toggle     = document.getElementById('navToggle');
  var mobileMenu = document.getElementById('mobileMenu');
  var menuClose  = document.getElementById('menuClose');

  function focusables() {
    return Array.prototype.slice.call(mobileMenu.querySelectorAll('a[href], button:not([disabled])'));
  }
  function openMenu() {
    mobileMenu.hidden = false;
    document.body.classList.add('menu-open');
    if (toggle) toggle.setAttribute('aria-expanded', 'true');
    if (menuClose) menuClose.focus();
  }
  window.closeMobileMenu = function (restoreFocus) {
    if (!mobileMenu || mobileMenu.hidden) return;
    mobileMenu.hidden = true;
    document.body.classList.remove('menu-open');
    if (toggle) {
      toggle.setAttribute('aria-expanded', 'false');
      if (restoreFocus !== false) toggle.focus();
    }
  };

  if (toggle && mobileMenu) {
    toggle.addEventListener('click', openMenu);
    if (menuClose) menuClose.addEventListener('click', function () { window.closeMobileMenu(); });
    mobileMenu.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') { window.closeMobileMenu(); return; }
      if (e.key !== 'Tab') return;
      var items = focusables();
      if (!items.length) return;
      var first = items[0], last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    });
    // Following a link closes the drawer (in-page anchors then scroll normally).
    mobileMenu.querySelectorAll('a[href]').forEach(function (a) {
      a.addEventListener('click', function () { if (!a.hasAttribute('data-open-search')) window.closeMobileMenu(false); });
    });
    var wide = window.matchMedia('(min-width: 1024px)');
    var onWide = function () { if (wide.matches) window.closeMobileMenu(false); };
    if (wide.addEventListener) wide.addEventListener('change', onWide);
  }

  // ── Hero availability search ─────────────────────────────────────────────
  // Rooms: check-in/check-out. Cottage / hall: date + time in/out. Event: date.
  // "Check availability" opens the live catalogue for those dates, where each
  // listing shows whether it is free and carries the dates to its page and to booking.
  var form      = document.getElementById('search');
  var heroCheckin  = document.getElementById('heroCheckin');
  var heroCheckout = document.getElementById('heroCheckout');
  var heroStart = document.getElementById('heroStart');
  var heroEnd   = document.getElementById('heroEnd');
  var heroGuests = document.getElementById('heroGuests');
  var heroError = document.getElementById('heroError');
  var summary   = document.getElementById('searchSummary');

  var now   = new Date();
  var today = new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  if (heroCheckin)  heroCheckin.min  = today;
  if (heroCheckout) heroCheckout.min = today;

  // Say "onward" instead of the browser's "or later" for past dates.
  [heroCheckin, heroCheckout].forEach(function (field) {
    if (!field) return;
    field.addEventListener('invalid', function () {
      if (!field.min || !field.validity.rangeUnderflow) return;
      var label = new Date(field.min + 'T00:00:00')
        .toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
      field.setCustomValidity('Please select ' + label + ' onward.');
    });
    field.addEventListener('input', function () { field.setCustomValidity(''); });
  });

  function kind() {
    var r = form && form.querySelector('input[name="kind"]:checked');
    return r ? r.value : 'room';
  }
  var KIND_NAMES = { room: 'Stay', cottage: 'Cottage', venue: 'Venue', event: 'Event' };
  function shortDate(v) {
    return v ? new Date(v + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '';
  }
  function syncKind() {
    if (!form) return;
    var k = kind();
    form.querySelectorAll('[data-for]').forEach(function (f) {
      var on = f.getAttribute('data-for').split(' ').indexOf(k) !== -1;
      f.hidden = !on;
      f.querySelectorAll('input').forEach(function (i) { i.disabled = !on; });
    });
    var lbl = document.getElementById('heroCheckinLabel');
    if (lbl) lbl.textContent = k === 'room' ? 'Check-in' : (k === 'cottage' ? 'Date' : 'Event date');
    var sl = document.getElementById('heroStartLabel'), el = document.getElementById('heroEndLabel');
    if (sl) sl.textContent = k === 'venue' ? 'Start time' : 'Time in';
    if (el) el.textContent = k === 'venue' ? 'End time' : 'Time out';
    var go = document.getElementById('heroSearchBtn');
    if (go) go.lastChild.textContent = k === 'event' ? ' See event packages' : ' Check availability';
    form.setAttribute('data-kind', k);
    if (heroError) { heroError.hidden = true; heroError.textContent = ''; }
    syncSummary();
  }
  function syncSummary() {
    if (!summary) return;
    var k = kind();
    var when = heroCheckin && heroCheckin.value
      ? (k === 'room' && heroCheckout && heroCheckout.value ? shortDate(heroCheckin.value) + ' – ' + shortDate(heroCheckout.value) : shortDate(heroCheckin.value))
      : 'any date';
    var who = heroGuests && heroGuests.value ? ' · ' + heroGuests.value + ' guest' + (heroGuests.value === '1' ? '' : 's') : '';
    summary.textContent = KIND_NAMES[k] + ' · ' + when + who;
  }
  function fail(field, msg) {
    heroError.textContent = msg; heroError.hidden = false;
    field.setAttribute('aria-invalid', 'true');
    field.focus();
  }

  if (form) {
    form.addEventListener('change', function (e) {
      if (e.target.name === 'kind') syncKind(); else syncSummary();
    });
    form.addEventListener('input', function (e) {
      if (e.target.removeAttribute) e.target.removeAttribute('aria-invalid');
      if (heroError) heroError.hidden = true;
      syncSummary();
    });
    if (heroCheckin && heroCheckout) {
      heroCheckin.addEventListener('change', function () {
        if (!this.value) return;
        var d = new Date(this.value + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + 1);
        heroCheckout.min = d.toISOString().slice(0, 10);
        if (heroCheckout.value && heroCheckout.value <= this.value) heroCheckout.value = '';
      });
    }
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      if (heroCheckin && !heroCheckin.checkValidity()) { heroCheckin.reportValidity(); return; }
      var k = kind();
      var ci = heroCheckin ? heroCheckin.value : '';
      var params = new URLSearchParams();
      var url;
      if (k === 'room') {
        var co = heroCheckout ? heroCheckout.value : '';
        if (ci && !co) return fail(heroCheckout, 'Add a check-out date, or clear the check-in date to see every room.');
        if (co && !ci) return fail(heroCheckin, 'Add a check-in date.');
        if (ci && co && co <= ci) return fail(heroCheckout, 'Check-out must be at least one night after check-in.');
        if (ci) { params.set('checkin', ci); params.set('checkout', co); }
        url = '/portal/rooms';
      } else {
        if (ci) params.set('date', ci);
        if (k !== 'event' && heroStart && heroEnd && heroStart.value && heroEnd.value) {
          if (heroEnd.value <= heroStart.value) return fail(heroEnd, (k === 'venue' ? 'End time' : 'Time out') + ' must be later than ' + (k === 'venue' ? 'start time.' : 'time in.'));
          if (ci) { params.set('start_time', heroStart.value); params.set('end_time', heroEnd.value); }
        }
        url = k === 'cottage' ? '/portal/cottages' : '/portal/venues';
      }
      if (heroGuests && heroGuests.value) {
        var n = parseInt(heroGuests.value, 10);
        if (!(n >= 1)) return fail(heroGuests, 'Enter at least 1 guest, or leave it blank.');
        params.set('guests', String(n));
      }
      var qs = params.toString();
      window.location.href = url + (qs ? '?' + qs : '') + (k === 'event' ? '#packages' : '');
    });
    syncKind();
  }

  // ── Category tabs: Rooms / Cottages / Venue / Packages ────────────────────
  // Without JS every group is shown in turn; with JS they become ARIA tabs
  // (arrow keys, Home/End) and a link to #cottages, #hall etc. opens the right tab.
  var tabsBox = document.querySelector('[data-tabs]');
  var tabs = tabsBox ? Array.prototype.slice.call(tabsBox.querySelectorAll('[role="tab"]')) : [];
  function panelOf(t) { return document.getElementById(t.getAttribute('aria-controls')); }
  function selectTab(tab, focus) {
    tabs.forEach(function (t) {
      var on = t === tab, p = panelOf(t);
      t.setAttribute('aria-selected', on ? 'true' : 'false');
      t.tabIndex = on ? 0 : -1;
      if (p) p.hidden = !on;
    });
    if (focus) tab.focus();
  }
  if (tabs.length) {
    tabsBox.hidden = false;
    document.documentElement.classList.add('js-tabs');
    tabs.forEach(function (t) {
      var p = panelOf(t);
      if (p) { p.setAttribute('role', 'tabpanel'); p.setAttribute('aria-labelledby', t.id); p.tabIndex = 0; }
      t.addEventListener('click', function () { selectTab(t); });
      t.addEventListener('keydown', function (e) {
        var i = tabs.indexOf(t), n = null;
        if (e.key === 'ArrowRight') n = tabs[(i + 1) % tabs.length];
        if (e.key === 'ArrowLeft') n = tabs[(i - 1 + tabs.length) % tabs.length];
        if (e.key === 'Home') n = tabs[0];
        if (e.key === 'End') n = tabs[tabs.length - 1];
        if (n) { e.preventDefault(); selectTab(n, true); }
      });
    });
    selectTab(tabs[0]);
  }
  function tabForId(id) {
    var el = id && document.getElementById(id);
    if (!el) return null;
    for (var i = 0; i < tabs.length; i++) { var p = panelOf(tabs[i]); if (p && (p === el || p.contains(el))) return tabs[i]; }
    return null;
  }
  function openTabFor(id) { var t = tabForId(id); if (t) selectTab(t); }
  if (location.hash) openTabFor(location.hash.slice(1));
  window.addEventListener('hashchange', function () { openTabFor(location.hash.slice(1)); });

  // ── Occasion filter for event packages ───────────────────────────────────
  var occBox = document.querySelector('[data-occ-filter]');
  if (occBox) {
    occBox.hidden = false;
    var chips = occBox.querySelectorAll('[data-occ]');
    var rows = document.querySelectorAll('#events [data-occasion]');
    var known = ['wedding', 'debut', 'birthday', 'corporate', 'meeting'];
    var occStatus = document.getElementById('occStatus');
    chips.forEach(function (c) {
      c.addEventListener('click', function () {
        var k = c.getAttribute('data-occ'), shown = 0;
        chips.forEach(function (x) { x.setAttribute('aria-pressed', x === c ? 'true' : 'false'); });
        rows.forEach(function (r) {
          var occ = r.getAttribute('data-occasion');
          var on = !k || occ === k || (k === 'other' && known.indexOf(occ) === -1);
          r.hidden = !on; if (on) shown++;
        });
        if (occStatus) occStatus.textContent = shown + ' package' + (shown === 1 ? '' : 's') + ' shown';
      });
    });
  }

  // ── In-page anchors: smooth scroll (unless reduced motion), open the right tab, move focus ──
  function scrollToId(id, focusEl) {
    var target = document.getElementById(id);
    if (!target) return;
    openTabFor(id);
    target.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'start' });
    if (history.replaceState) history.replaceState(null, '', '#' + id);
    var f = focusEl || target;
    if (f === target && !target.hasAttribute('tabindex')) target.setAttribute('tabindex', '-1');
    setTimeout(function () { f.focus({ preventScroll: true }); }, reduceMotion ? 0 : 320);
  }
  document.addEventListener('click', function (e) {
    var a = e.target.closest('a[href]');
    if (!a || e.defaultPrevented) return;
    var href = a.getAttribute('href');
    var onHome = location.pathname === '/';
    var id = href.charAt(0) === '#' ? href.slice(1) : (onHome && href.indexOf('/#') === 0 ? href.slice(2) : '');
    if (!id) return;
    var target = document.getElementById(id);
    if (!target || target.hasAttribute('data-sheet')) return;   // sheets (booking summary) are opened by listing.js
    e.preventDefault();
    if (window.closeMobileMenu) window.closeMobileMenu(false);
    // "Check availability" / "Book": bring the search into view and focus the choice of what to book.
    var focusEl = a.hasAttribute('data-open-search') && id === 'search' ? (target.querySelector('input[name="kind"]:checked') || heroCheckin) : null;
    scrollToId(id, focusEl);
  });

  // ── Header: mark the section in view ─────────────────────────────────────
  var navLinks = Array.prototype.slice.call(document.querySelectorAll('.header-nav a[href^="#"]'));
  if (navLinks.length && 'IntersectionObserver' in window) {
    var byId = {};
    navLinks.forEach(function (a) { byId[a.getAttribute('href').slice(1)] = a; });
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (!en.isIntersecting) return;
        navLinks.forEach(function (a) { a.classList.toggle('is-current', a === byId[en.target.id]); });
      });
    }, { rootMargin: '-45% 0px -50% 0px' });
    Object.keys(byId).forEach(function (id) { var el = document.getElementById(id); if (el) io.observe(el); });
  }

  // ── Photos: a file that fails to load shows the honest empty state ──────
  document.querySelectorAll('.lst-slide img, .hero-media img, .about-photo img, .gal-open img').forEach(function (img) {
    var swap = function () {
      var box = document.createElement('span');
      box.className = 'photo-pending';
      box.innerHTML = '<i class="fas fa-camera" aria-hidden="true"></i>Photos coming soon';
      img.replaceWith(box);
    };
    if (img.complete && img.naturalWidth === 0 && img.getAttribute('src')) swap();
    else img.addEventListener('error', swap, { once: true });
  });
})();
