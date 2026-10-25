/**
 * Balai-Reserve — hero scroll parallax, fallback (landing page)
 *
 * Browsers with CSS scroll-driven animations do the parallax in landing.css ("Hero parallax"),
 * on the compositor; this script then does nothing. Elsewhere it applies the same numbers
 * straight from the scroll position, once per frame: photo 0.38 × scroll (up to 380px), words
 * drift 0.22 × scroll and fade over 460px, card lifts up to 44px. Off with reduced motion.
 */
(function () {
  'use strict';
  if (window.CSS && CSS.supports && CSS.supports('animation-timeline: scroll()')) return;
  var hero = document.getElementById('home');
  if (!hero) return;
  var reduce = window.matchMedia('(prefers-reduced-motion: reduce)');
  var media = hero.querySelector('.hero-media');
  var copy = hero.querySelector('.hero-copy');
  var card = document.querySelector('.dock-wrap .search');
  var frame = 0;

  function paint() {
    frame = 0;
    var y = reduce.matches ? 0 : Math.max(0, window.scrollY);
    if (media) media.style.transform = y ? 'translate3d(0,' + Math.min(y * 0.38, 380).toFixed(1) + 'px,0)' : '';
    if (copy) {
      copy.style.transform = y ? 'translate3d(0,' + Math.min(y * 0.22, 101).toFixed(1) + 'px,0)' : '';
      copy.style.opacity = y ? Math.max(0, 1 - y / 460).toFixed(3) : '';
    }
    if (card) card.style.transform = y ? 'translate3d(0,' + (-Math.min(y * 0.1, 44)).toFixed(1) + 'px,0)' : '';
  }
  function kick() { if (!frame) frame = requestAnimationFrame(paint); }
  window.addEventListener('scroll', kick, { passive: true });
  window.addEventListener('resize', kick);
  if (reduce.addEventListener) reduce.addEventListener('change', kick);
  paint();
})();
