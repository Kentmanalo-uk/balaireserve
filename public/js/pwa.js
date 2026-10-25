/**
 * Balai-Reserve — installable app (PWA)
 *
 * Registers the service worker (public/sw.js) and wires any [data-install-app] button:
 * hidden until the browser offers installation, then it opens the install prompt.
 * On iPhone/iPad (no install prompt) the button explains "Share → Add to Home Screen".
 */
(function () {
  'use strict';
  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
    window.addEventListener('load', function () {
      navigator.serviceWorker.register('/sw.js').catch(function () {});
    });
  }

  var standalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
  if (standalone) document.documentElement.classList.add('is-app');
  var buttons = document.querySelectorAll('[data-install-app]');
  if (!buttons.length || standalone) return;

  var deferred = null;
  var ios = /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  function show(on) { buttons.forEach(function (b) { b.hidden = !on; }); }

  window.addEventListener('beforeinstallprompt', function (e) {
    e.preventDefault();
    deferred = e;
    show(true);
  });
  window.addEventListener('appinstalled', function () { deferred = null; show(false); });
  if (ios) show(true);

  buttons.forEach(function (b) {
    b.addEventListener('click', function () {
      if (deferred) {
        deferred.prompt();
        deferred.userChoice.finally(function () { deferred = null; show(false); });
      } else if (ios) {
        alert('To install Balai-Reserve: tap the Share button, then "Add to Home Screen".');
      }
    });
  });
})();
