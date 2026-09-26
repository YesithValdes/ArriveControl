/**
 * lib/modelosApk.js — ¿Los modelos del kiosco salen de la APK?
 *
 * La app de Android anuncia qué archivos trae empaquetados en
 * `window.__modelosEnApk` (MainActivity, antes de cargar la página). Solo si
 * trae TODOS los que el kiosco carga, la web deja esos archivos a la APK
 * (ModelosLocales) y su service worker no los toca.
 *
 * `isNativePlatform()` no alcanza: es verdadero en CUALQUIER cascarón de
 * Capacitor, también en APKs viejas sin ModelosLocales o compiladas sin
 * `npm run apk`. Con esas, saltarse el service worker significaba volver a
 * bajar ~48 MB en cada arranque en frío. Sin anuncio: como en la web.
 */

// Lo que el kiosco carga de verdad (MediaPipe con SIMD, ORT y los modelos).
export const ARCHIVOS_DEL_KIOSCO = [
  '/models/face_landmarker.task',
  '/models/v2/w600k_mbf.onnx',
  '/wasm/vision_wasm_internal.js',
  '/wasm/vision_wasm_internal.wasm',
  '/wasm/ort/ort-wasm-simd-threaded.wasm',
]

export function modelosDesdeApk() {
  if (typeof window === 'undefined') return false
  const lista = window.__modelosEnApk
  if (!Array.isArray(lista) || lista.length === 0) return false
  const hay = new Set(lista)
  return ARCHIVOS_DEL_KIOSCO.every((r) => hay.has(r))
}
