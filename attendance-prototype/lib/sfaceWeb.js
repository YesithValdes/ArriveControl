/**
 * lib/sfaceWeb.js — Modelos faciales EN EVALUACIÓN, en el navegador (SFace y
 * AuraFace; catálogo en utils/evaluacionSface.js). Miden en sombra junto al
 * modelo actual (app/api/evaluacion-sface): nunca deciden quién marca.
 *
 * Mismo runtime que el modelo actual (onnxruntime-web, solo WASM, 1 hilo),
 * misma alineación 112×112 (plantilla ArcFace) y la MISMA fila de
 * inferencias: una medición jamás corre a la par de una captura del modelo
 * que decide.
 *
 * Descarga: solo si el modelo está activo en la evaluación. Se guarda en el
 * Cache Storage del aparato (AuraFace pesa 260 MB: bajarlo en cada arranque
 * sería inviable) y se verifica su SHA-256 antes de usarlo — el de AuraFace
 * viene de Hugging Face, fuera de nuestro servidor.
 */
import { cargarV2, enFila } from './rostroV2.js'
import { MODELOS, normalizar } from '../utils/evaluacionSface.js'

const LADO = 112
const CACHE = 'asistencia-modelos-eval-v1'
const sesiones = new Map()

const hex = (buf) => Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('')

/** Bytes del modelo: del caché del aparato si ya están y su huella cuadra. */
async function bytesDe(m) {
  let cache = null
  try { cache = await caches.open(CACHE) } catch { /* sin Cache Storage: se baja cada vez */ }
  const verificar = async (buf) => hex(await crypto.subtle.digest('SHA-256', buf)) === m.sha256
  if (cache) {
    const guardada = await cache.match(m.url)
    if (guardada) {
      const buf = await guardada.arrayBuffer()
      if (await verificar(buf)) return new Uint8Array(buf)
      await cache.delete(m.url) // dañada o de otra versión: se vuelve a bajar
    }
  }
  const r = await fetch(m.url, { priority: 'low' })
  if (!r.ok) throw new Error(`${m.nombre}: HTTP ${r.status}`)
  const buf = await r.arrayBuffer()
  if (!(await verificar(buf))) throw new Error(`${m.nombre}: el archivo descargado no coincide con su huella SHA-256`)
  if (cache) {
    try { await cache.put(m.url, new Response(buf, { headers: { 'Content-Type': 'application/octet-stream' } })) } catch { /* sin espacio: se usa igual */ }
  }
  return new Uint8Array(buf)
}

/** Carga perezosa y única de un modelo. Reusa el runtime del modelo actual. */
export function cargarModelo(id) {
  const m = MODELOS[id]
  if (!m) return Promise.reject(new Error(`Modelo desconocido: ${id}`))
  if (!sesiones.has(id)) {
    const p = (async () => {
      const { ort } = await cargarV2() // mismo runtime ya configurado
      const bytes = await bytesDe(m)
      // En la fila del runtime: crear la sesión tampoco debe pisar una captura.
      const sesion = await enFila(() => ort.InferenceSession.create(bytes, { executionProviders: ['wasm'] }))
      return { ort, sesion }
    })()
    p.catch(() => { sesiones.delete(id) })
    sesiones.set(id, p)
  }
  return sesiones.get(id)
}

/** Vector (L2) de un recorte alineado 112×112 (ImageData RGBA) con ese modelo. */
export async function vectorDe(id, recorte) {
  const m = MODELOS[id]
  const { ort, sesion } = await cargarModelo(id)
  const { data } = recorte
  const plano = LADO * LADO
  const entrada = new Float32Array(3 * plano)
  const f = m.entrada === 'cruda' ? (x) => x : (x) => (x - 127.5) / 127.5
  for (let i = 0; i < plano; i++) {
    entrada[i] = f(data[i * 4])
    entrada[plano + i] = f(data[i * 4 + 1])
    entrada[2 * plano + i] = f(data[i * 4 + 2])
  }
  const tensor = new ort.Tensor('float32', entrada, [1, 3, LADO, LADO])
  const salida = await enFila(() => sesion.run({ [sesion.inputNames[0]]: tensor }))
  const crudo = salida[sesion.outputNames[0]].data
  if (crudo.length !== m.largo) throw new Error(`${m.nombre} devolvió ${crudo.length} valores`)
  const v = normalizar(crudo)
  if (!v) throw new Error(`${m.nombre} devolvió un vector vacío`)
  return v
}

// Compatibilidad con la versión anterior.
export const cargarSFace = () => cargarModelo('sface')
export const vectorSFace = (recorte) => vectorDe('sface', recorte)
