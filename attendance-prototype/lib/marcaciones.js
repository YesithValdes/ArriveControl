/**
 * lib/marcaciones.js — Lógica de marcaciones SOBRE POSTGRES (solo servidor).
 *
 * Es la misma lógica de journeyService (alternancia con reinicio diario,
 * anti-rebote de 3 min) pero decidida aquí, con la hora de la BASE DE DATOS —
 * el cliente nunca dice qué hora es ni si es entrada o salida.
 *
 * Las anomalías (entrada tardía, salida faltante…) NO se guardan: se derivan
 * al consultar, a partir de las marcaciones y el horario del empleado.
 */
import { pool } from './db.js'

export const ANTI_BOUNCE_MS = 3 * 60 * 1000

/** Día calendario en Bogotá (UTC-5 fijo, sin horario de verano). */
const diaBogota = (d) => new Date(new Date(d).getTime() - 5 * 3600000).toISOString().slice(0, 10)

/**
 * Registra el paso de un empleado por el kiosco.
 * @param {object} p
 * @param {string} p.empleadoId
 * @param {string} p.sedeId
 * @param {string=} p.tsDispositivo  ISO — solo cola offline (diferido)
 * @param {boolean=} p.diferido
 * @returns {{duplicado:true, ultima:object} | {tipo:'entrada'|'salida', marcacion:object} | {error:string}}
 */
export async function registrarPaso({ empleadoId, sedeId, tsDispositivo = null, diferido = false }) {
  const client = await pool.connect()
  try {
    await client.query('begin')

    const emp = await client.query(
      `select id, activo from asistencia.empleados where id = $1`, [empleadoId],
    )
    if (emp.rowCount === 0 || !emp.rows[0].activo) {
      await client.query('rollback')
      return { error: 'EMPLEADO_NO_ENCONTRADO' }
    }

    // Hora oficial y última marcación, ambas de la base de datos.
    // El lock por empleado evita la carrera de dos pasadas simultáneas.
    await client.query(`select pg_advisory_xact_lock(hashtext($1))`, [empleadoId])
    const ahora = diferido && tsDispositivo ? new Date(tsDispositivo) : new Date((await client.query('select now() as n')).rows[0].n)
    const ult = await client.query(
      `select id, tipo, ts from asistencia.marcaciones
        where empleado_id = $1 and not eliminada
        order by ts desc limit 1`, [empleadoId],
    )
    const ultima = ult.rows[0] ?? null

    // Anti-rebote: doble pasada en < 3 min (abs: protege relojes que retroceden).
    if (ultima && Math.abs(ahora - new Date(ultima.ts)) < ANTI_BOUNCE_MS) {
      await client.query('rollback')
      return { duplicado: true, ultima }
    }

    // Alternancia con REINICIO DIARIO: solo una entrada de HOY (día Bogotá)
    // alterna a salida; cualquier otro caso arranca el día con entrada.
    const mismoDia = ultima && diaBogota(ultima.ts) === diaBogota(ahora)
    const tipo = ultima && ultima.tipo === 'entrada' && mismoDia ? 'salida' : 'entrada'

    const ins = await client.query(
      `insert into asistencia.marcaciones (empleado_id, tipo, ts, ts_dispositivo, sede_id, origen)
       values ($1, $2, ${diferido && tsDispositivo ? '$5' : 'now()'}, $3, $4, ${diferido ? `'kiosco_diferido'` : `'kiosco'`})
       returning *`,
      diferido && tsDispositivo
        ? [empleadoId, tipo, tsDispositivo, sedeId, tsDispositivo]
        : [empleadoId, tipo, tsDispositivo, sedeId],
    )
    await client.query('commit')
    return { tipo, marcacion: ins.rows[0] }
  } catch (e) {
    await client.query('rollback')
    throw e
  } finally {
    client.release()
  }
}

/**
 * Lista marcaciones para el panel, con nombre del empleado.
 * @param {{desde?:string, hasta?:string, empleadoId?:string}} f  fechas YYYY-MM-DD (día Bogotá)
 */
export async function listarMarcaciones(f = {}) {
  const cond = ['not m.eliminada']
  const args = []
  if (f.empleadoId) { args.push(f.empleadoId); cond.push(`m.empleado_id = $${args.length}`) }
  if (f.desde) { args.push(f.desde); cond.push(`(m.ts at time zone 'America/Bogota')::date >= $${args.length}::date`) }
  if (f.hasta) { args.push(f.hasta); cond.push(`(m.ts at time zone 'America/Bogota')::date <= $${args.length}::date`) }

  const { rows } = await pool.query(
    `select m.id, m.empleado_id, e.nombre as empleado_nombre, e.cedula,
            m.tipo, m.ts, m.ts_dispositivo, m.sede_id, s.nombre as sede_nombre, m.origen
       from asistencia.marcaciones m
       join asistencia.empleados e on e.id = m.empleado_id
       left join asistencia.sedes s on s.id = m.sede_id
      where ${cond.join(' and ')}
      order by m.ts asc`,
    args,
  )
  return rows
}
