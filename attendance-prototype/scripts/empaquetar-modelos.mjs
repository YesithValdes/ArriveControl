/**
 * scripts/empaquetar-modelos.mjs — Mete los modelos faciales dentro del APK.
 *
 * Ejecutar ANTES de compilar en Android Studio:
 *   node scripts/empaquetar-modelos.mjs
 *
 * Por qué existe: la app es un cascarón que carga la web remota, así que la
 * primera arrancada en cada aparato bajaba ~25 MB comprimidos de modelos —
 * unos 40 segundos en 4G lento, con la pantalla en blanco. Los modelos casi
 * nunca cambian, así que viajan dentro del APK y `ModelosLocales.java`
 * intercepta sus peticiones para servirlos del disco.
 *
 * Se copia SOLO lo que el kiosco carga de verdad. Lo que no esté aquí se
 * seguirá bajando de la red, que es el respaldo deliberado: si un día se
 * publica un modelo nuevo, funciona aunque la APK instalada sea vieja.
 */
import { readdirSync, statSync, mkdirSync, copyFileSync, rmSync, existsSync } from 'node:fs'
import { join, dirname, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..')
const DESTINO = join(RAIZ, 'android/app/src/main/assets/modelos')

/**
 * Lo que el kiosco pide al arrancar. Se enumera a mano y no se copia
 * `public/` entero por una razón concreta: la carpeta de onnxruntime trae dos
 * motores, y el que NO se usa (la edición JSEP con WebGPU) pesa 27 MB. Meterlo
 * doblaría el APK para nada.
 */
const LISTA = [
  // face-api: detección, puntos faciales y descriptor v1
  'models/tiny_face_detector_model-weights_manifest.json',
  'models/tiny_face_detector_model.bin',
  'models/face_landmark_68_model-weights_manifest.json',
  'models/face_landmark_68_model.bin',
  'models/face_recognition_model-weights_manifest.json',
  'models/face_recognition_model.bin',
  // MediaPipe: prueba de vida (parpadeo)
  'models/face_landmarker.task',
  'wasm/vision_wasm_internal.js',
  'wasm/vision_wasm_internal.wasm',
  'wasm/vision_wasm_nosimd_internal.js',   // respaldo en aparatos sin SIMD
  'wasm/vision_wasm_nosimd_internal.wasm',
  // Reconocimiento v2 (ArcFace sobre onnxruntime), edición SOLO-WASM
  'models/v2/w600k_mbf.onnx',
  'wasm/ort/ort.wasm.min.mjs',
  'wasm/ort/ort-wasm-simd-threaded.mjs',
  'wasm/ort/ort-wasm-simd-threaded.wasm',
]

const mb = (n) => `${(n / 1048576).toFixed(1)} MB`

if (!existsSync(join(RAIZ, 'android'))) {
  console.error('No hay proyecto Android en esta carpeta. ¿Falta `npx cap add android`?')
  process.exit(1)
}

// Se vacía primero: si un modelo se renombra, el viejo no puede quedarse
// dentro engordando el APK para siempre.
rmSync(DESTINO, { recursive: true, force: true })

let total = 0
const faltantes = []
for (const rel of LISTA) {
  const origen = join(RAIZ, 'public', rel)
  if (!existsSync(origen)) { faltantes.push(rel); continue }
  const destino = join(DESTINO, rel)
  mkdirSync(dirname(destino), { recursive: true })
  copyFileSync(origen, destino)
  total += statSync(origen).size
  console.log(`  ${rel.padEnd(48)} ${mb(statSync(origen).size).padStart(9)}`)
}

console.log(`\n  ${'TOTAL empaquetado'.padEnd(48)} ${mb(total).padStart(9)}`)
console.log(`  destino: ${relative(RAIZ, DESTINO)}`)

if (faltantes.length) {
  console.log('\n  ⚠ No se encontraron (se bajarán de la red, no es fatal):')
  for (const f of faltantes) console.log(`     ${f}`)
}

// Aviso útil: si `public/` tiene archivos pesados fuera de la lista, puede
// que alguien haya agregado un modelo y olvidado empaquetarlo.
const pesados = []
for (const carpeta of ['models', 'wasm']) {
  const base = join(RAIZ, 'public', carpeta)
  if (!existsSync(base)) continue
  const recorrer = (dir) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name)
      if (e.isDirectory()) { recorrer(p); continue }
      const rel = relative(join(RAIZ, 'public'), p).replaceAll('\\', '/')
      if (!LISTA.includes(rel) && statSync(p).size > 2 * 1048576) pesados.push([rel, statSync(p).size])
    }
  }
  recorrer(base)
}
if (pesados.length) {
  console.log('\n  Archivos pesados que NO se empaquetaron (revisa si alguno hace falta):')
  for (const [f, s] of pesados) console.log(`     ${f.padEnd(45)} ${mb(s).padStart(9)}`)
}
