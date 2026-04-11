const CACHE = 'kausay-v1';
const STATIC = ['alcalde.html','secretaria.html','gm.html','gerente.html','login.html',
  'icons/icon-alcalde-192.png','icons/icon-secretaria-192.png','icons/icon-gm-192.png','icons/icon-gerente-192.png'];
self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(STATIC)).catch(()=>{}));
  self.skipWaiting();
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k=>k!==CACHE).map(k=>caches.delete(k)))));
  self.clients.claim();
});
self.addEventListener('fetch', e => {
  if(e.request.method !== 'GET') return;
  e.respondWith(caches.match(e.request).then(cached => cached || fetch(e.request).then(resp => {
    if(resp && resp.status === 200) {
      const clone = resp.clone();
      caches.open(CACHE).then(c => c.put(e.request, clone));
    }
    return resp;
  }).catch(() => cached)));
});
