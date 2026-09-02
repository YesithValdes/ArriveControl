/**
 * lib/rostroV2.js — Modelo facial v2 (solo navegador).
 *
 * Reemplazo del embedding de face-api (2017, 128-D): MobileFaceNet entrenado
 * con ArcFace (InsightFace `w600k_mbf`, 512-D) sobre onnxruntime-web. La
 * separación entre personas distintas es MUY superior — nace de dos parejas
 * reales que el modelo viejo no distinguía (Tatiana/Hanny, Óscar/Edwin).
 *
 * Convive con v1: cada rostro guarda ambos descriptores y el kiosco decide
 * con v2 cuando las dos partes lo tienen (ver KioskMode).
 *
 * La MEDIDA aquí es SIMILITUD COSENO (más alta = más parecido), no la
 * distancia euclidiana de v1: cuidado con mezclarlas.
 */

import { V2_LENGTH } from '../utils/faceMath.js'

const MODELO_URL = '/models/v2/w600k_mbf.onnx'
const WASM_ORT = '/wasm/ort/'
export const V2_LARGO = V2_LENGTH

// Los umbrales viven en utils/faceMath.js (los comparte el servidor).
export { V2_UMBRAL_SIM, V2_MARGEN_SIM, V2_LIMITE_COLISION_SIM } from '../utils/faceMath.js'

// Plantilla ArcFace: dónde deben caer ojos, nariz y boca en el lienzo 112×112.
// "Izquierda" es la izquierda de la IMAGEN (ojo derecho de la persona).
const PLANTILLA = [
  [38.2946, 51.6963], // ojo izquierdo (de la imagen)
  [73.5318, 51.5014], // ojo derecho
  [56.0252, 71.7366], // punta de la nariz
  [41.5493, 92.3655], // comisura izquierda
  [70.7299, 92.2041], // comisura derecha
]
const LADO = 112

let sesionProm = null

/** Carga perezosa y única del runtime + modelo (los cachea el service worker). */
export function cargarV2() {
  if (!sesionProm) {
    sesionProm = (async () => {
      // La edición SOLO-WASM: la de por defecto trae WebGPU (JSEP) y pide
      // `ort-wasm-simd-threaded.jsep.mjs`, que no publicamos — en el panel
      // del celular reventaba con "no available backend found".
      const ort = await import('onnxruntime-web/wasm')
      ort.env.wasm.wasmPaths = WASM_ORT
      // 1 hilo: los hilos exigen COOP/COEP (SharedArrayBuffer) que el sitio
      // no envía; con SIMD de un hilo el embedding tarda ~30-60 ms igual.
      ort.env.wasm.numThreads = 1
      const sesion = await ort.InferenceSession.create(MODELO_URL, { executionProviders: ['wasm'] })
      return { ort, sesion }
    })()
    sesionProm.catch(() => { sesionProm = null }) // permitir reintento si falló
  }
  return sesionProm
}

/**
 * Transformación de SEMEJANZA (rotación + escala + traslación) que lleva los
 * 5 puntos detectados a la plantilla — método de Umeyama, mínimos cuadrados.
 * Alinear antes de medir es lo que hace comparable a ArcFace: sin esto las
 * similitudes se desploman.
 * @returns {[number, number, number, number, number, number]} matriz [a,b,c,d,e,f] para canvas.setTransform
 */
function semejanzaUmeyama(src, dst) {
  const n = src.length
  let mxS = 0, myS = 0, mxD = 0, myD = 0
  for (let i = 0; i < n; i++) { mxS += src[i][0]; myS += src[i][1]; mxD += dst[i][0]; myD += dst[i][1] }
  mxS /= n; myS /= n; mxD /= n; myD /= n

  let sxx = 0, sxy = 0, syx = 0, syy = 0, varS = 0
  for (let i = 0; i < n; i++) {
    const xs = src[i][0] - mxS, ys = src[i][1] - myS
    const xd = dst[i][0] - mxD, yd = dst[i][1] - myD
    sxx += xs * xd; sxy += xs * yd; syx += ys * xd; syy += ys * yd
    varS += xs * xs + ys * ys
  }
  // Rotación óptima a partir de la matriz de covarianza 2×2; el caso de
  // reflexión no aplica (una cara no llega espejada respecto a la plantilla
  // en un flujo de cámara/foto normal).
  const theta = Math.atan2(sxy - syx, sxx + syy)
  const cos = Math.cos(theta), sin = Math.sin(theta)
  const escala = (cos * (sxx + syy) + sin * (sxy - syx)) / varS
  const a = escala * cos, b = escala * sin
  const e = mxD - (a * mxS - b * myS)
  const f = myD - (b * mxS + a * myS)
  // canvas.setTransform(m11, m12, m21, m22, dx, dy):
  //   x' = m11·x + m21·y + dx ; y' = m12·x + m22·y + dy
  return [a, b, -b, a, e, f]
}

/** Promedio de puntos {x,y} de face-api → [x,y]. */
const centro = (pts) => {
  let x = 0, y = 0
  for (const p of pts) { x += p.x; y += p.y }
  return [x / pts.length, y / pts.length]
}

/**
 * Los 5 puntos ArcFace desde los 68 landmarks de face-api.
 * @param {object} landmarks  resultado .landmarks de face-api (con posiciones en píxeles del medio)
 */
/**
 * Los mismos 5 puntos, pero sacados de MediaPipe.
 *
 * Existe para poder QUITAR face-api del kiosco: hoy se cargan 6,5 MB de
 * modelos y todo TensorFlow.js nada más para obtener estas cinco coordenadas,
 * mientras MediaPipe —que ya corre en cada cuadro— entrega 478 puntos.
 *
 * Los índices son los del malla facial canónica de MediaPipe. Los contornos de
 * ojo elegidos son los seis que corresponden a los que face-api promedia
 * (dlib 36-41 y 42-47), para que el centro caiga en el mismo sitio.
 *
 * OJO con la izquierda y la derecha: aquí «izquierdo» es el de la IMAGEN, no
 * el de la persona, igual que en puntos5DeFaceApi. Invertirlos daría un
 * alineamiento espejado y descriptores que no se parecen a nada.
 *
 * @param {Array<{x:number,y:number}>} lm  landmarks normalizados (0..1)
 * @param {number} ancho @param {number} alto  del media, para pasar a píxeles
 */
export function puntos5DeMediaPipe(lm, ancho, alto) {
  const OJO_IZQ = [33, 160, 158, 133, 153, 144]
  const OJO_DER = [362, 385, 387, 263, 373, 380]
  const NARIZ = 1
  const BOCA_IZQ = 61
  const BOCA_DER = 291

  const px = (i) => [lm[i].x * ancho, lm[i].y * alto]
  const centroDe = (idx) => {
    let sx = 0
    let sy = 0
    for (const i of idx) { sx += lm[i].x; sy += lm[i].y }
    return [(sx / idx.length) * ancho, (sy / idx.length) * alto]
  }
  return [centroDe(OJO_IZQ), centroDe(OJO_DER), px(NARIZ), px(BOCA_IZQ), px(BOCA_DER)]
}

export function puntos5DeFaceApi(landmarks) {
  const pos = landmarks.positions
  return [
    centro(pos.slice(36, 42)), // ojo izquierdo de la imagen
    centro(pos.slice(42, 48)), // ojo derecho
    [pos[30].x, pos[30].y],    // nariz
    [pos[48].x, pos[48].y],    // comisura izquierda
    [pos[54].x, pos[54].y],    // comisura derecha
  ]
}

/**
 * Descriptor v2 (512 floats, normalizado L2) de un video/imagen ya detectado.
 * @param {HTMLVideoElement|HTMLImageElement|HTMLCanvasElement} media
 * @param {Array<[number,number]>} puntos5  en píxeles del media (¡no normalizados!)
 */
export async function descriptorV2(media, puntos5) {
  const { ort, sesion } = await cargarV2()

  const lienzo = document.createElement('canvas')
  lienzo.width = LADO; lienzo.height = LADO
  const ctx = lienzo.getContext('2d', { willReadFrequently: true })
  ctx.setTransform(...semejanzaUmeyama(puntos5, PLANTILLA))
  ctx.drawImage(media, 0, 0)

  const { data } = ctx.getImageData(0, 0, LADO, LADO) // RGBA
  // NCHW, RGB, (x − 127.5) / 127.5 — el preprocesamiento canónico de ArcFace.
  const plano = LADO * LADO
  const entrada = new Float32Array(3 * plano)
  for (let i = 0; i < plano; i++) {
    entrada[i] = (data[i * 4] - 127.5) / 127.5
    entrada[plano + i] = (data[i * 4 + 1] - 127.5) / 127.5
    entrada[2 * plano + i] = (data[i * 4 + 2] - 127.5) / 127.5
  }

  const tensor = new ort.Tensor('float32', entrada, [1, 3, LADO, LADO])
  const salida = await sesion.run({ [sesion.inputNames[0]]: tensor })
  const crudo = salida[sesion.outputNames[0]].data

  // Normalizado L2: así la similitud coseno es un producto punto simple.
  let norma = 0
  for (let i = 0; i < V2_LARGO; i++) norma += crudo[i] * crudo[i]
  norma = Math.sqrt(norma) || 1
  const vec = new Array(V2_LARGO)
  for (let i = 0; i < V2_LARGO; i++) vec[i] = crudo[i] / norma
  return vec
}

/** Similitud coseno entre descriptores v2 YA normalizados. */
export function similitudV2(a, b) {
  let s = 0
  for (let i = 0; i < V2_LARGO; i++) s += a[i] * b[i]
  return s
}

/** Promedio de varios descriptores v2, re-normalizado. */
export function promedioV2(lista) {
  if (lista.length === 1) return lista[0]
  const suma = new Array(V2_LARGO).fill(0)
  for (const v of lista) for (let i = 0; i < V2_LARGO; i++) suma[i] += v[i]
  let norma = 0
  for (let i = 0; i < V2_LARGO; i++) norma += suma[i] * suma[i]
  norma = Math.sqrt(norma) || 1
  return suma.map((x) => x / norma)
}

/** ¿Es un descriptor v2 válido? — la definición vive en utils/faceMath.js. */
export { esDescriptorV2 } from '../utils/faceMath.js'
