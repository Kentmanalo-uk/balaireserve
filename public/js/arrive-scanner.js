/**
 * Balai-Reserve — guest scanner for the resort's check-in QR (views/arrive/scan.xian)
 *
 * For phones whose camera app doesn't open QR links. Reads the QR with the browser's own
 * BarcodeDetector where it exists, otherwise jsQR (loaded on demand from jsDelivr), and opens the
 * /arrive/<code> link it holds on this site (the QR may name another address for the same server,
 * e.g. the resort's Wi-Fi address, so only the path is used).
 */
(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  var video = $('arVideo'), finder = $('arViewfinder'), idle = $('arIdle'), idleText = $('arIdleText'), startBtn = $('arStart'), msg = $('arMsg');
  if (!video || !finder) return;

  var JSQR_URL = 'https://cdn.jsdelivr.net/npm/jsqr@1.4.0/dist/jsQR.min.js';
  var stream = null, detector = null, decode = null, scanning = false, starting = false, timer = 0, canvas = null, ctx2d = null, lastBad = '';

  function setIdle(text, showStart) {
    finder.setAttribute('data-state', 'idle');
    idle.hidden = false; idleText.textContent = text; startBtn.hidden = !showStart;
  }
  function stopCamera() {
    scanning = false; clearTimeout(timer);
    if (stream) stream.getTracks().forEach(function (t) { t.stop(); });
    stream = null; video.srcObject = null;
  }
  async function loadDecoder() {
    if ('BarcodeDetector' in window) {
      try {
        var formats = await window.BarcodeDetector.getSupportedFormats();
        if (formats.indexOf('qr_code') !== -1) { detector = new window.BarcodeDetector({ formats: ['qr_code'] }); return; }
      } catch (e) { /* fall back to jsQR */ }
    }
    if (!window.jsQR) await new Promise(function (ok, fail) { var s = document.createElement('script'); s.src = JSQR_URL; s.onload = ok; s.onerror = fail; document.head.appendChild(s); });
    canvas = document.createElement('canvas'); ctx2d = canvas.getContext('2d', { willReadFrequently: true });
    decode = function () {
      var w = video.videoWidth, h = video.videoHeight; if (!w || !h) return null;
      var scale = Math.min(1, 720 / Math.max(w, h)); canvas.width = Math.round(w * scale); canvas.height = Math.round(h * scale);
      ctx2d.drawImage(video, 0, 0, canvas.width, canvas.height);
      var img = ctx2d.getImageData(0, 0, canvas.width, canvas.height);
      var hit = window.jsQR(img.data, img.width, img.height, { inversionAttempts: 'attemptBoth' });
      return hit ? hit.data : null;
    };
  }
  async function startCamera() {
    if (starting || stream) return;   // the auto-start and a tap on Start must not race each other
    starting = true;
    try { await openCamera(); } finally { starting = false; }
  }
  async function openCamera() {
    if (!window.isSecureContext || !navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      setIdle('This browser can’t use the camera here. Open your phone’s camera app and point it at the QR instead.', false); return;
    }
    setIdle('Starting the camera…', false);
    try {
      if (!detector && !decode) await loadDecoder();
      stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } } });
      video.srcObject = stream; await video.play();
      finder.setAttribute('data-state', 'live'); idle.hidden = true;
      scanning = true; tick();
    } catch (e) {
      stopCamera();
      setIdle(e && e.name === 'NotAllowedError'
        ? 'Camera access was blocked. Allow the camera for this site in your browser settings, or use your phone’s camera app.'
        : 'The camera couldn’t start. Use your phone’s camera app to scan the QR instead.', true);
    }
  }
  async function tick() {
    if (!scanning) return;
    if (!document.hidden && video.readyState >= 2) {
      try {
        var code = null;
        if (detector) { var found = await detector.detect(video); code = found && found[0] ? found[0].rawValue : null; }
        else if (decode) code = decode();
        if (code) onCode(code);
      } catch (e) { /* a bad frame; keep going */ }
    }
    if (scanning) timer = setTimeout(function () { requestAnimationFrame(tick); }, 120);
  }
  function onCode(code) {
    var path = '';
    try { path = new URL(code, location.href).pathname; } catch (e) {}
    if (path.indexOf('/arrive/') === 0 && path.length > 8) {
      stopCamera(); finder.setAttribute('data-state', 'found');
      try { if (navigator.vibrate) navigator.vibrate(60); } catch (e) {}
      msg.hidden = false; msg.className = 'ar-msg'; msg.textContent = 'Got it — opening your check-in…';
      location.href = path;
      return;
    }
    if (code !== lastBad) {
      lastBad = code;
      msg.hidden = false; msg.className = 'ar-msg is-bad';
      msg.textContent = 'That isn’t the resort’s check-in QR. Point the camera at the QR at the front desk.';
    }
  }
  startBtn.addEventListener('click', startCamera);
  document.addEventListener('visibilitychange', function () { if (document.hidden && stream) { stopCamera(); setIdle('Camera paused.', true); } });
  window.addEventListener('pagehide', stopCamera);
  if (navigator.permissions && navigator.permissions.query) {
    navigator.permissions.query({ name: 'camera' }).then(function (p) { if (p.state === 'granted') startCamera(); }).catch(function () {});
  }
})();
