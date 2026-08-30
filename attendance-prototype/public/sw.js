/**
 * public/sw.js — Service Worker: modelos + cascarón offline del kiosco.
 *
 * Dos objetivos:
 *  1) Los modelos pesados (~11 MB) se descargan UNA vez y luego se sirven del
 *     caché → carga casi instantánea en visitas repetidas.
 *  2) El KIOSCO debe abrir sin internet. El APK de Capacitor es un cascarón
 *     que carga la web remota; sin este caché de navegación, sin red no había
 *     ni pantalla. Ahora la página y sus recursos quedan guardados y el kiosco
 *     arranca offline contra el roster cacheado y la cola local.
 *
 * ── LA REGLA QUE NO SE PUEDE RELAJAR ─────────────────────────────────────
 *
 * El caché es COMÚN a todas las cuentas que usen ese navegador: no lo separa
 * por sesión ni se vacía al salir. Así que aquí SOLO puede entrar lo que no
 * lleva identidad dentro.
 *
 * El panel (`/admin`), la plataforma y el login se renderizan en el SERVIDOR
 * con el nombre, el correo, la empresa y los permisos de quien entró — todo
 * eso viaja dentro del HTML. Guardarlos significaba que, al cambiar de cuenta,
 * el navegador le servía a la persona nueva el cascarón de la anterior: los
 * datos llegaban bien (nunca se cachea `/api/`) pero el nombre y la empresa
 * eran de otro, y la única salida era borrar los datos del sitio a mano.
 *
 * Por eso esto funciona con una LISTA DE LO PERMITIDO y no de lo prohibido:
 * si mañana aparece una pantalla nueva con sesión, queda fuera por defecto.
 *
 * Estrategias, para lo que sí entra:
 *  - /models/           → cache-first (pesos grandes e inmutables).
 *  - /_next/static/     → cache-first (Next les pone hash de contenido: si el
 *                         archivo cambia, cambia la URL; el caché nunca sirve
 *                         una versión vieja de un archivo nuevo).
 *  - navegación a «/»   → red primero, caché de respaldo. Es el kiosco, y es
 *                         anónimo: se identifica con su clave de dispositivo,
 *                         no con una sesión.
 *  - /wasm/             → red primero, caché de respaldo. NO cache-first:
 *                         MediaPipe es sensible al modo en que se sirve su
 *                         runtime WASM y un caché intermedio puede colgar la
 *                         inicialización; el caché aquí es solo para offline.
 *  - íconos y manifest  → red primero, caché de respaldo (instalación PWA).
 *
 * Todo lo demás —el panel, el login, la plataforma, `/api/` y las cargas RSC
 * de Next— va a la red y no se guarda.
 */

// v4: la v3 llegó a guardar páginas con sesión dentro. Al subir el número,
// `activate` borra esos cachés viejos en la próxima visita de cada quien.
const CACHE_NAME = 'arrive-app-v4';

/** Única navegación que se guarda: el kiosco, que debe abrir sin internet. */
const NAVEGACION_OFFLINE = '/';

/** Estáticos sueltos de la raíz que hacen falta para instalar y abrir la PWA. */
const ARCHIVOS_PWA = new Set([
  '/manifest.webmanifest',
  '/icon.svg',
  '/icon-192.png',
  '/icon-512.png',
  '/icon-512-maskable.png',
  '/apple-touch-icon.png',
  '/splash.png',
]);

self.addEventListener('install', () => {
  // Activa este SW de inmediato sin esperar a que se cierren pestañas.
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      // Limpia versiones viejas del caché. Es también lo que desinfecta a
      // quien ya tenía guardadas páginas con sesión de la versión anterior.
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

  // Navegación (HTML). Solo el kiosco; el panel, el login y la plataforma
  // llevan la sesión renderizada dentro y van siempre a la red.
  if (request.mode === 'navigate') {
    if (url.pathname === NAVEGACION_OFFLINE) {
      event.respondWith(networkFirst(request, NAVEGACION_OFFLINE));
    }
    return;
  }

  // Navegación interna de Next: pide el MISMO HTML del panel con `?_rsc=`.
  // Es la otra puerta por la que la sesión podría entrar al caché.
  if (url.searchParams.has('_rsc')) return;

  if (url.pathname.startsWith('/models/') || url.pathname.startsWith('/_next/static/')) {
    event.respondWith(cacheFirst(request));
    return;
  }

  if (url.pathname.startsWith('/wasm/') || ARCHIVOS_PWA.has(url.pathname)) {
    event.respondWith(networkFirst(request));
    return;
  }

  // Cualquier otra cosa: a la red, sin guardarla.
});
