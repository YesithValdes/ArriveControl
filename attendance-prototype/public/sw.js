/**
 * public/sw.js — Service Worker de caché de modelos.
 *
 * Objetivo: la PRIMERA visita descarga los modelos pesados (~11 MB:
 * MediaPipe .task + WASM + pesos de face-api); las siguientes los sirven
 * desde el caché del dispositivo → carga casi instantánea.
 *
 * Estrategia "cache-first" SOLO para rutas de modelos (/models/ y /wasm/).
 * El resto de la app la maneja el navegador/Next normalmente.
 */

const CACHE_NAME = 'arrive-models-v2';
// Solo cacheamos los pesos grandes de /models/. NO tocamos /wasm/ porque
// MediaPipe es sensible al modo en que se sirve su runtime WASM y un caché
// intermedio puede colgar la inicialización.
const CACHEABLE_PREFIXES = ['/models/'];

self.addEventListener('install', () => {
  // Activa este SW de inmediato sin esperar a que se cierren pestañas.
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      // Limpia versiones viejas del caché.
      const keys = await caches.keys();
      await Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)));
      await self.clients.claim();
    })()
  );
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  const isModelAsset = CACHEABLE_PREFIXES.some((p) => url.pathname.startsWith(p));
  if (!isModelAsset || event.request.method !== 'GET') return;

  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE_NAME);
      const cached = await cache.match(event.request);
      if (cached) return cached; // ← visita repetida: instantáneo

      const response = await fetch(event.request);
      // Solo cacheamos respuestas completas y válidas.
      if (response && response.ok && response.status === 200) {
        cache.put(event.request, response.clone());
      }
      return response;
    })()
  );
});
