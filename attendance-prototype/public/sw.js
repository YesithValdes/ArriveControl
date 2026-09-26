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
 *
 * En la APP DE ANDROID (se registra como /sw.js?apk=1) los modelos NO pasan
 * por aquí: los sirve ModelosLocales.java desde la propia APK. Si este worker
 * los interceptara, su fetch() iría por el ServiceWorkerClient de Capacitor
 * directo a la red — la APK quedaba sin usar y se bajaban ~15 MB.
 */
const CACHE = 'cr-inmutables-v1';
// `?.`: el arnés de pruebas solo define location.origin.
const EN_APK = /[?&]apk=1(&|$)/.test(self.location?.search ?? '');
const PESADOS = [/^\/models\//, /^\/wasm\//];
const CACHEABLES = EN_APK ? [/^\/_next\/static\//] : [...PESADOS, /^\/_next\/static\//];

self.addEventListener('install', (e) => {
  self.skipWaiting();
  // Static Routing (Chrome/WebView 123+): lo que este worker nunca responde va
  // directo a la red SIN despertarlo. Sobre todo la navegación: al abrir la
  // app en frío, el HTML ya no espera a que arranque el worker. Una regla por
  // llamada: una condición no soportada no tumba las demás.
  if (typeof e.addRoutes === 'function' && typeof URLPattern === 'function') {
    const red = (pathname) => ({ condition: { urlPattern: new URLPattern({ pathname }) }, source: 'network' });
    const rutas = [{ condition: { requestMode: 'navigate' }, source: 'network' }, red('/api/*')];
    if (EN_APK) rutas.push(red('/models/*'), red('/wasm/*'));
    for (const r of rutas) e.waitUntil?.(e.addRoutes(r).catch(() => {}));
  }
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    // Limpia versiones viejas de este mismo caché si el nombre cambia.
    for (const k of await caches.keys()) {
      if (k.startsWith('cr-inmutables-') && k !== CACHE) await caches.delete(k);
    }
    // En la APK, los modelos que un worker anterior dejó aquí sobran (~40 MB
    // duplicados de la propia APK).
    if (EN_APK) {
      const c = await caches.open(CACHE);
      for (const req of await c.keys()) {
        if (PESADOS.some((rx) => rx.test(new URL(req.url).pathname))) await c.delete(req);
      }
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
    // Si Cache Storage falla (cuota, almacenamiento dañado, un error del
    // WebView), se va a la red: antes TODA petición de modelos fallaba con
    // net::ERR_FAILED y el kiosco no podía cargar nada.
    let cache = null;
    try {
      cache = await caches.open(CACHE);
      const hit = await cache.match(e.request);
      if (hit) return hit;
    } catch { /* sin caché: se sirve de la red */ }
    const resp = await fetch(e.request);
    // Solo respuestas completas: Cache API rechaza las 206 (parciales).
    if (cache && resp.status === 200) {
      const guardar = cache.put(e.request, resp.clone()).catch(() => {});
      // Sin waitUntil el worker puede morir a mitad de escribir 14 MB.
      e.waitUntil?.(guardar);
    }
    return resp;
  })());
});

// Primera visita: lo que la página pidió ANTES de que este worker tomara
// control no pasó por aquí y no quedó en Cache Storage (solo en el caché HTTP,
// que el WebView desaloja). La página avisa cuando terminó de cargar y se
// copia desde el caché HTTP (force-cache: ya está ahí, sin red).
self.addEventListener('message', (e) => {
  if (EN_APK || e.data?.tipo !== 'guardar-modelos' || !Array.isArray(e.data.urls)) return;
  e.waitUntil?.((async () => {
    const cache = await caches.open(CACHE);
    for (const u of e.data.urls.slice(0, 50)) {
      try {
        const url = new URL(u, self.location.origin);
        if (url.origin !== self.location.origin || !PESADOS.some((rx) => rx.test(url.pathname))) continue;
        if (await cache.match(url.href)) continue;
        const r = await fetch(url.href, { cache: 'force-cache' });
        if (r.status === 200) await cache.put(url.href, r);
      } catch { /* se intentará en la próxima visita */ }
    }
  })());
});
