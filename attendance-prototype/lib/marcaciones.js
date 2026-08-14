/**
 * lib/marcaciones.js — Lógica de marcaciones SOBRE POSTGRES (solo servidor).
 *
 * Es la misma lógica de journeyService (alternancia con reinicio diario,
 * anti-rebote de 3 min) pero decidida aquí, con la hora de la BASE DE DATOS —
 * el cliente nunca dice qué hora es ni si es entrada o salida.
 *
 * Las anomalías (entrada tardía, salida faltante…) NO se guardan: se derivan
 * al consultar, a partir de las marcaciones y el horario del empleado.
 *
 * Multi-empresa: el SQL va sin prefijo de esquema — lo fija `conEmpresa()` por
 * petición. Toda función de aquí recibe el `esquema` de la empresa a la que
 * pertenece la marcación.
 */
import { conEmpresa } from './db.js'

export const ANTI_BOUNCE_MS = 3 * 60 * 1000

/** Distancia en metros entre dos coordenadas (haversine). */
export function distanciaM(lat1, lon1, lat2, lon2) {
  const R = 6371000
  const rad = (g) => (g * Math.PI) / 180
  const dLat = rad(lat2 - lat1)
  const dLon = rad(lon2 - lon1)
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLon / 2) ** 2
  return Math.round(2 * R * Math.asin(Math.sqrt(a)))
}

/** Día calendario en Bogotá (UTC-5 fijo, sin horario de verano). */
const diaBogota = (d) => new Date(new Date(d).getTime() - 5 * 3600000).toISOString().slice(0, 10)

/**
 * Registra el paso de un empleado por el kiosco.
 * @param {object} p
 * @param {string} p.esquema  el de la empresa dueña del kiosco
 * @param {string} p.empleadoId
 * @param {string} p.sedeId
 * @param {string=} p.tsDispositivo  ISO — solo cola offline (diferido)
 * @param {boolean=} p.diferido
 * @returns {{duplicado:true, ultima:object} | {tipo:'entrada'|'salida', marcacion:object} | {error:string}}
 */
export async function registrarPaso({ esquema, empleadoId, sedeId, tsDispositivo = null, diferido = false, lat = null, lon = null, precisionM = null }) {
  // `conEmpresa` ya abre la transacción y fija el esquema; el lock por empleado
  // y la lectura de la última marcación viven dentro de ella, que es lo que
  // impide que dos pasadas simultáneas se pisen.
  return conEmpresa(esquema, async (client) => {
    const emp = await client.query(
      `select e.id, e.activo, e.nombre, e.correo, e.validar_sede, e.validar_ubicacion,
              e.sede_id, s.nombre as sede_nombre, s.lat as sede_lat, s.lon as sede_lon, s.radio_m
         from empleados e
         left join sedes s on s.id = e.sede_id
        where e.id = $1`, [empleadoId],
    )
    // Salir devolviendo, sin `rollback`: la transacción la cierra `conEmpresa`,
    // y aquí todavía no se escribió nada, así que confirmarla es inofensivo.
    // Un `rollback` a mano dejaría la transacción abortada y el `commit` del
    // envoltorio fallaría después.
    if (emp.rowCount === 0 || !emp.rows[0].activo) {
      return { error: 'EMPLEADO_NO_ENCONTRADO' }
    }
    const persona = emp.rows[0]

    // LIMITAR UBICACIÓN (validar_sede): la marcación debe caer dentro del
    // radio de la sede del empleado, según el GPS del dispositivo. El margen
    // suma la imprecisión reportada (capada a 100 m) para no rechazar por un
    // GPS flojo. Sin coordenadas no se rechaza aquí: un kiosco fijo sin
    // permiso de GPS sigue valiendo por el candado kiosco→sede que ya existe.
    if (persona.validar_sede && persona.sede_lat != null && lat != null && lon != null) {
      const d = distanciaM(lat, lon, persona.sede_lat, persona.sede_lon)
      const margen = Math.min(Number(precisionM) || 0, 100)
      if (d > persona.radio_m + margen) {
        return { rechazo: `Estás a ${d} m de ${persona.sede_nombre} y el límite es ${persona.radio_m} m. Debes marcar dentro de tu sede.` }
      }
    }

    // La ubicación exacta se guarda cuando el empleado tiene alguno de los
    // dos candados de ubicación; sin ellos no se retiene el dato (es la
    // preferencia que el administrador marcó al registrarlo).
    const guardaGps = (persona.validar_ubicacion || persona.validar_sede) && lat != null && lon != null

    // Hora oficial y última marcación, ambas de la base de datos.
    // El lock por empleado evita la carrera de dos pasadas simultáneas.
    await client.query(`select pg_advisory_xact_lock(hashtext($1))`, [empleadoId])
    const ahora = diferido && tsDispositivo ? new Date(tsDispositivo) : new Date((await client.query('select now() as n')).rows[0].n)
    const ult = await client.query(
      `select id, tipo, ts from marcaciones
        where empleado_id = $1 and not eliminada
        order by ts desc limit 1`, [empleadoId],
    )
    const ultima = ult.rows[0] ?? null

    // Anti-rebote: doble pasada en < 3 min (abs: protege relojes que retroceden).
    if (ultima && Math.abs(ahora - new Date(ultima.ts)) < ANTI_BOUNCE_MS) {
      return { duplicado: true, ultima }
    }

    // Alternancia con REINICIO DIARIO: solo una entrada de HOY (día Bogotá)
    // alterna a salida; cualquier otro caso arranca el día con entrada.
    const mismoDia = ultima && diaBogota(ultima.ts) === diaBogota(ahora)
    const tipo = ultima && ultima.tipo === 'entrada' && mismoDia ? 'salida' : 'entrada'

    const ins = await client.query(
      `insert into marcaciones (empleado_id, tipo, ts, ts_dispositivo, sede_id, origen, lat, lon, precision_m)
       values ($1, $2, ${diferido && tsDispositivo ? '$8' : 'now()'}, $3, $4, ${diferido ? `'kiosco_diferido'` : `'kiosco'`}, $5, $6, $7)
       returning *`,
      [
        empleadoId, tipo, tsDispositivo, sedeId,
        guardaGps ? lat : null, guardaGps ? lon : null, guardaGps ? Math.round(Number(precisionM) || 0) || null : null,
        ...(diferido && tsDispositivo ? [tsDispositivo] : []),
      ],
    )
    // Datos extra para el comprobante por correo (la ruta decide si envía).
    // La sede del comprobante es DONDE marcó (la del kiosco), no la asignada.
    let sedeMarcacion = null
    if (sedeId) {
      const s = await client.query(`select nombre from sedes where id = $1`, [sedeId])
      sedeMarcacion = s.rows[0]?.nombre ?? null
    }
    return {
      tipo,
      marcacion: ins.rows[0],
      empleado: { nombre: persona.nombre, correo: persona.correo },
      sedeNombre: sedeMarcacion || persona.sede_nombre || null,
    }
  })
}

/**
 * Lista marcaciones para el panel, con nombre del empleado.
 * @param {string} esquema  el de la empresa que consulta
 * @param {{desde?:string, hasta?:string, empleadoId?:string}} f  fechas YYYY-MM-DD (día Bogotá)
 */
export async function listarMarcaciones(esquema, f = {}) {
  const cond = ['not m.eliminada']
  const args = []
  if (f.empleadoId) { args.push(f.empleadoId); cond.push(`m.empleado_id = $${args.length}`) }
  if (f.desde) { args.push(f.desde); cond.push(`(m.ts at time zone 'America/Bogota')::date >= $${args.length}::date`) }
  if (f.hasta) { args.push(f.hasta); cond.push(`(m.ts at time zone 'America/Bogota')::date <= $${args.length}::date`) }

  return conEmpresa(esquema, async (db) => {
    const { rows } = await db.query(
      `select m.id, m.empleado_id, e.nombre as empleado_nombre, e.cedula,
              m.tipo, m.ts, m.ts_dispositivo, m.sede_id, s.nombre as sede_nombre, m.origen,
              m.lat, m.lon, m.precision_m
         from marcaciones m
         join empleados e on e.id = m.empleado_id
         left join sedes s on s.id = m.sede_id
        where ${cond.join(' and ')}
        order by m.ts asc`,
      args,
    )
    return rows
  })
}
