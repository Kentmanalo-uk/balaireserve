/**
 * Balai-Reserve — shared availability date picker (V3 §07)
 *
 * A month calendar that WRITES INTO existing native date inputs (it never replaces them), so
 * server validation, form posts and the "Please select <date> onward." checks keep working.
 * Without JavaScript the native inputs work on their own.
 *
 *   BrDatePicker.create(container, {
 *     start:   <input type="date">,            // check-in / the single date
 *     end:     <input type="date"> | null,     // check-out → range mode (rooms)
 *     nightly: true,                           // rooms: blocked periods are nights [start, end)
 *     blocked: [{ start, end, from, to }],     // same shape as /stay pages (from the item's real bookings)
 *     min:     'YYYY-MM-DD',                   // first selectable day (today)
 *     months:  1 | 2 | 'auto',
 *     note:    'text shown under the calendar'
 *   })  →  { setBlocked(list), render(), destroy() }
 *
 * Keyboard: arrows move by day / week, Home/End to week start/end, PageUp/PageDown by month,
 * Enter or Space selects, Esc cancels a half-finished range. Weeks start on Sunday (PH convention).
 */
(function () {
  'use strict';
  if (window.BrDatePicker) return;

  var MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  var DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  var uid = 0;

  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function parse(s) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(s || '')) return null;
    var d = new Date(s + 'T00:00:00Z');
    return isNaN(d) ? null : d;
  }
  function ymd(d) { return d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate()); }
  function addDays(s, n) { var d = parse(s); d.setUTCDate(d.getUTCDate() + n); return ymd(d); }
  function monthStart(s) { return s.slice(0, 8) + '01'; }
  function addMonths(s, n) { var d = parse(monthStart(s)); d.setUTCMonth(d.getUTCMonth() + n); return ymd(d); }
  function nightsBetween(a, b) { return Math.round((parse(b) - parse(a)) / 86400000); }
  function longDate(s) { var d = parse(s); return DAYS[d.getUTCDay()] + ', ' + MONTHS[d.getUTCMonth()] + ' ' + d.getUTCDate() + ', ' + d.getUTCFullYear(); }
  function shortDate(s, year) { var d = parse(s); return DAYS[d.getUTCDay()].slice(0, 3) + ', ' + MONTHS[d.getUTCMonth()].slice(0, 3) + ' ' + d.getUTCDate() + (year ? ', ' + d.getUTCFullYear() : ''); }
  function onward(min) { var d = parse(min); return 'Please select ' + MONTHS[d.getUTCMonth()].slice(0, 3) + ' ' + d.getUTCDate() + ', ' + d.getUTCFullYear() + ' onward.'; }
  function time12(t) { var m = /^(\d{1,2}):(\d{2})/.exec(t || ''); if (!m) return t || ''; var h = +m[1]; return (h % 12 || 12) + ':' + m[2] + ' ' + (h >= 12 ? 'PM' : 'AM'); }
  function localToday() { var n = new Date(); return new Date(n.getTime() - n.getTimezoneOffset() * 60000).toISOString().slice(0, 10); }
  function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }

  function Picker(root, o) {
    this.root = root;
    this.a = o.start;
    this.b = o.end || null;
    this.range = !!this.b;
    this.nightly = !!o.nightly;
    this.blocked = Array.isArray(o.blocked) ? o.blocked : [];
    var today = localToday();
    this.min = o.min && o.min > today ? o.min : today;
    this.monthsOpt = o.months || 'auto';
    this.id = 'dp' + (++uid);
    this.writing = false;
    this.prev = null;           // values before a half-finished range (for Esc)
    this.view = monthStart((this.a && this.a.value && this.a.value >= this.min) ? this.a.value : this.min);
    this.focusDate = (this.a && this.a.value) || this.min;
    this.build(o.note || '');
    this.render();
    var self = this;
    [this.a, this.b].forEach(function (inp) {
      if (!inp) return;
      var sync = function () {
        if (self.writing) return;
        if (inp.value && parse(inp.value)) { self.view = monthStart(inp === self.b && self.a.value ? self.a.value : inp.value); self.focusDate = inp.value; }
        self.render();
      };
      inp.addEventListener('change', sync);
      inp.addEventListener('input', sync);
    });
    if (window.ResizeObserver) {
      var w = 0;
      this.ro = new ResizeObserver(function (entries) {
        var nw = Math.round(entries[0].contentRect.width);
        if (Math.abs(nw - w) > 20) { w = nw; self.render(); }
      });
      this.ro.observe(root);
    }
  }

  Picker.prototype.build = function (noteText) {
    var r = this.root, self = this;
    r.classList.add('dp');
    r.innerHTML = '';
    var head = el('div', 'dp-head');
    this.prevBtn = el('button', 'dp-nav'); this.prevBtn.type = 'button';
    this.prevBtn.innerHTML = '<i class="fas fa-chevron-left" aria-hidden="true"></i><span class="br-sr-only">Previous month</span>';
    this.nextBtn = el('button', 'dp-nav'); this.nextBtn.type = 'button';
    this.nextBtn.innerHTML = '<i class="fas fa-chevron-right" aria-hidden="true"></i><span class="br-sr-only">Next month</span>';
    this.status = el('p', 'dp-status');
    this.status.setAttribute('aria-live', 'polite');
    head.appendChild(this.prevBtn); head.appendChild(this.status); head.appendChild(this.nextBtn);
    this.monthsBox = el('div', 'dp-months');
    var legend = el('ul', 'dp-legend');
    legend.setAttribute('aria-label', 'Calendar key');
    [['dp-k-free', 'Available'], ['dp-k-booked', 'Booked'], ['dp-k-sel', 'Selected']]
      .concat(this.nightly ? [] : [['dp-k-part', 'Some hours booked']])
      .forEach(function (k) { var li = el('li'); li.appendChild(el('span', 'dp-key ' + k[0])); li.appendChild(document.createTextNode(k[1])); legend.appendChild(li); });
    this.msg = el('p', 'dp-msg');
    this.msg.id = this.id + '-msg';
    this.msg.setAttribute('role', 'status');
    this.msg.hidden = true;
    r.appendChild(head); r.appendChild(this.monthsBox); r.appendChild(legend); r.appendChild(this.msg);
    if (noteText) r.appendChild(el('p', 'dp-note', noteText));

    this.prevBtn.addEventListener('click', function () { self.view = addMonths(self.view, -1); self.render(); });
    this.nextBtn.addEventListener('click', function () { self.view = addMonths(self.view, 1); self.render(); });
    this.monthsBox.addEventListener('click', function (e) {
      var b = e.target.closest('.dp-day'); if (b) self.pick(b.getAttribute('data-date'));
    });
    this.monthsBox.addEventListener('keydown', function (e) { self.onKey(e); });
    var preview = function (e) { var b = e.target.closest && e.target.closest('.dp-day'); if (b) self.preview(b.getAttribute('data-date')); };
    this.monthsBox.addEventListener('pointerover', preview);
    this.monthsBox.addEventListener('focusin', preview);
    this.monthsBox.addEventListener('pointerleave', function () { self.preview(null); });
  };

  // ── Availability rules ────────────────────────────────────────────────────
  Picker.prototype.bookedNight = function (d) {   // rooms: night d is held by another booking
    return this.blocked.some(function (b) { return b.start <= d && d < b.end; });
  };
  Picker.prototype.dayInfo = function (d) {       // cottages / venue: whole day or some hours
    var full = false, parts = [];
    this.blocked.forEach(function (b) {
      if (!(b.start <= d && d <= (b.end || b.start))) return;
      if (b.from && b.to) parts.push(b); else full = true;
    });
    return { full: full, parts: parts };
  };
  Picker.prototype.phaseEnd = function () { return this.range && this.a.value && !this.b.value; };
  Picker.prototype.limitAfter = function (start) {  // last possible check-out after a check-in
    var lim = null;
    this.blocked.forEach(function (b) { if (b.end > start && (b.start >= start) && (!lim || b.start < lim)) lim = b.start; });
    return lim;   // check-out may fall ON the first held night's date
  };
  Picker.prototype.state = function (d) {
    var s = { past: d < this.min, booked: false, part: false, sel: false, start: false, end: false, mid: false, blockedNow: false };
    if (this.range) {
      s.booked = this.bookedNight(d);
      var a = this.a.value, b = this.b.value;
      s.start = !!a && d === a; s.end = !!b && d === b;
      s.mid = !!(a && b && d > a && d < b);
      if (this.phaseEnd() && d > a) {
        var lim = this.limitAfter(a);
        s.blockedNow = !!(lim && d > lim);
        if (!s.blockedNow && s.booked) s.booked = d !== lim ? s.booked : false;   // the held night's date works as a check-out day
      }
    } else {
      var info = this.dayInfo(d);
      s.booked = info.full; s.part = !info.full && info.parts.length > 0;
      s.start = this.a.value === d;
    }
    s.sel = s.start || s.end;
    return s;
  };

  // ── Rendering ─────────────────────────────────────────────────────────────
  Picker.prototype.count = function () {
    if (this.monthsOpt === 1 || this.monthsOpt === 2) return this.monthsOpt;
    return (this.root.clientWidth || 0) >= 640 ? 2 : 1;
  };
  Picker.prototype.render = function () {
    var self = this, n = this.count();
    var hadFocus = this.monthsBox.contains(document.activeElement);
    if (monthStart(this.view) < monthStart(this.min)) this.view = monthStart(this.min);
    this.monthsBox.innerHTML = '';
    this.monthsBox.setAttribute('data-count', String(n));
    var focusIn = this.focusDate;
    var first = this.view, last = ymd(new Date(Date.UTC(+addMonths(this.view, n - 1).slice(0, 4), +addMonths(this.view, n - 1).slice(5, 7), 0)));
    if (!(focusIn >= first && focusIn <= last)) focusIn = null;
    var firstFocusable = null;
    for (var m = 0; m < n; m++) {
      var ms = addMonths(this.view, m), md = parse(ms);
      var box = el('div', 'dp-month');
      var title = el('p', 'dp-mtitle', MONTHS[md.getUTCMonth()] + ' ' + md.getUTCFullYear());
      title.id = this.id + '-m' + m;
      box.appendChild(title);
      var table = el('table', 'dp-grid');
      table.setAttribute('role', 'grid');
      table.setAttribute('aria-labelledby', title.id);
      var thead = el('thead'), hr = el('tr');
      DAYS.forEach(function (dn) { var th = el('th', null, dn.slice(0, 2)); th.scope = 'col'; th.abbr = dn; hr.appendChild(th); });
      thead.appendChild(hr); table.appendChild(thead);
      var tbody = el('tbody'), tr = el('tr');
      var lead = md.getUTCDay();
      for (var i = 0; i < lead; i++) tr.appendChild(el('td'));
      var dim = new Date(Date.UTC(md.getUTCFullYear(), md.getUTCMonth() + 1, 0)).getUTCDate();
      for (var day = 1; day <= dim; day++) {
        if (tr.children.length === 7) { tbody.appendChild(tr); tr = el('tr'); }
        var d = ms.slice(0, 8) + pad(day);
        var st = this.state(d);
        var td = el('td');
        var btn = el('button', 'dp-day', String(day));
        btn.type = 'button';
        btn.setAttribute('data-date', d);
        btn.tabIndex = -1;
        var cls = [];
        if (st.past) cls.push('is-past');
        if (st.booked) cls.push('is-booked');
        if (st.part) cls.push('is-part');
        if (st.blockedNow) cls.push('is-out');
        if (st.start) cls.push('is-start');
        if (st.end) cls.push('is-end');
        if (st.mid) cls.push('is-mid');
        if (d === localToday()) cls.push('is-today');
        if (cls.length) btn.className += ' ' + cls.join(' ');
        var label = longDate(d);
        if (st.past) label += ', unavailable';
        else if (st.booked) label += ', booked';
        else if (st.blockedNow) label += ', not available with this check-in';
        else if (st.part) label += ', some hours booked';
        if (st.start) label += this.range ? ', check-in' : ', selected';
        if (st.end) label += ', check-out';
        btn.setAttribute('aria-label', label);
        if (st.sel) btn.setAttribute('aria-pressed', 'true');
        if (st.past || st.booked || st.blockedNow) btn.setAttribute('aria-disabled', 'true');
        if (st.part) btn.title = 'Some hours booked';
        if (!firstFocusable && !st.past) firstFocusable = btn;
        if (focusIn === d) firstFocusable = btn, focusIn = '__done';
        td.appendChild(btn); tr.appendChild(td);
      }
      while (tr.children.length < 7) tr.appendChild(el('td'));
      tbody.appendChild(tr);
      table.appendChild(tbody);
      box.appendChild(table);
      this.monthsBox.appendChild(box);
    }
    if (firstFocusable) firstFocusable.tabIndex = 0;
    this.prevBtn.disabled = monthStart(this.view) <= monthStart(this.min);
    this.status.textContent = this.summary();
    if (hadFocus && firstFocusable) firstFocusable.focus();
  };
  Picker.prototype.summary = function () {
    var a = this.a.value, b = this.b ? this.b.value : '';
    if (this.range) {
      if (a && b && b > a) { var n = nightsBetween(a, b); return shortDate(a) + ' – ' + shortDate(b, true) + ' · ' + n + ' night' + (n === 1 ? '' : 's'); }
      if (a) return 'Check-in ' + shortDate(a) + ' · now choose check-out';
      return 'Choose your check-in date';
    }
    return a ? shortDate(a, true) : 'Choose a date';
  };
  Picker.prototype.say = function (text, isError) {
    this.msg.textContent = text || '';
    this.msg.hidden = !text;
    this.msg.classList.toggle('is-error', !!isError);
  };
  Picker.prototype.preview = function (d) {
    var a = this.a.value;
    var on = this.phaseEnd() && d && d > a;
    var lim = on ? this.limitAfter(a) : null;
    this.monthsBox.querySelectorAll('.dp-day').forEach(function (b) {
      var x = b.getAttribute('data-date');
      b.classList.toggle('is-preview', !!(on && x > a && x <= d && !(lim && x > lim)));
    });
  };

  // ── Selecting ─────────────────────────────────────────────────────────────
  Picker.prototype.write = function (inp, v) {
    if (!inp || inp.value === v) return;
    this.writing = true;
    inp.value = v;
    inp.setCustomValidity && inp.setCustomValidity('');
    inp.dispatchEvent(new Event('input', { bubbles: true }));
    inp.dispatchEvent(new Event('change', { bubbles: true }));
    this.writing = false;
  };
  Picker.prototype.pick = function (d) {
    this.focusDate = d;
    if (d < this.min) { this.say(onward(this.min), true); return; }
    if (this.range) {
      var a = this.a.value;
      if (this.phaseEnd() && d > a) {
        var lim = this.limitAfter(a);
        if (lim && d > lim) { this.say('Your stay can’t run past a booked night (' + shortDate(lim) + '). Choose an earlier check-out, or another check-in date.', true); return; }
        this.write(this.b, d);
        this.prev = null;
        var n = nightsBetween(a, d);
        this.say(shortDate(a) + ' – ' + shortDate(d, true) + ': ' + n + ' night' + (n === 1 ? '' : 's') + '.');
      } else {
        if (this.bookedNight(d)) { this.say('The night of ' + shortDate(d) + ' is booked. Choose another check-in date.', true); return; }
        if (!this.phaseEnd()) this.prev = { a: this.a.value, b: this.b.value };
        this.write(this.b, '');
        this.write(this.a, d);
        this.say('Check-in ' + shortDate(d) + '. Now choose your check-out date.');
      }
    } else {
      var info = this.dayInfo(d);
      if (info.full) { this.say(shortDate(d, true) + ' is booked. Choose another date.', true); return; }
      this.write(this.a, d);
      if (info.parts.length) {
        this.say('Some hours are already booked on ' + shortDate(d) + ': ' + info.parts.map(function (p) { return time12(p.from) + ' – ' + time12(p.to); }).join(', ') + '. Pick times that don’t overlap.');
      } else this.say(shortDate(d, true) + ' selected.');
    }
    this.render();
  };
  Picker.prototype.onKey = function (e) {
    var b = e.target.closest('.dp-day');
    if (!b) return;
    var d = b.getAttribute('data-date'), nd = null, wd = parse(d).getUTCDay();
    switch (e.key) {
      case 'ArrowLeft': nd = addDays(d, -1); break;
      case 'ArrowRight': nd = addDays(d, 1); break;
      case 'ArrowUp': nd = addDays(d, -7); break;
      case 'ArrowDown': nd = addDays(d, 7); break;
      case 'Home': nd = addDays(d, -wd); break;
      case 'End': nd = addDays(d, 6 - wd); break;
      case 'PageUp': nd = addMonths(d, -1).slice(0, 8) + d.slice(8); break;
      case 'PageDown': nd = addMonths(d, 1).slice(0, 8) + d.slice(8); break;
      case 'Escape':
        if (this.phaseEnd() && this.prev) {
          e.preventDefault(); e.stopPropagation();
          this.write(this.a, this.prev.a); this.write(this.b, this.prev.b); this.prev = null;
          this.say('Date change cancelled.'); this.render();
        }
        return;
      default: return;
    }
    e.preventDefault();
    if (!parse(nd)) { var p = parse(nd.slice(0, 8) + '01'); nd = ymd(new Date(Date.UTC(p.getUTCFullYear(), p.getUTCMonth() + 1, 0))); }
    if (nd < this.min) nd = this.min;
    this.focusDate = nd;
    var n = this.count();
    var lastMonth = addMonths(this.view, n - 1);
    if (monthStart(nd) < this.view) this.view = monthStart(nd);
    else if (monthStart(nd) > lastMonth) this.view = addMonths(monthStart(nd), -(n - 1));
    var target = this.monthsBox.querySelector('[data-date="' + nd + '"]');
    if (target) {
      this.monthsBox.querySelectorAll('.dp-day[tabindex="0"]').forEach(function (x) { x.tabIndex = -1; });
      target.tabIndex = 0; target.focus();
    } else { this.render(); var t2 = this.monthsBox.querySelector('[data-date="' + nd + '"]'); if (t2) t2.focus(); }
  };
  Picker.prototype.setBlocked = function (list) { this.blocked = Array.isArray(list) ? list : []; this.say(''); this.render(); };
  Picker.prototype.destroy = function () { if (this.ro) this.ro.disconnect(); this.root.innerHTML = ''; this.root.classList.remove('dp'); };

  window.BrDatePicker = {
    create: function (root, opts) { return root && opts && opts.start ? new Picker(root, opts) : null; },
    onward: onward,
    shortDate: shortDate
  };
})();
