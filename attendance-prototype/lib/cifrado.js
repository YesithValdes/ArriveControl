/**
 * lib/cifrado.js — Primitivas de cifrado (solo servidor). Sin base de datos.
 *
 * Todo es AES-256-GCM de `node:crypto`: cifrado autenticado, así que un dato
 * alterado o movido de lugar no se descifra mal — falla. Ese "movido de
 * lugar" lo cubren los DATOS ASOCIADOS (aad): cada sobre se cifra atado a la
 * empresa y al uso que tiene, y no se abre fuera de ese contexto. Una DEK
 * envuelta copiada de la fila de otra empresa no se desenvuelve; una cédula
 * cifrada pegada en la columna del salario, tampoco.
 *
 * Tres llaves, tres papeles (ver control/017_llaves_y_soporte.sql):
 *   · maestra       → del servidor (ARRIVE_LLAVE_MAESTRA). Envuelve las DEK.
 *   · recuperación  → de la empresa; solo la conoce el dueño. Envuelve la DEK.
 *   · DEK           → de la empresa, 256 bits. Cifra sus datos sensibles.
 *
 * Este archivo no sabe de empresas ni de tablas: eso es lib/llaves.js.
 */
import { createCipheriv, createDecipheriv, hkdfSync, randomBytes, timingSafeEqual } from 'node:crypto'

const ALGORITMO = 'aes-256-gcm'
const BYTES_LLAVE = 32 // 256 bits
const BYTES_IV = 12    // el tamaño que recomienda GCM
const PREFIJO = 'ac1'  // versión del FORMATO del sobre, no de la llave

const b64 = (buf) => Buffer.from(buf).toString('base64url')
const deB64 = (s) => Buffer.from(String(s), 'base64url')

/** Una llave nueva de 256 bits (para una DEK). */
export const nuevaLlave = () => randomBytes(BYTES_LLAVE)

/** Borra una llave de memoria en cuanto deja de hacer falta (mejor esfuerzo). */
export const olvidar = (buf) => { if (Buffer.isBuffer(buf)) buf.fill(0) }

function exigirLlave(llave) {
  if (!Buffer.isBuffer(llave) || llave.length !== BYTES_LLAVE) {
    throw new Error('Llave inválida: se esperaban 32 bytes.')
  }
}

/**
 * Cifra `datos` (Buffer o texto) con `llave`, atado a `aad`.
 * Devuelve `ac1.<etiquetaLlave>.<iv>.<cifrado>.<tag>` en base64url — texto,
 * para que quepa en una columna `text` sin conversiones.
 *
 * `etiquetaLlave` dice con QUÉ llave se cifró (la versión de la DEK, o el id
 * de la maestra): así un dato cifrado sigue abriéndose después de una rotación.
 */
export function sellar(llave, datos, aad, etiquetaLlave = '0') {
  exigirLlave(llave)
  if (!/^[A-Za-z0-9_-]{1,32}$/.test(String(etiquetaLlave))) {
    throw new Error('Etiqueta de llave inválida.')
  }
  const iv = randomBytes(BYTES_IV)
  const cifrador = createCipheriv(ALGORITMO, llave, iv)
  cifrador.setAAD(Buffer.from(String(aad), 'utf8'))
  const cuerpo = Buffer.concat([cifrador.update(Buffer.isBuffer(datos) ? datos : Buffer.from(String(datos), 'utf8')), cifrador.final()])
  const tag = cifrador.getAuthTag()
  return [PREFIJO, etiquetaLlave, b64(iv), b64(cuerpo), b64(tag)].join('.')
}

/** Partes de un sobre, sin abrirlo. Lanza si no tiene el formato. */
export function leerSobre(sobre) {
  const partes = String(sobre ?? '').split('.')
  if (partes.length !== 5 || partes[0] !== PREFIJO) throw new Error('No es un dato cifrado de ArriveControl.')
  const [, etiquetaLlave, iv, cuerpo, tag] = partes
  return { etiquetaLlave, iv: deB64(iv), cuerpo: deB64(cuerpo), tag: deB64(tag) }
}

/** ¿Este valor ya es un sobre cifrado? (útil al migrar columnas por etapas) */
export const esSobre = (valor) => typeof valor === 'string' && valor.startsWith(`${PREFIJO}.`) && valor.split('.').length === 5

/** Abre un sobre de `sellar`. Devuelve un Buffer. Lanza si la llave o el aad no corresponden. */
export function abrir(llave, sobre, aad) {
  exigirLlave(llave)
  const { iv, cuerpo, tag } = leerSobre(sobre)
  if (iv.length !== BYTES_IV || tag.length !== 16) throw new Error('Dato cifrado corrupto.')
  const descifrador = createDecipheriv(ALGORITMO, llave, iv)
  descifrador.setAAD(Buffer.from(String(aad), 'utf8'))
  descifrador.setAuthTag(tag)
  try {
    return Buffer.concat([descifrador.update(cuerpo), descifrador.final()])
  } catch {
    // GCM no distingue «llave equivocada» de «dato alterado» de «otro
    // contexto», y tampoco conviene decírselo a nadie: las tres son lo mismo.
    throw new Error('No se pudo descifrar: llave, contexto o dato no corresponden.')
  }
}

// ── Contextos (aad) ─────────────────────────────────────────────────────
// Se arman aquí y en ningún otro lugar: un aad escrito a mano en dos sitios
// distintos que difiera en un carácter deja datos imposibles de abrir.

/** aad de una DEK envuelta: empresa + versión + con qué se envolvió. */
export const aadDek = (empresaId, version, tipo) => {
  if (tipo !== 'maestra' && tipo !== 'recuperacion') throw new Error(`Tipo de envoltura desconocido: ${tipo}`)
  return `arrivecontrol:dek:${empresaId}:v${version}:${tipo}`
}

/** aad de un dato de la empresa: empresa + dónde vive (p. ej. 'empleados.cedula'). */
export const aadDato = (empresaId, contexto) => {
  if (!/^[a-z_]+\.[a-z_0-9]+$/.test(String(contexto))) throw new Error(`Contexto de dato inválido: ${contexto}`)
  return `arrivecontrol:dato:${empresaId}:${contexto}`
}

// ── Llave maestra del servidor ──────────────────────────────────────────

function decodificarMaestra(valor, nombre) {
  const limpio = String(valor).trim()
  const buf = Buffer.from(limpio, /[-_]/.test(limpio) ? 'base64url' : 'base64')
  if (buf.length !== BYTES_LLAVE) {
    throw new Error(`${nombre} debe ser de 32 bytes en base64 (tiene ${buf.length}). Genera una con: node db/llaves.mjs nueva-maestra`)
  }
  return buf
}

/**
 * Llaves maestras configuradas: la vigente y, durante una rotación, la
 * anterior. `null` si no hay ninguna — la aplicación sigue funcionando, pero
 * no puede crear ni abrir DEKs (y lo dice).
 *
 *   ARRIVE_LLAVE_MAESTRA              32 bytes en base64 — la vigente
 *   ARRIVE_LLAVE_MAESTRA_ID           cómo se llama (por defecto 'm1')
 *   ARRIVE_LLAVE_MAESTRA_ANTERIOR     solo mientras se rota
 *   ARRIVE_LLAVE_MAESTRA_ANTERIOR_ID
 */
export function llavesMaestras(env = process.env) {
  if (!env.ARRIVE_LLAVE_MAESTRA) return null
  const vigente = {
    id: env.ARRIVE_LLAVE_MAESTRA_ID || 'm1',
    llave: decodificarMaestra(env.ARRIVE_LLAVE_MAESTRA, 'ARRIVE_LLAVE_MAESTRA'),
  }
  const porId = new Map([[vigente.id, vigente.llave]])
  if (env.ARRIVE_LLAVE_MAESTRA_ANTERIOR) {
    const idAnterior = env.ARRIVE_LLAVE_MAESTRA_ANTERIOR_ID
    if (!idAnterior || idAnterior === vigente.id) {
      throw new Error('ARRIVE_LLAVE_MAESTRA_ANTERIOR_ID debe existir y ser distinto del id vigente.')
    }
    porId.set(idAnterior, decodificarMaestra(env.ARRIVE_LLAVE_MAESTRA_ANTERIOR, 'ARRIVE_LLAVE_MAESTRA_ANTERIOR'))
  }
  return { vigente, porId }
}

// ── Llave de recuperación de la empresa ─────────────────────────────────
//
// 256 bits aleatorios, mostrados en base32 (A–Z, 2–7) en grupos de cuatro:
// se pueden dictar, imprimir y volver a escribir. No es una contraseña
// elegida por alguien, así que no necesita un derivador lento: ya trae toda
// la entropía. Se deriva con HKDF, atada a la empresa.

const ALFABETO = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'

function aBase32(buf) {
  let bits = 0, valor = 0, salida = ''
  for (const byte of buf) {
    valor = (valor << 8) | byte
    bits += 8
    while (bits >= 5) {
      salida += ALFABETO[(valor >>> (bits - 5)) & 31]
      bits -= 5
    }
  }
  if (bits > 0) salida += ALFABETO[(valor << (5 - bits)) & 31]
  return salida
}

function deBase32(texto) {
  let bits = 0, valor = 0
  const bytes = []
  for (const c of texto) {
    const i = ALFABETO.indexOf(c)
    if (i < 0) throw new Error('La llave de recuperación tiene caracteres que no le pertenecen.')
    valor = (valor << 5) | i
    bits += 5
    if (bits >= 8) {
      bytes.push((valor >>> (bits - 8)) & 255)
      bits -= 8
    }
  }
  return Buffer.from(bytes)
}

/** Llave de recuperación nueva: `{ bytes, texto }`. El texto se muestra UNA vez. */
export function nuevaRecuperacion() {
  const bytes = randomBytes(BYTES_LLAVE)
  const texto = aBase32(bytes).match(/.{1,4}/g).join('-')
  return { bytes, texto }
}

/**
 * Texto escrito por una persona → bytes. Tolera minúsculas, espacios, guiones
 * y las confusiones típicas al copiar a mano (0↔O, 1↔I, 8↔B), que en este
 * alfabeto no son ambiguas porque 0, 1 y 8 no existen.
 */
export function leerRecuperacion(texto) {
  const limpio = String(texto ?? '').toUpperCase().replace(/[\s-]/g, '')
    .replace(/0/g, 'O').replace(/1/g, 'I').replace(/8/g, 'B')
  if (limpio.length !== 52) throw new Error('La llave de recuperación debe tener 52 caracteres (13 grupos de 4).')
  const bytes = deBase32(limpio)
  if (bytes.length !== BYTES_LLAVE) throw new Error('Llave de recuperación inválida.')
  return bytes
}

const derivar = (bytes, empresaId, uso) =>
  Buffer.from(hkdfSync('sha256', bytes, Buffer.from(`arrivecontrol:${empresaId}`, 'utf8'), `recuperacion/${uso}/v1`, BYTES_LLAVE))

/** La llave que envuelve la DEK, derivada de la de recuperación. */
export const kekDeRecuperacion = (bytes, empresaId) => derivar(bytes, empresaId, 'kek')

/**
 * Huella para reconocer la llave de recuperación sin guardarla. Sale de una
 * derivación DISTINTA a la que envuelve la DEK: conocer la huella no ayuda a
 * desenvolver nada.
 */
export const huellaDeRecuperacion = (bytes, empresaId) => derivar(bytes, empresaId, 'huella').toString('hex')

/** Compara huellas en tiempo constante. */
export function mismaHuella(a, b) {
  const x = Buffer.from(String(a ?? ''), 'utf8')
  const y = Buffer.from(String(b ?? ''), 'utf8')
  return x.length === y.length && timingSafeEqual(x, y)
}
