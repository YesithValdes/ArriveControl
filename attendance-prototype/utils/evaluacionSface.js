/**
 * utils/evaluacionSface.js — Reglas de la evaluación de SFace (servidor y
 * navegador). Sin dependencias: se prueba en Node.
 *
 * SFace (OpenCV Zoo, 2021dec, Apache-2.0) entrega 128 floats; se comparan
 * con similitud coseno sobre vectores normalizados L2. El umbral 0.363 es el
 * que publica OpenCV para este modelo; es PROVISIONAL hasta calibrarlo con
 * los datos de la evaluación.
 */
export const SFACE_LARGO = 128
export const SFACE_UMBRAL = 0.363
export const SFACE_MARGEN = 0.08
/** Vectores por persona: con tres capturas distintas ya se cubre luz y ángulo. */
export const SFACE_MAX_POR_PERSONA = 3
export const FASES = ['apagada', 'inscripcion', 'medicion']

/** ¿Vector SFace válido? 128 números finitos con norma ≈ 1. */
export function esVectorSface(v) {
  if (!Array.isArray(v) || v.length !== SFACE_LARGO) return false
  let n = 0
  for (const x of v) {
    if (typeof x !== 'number' || !Number.isFinite(x)) return false
    n += x * x
  }
  return Math.abs(Math.sqrt(n) - 1) < 0.01
}

/** Normaliza L2 (devuelve null si es todo ceros). */
export function normalizar(v) {
  let n = 0
  for (const x of v) n += x * x
  n = Math.sqrt(n)
  if (!(n > 1e-10)) return null
  return Array.from(v, (x) => x / n)
}

export const similitud = (a, b) => {
  let s = 0
  for (let i = 0; i < a.length; i++) s += a[i] * b[i]
  return s
}

/**
 * Los dos más parecidos entre los inscritos. Por persona cuenta su vector MÁS
 * parecido (como el kiosco con el modelo actual).
 * @param {number[]} vivo
 * @param {Map<string, number[][]>} inscritos  empleado → vectores
 */
export function ranking(vivo, inscritos) {
  let top1 = { id: null, sim: -1 }
  let top2 = { id: null, sim: -1 }
  for (const [id, vectores] of inscritos) {
    let s = -1
    for (const v of vectores) { const x = similitud(v, vivo); if (x > s) s = x }
    if (s > top1.sim) { top2 = top1; top1 = { id, sim: s } } else if (s > top2.sim) top2 = { id, sim: s }
  }
  return { top1, top2 }
}

/** ¿SFace habría aceptado? Umbral y margen sobre el segundo. */
export const aceptaSface = (sim1, sim2) =>
  sim1 != null && sim1 >= SFACE_UMBRAL && (sim2 == null || sim1 - sim2 >= SFACE_MARGEN)

/** La fase vigente: con `hasta` vencido, la evaluación está apagada. */
export function faseVigente(config, ahora = new Date()) {
  if (!config || !FASES.includes(config.estado)) return 'apagada'
  if (config.hasta && new Date(config.hasta) <= ahora) return 'apagada'
  return config.estado
}

const percentil = (lista, p) => {
  if (lista.length === 0) return null
  const o = [...lista].sort((a, b) => a - b)
  return o[Math.min(o.length - 1, Math.floor((p / 100) * o.length))]
}

/**
 * Resumen de los intentos para el reporte. Se compara contra lo que decidió
 * el modelo ACTUAL: no es una verdad verificada, es el punto de referencia.
 *  · coinciden: los dos aceptan a la misma persona.
 *  · sfaceRechaza: el actual aceptó y SFace no habría aceptado.
 *  · confunde: el actual aceptó a X y SFace habría aceptado a OTRA persona.
 *  · sfaceSolo: el actual rechazó y SFace sí habría aceptado (revisar a mano).
 */
export function resumir(intentos) {
  const r = { total: intentos.length, coinciden: 0, sfaceRechaza: 0, confunde: 0, sfaceSolo: 0, ambosRechazan: 0, errores: 0, msMediana: null, msP95: null }
  const tiempos = []
  for (const i of intentos) {
    if (i.error) { r.errores += 1; continue }
    if (Number.isFinite(i.ms)) tiempos.push(i.ms)
    const sf = aceptaSface(i.sface_sim1, i.sface_sim2)
    if (i.aceptado_actual) {
      if (!sf) r.sfaceRechaza += 1
      else if (i.sface_top1 === i.referencia_id) r.coinciden += 1
      else r.confunde += 1
    } else if (sf) r.sfaceSolo += 1
    else r.ambosRechazan += 1
  }
  r.msMediana = percentil(tiempos, 50)
  r.msP95 = percentil(tiempos, 95)
  return r
}
