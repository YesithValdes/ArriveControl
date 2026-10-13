/**
 * lib/sfaceWeb.js — SFace (OpenCV Zoo 2021dec, Apache-2.0) en el navegador,
 * para EVALUARLO en sombra junto al modelo actual (ver
 * app/api/evaluacion-sface). No decide nada: solo mide.
 *
 * Mismo runtime que el modelo actual (onnxruntime-web, solo WASM, 1 hilo) y
 * misma alineación de 112×112 (plantilla ArcFace). Lo que cambia es la
 * entrada: SFace recibe RGB 0–255 SIN normalizar (la normalización va dentro
 * del ONNX) y entrega 128 floats.
 *
 * Se carga SOLO si la evaluación está activa: con la fase apagada, el kiosco
 * no baja estos 38 MB.
 */
import { cargarV2 } from './rostroV2.js'
import { SFACE_LARGO, normalizar } from '../utils/evaluacionSface.js'

export const SFACE_URL = '/models/eval/sface.onnx'
const LADO = 112

let sesionProm = null

/** Carga perezosa y única. Reusa el runtime que ya arrancó el modelo actual. */
export function cargarSFace() {
  if (!sesionProm) {
    sesionProm = (async () => {
      const { ort } = await cargarV2() // mismo runtime ya configurado
      const r = await fetch(SFACE_URL, { priority: 'low' })
      if (!r.ok) throw new Error(`SFace: HTTP ${r.status}`)
      const bytes = new Uint8Array(await r.arrayBuffer())
      const sesion = await ort.InferenceSession.create(bytes, { executionProviders: ['wasm'] })
      return { ort, sesion }
    })()
    sesionProm.catch(() => { sesionProm = null })
  }
  return sesionProm
}

// Una inferencia a la vez (como el modelo actual): no compite con él.
let cola = Promise.resolve()
const enFila = (fn) => {
  const p = cola.then(fn, fn)
  cola = p.catch(() => {})
  return p
}

/** Vector SFace (128, L2) de un recorte alineado 112×112 (ImageData RGBA). */
export async function vectorSFace(recorte) {
  const { ort, sesion } = await cargarSFace()
  const { data } = recorte
  const plano = LADO * LADO
  const entrada = new Float32Array(3 * plano)
  for (let i = 0; i < plano; i++) {
    entrada[i] = data[i * 4]
    entrada[plano + i] = data[i * 4 + 1]
    entrada[2 * plano + i] = data[i * 4 + 2]
  }
  const tensor = new ort.Tensor('float32', entrada, [1, 3, LADO, LADO])
  const salida = await enFila(() => sesion.run({ [sesion.inputNames[0]]: tensor }))
  const crudo = salida[sesion.outputNames[0]].data
  if (crudo.length !== SFACE_LARGO) throw new Error(`SFace devolvió ${crudo.length} valores`)
  const v = normalizar(crudo)
  if (!v) throw new Error('SFace devolvió un vector vacío')
  return v
}
