/**
 * utils/evaluacionSface.js — Reglas de la evaluación de modelos faciales
 * (servidor y navegador). Sin dependencias: se prueba en Node.
 *
 * Los modelos se evalúan EN SOMBRA: el modelo actual decide quién marca y
 * estos solo se miden con la misma imagen. Se comparan con similitud coseno
 * sobre vectores normalizados L2. Los umbrales son PROVISIONALES (los que
 * publica cada autor) hasta calibrarlos con los datos de la evaluación.
 */

/**
 * Catálogo. `entrada`: cómo se arma el tensor desde el recorte RGB 112×112
 *   · 'cruda'  → valores 0–255 (la normalización va dentro del ONNX);
 *   · 'arcface'→ (x − 127.5) / 127.5.
 * `sha256` verifica el archivo descargado (obligatorio si viene de fuera).
 * `recortes`: cuántos recortes de cada marcación procesa. AuraFace tarda
 *   ~1 s por rostro en un PC (medido, WASM de 1 hilo) y comparte la fila con
 *   el modelo que decide: con uno solo, la siguiente persona espera menos.
 */
export const MODELOS = {
  sface: {
    id: 'sface', nombre: 'SFace', largo: 128, umbral: 0.363, margen: 0.08, entrada: 'cruda',
    url: '/models/eval/sface.onnx', mb: 38, recortes: 2,
    sha256: '0ba9fbfa01b5270c96627c4ef784da859931e02f04419c829e83484087c34e79',
    licencia: 'Apache-2.0 (OpenCV Zoo)',
  },
  auraface: {
    id: 'auraface', nombre: 'AuraFace', largo: 512, umbral: 0.45, margen: 0.08, entrada: 'arcface',
    // Alojado por su autor (fal) en Hugging Face, fijado a una revisión exacta.
    url: 'https://huggingface.co/fal/AuraFace-v1/resolve/af6d057c9b0ec4071d4c49c80e3539258798b609/glintr100.onnx',
    mb: 260, recortes: 1,
    sha256: 'a7933ea5330113b01c9b60351d8f4c33003f145d8470ac5f0e52ee2effe25c60',
    licencia: 'Apache-2.0 (fal / AuraFace-v1)',
  },
}
export const IDS_MODELOS = Object.keys(MODELOS)
export const MODELOS_POR_DEFECTO = ['sface']

// Compatibilidad con lo ya publicado (pantalla y pruebas).
export const SFACE_LARGO = MODELOS.sface.largo
export const SFACE_UMBRAL = MODELOS.sface.umbral
export const SFACE_MARGEN = MODELOS.sface.margen

/** Vectores por persona y modelo: tres capturas distintas cubren luz y ángulo. */
export const SFACE_MAX_POR_PERSONA = 3
export const FASES = ['apagada', 'inscripcion', 'medicion']

/** Lista de modelos válida (sin repetidos, al menos uno). Null si no sirve. */
export function modelosValidos(lista) {
  if (!Array.isArray(lista)) return null
  const l = [...new Set(lista)].filter((m) => IDS_MODELOS.includes(m))
  return l.length > 0 && l.length === new Set(lista).size ? l : null
}

/** ¿Vector válido para ese modelo? Su largo, números finitos y norma ≈ 1. */
export function esVector(v, modelo = 'sface') {
  const m = MODELOS[modelo]
  if (!m || !Array.isArray(v) || v.length !== m.largo) return false
  let n = 0
  for (const x of v) {
    if (typeof x !== 'number' || !Number.isFinite(x)) return false
    n += x * x
  }
  return Math.abs(Math.sqrt(n) - 1) < 0.01
}
export const esVectorSface = (v) => esVector(v, 'sface')

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

/** ¿El modelo habría aceptado? Su umbral y su margen sobre el segundo. */
export function acepta(modelo, sim1, sim2) {
  const m = MODELOS[modelo] ?? MODELOS.sface
  return sim1 != null && sim1 >= m.umbral && (sim2 == null || sim1 - sim2 >= m.margen)
}
export const aceptaSface = (sim1, sim2) => acepta('sface', sim1, sim2)

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
 * Resumen de los intentos de UN modelo. Se compara contra lo que decidió el
 * modelo ACTUAL: no es una verdad verificada, es el punto de referencia.
 *  · coinciden: los dos aceptan a la misma persona.
 *  · sfaceRechaza: el actual aceptó y el evaluado no habría aceptado.
 *  · confunde: el actual aceptó a X y el evaluado habría aceptado a OTRA.
 *  · sfaceSolo: el actual rechazó y el evaluado sí habría aceptado (revisar).
 * (Los nombres de campo vienen de cuando solo existía SFace.)
 */
export function resumir(intentos, modelo = 'sface') {
  const r = { total: intentos.length, coinciden: 0, sfaceRechaza: 0, confunde: 0, sfaceSolo: 0, ambosRechazan: 0, errores: 0, msMediana: null, msP95: null }
  const tiempos = []
  for (const i of intentos) {
    if (i.error) { r.errores += 1; continue }
    if (Number.isFinite(i.ms)) tiempos.push(i.ms)
    const sf = acepta(i.modelo ?? modelo, i.sface_sim1, i.sface_sim2)
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
