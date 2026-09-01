/**
 * public/sw.js — Caché PERSISTENTE de los archivos pesados del kiosco.
 *
 * El caché HTTP del WebView de Android es pequeño y desaloja los modelos
 * faciales (~16 MB) al cerrar la app: cada arranque en frío los volvía a
 * bajar. Cache Storage tiene cuota de disco real y sobrevive al cierre.
 *
 * Estrategia: cache-first SOLO para archivos inmutables (modelos, wasm y los
 * chunks con hash de Next). El HTML y las APIs nunca pasan por aquí, así que
 * la auto-actualización del kiosco sigue funcionando igual.
 */
const CACHE = 'cr-inmutables-v1';
const CACHEABLES = [/^\/models\//, /^\/wasm\//, /^\/_next\/static\//];

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    // Limpia versiones viejas de este mismo caché si el nombre cambia.
    for (const k of await caches.keys()) {
      if (k.startsWith('cr-inmutables-') && k !== CACHE) await caches.delete(k);
    }
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);
  if (url.origin !== self.location.origin) return;
  if (!CACHEABLES.some((rx) => rx.test(url.pathname))) return;
  e.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const hit = await cache.match(e.request);
    if (hit) return hit;
    const resp = await fetch(e.request);
    if (resp.ok) cache.put(e.request, resp.clone());
    return resp;
  })());
});
