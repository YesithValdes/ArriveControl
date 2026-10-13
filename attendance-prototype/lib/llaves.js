/**
 * lib/llaves.js — La DEK de cada empresa (solo servidor).
 *
 * Cada empresa tiene una DEK de 256 bits guardada en control.empresa_llaves
 * ENVUELTA dos veces: con la llave maestra del servidor y con la llave de
 * recuperación de la empresa. Este módulo es el único que la desenvuelve, y
 * lo que entrega hacia afuera son operaciones (`cifrarDato`, `descifrarDato`),
 * no la llave: el resto de la aplicación no tiene por qué tocarla.
 *
 * Primitivas en lib/cifrado.js; tablas en control/017_llaves_y_soporte.sql.
 */
import { control } from './db.js'
import {
  sellar, abrir, leerSobre, esSobre, nuevaLlave, olvidar, aadDek, aadDato,
  llavesMaestras, nuevaRecuperacion, leerRecuperacion, kekDeRecuperacion,
  huellaDeRecuperacion, mismaHuella,
} from './cifrado.js'

// La configuración de las maestras se lee UNA vez. Si está mal escrita, el
// error aparece en la primera operación que la necesita, con su causa.
let maestrasCache
function maestras() {
  if (maestrasCache === undefined) maestrasCache = llavesMaestras()
  return maestrasCache
}

/** ¿Hay llave maestra configurada en este servidor? */
export function cifradoConfigurado() {
  try { return maestras() !== null } catch { return false }
}

function exigirMaestras() {
  const m = maestras()
  if (!m) {
    throw new Error('Cifrado sin configurar: falta ARRIVE_LLAVE_MAESTRA en el servidor.')
  }
  return m
}

// ── Caché de DEKs abiertas ──────────────────────────────────────────────
// Desenvolver es barato, pero ir a la base en cada dato no. Cinco minutos:
// lo bastante para una petición del panel con cientos de filas, y lo bastante
// corto para que una DEK retirada deje de usarse sola.
const TTL_MS = 5 * 60 * 1000
const cache = new Map() // `${empresaId}:${version|'activa'}` → { version, llave, expira }

/** Olvida las DEK abiertas (tras rotar, restaurar o borrar una empresa). */
export function olvidarLlaves(empresaId = null) {
  for (const [clave, v] of cache) {
    if (!empresaId || clave.startsWith(`${empresaId}:`)) {
      olvidar(v.llave)
      cache.delete(clave)
    }
  }
}

function desenvolverConMaestra(fila) {
  const { porId } = exigirMaestras()
  const maestra = porId.get(fila.maestra_id)
  if (!maestra) {
    throw new Error(
      `La DEK de la empresa está envuelta con la maestra "${fila.maestra_id}", que este servidor no tiene. `
      + 'Configura ARRIVE_LLAVE_MAESTRA_ANTERIOR o restáurala con la llave de recuperación.',
    )
  }
  return abrir(maestra, fila.dek_maestra, aadDek(fila.empresa_id, fila.version, 'maestra'))
}

// ── Crear ───────────────────────────────────────────────────────────────

/**
 * Crea la DEK (versión 1) de una empresa, envuelta con la maestra vigente.
 * Recibe el cliente de una transacción para poder ir junto con el alta de la
 * empresa: o nacen las dos, o ninguna. Idempotente: si ya tiene una activa,
 * no hace nada.
 *
 * @param {{query: Function}} db  cliente de pg (o algo con `.query`)
 * @returns {Promise<boolean>}  true si la creó
 */
export async function crearLlaveEmpresa(db, empresaId) {
  const { vigente } = exigirMaestras()
  const dek = nuevaLlave()
  try {
    const envuelta = sellar(vigente.llave, dek, aadDek(empresaId, 1, 'maestra'), vigente.id)
    const r = await db.query(
      `insert into control.empresa_llaves (empresa_id, version, dek_maestra, maestra_id)
       values ($1, 1, $2, $3)
       on conflict do nothing`,
      [empresaId, envuelta, vigente.id],
    )
    return r.rowCount > 0
  } finally {
    olvidar(dek)
  }
}

/** Se asegura de que la empresa tenga DEK (para las que nacieron antes del cifrado). */
export async function asegurarLlave(empresa) {
  return crearLlaveEmpresa({ query: control }, empresa.id)
}

// ── Abrir ───────────────────────────────────────────────────────────────

/**
 * DEK de una empresa: la activa, o una versión concreta (para abrir datos
 * cifrados antes de una rotación). Si la empresa todavía no tiene DEK se le
 * crea en el momento — así las empresas que existían antes del cifrado no
 * necesitan un paso manual para empezar a usarlo.
 *
 * @returns {Promise<{version: number, llave: Buffer}>}
 */
async function dek(empresa, version = null) {
  const clave = `${empresa.id}:${version ?? 'activa'}`
  const hit = cache.get(clave)
  if (hit && Date.now() < hit.expira) return hit

  const buscar = () => control(
    version == null
      ? `select empresa_id, version, dek_maestra, maestra_id from control.empresa_llaves
          where empresa_id = $1 and estado = 'activa'`
      : `select empresa_id, version, dek_maestra, maestra_id from control.empresa_llaves
          where empresa_id = $1 and version = $2`,
    version == null ? [empresa.id] : [empresa.id, version],
  )
  let { rows } = await buscar()
  if (rows.length === 0 && version == null) {
    await asegurarLlave(empresa)
    ;({ rows } = await buscar())
  }
  if (rows.length === 0) throw new Error(`La empresa no tiene la DEK versión ${version ?? 'activa'}.`)

  const entrada = { version: rows[0].version, llave: desenvolverConMaestra(rows[0]), expira: Date.now() + TTL_MS }
  cache.set(clave, entrada)
  return entrada
}

// ── Cifrar y descifrar datos de la empresa ──────────────────────────────

/**
 * Cifra un dato de la empresa. `contexto` es dónde vive ('empleados.cedula'):
 * va en los datos asociados, así que el sobre solo se abre en ese lugar.
 * null y undefined pasan tal cual — un campo vacío no tiene nada que ocultar.
 */
export async function cifrarDato(empresa, contexto, valor) {
  if (valor == null) return valor
  const { version, llave } = await dek(empresa)
  return sellar(llave, valor, aadDato(empresa.id, contexto), String(version))
}

/**
 * Descifra un dato de la empresa y lo devuelve como texto (o Buffer con
 * `{ binario: true }`). Un valor que NO es sobre se devuelve igual: es lo que
 * permite cifrar una columna por etapas, con filas viejas en claro conviviendo
 * con las nuevas cifradas hasta que la migración las alcance.
 */
export async function descifrarDato(empresa, contexto, valor, { binario = false } = {}) {
  if (valor == null || !esSobre(valor)) return valor
  const version = Number(leerSobre(valor).etiquetaLlave)
  const { llave } = await dek(empresa, Number.isInteger(version) && version > 0 ? version : null)
  const buf = abrir(llave, valor, aadDato(empresa.id, contexto))
  return binario ? buf : buf.toString('utf8')
}

// ── Estado (para el panel del dueño) ────────────────────────────────────

export async function estadoLlaves(empresa) {
  const { rows } = await control(
    `select version, maestra_id, creada_en, recuperacion_creada_en, recuperacion_creada_por,
            dek_recuperacion is not null as con_recuperacion
       from control.empresa_llaves
      where empresa_id = $1 and estado = 'activa'`,
    [empresa.id],
  )
  const fila = rows[0]
  return {
    configurado: cifradoConfigurado(),
    tieneDek: Boolean(fila),
    version: fila?.version ?? null,
    creadaEn: fila?.creada_en ?? null,
    recuperacion: fila?.con_recuperacion
      ? { creadaEn: fila.recuperacion_creada_en, creadaPor: fila.recuperacion_creada_por }
      : null,
  }
}

// ── Llave de recuperación ───────────────────────────────────────────────

/**
 * Genera la llave de recuperación de la empresa y envuelve con ella TODAS las
 * versiones de su DEK. Devuelve el texto de la llave: es la ÚNICA vez que
 * existe fuera de la cabeza (o el papel) del dueño — aquí solo queda la DEK
 * envuelta y una huella.
 *
 * Con `reemplazar` se genera una nueva y la anterior deja de servir. Sin él,
 * si ya había una, se rechaza: nadie debe pisar por accidente la llave que el
 * dueño guardó.
 *
 * @returns {Promise<{texto: string}|{error: 'YA_EXISTE'}>}
 */
export async function generarRecuperacion(empresa, { creadaPor = null, reemplazar = false } = {}) {
  await dek(empresa) // garantiza que exista la DEK (y que la maestra la abra)
  const { rows } = await control(
    `select empresa_id, version, dek_maestra, maestra_id, dek_recuperacion
       from control.empresa_llaves where empresa_id = $1 order by version`,
    [empresa.id],
  )
  if (!reemplazar && rows.some((f) => f.dek_recuperacion)) return { error: 'YA_EXISTE' }

  const { bytes, texto } = nuevaRecuperacion()
  const kek = kekDeRecuperacion(bytes, empresa.id)
  const huella = huellaDeRecuperacion(bytes, empresa.id)
  try {
    for (const fila of rows) {
      const llave = desenvolverConMaestra(fila)
      try {
        const envuelta = sellar(kek, llave, aadDek(empresa.id, fila.version, 'recuperacion'), 'r')
        await control(
          `update control.empresa_llaves
              set dek_recuperacion = $3, recuperacion_huella = $4,
                  recuperacion_creada_en = now(), recuperacion_creada_por = $5
            where empresa_id = $1 and version = $2`,
          [empresa.id, fila.version, envuelta, huella, creadaPor],
        )
      } finally {
        olvidar(llave)
      }
    }
  } finally {
    olvidar(kek)
    olvidar(bytes)
  }
  return { texto }
}

/**
 * ¿Esta es la llave de recuperación vigente de la empresa? Además de comparar
 * la huella, desenvuelve la DEK con ella: la respuesta "sí" significa que de
 * verdad recuperaría los datos, no solo que coincide un número.
 */
export async function verificarRecuperacion(empresa, texto) {
  let bytes
  try { bytes = leerRecuperacion(texto) } catch { return false }
  const { rows } = await control(
    `select version, dek_recuperacion, recuperacion_huella from control.empresa_llaves
      where empresa_id = $1 and estado = 'activa' and dek_recuperacion is not null`,
    [empresa.id],
  )
  const fila = rows[0]
  if (!fila || !mismaHuella(fila.recuperacion_huella, huellaDeRecuperacion(bytes, empresa.id))) {
    olvidar(bytes)
    return false
  }
  const kek = kekDeRecuperacion(bytes, empresa.id)
  try {
    olvidar(abrir(kek, fila.dek_recuperacion, aadDek(empresa.id, fila.version, 'recuperacion')))
    return true
  } catch {
    return false
  } finally {
    olvidar(kek)
    olvidar(bytes)
  }
}

/**
 * Recupera la DEK con la llave de recuperación y la vuelve a envolver con la
 * maestra VIGENTE. Es el camino para cuando la maestra con que estaba
 * envuelta se perdió o se rotó sin conservar la anterior: sin esto, los datos
 * de la empresa serían irrecuperables.
 *
 * @returns {Promise<{ok: true, versiones: number}|{error: 'LLAVE_INVALIDA'|'SIN_RECUPERACION'}>}
 */
export async function restaurarConRecuperacion(empresa, texto) {
  const { vigente } = exigirMaestras()
  let bytes
  try { bytes = leerRecuperacion(texto) } catch { return { error: 'LLAVE_INVALIDA' } }
  const { rows } = await control(
    `select version, dek_recuperacion, recuperacion_huella from control.empresa_llaves
      where empresa_id = $1 and dek_recuperacion is not null order by version`,
    [empresa.id],
  )
  if (rows.length === 0) { olvidar(bytes); return { error: 'SIN_RECUPERACION' } }
  if (!rows.every((f) => mismaHuella(f.recuperacion_huella, huellaDeRecuperacion(bytes, empresa.id)))) {
    olvidar(bytes)
    return { error: 'LLAVE_INVALIDA' }
  }
  const kek = kekDeRecuperacion(bytes, empresa.id)
  try {
    for (const fila of rows) {
      const llave = abrir(kek, fila.dek_recuperacion, aadDek(empresa.id, fila.version, 'recuperacion'))
      try {
        await control(
          `update control.empresa_llaves set dek_maestra = $3, maestra_id = $4
            where empresa_id = $1 and version = $2`,
          [empresa.id, fila.version, sellar(vigente.llave, llave, aadDek(empresa.id, fila.version, 'maestra'), vigente.id), vigente.id],
        )
      } finally {
        olvidar(llave)
      }
    }
  } catch {
    return { error: 'LLAVE_INVALIDA' }
  } finally {
    olvidar(kek)
    olvidar(bytes)
    olvidarLlaves(empresa.id)
  }
  return { ok: true, versiones: rows.length }
}

/**
 * Rotación de la llave maestra: vuelve a envolver con la VIGENTE toda DEK que
 * esté envuelta con otra (que debe estar configurada como ANTERIOR). No toca
 * ningún dato de las empresas: solo cambia el sobre de cada DEK.
 *
 * @returns {Promise<{reenvueltas: number, sinMaestra: string[]}>}
 */
export async function reenvolverConMaestraVigente() {
  const { vigente, porId } = exigirMaestras()
  const { rows } = await control(
    `select empresa_id, version, dek_maestra, maestra_id from control.empresa_llaves
      where maestra_id <> $1`,
    [vigente.id],
  )
  let reenvueltas = 0
  const sinMaestra = []
  for (const fila of rows) {
    if (!porId.has(fila.maestra_id)) { sinMaestra.push(`${fila.empresa_id} v${fila.version}`); continue }
    const llave = desenvolverConMaestra(fila)
    try {
      const r = await control(
        `update control.empresa_llaves set dek_maestra = $3, maestra_id = $4
          where empresa_id = $1 and version = $2 and maestra_id = $5`,
        [fila.empresa_id, fila.version, sellar(vigente.llave, llave, aadDek(fila.empresa_id, fila.version, 'maestra'), vigente.id), vigente.id, fila.maestra_id],
      )
      reenvueltas += r.rowCount
    } finally {
      olvidar(llave)
    }
  }
  olvidarLlaves()
  return { reenvueltas, sinMaestra }
}
