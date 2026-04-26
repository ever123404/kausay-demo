// Kausay MPC — Service Worker
const CACHE = 'mpc-v1';
const ASSETS = [
  '/kausay-demo/',
  '/kausay-demo/index.html',
  '/kausay-demo/alcalde.html',
  '/kausay-demo/asesor.html',
  '/kausay-demo/gm.html',
  '/kausay-demo/secretaria.html',
  '/kausay-demo/gerente.html',
  '/kausay-demo/mpc-192.png',
  '/kausay-demo/mpc-512.png',
  '/kausay-demo/manifest.json'
];
self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(ASSETS)).catch(()=>{})
  );
  self.skipWaiting();
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys =>
    Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k)))
  ));
  self.clients.claim();
});
self.addEventListener('fetch', e => {
  e.respondWith(
    caches.match(e.request).then(r => r || fetch(e.request).catch(()=>caches.match('/kausay-demo/index.html')))
  );
});
