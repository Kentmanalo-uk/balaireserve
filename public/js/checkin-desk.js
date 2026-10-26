/**
 * Balai-Reserve — check-in desk (views/checkin/desk.xian)
 *
 * - The QR guests scan changes every 30 seconds: the new one comes from GET /checkin/desk/code just as the
 *   old one rolls over, and a thin bar shows the time left.
 * - The arrivals / in-house lists reload from GET /checkin/desk/lists every 15 seconds, so a guest who
 *   checks in with their phone shows up here; the desk hears a short chime when that happens.
 * - Booking ref: GET /checkin/lookup, then POST /checkin/booking/:id (rules in src/utils/checkin.js).
 * Polling pauses while the page is hidden.
 */
(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  var qrBox = $('ckQr'), bar = $('ckQrBar'), note = $('ckQrNote'), show = $('ckShow'), fullBtn = $('ckFull');
  var lists = $('ckLists'), result = $('ckResult'), manual = $('ckManual'), codeInput = $('ckCode');
  if (!qrBox || !lists) return;

  var peso = function (n) { return '₱' + Number(n || 0).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); };
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  var t12 = function (t) { var m = /^(\d{1,2}):(\d{2})/.exec(t || ''); if (!m) return ''; var h = +m[1]; return (h % 12 || 12) + ':' + m[2] + ' ' + (h >= 12 ? 'PM' : 'AM'); };
  var day = function (d) { return d ? new Date(d + 'T00:00:00Z').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' }) : ''; };
  var clock = function (iso) { return iso ? new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Manila' }) : ''; };
  var getJson = function (url) { return fetch(url, { headers: { Accept: 'application/json' }, credentials: 'same-origin', cache: 'no-store' }).then(function (r) { return r.json(); }); };

  function chime() {
    try { if (navigator.vibrate) navigator.vibrate(60); } catch (e) {}
    try {
      var A = window.AudioContext || window.webkitAudioContext; if (!A) return;
      var ac = new A(), o = ac.createOscillator(), g = ac.createGain();
      o.frequency.value = 880; g.gain.value = 0.06; o.connect(g); g.connect(ac.destination); o.start(); o.stop(ac.currentTime + 0.12);
      o.onended = function () { ac.close(); };
    } catch (e) {}
  }

  // ── Live QR ───────────────────────────────────────────────────────────────
  var windowMs = Number(qrBox.getAttribute('data-window')) || 30000;
  var nextAt = Date.now() + (Number(qrBox.getAttribute('data-refresh')) || windowMs), qrTimer = 0, failures = 0;
  function animateBar() {
    if (!bar) return;
    var left = Math.max(0, nextAt - Date.now());
    bar.style.transition = 'none';
    bar.style.transform = 'scaleX(' + (left / windowMs) + ')';
    void bar.offsetWidth;   // restart the transition from the current width
    bar.style.transition = 'transform ' + left + 'ms linear';
    bar.style.transform = 'scaleX(0)';
  }
  function scheduleQr() { clearTimeout(qrTimer); qrTimer = setTimeout(refreshQr, Math.max(250, nextAt - Date.now() + 150)); animateBar(); }
  function refreshQr() {
    if (document.hidden) return;
    getJson('/checkin/desk/code').then(function (d) {
      qrBox.innerHTML = d.svg; failures = 0;
      nextAt = Date.now() + d.refreshInMs;
      qrBox.classList.remove('is-stale'); note.textContent = 'The code changes every 30 seconds.';
      scheduleQr();
    }).catch(function () {
      // Offline: the shown code still works for about 2 minutes, then guests can't use it.
      failures++;
      if (failures > 3) { qrBox.classList.add('is-stale'); note.textContent = 'Can’t reach the server — this code will stop working. Check the connection.'; }
      nextAt = Date.now() + 5000; scheduleQr();
    });
  }
  scheduleQr();

  if (fullBtn && show.requestFullscreen) {
    fullBtn.addEventListener('click', function () {
      if (document.fullscreenElement) document.exitFullscreen(); else show.requestFullscreen().catch(function () {});
    });
    document.addEventListener('fullscreenchange', function () {
      var on = document.fullscreenElement === show;
      show.classList.toggle('is-full', on);
      fullBtn.lastChild.textContent = on ? 'Exit full screen' : 'Full screen';
    });
  } else if (fullBtn) fullBtn.hidden = true;

  // ── Lists ─────────────────────────────────────────────────────────────────
  var inHouseIds = function () { return Array.prototype.map.call(lists.querySelectorAll('#ckInHouse li'), function (li) { return li.getAttribute('data-id'); }); };
  var known = inHouseIds();
  function refreshLists() {
    if (document.hidden) return;
    fetch('/checkin/desk/lists', { credentials: 'same-origin', cache: 'no-store' }).then(function (r) { return r.ok ? r.text() : null; }).then(function (html) {
      if (!html) return;
      if (lists.contains(document.activeElement)) return;   // don't pull the list from under someone's click
      lists.innerHTML = html;
      var now = inHouseIds(), fresh = now.filter(function (id) { return known.indexOf(id) === -1; });
      fresh.forEach(function (id) { var li = lists.querySelector('#ckInHouse li[data-id="' + id + '"]'); if (li) li.classList.add('is-new'); });
      if (fresh.length) chime();
      known = now;
      if (window.ikionsRender) window.ikionsRender(lists);
      updateTimes();
    }).catch(function () {});
  }
  setInterval(refreshLists, 15000);
  document.addEventListener('visibilitychange', function () { if (!document.hidden) { refreshQr(); refreshLists(); } });

  function span(ms) {
    var m = Math.max(0, Math.round(ms / 60000)), d = Math.floor(m / 1440), h = Math.floor((m % 1440) / 60), mm = m % 60;
    return d ? d + 'd ' + h + 'h' : h ? h + 'h ' + mm + 'm' : mm + 'm';
  }
  function updateTimes() {
    var now = Date.now();
    Array.prototype.forEach.call(lists.querySelectorAll('#ckInHouse li'), function (li) {
      var inAt = li.getAttribute('data-in'), due = li.getAttribute('data-due');
      var el = li.querySelector('[data-ck-elapsed]'); if (el && inAt) el.textContent = 'in for ' + span(now - new Date(inAt).getTime());
      var left = li.querySelector('[data-ck-left]');
      if (left && due) {
        var diff = new Date(due + ':00+08:00').getTime() - now;
        left.textContent = diff >= 0 ? '(' + span(diff) + ' left)' : '(' + span(-diff) + ' over)';
        li.classList.toggle('is-over', diff < 0);
        li.classList.toggle('is-soon', diff >= 0 && diff < 3600000);
      }
    });
  }
  updateTimes();
  setInterval(updateTimes, 30000);

  // ── Check in by booking ref ───────────────────────────────────────────────
  function showError(msg) {
    result.hidden = false;
    result.innerHTML = '<div class="ck-card is-bad"><p class="ck-card-state"><i class="fas fa-circle-exclamation" aria-hidden="true"></i>' + esc(msg) + '</p>' +
      '<div class="ck-actions"><button type="button" class="btn btn-outline-secondary" data-ck-next>Close</button></div></div>';
    if (window.ikionsRender) window.ikionsRender(result);
  }
  function lookup(code) {
    result.hidden = false; result.innerHTML = '<p class="ck-loading">Looking up the booking…</p>';
    getJson('/checkin/lookup?code=' + encodeURIComponent(code)).then(function (data) {
      if (!data.found) return showError(data.reason || 'No booking matches that reference.');
      render(data.booking);
    }).catch(function () { showError('Couldn’t reach the server. Check the connection and try again.'); });
  }
  function render(b) {
    var range = b.startDate === b.endDate ? day(b.startDate) : day(b.startDate) + ' – ' + day(b.endDate);
    var times = [t12(b.startTime), t12(b.endTime)].filter(Boolean).join(' – ');
    var state = b.code === 'already' ? '<p class="ck-card-state is-ok"><i class="fas fa-circle-check" aria-hidden="true"></i>Already checked in' + (b.checkedInAt ? ' at ' + esc(clock(b.checkedInAt)) : '') + '</p>'
      : b.canCheckIn ? '<p class="ck-card-state is-ok"><i class="fas fa-circle-check" aria-hidden="true"></i>Ready to check in</p>'
      : '<p class="ck-card-state is-bad"><i class="fas fa-circle-exclamation" aria-hidden="true"></i>' + esc(b.reason) + '</p>';
    var warn = (b.warnings || []).map(function (w) { return '<li><i class="fas fa-triangle-exclamation" aria-hidden="true"></i>' + esc(w) + '</li>'; }).join('');
    var actions = b.canCheckIn
      ? '<button type="button" class="btn btn-primary btn-lg" data-ck-checkin="' + b.id + '"><i class="fas fa-check me-2" aria-hidden="true"></i>Check in now</button>'
      : (b.code === 'unpaid' ? '<a class="btn btn-primary btn-lg" href="/reservations/' + b.id + '#payments"><i class="fas fa-money-bill-wave me-2" aria-hidden="true"></i>Record the payment</a>' : '');
    result.hidden = false;
    result.innerHTML =
      '<div class="ck-card' + (b.canCheckIn || b.code === 'already' ? '' : ' is-bad') + '">' + state +
      '<h3 class="ck-card-name">' + esc(b.guest) + '</h3>' +
      '<dl class="ck-card-facts">' +
        '<div><dt>Booking</dt><dd class="ap-code">' + esc(b.ref) + '</dd></div>' +
        (b.items.length ? '<div><dt>Booked</dt><dd>' + esc(b.items.join(', ')) + '</dd></div>' : '') +
        '<div><dt>Stay</dt><dd>' + esc(range) + (times ? ' · ' + esc(times) : '') + '</dd></div>' +
        '<div><dt>Guests</dt><dd>' + esc(b.guests) + '</dd></div>' +
        '<div><dt>Paid</dt><dd>' + peso(b.paid) + ' of ' + peso(b.total) + (b.balance > 0 ? ' <span class="ck-due">· balance ' + peso(b.balance) + '</span>' : '') + '</dd></div>' +
      '</dl>' +
      (warn && b.canCheckIn ? '<ul class="ck-warn">' + warn + '</ul>' : '') +
      '<div class="ck-actions">' + actions +
        '<a class="btn btn-outline-secondary" href="/reservations/' + b.id + '">Open reservation</a>' +
        '<button type="button" class="btn btn-outline-secondary" data-ck-next>Close</button></div>' +
      '</div>';
    if (window.ikionsRender) window.ikionsRender(result);
    var go = result.querySelector('[data-ck-checkin]'); if (go) go.focus({ preventScroll: true });
    result.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }
  function checkIn(btn) {
    var id = btn.getAttribute('data-ck-checkin');
    btn.disabled = true; btn.setAttribute('aria-busy', 'true'); btn.textContent = 'Checking in…';
    fetch('/checkin/booking/' + id, { method: 'POST', credentials: 'same-origin',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' }, body: JSON.stringify({ method: 'manual' }) })
      .then(function (r) { return r.json(); })
      .then(function (data) {
        if (!data.ok) return showError(data.reason || 'Check-in failed.');
        var b = data.booking;
        known.push(String(b.id));   // staff did this one: no chime when the list reloads
        result.innerHTML = '<div class="ck-card is-done"><p class="ck-card-state is-ok"><i class="fas fa-circle-check" aria-hidden="true"></i>Checked in</p>' +
          '<h3 class="ck-card-name">Welcome, ' + esc(b.guest.split(' ')[0]) + '!</h3>' +
          '<dl class="ck-card-facts"><div><dt>Time in</dt><dd>' + esc(clock(b.checkedInAt)) + '</dd></div>' +
          (b.dueOut ? '<div><dt>Time out</dt><dd>' + esc(day(b.dueOut.slice(0, 10))) + ' · ' + esc(t12(b.dueOut.slice(11, 16))) + '</dd></div>' : '') +
          (b.balance > 0 ? '<div><dt>Balance</dt><dd class="ck-due">' + peso(b.balance) + ' — collect before check-out</dd></div>' : '') +
          '</dl><div class="ck-actions"><a class="btn btn-outline-secondary" href="/reservations/' + b.id + '">Open reservation</a>' +
          '<button type="button" class="btn btn-outline-secondary" data-ck-next>Close</button></div></div>';
        if (window.ikionsRender) window.ikionsRender(result);
        refreshLists();
      })
      .catch(function () { showError('Couldn’t reach the server. Check the connection and try again.'); });
  }
  result.addEventListener('click', function (e) {
    var c = e.target.closest('[data-ck-checkin]'); if (c) return checkIn(c);
    if (e.target.closest('[data-ck-next]')) { result.hidden = true; result.innerHTML = ''; codeInput.value = ''; codeInput.focus(); }
  });
  manual.addEventListener('submit', function (e) { e.preventDefault(); var v = codeInput.value.trim(); if (v) lookup(v); });
  lists.addEventListener('click', function (e) {
    var b = e.target.closest('[data-ck-lookup]'); if (!b) return;
    codeInput.value = b.getAttribute('data-ck-lookup'); lookup(codeInput.value);
  });
})();
