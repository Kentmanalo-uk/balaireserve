/**
 * Balai-Reserve — designed date & time fields
 *
 * Turns a native <input type="date|time" data-picker> into a styled button that opens a popover
 * (a bottom sheet on phones). The native input stays in the form and keeps the value, so form
 * submits, validation and other scripts work unchanged. Without JavaScript the native input is used.
 *
 *   data-picker="date" data-range-end="id"     check-in: one calendar picks both dates while the
 *   data-picker="date" data-range-start="id"   check-out input is enabled (rooms), else one date
 *   data-picker="time" data-push="id"          time in: moves the paired time out along when needed
 *   data-picker="time" data-after="id"         time out: only times after the paired time in
 *
 * The calendar is public/js/br-datepicker.js (BrDatePicker).
 */
(function () {
  'use strict';
  if (!window.BrDatePicker) return;

  var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  var DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  var TIME_GROUPS = [['Morning', 360, 690], ['Afternoon', 720, 1050], ['Evening', 1080, 1410]];   // 6:00 AM – 11:30 PM, every 30 min
  var phone = window.matchMedia('(max-width: 575.98px)');
  var reduce = window.matchMedia('(prefers-reduced-motion: reduce)');
  var fields = [];
  var calendars = {};
  var pop, scrim, title, body, current = null, hideTimer = 0;

  function byId(id) { return id ? document.getElementById(id) : null; }
  function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function minutes(t) { var m = /^(\d{1,2}):(\d{2})/.exec(t || ''); return m ? +m[1] * 60 + +m[2] : null; }
  function hhmm(n) { return pad(Math.floor(n / 60)) + ':' + pad(n % 60); }
  function timeText(t) { var n = minutes(t); if (n == null) return t; var h = Math.floor(n / 60); return (h % 12 || 12) + ':' + pad(n % 60) + ' ' + (h >= 12 ? 'PM' : 'AM'); }
  function dateText(v) { var d = new Date(v + 'T00:00:00Z'); return isNaN(d) ? v : DAYS[d.getUTCDay()] + ', ' + MONTHS[d.getUTCMonth()] + ' ' + d.getUTCDate(); }
  function span(mins) { return mins < 60 ? mins + ' min' : (mins / 60) + ' hr'; }
  function localToday() { var n = new Date(); return new Date(n.getTime() - n.getTimezoneOffset() * 60000).toISOString().slice(0, 10); }
  function labelOf(input) { return document.querySelector('label[for="' + input.id + '"]'); }

  function write(input, v) {
    if (!input || input.value === v) return;
    input.value = v;
    if (input.setCustomValidity) input.setCustomValidity('');
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }

  // ── The trigger that stands in for each native input ──────────────────────
  function enhance(input) {
    var type = input.getAttribute('data-picker');
    var label = labelOf(input);
    if (label && !label.id) label.id = input.id + 'Label';
    var btn = el('button', 'pk-trigger');
    btn.type = 'button';
    btn.setAttribute('aria-haspopup', 'dialog');
    btn.setAttribute('aria-expanded', 'false');
    var val = el('span', 'pk-value');
    val.id = input.id + 'Value';
    btn.appendChild(val);
    btn.insertAdjacentHTML('beforeend', '<i class="fa-regular fa-' + (type === 'time' ? 'clock' : 'calendar') + ' pk-icon" aria-hidden="true"></i>');
    if (label) btn.setAttribute('aria-labelledby', label.id + ' ' + val.id);
    input.classList.add('pk-native');
    input.tabIndex = -1;
    input.setAttribute('aria-hidden', 'true');
    input.parentNode.insertBefore(btn, input.nextSibling);

    var f = { input: input, btn: btn, type: type, label: label };
    f.sync = function () {
      var v = input.value;
      val.textContent = v ? (type === 'time' ? timeText(v) : dateText(v)) : (type === 'time' ? 'Add time' : 'Add date');
      btn.classList.toggle('is-empty', !v);
      btn.disabled = input.disabled;
    };
    f.sync();
    fields.push(f);

    input.addEventListener('focus', function () { btn.focus(); });   // e.g. a script focusing the field to show an error
    if (label) label.addEventListener('click', function (e) { e.preventDefault(); if (!btn.disabled) open(f); });
    btn.addEventListener('click', function () { if (current && current.f === f) close(true); else open(f); });
    new MutationObserver(f.sync).observe(input, { attributes: true, attributeFilter: ['disabled'] });
  }
  function syncAll() { fields.forEach(function (f) { f.sync(); }); }

  // ── Popover / sheet shell ─────────────────────────────────────────────────
  function build() {
    scrim = el('div', 'pk-scrim');
    scrim.hidden = true;
    pop = el('div', 'pk-pop');
    pop.hidden = true;
    pop.setAttribute('role', 'dialog');
    pop.setAttribute('aria-labelledby', 'pkTitle');
    var head = el('div', 'pk-head');
    title = el('p', 'pk-title');
    title.id = 'pkTitle';
    var x = el('button', 'pk-x');
    x.type = 'button';
    x.setAttribute('aria-label', 'Close');
    x.innerHTML = '<i class="fas fa-xmark" aria-hidden="true"></i>';
    head.appendChild(title); head.appendChild(x);
    body = el('div', 'pk-body');
    var foot = el('div', 'pk-foot');
    var clear = el('button', 'pk-clear', 'Clear');
    clear.type = 'button';
    var done = el('button', 'pk-done', 'Done');
    done.type = 'button';
    foot.appendChild(clear); foot.appendChild(done);
    pop.appendChild(head); pop.appendChild(body); pop.appendChild(foot);
    document.body.appendChild(scrim);
    document.body.appendChild(pop);

    x.addEventListener('click', function () { close(true); });
    done.addEventListener('click', function () { close(true); });
    clear.addEventListener('click', function () { if (current && current.clear) current.clear(); });
    pop.addEventListener('keydown', function (e) { if (e.key === 'Escape') { e.preventDefault(); close(true); } });
    document.addEventListener('pointerdown', function (e) {
      if (!current || pop.contains(e.target) || current.f.btn.contains(e.target) || (current.f.label && current.f.label.contains(e.target))) return;
      close(false);
    }, true);
    document.addEventListener('focusin', function (e) {
      if (current && !pop.contains(e.target) && e.target !== current.f.btn) close(false);
    });
    window.addEventListener('resize', place);
    if (phone.addEventListener) phone.addEventListener('change', place);
  }

  function place() {
    if (!current) return;
    var sheet = phone.matches;
    pop.classList.toggle('is-sheet', sheet);
    scrim.hidden = !sheet;
    document.documentElement.classList.toggle('pk-lock', sheet);
    if (sheet) { pop.style.left = pop.style.top = ''; return; }
    var r = current.anchor.getBoundingClientRect();
    var vw = document.documentElement.clientWidth, w = pop.offsetWidth, h = pop.offsetHeight;
    var left = Math.min(Math.max(16, r.left), vw - w - 16);
    var top = r.bottom + 10, above = false;
    if (top + h > window.innerHeight - 12 && r.top - h - 10 > 12) { top = r.top - h - 10; above = true; }
    pop.classList.toggle('is-above', above);
    pop.style.left = (left + window.scrollX) + 'px';
    pop.style.top = (top + window.scrollY) + 'px';
  }

  function open(f) {
    if (!pop) build();
    if (current) close(false);
    clearTimeout(hideTimer);
    body.innerHTML = '';
    var c = { f: f, anchor: f.btn.closest('.field') || f.btn, focus: null, cleanup: [] };
    if (f.type === 'time') setupTime(c); else setupDate(c);
    pop.className = 'pk-pop pk-pop--' + c.kind;
    current = c;
    f.btn.setAttribute('aria-expanded', 'true');
    pop.hidden = false;
    place();
    void pop.offsetWidth;                         // start the entrance from its first frame
    pop.classList.add('is-in');
    scrim.classList.add('is-in');
    if (!phone.matches) {
      var r = pop.getBoundingClientRect();
      if (r.bottom > window.innerHeight) window.scrollBy({ top: r.bottom - window.innerHeight + 16, behavior: reduce.matches ? 'auto' : 'smooth' });
    }
    var target = c.focus || pop.querySelector('.dp-day[tabindex="0"]') || pop.querySelector('.pk-done');
    if (target) target.focus({ preventScroll: true });
    if (c.after) c.after();
  }

  function close(returnFocus) {
    if (!current) return;
    var c = current;
    current = null;
    c.cleanup.forEach(function (fn) { fn(); });
    c.f.btn.setAttribute('aria-expanded', 'false');
    pop.classList.remove('is-in');
    scrim.classList.remove('is-in');
    document.documentElement.classList.remove('pk-lock');
    hideTimer = setTimeout(function () { pop.hidden = true; scrim.hidden = true; }, reduce.matches ? 0 : 240);
    syncAll();
    if (returnFocus) c.f.btn.focus({ preventScroll: true });
  }

  // ── Dates: the shared availability calendar, in range mode for stays ──────
  function setupDate(c) {
    var input = c.f.input;
    var start = byId(input.getAttribute('data-range-start')) || input;
    var end = start === input ? byId(input.getAttribute('data-range-end')) : input;
    var range = !!(end && !end.disabled);
    if (!range) end = null;
    var months = range && !phone.matches && window.innerWidth >= 768 ? 2 : 1;
    var key = start.id + '|' + (end ? end.id : '') + '|' + months;
    var cal = calendars[key];
    if (!cal) {
      var root = el('div', 'pk-cal');
      cal = calendars[key] = { root: root, dp: BrDatePicker.create(root, { start: start, end: end, nightly: range, min: start.min || localToday(), months: months }) };
    }
    // Opened from check-out with both dates set: pick a new check-out (kept if nothing is chosen).
    var restore = null;
    if (range && input === end && start.value && end.value) { restore = end.value; write(end, ''); }
    var dp = cal.dp;
    var at = (range && input === end && start.value) || start.value || dp.min;
    dp.view = at.slice(0, 8) + '01';
    dp.focusDate = range && input === end && start.value ? start.value : (start.value || dp.min);
    dp.say('');
    dp.render();
    body.appendChild(cal.root);

    c.kind = range ? 'range' : 'date';
    title.textContent = range ? 'Your stay' : (c.f.label ? c.f.label.textContent : 'Choose a date');
    if (range) c.anchor = start.closest('.field') || c.anchor;
    c.clear = function () { restore = null; if (end) write(end, ''); write(start, ''); dp.say(''); dp.render(); syncAll(); };
    var done = function () {
      syncAll();
      if (range ? (start.value && end.value) : start.value) setTimeout(function () { if (current === c) close(true); }, reduce.matches ? 0 : 260);
    };
    [start, end].forEach(function (i) { if (i) { i.addEventListener('change', done); c.cleanup.push(function () { i.removeEventListener('change', done); }); } });
    c.cleanup.push(function () { if (restore && end && !end.value && start.value && restore > start.value) write(end, restore); });
  }

  // ── Times: chips every 30 minutes, grouped by part of the day ──────────────
  function setupTime(c) {
    var input = c.f.input;
    var after = byId(input.getAttribute('data-after'));
    var push = byId(input.getAttribute('data-push'));
    var floor = after && !after.disabled ? minutes(after.value) : null;
    var cur = minutes(input.value);
    var all = [];
    TIME_GROUPS.forEach(function (g) {
      var group = el('div', 'pk-tgroup');
      group.setAttribute('role', 'group');
      var head = el('p', 'pk-tlabel', g[0]);
      head.id = 'pkT' + g[1];
      group.setAttribute('aria-labelledby', head.id);
      var grid = el('div', 'pk-tgrid');
      for (var m = g[1]; m <= g[2]; m += 30) {
        var b = el('button', 'pk-time');
        b.type = 'button';
        b.setAttribute('data-v', hhmm(m));
        b.appendChild(el('span', null, timeText(hhmm(m))));
        var label = timeText(hhmm(m));
        if (floor != null && m <= floor) { b.setAttribute('aria-disabled', 'true'); label += ', before ' + timeText(after.value); }
        else if (floor != null) { b.appendChild(el('small', null, span(m - floor))); label += ', ' + span(m - floor).replace('hr', 'hours').replace('min', 'minutes'); }
        if (m === cur) { b.classList.add('is-sel'); b.setAttribute('aria-pressed', 'true'); }
        b.setAttribute('aria-label', label);
        b.tabIndex = -1;
        grid.appendChild(b);
        all.push(b);
      }
      group.appendChild(head); group.appendChild(grid);
      body.appendChild(group);
    });
    var sel = body.querySelector('.pk-time.is-sel') || body.querySelector('.pk-time:not([aria-disabled])') || all[0];
    sel.tabIndex = 0;
    c.focus = sel;
    c.kind = 'time';
    title.textContent = c.f.label ? c.f.label.textContent : 'Choose a time';
    c.after = function () {   // centre the chosen time in whichever box scrolls (the list, or the whole sheet on phones)
      var box = body.scrollHeight > body.clientHeight + 1 ? body : pop;
      var top = sel.offsetTop + (box === pop ? body.offsetTop : 0);
      box.scrollTop = Math.max(0, top - box.clientHeight / 2 + sel.offsetHeight / 2);
    };

    var choose = function (b) {
      if (b.getAttribute('aria-disabled') === 'true') return;
      var m = minutes(b.getAttribute('data-v'));
      if (push && !push.disabled) {
        var pv = minutes(push.value);
        if (pv != null && pv <= m) {
          var keep = cur != null && pv > cur ? pv - cur : 120;   // keep the same length of stay
          write(push, hhmm(Math.min(m + keep, 1439)));
        }
      }
      write(input, b.getAttribute('data-v'));
      close(true);
    };
    var onClick = function (e) { var b = e.target.closest('.pk-time'); if (b) choose(b); };
    var onKey = function (e) {
      var b = e.target.closest('.pk-time');
      if (!b) return;
      var i = all.indexOf(b), cols = getComputedStyle(b.parentNode).gridTemplateColumns.split(' ').length, n = null;
      switch (e.key) {
        case 'ArrowLeft': n = i - 1; break;
        case 'ArrowRight': n = i + 1; break;
        case 'ArrowUp': n = i - cols; break;
        case 'ArrowDown': n = i + cols; break;
        case 'Home': n = 0; break;
        case 'End': n = all.length - 1; break;
        default: return;
      }
      e.preventDefault();
      n = Math.max(0, Math.min(all.length - 1, n));
      b.tabIndex = -1; all[n].tabIndex = 0; all[n].focus();
    };
    body.addEventListener('click', onClick);
    body.addEventListener('keydown', onKey);
    c.cleanup.push(function () { body.removeEventListener('click', onClick); body.removeEventListener('keydown', onKey); });
  }

  document.querySelectorAll('input[data-picker]').forEach(enhance);
  if (!fields.length) return;
  // Other scripts set values directly (e.g. clearing check-out); keep the buttons current.
  document.addEventListener('change', syncAll);
  document.addEventListener('input', syncAll);
})();
