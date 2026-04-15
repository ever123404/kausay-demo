/* Kausay Municipal — Service Worker v1.0 (stub para piloto)
   Funcionalidad offline completa en Etapa 5. */
const CACHE_NAME = 'kausay-v1';
self.addEventListener('install', e => { e.waitUntil(caches.open(CACHE_NAME)); });
self.addEventListener('fetch',   e => { /* pass-through en piloto */ });
