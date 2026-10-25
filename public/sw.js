/**
 * Balai-Reserve service worker
 *
 * - Pages always come from the network (they carry sessions, CSRF tokens and live
 *   availability), so nothing personal or stale is ever served from the cache. When the
 *   network is down, a page request gets the offline page instead.
 * - The site's own styles and scripts come from the network first (so a new deploy shows at
 *   once) and fall back to the cache offline.
 * - Images, catalogue photos and versioned CDN files (Bootstrap, Font Awesome, fonts) are
 *   served from the cache and refreshed in the background, so repeat visits load fast.
 * - Never cached: anything that isn't GET, payment proofs, booking QR codes, and API/JSON.
 *
 * Bump VERSION to drop every old cache on the next visit.
 */
'use strict';
const VERSION = 'v1';
const CORE = 'balai-core-' + VERSION;
const ASSETS = 'balai-assets-' + VERSION;
const OFFLINE_URL = '/offline.html';
const PRECACHE = [
  OFFLINE_URL,
  '/images/brand/balai-icon-96.png',
  '/images/brand/pwa-192.png',
  '/manifest.webmanifest',
];
const ASSET_LIMIT = 160;
const CDN_HOSTS = ['cdn.jsdelivr.net', 'cdnjs.cloudflare.com', 'fonts.googleapis.com', 'fonts.gstatic.com'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CORE).then((c) => c.addAll(PRECACHE)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('balai-') && k !== CORE && k !== ASSETS).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

function isAsset(url) {
  if (url.origin === self.location.origin) {
    if (url.pathname.startsWith('/uploads/payment_proofs') || url.pathname.startsWith('/qrcodes')) return false;
    return /^\/(css|js|images|uploads)\//.test(url.pathname) || url.pathname === '/favicon.svg';
  }
  return CDN_HOSTS.includes(url.hostname);
}

async function trim(cache) {
  const keys = await cache.keys();
  for (let i = 0; i < keys.length - ASSET_LIMIT; i++) await cache.delete(keys[i]);
}

async function staleWhileRevalidate(event) {
  const cache = await caches.open(ASSETS);
  const cached = await cache.match(event.request);
  const fresh = fetch(event.request).then((res) => {
    if (res && (res.ok || res.type === 'opaque')) {
      cache.put(event.request, res.clone()).then(() => trim(cache));
    }
    return res;
  }).catch(() => cached);
  if (cached) { event.waitUntil(fresh); return cached; }
  return fresh;
}

async function networkFirstAsset(request) {
  const cache = await caches.open(ASSETS);
  try {
    const res = await fetch(request);
    if (res && res.ok) cache.put(request, res.clone()).then(() => trim(cache));
    return res;
  } catch (err) {
    return (await cache.match(request)) || Response.error();
  }
}

async function networkFirstPage(request) {
  try {
    return await fetch(request);
  } catch (err) {
    const offline = await caches.match(OFFLINE_URL);
    return offline || Response.error();
  }
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (request.mode === 'navigate') { event.respondWith(networkFirstPage(request)); return; }
  if (!isAsset(url)) return;
  const own = url.origin === self.location.origin && /^\/(css|js)\//.test(url.pathname);
  event.respondWith(own ? networkFirstAsset(request) : staleWhileRevalidate(event));
});
