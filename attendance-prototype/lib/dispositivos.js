/**
 * lib/dispositivos.js — Activación y validación de dispositivos del kiosco
 * (solo servidor). Cada aparato se activa una vez con sesión de admin y recibe
 * una clave propia; las APIs del kiosco exigen esa clave en X-Device-Key.
 *
 * Los dispositivos viven en el esquema COMPARTIDO `control`, no en el de la
 * empresa. Tienen que: el kiosco no trae sesión, así que hay que averiguar de
 * qué empresa es la tablet ANTES de poder abrir su esquema. Por eso cada fila
 * lleva su `empresa_id`.
 *
 * `sede_id` sí apunta al esquema de la empresa y va sin llave foránea — la
 * base no puede validarlo, así que se valida al activar el dispositivo.
 */
import { createHash, randomBytes } from 'node:crypto'
import { control, conEmpresa } from './db.js'

const sha256 = (s) => createHash('sha256').update(s).digest('hex')

/**
 * Activa un dispositivo nuevo. La clave se genera aquí y se devuelve UNA sola
 * vez; en la base queda solo el hash.
 *
 * @param {{empresa: object, nombre: string, sedeId?: string, activadoPor?: string}} p
 */
export async function activarDispositivo({ empresa, nombre, sedeId = null, activadoPor = null }) {
  // La sede debe existir y ser de ESTA empresa. Sin llave foránea que cruce de
  // esquema, esta comprobación es lo único que impide apuntar a la sede de
  // otro cliente.
  if (sedeId) {
    const existe = await conEmpresa(empresa.esquema, async (db) =>
      (await db.query(`select 1 from sedes where id = $1`, [sedeId])).rowCount > 0,
    )
    if (!existe) return { error: 'SEDE_NO_ENCONTRADA' }
  }

  const clave = randomBytes(24).toString('base64url') // ~32 chars, url-safe
  const { rows } = await control(
    `insert into control.dispositivos (empresa_id, nombre, sede_id, clave_hash, activado_por)
     values ($1,$2,$3,$4,$5)
     returning id, nombre, sede_id, creada_en`,
    [empresa.id, nombre, sedeId, sha256(clave), activadoPor],
  )
  return { ...rows[0], clave }
}

/** Dispositivos de una empresa, con el nombre de su sede. */
export async function listarDispositivos(empresa) {
  const { rows } = await control(
    `select d.id, d.nombre, d.sede_id, d.activo, d.activado_por, d.creada_en, d.ultimo_uso
       from control.dispositivos d
      where d.empresa_id = $1
      order by d.creada_en desc`,
    [empresa.id],
  )
  if (rows.length === 0) return rows

  // El nombre de la sede vive en el esquema de la empresa, así que no se puede
  // resolver con un join desde `control`: se trae aparte y se cruza en memoria.
  const sedes = await conEmpresa(empresa.esquema, async (db) =>
    (await db.query(`select id, nombre from sedes`)).rows,
  )
  const porId = new Map(sedes.map((s) => [s.id, s.nombre]))
  return rows.map((d) => ({ ...d, sede_nombre: porId.get(d.sede_id) ?? null }))
}

/**
 * Revoca (desactiva) un dispositivo. El aparato queda fuera al instante.
 * Se exige la empresa para que nadie revoque el kiosco de otro cliente.
 */
export async function revocarDispositivo(empresa, id) {
  const { rowCount } = await control(
    `update control.dispositivos set activo = false
      where id = $1 and empresa_id = $2`,
    [id, empresa.id],
  )
  return rowCount > 0
}
