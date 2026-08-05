/**
 * lib/dispositivos.js — Activación y validación de dispositivos del kiosco
 * (solo servidor). Cada aparato se activa una vez con sesión de admin y recibe
 * una clave propia; las APIs del kiosco exigen esa clave en X-Device-Key.
 */
import { createHash, randomBytes } from 'node:crypto'
import { pool } from './db.js'

const sha256 = (s) => createHash('sha256').update(s).digest('hex')

/**
 * Valida la X-Device-Key de una petición del kiosco.
 * @param {Request} req
 * @returns {Promise<{id: string, nombre: string, sede_id: string|null} | null>}
 */
export async function dispositivoDeLaPeticion(req) {
  const clave = req.headers.get('x-device-key')
  if (!clave) return null
  const { rows } = await pool.query(
    `update asistencia.dispositivos set ultimo_uso = now()
      where clave_hash = $1 and activo
      returning id, nombre, sede_id`,
    [sha256(clave)],
  )
  return rows[0] ?? null
}

/**
 * Activa un dispositivo nuevo. La clave se genera aquí y se devuelve UNA sola
 * vez; en la base queda solo el hash.
 */
export async function activarDispositivo({ nombre, sedeId, activadoPor }) {
  const clave = randomBytes(24).toString('base64url') // ~32 chars, url-safe
  const { rows } = await pool.query(
    `insert into asistencia.dispositivos (nombre, sede_id, clave_hash, activado_por)
     values ($1,$2,$3,$4)
     returning id, nombre, sede_id, creada_en`,
    [nombre, sedeId ?? null, sha256(clave), activadoPor ?? null],
  )
  return { ...rows[0], clave }
}

export async function listarDispositivos() {
  const { rows } = await pool.query(
    `select d.id, d.nombre, d.activo, d.activado_por, d.creada_en, d.ultimo_uso,
            s.nombre as sede_nombre
       from asistencia.dispositivos d
       left join asistencia.sedes s on s.id = d.sede_id
      order by d.creada_en desc`,
  )
  return rows
}

/** Revoca (desactiva) un dispositivo. El aparato queda fuera al instante. */
export async function revocarDispositivo(id) {
  const { rowCount } = await pool.query(
    `update asistencia.dispositivos set activo = false where id = $1`,
    [id],
  )
  return rowCount > 0
}
