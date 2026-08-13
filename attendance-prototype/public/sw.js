/**
 * public/sw.js — Service Worker: modelos + cascarón offline.
 *
 * Dos objetivos:
 *  1) Los modelos pesados (~11 MB) se descargan UNA vez y luego se sirven del
 *     caché → carga casi instantánea en visitas repetidas.
 *  2) La app debe ABRIR sin internet. El APK de Capacitor es un cascarón que
 *     carga la web remota; sin este caché de navegación, sin red no había ni
 *     pantalla. Ahora la página y sus recursos quedan guardados y el kiosco
 *     arranca offline contra el roster cacheado y la cola local.
 *
 * Estrategias por tipo de recurso:
 *  - /models/           → cache-first (pesos grandes e inmutables).
 *  - /_next/static/     → cache-first (Next les pone hash de contenido: si el
 *                         archivo cambia, cambia la URL; el caché nunca sirve
 *                         una versión vieja de un archivo nuevo).
 *  - navegación (HTML)  → red primero, caché de respaldo. Online siempre se ve
 *                         lo último desplegado; offline se sirve la última
 *                         copia buena.
 *  - /wasm/             → red primero, caché de respaldo. NO cache-first:
 *                         MediaPipe es sensible al modo en que se sirve su
 *                         runtime WASM y un caché intermedio puede colgar la
 *                         inicialización; el caché aquí es solo para offline.
 *  - /api/              → nunca se toca: los datos son responsabilidad de la
 *                         app (roster cacheado y cola en localStorage).
 */

const CACHE_NAME = 'arrive-app-v3';

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

const cacheFirst = async (request) => {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response && response.ok && response.status === 200) {
    cache.put(request, response.clone());
  }
  return response;
};

// Red primero; si la red falla (o responde con error de servidor), se sirve la
// última copia buena. `cacheKey` permite guardar todas las navegaciones bajo
// una sola entrada, para que abrir /?algo=1 offline también encuentre la página.
const networkFirst = async (request, cacheKey = request) => {
  const cache = await caches.open(CACHE_NAME);
  try {
    const response = await fetch(request);
    if (response && response.ok && response.status === 200) {
      cache.put(cacheKey, response.clone());
      return response;
    }
    // Respuesta de error (5xx del server, página caída): mejor la copia buena.
    const cached = await cache.match(cacheKey);
    return cached || response;
  } catch {
    const cached = await cache.match(cacheKey);
    if (cached) return cached;
    throw new Error('offline y sin copia en caché');
  }
};

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return; // fuentes externas, etc.
  if (url.pathname.startsWith('/api/')) return; // datos: los maneja la app

  // Navegación (el HTML del kiosco/panel): red primero, caché de respaldo.
  if (request.mode === 'navigate') {
    event.respondWith(networkFirst(request, url.pathname));
    return;
  }

  if (url.pathname.startsWith('/models/') || url.pathname.startsWith('/_next/static/')) {
    event.respondWith(cacheFirst(request));
    return;
  }

  // /wasm/, manifest, íconos y demás estáticos: red primero, respaldo offline.
  event.respondWith(networkFirst(request));
});
