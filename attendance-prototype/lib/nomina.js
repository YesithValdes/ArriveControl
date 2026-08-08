/**
 * lib/nomina.js — Arma el lote de horas con recargo desde POSTGRES.
 *
 * Es solo la capa de datos: lee marcaciones y configuración, y delega el
 * cálculo en lib/calculoHoras.js (la regla de negocio, sin base de datos ni
 * red, para que sea probable). Lo consume `GET /api/horas`, que es la salida
 * de ArriveControl hacia nómina o hacia Excel.
 */
import { pool } from './db.js'
import { configLaboral } from './configLaboral.js'
import { calcularRegistros } from './calculoHoras.js'

/**
 * Tramos con recargo de todos los empleados en un rango [desde, hasta]
 * (fechas YYYY-MM-DD en día Bogotá). Sin rango: todo el historial.
 * @returns {Promise<{registros: Array, porEmpleado: Map}>}
 */
export async function construirLote(rango = null) {
  // Jornada y festivos: del GESTOR (fuente única), no de config_laboral.
  const { festivos, vigencias } = await configLaboral()

  const cond = ['not m.eliminada']
  const args = []
  if (rango?.desde) { args.push(rango.desde); cond.push(`(m.ts at time zone 'America/Bogota')::date >= $${args.length}::date`) }
  if (rango?.hasta) { args.push(rango.hasta); cond.push(`(m.ts at time zone 'America/Bogota')::date <= $${args.length}::date`) }

  // Todo en hora Bogotá desde SQL: fecha, minutos del día y timestamp.
  const { rows } = await pool.query(
    `select m.empleado_id, e.cedula, e.nombre, e.jornada_semanal, s.nombre as sede_nombre, m.tipo,
            to_char(m.ts at time zone 'America/Bogota', 'YYYY-MM-DD') as fecha,
            (extract(hour from m.ts at time zone 'America/Bogota') * 60
             + extract(minute from m.ts at time zone 'America/Bogota'))::int as minutos,
            extract(epoch from m.ts) as epoch,
            extract(dow from m.ts at time zone 'America/Bogota')::int as dow
       from asistencia.marcaciones m
       join asistencia.empleados e on e.id = m.empleado_id
       left join asistencia.sedes s on s.id = m.sede_id
      where ${cond.join(' and ')}
      order by m.empleado_id, m.ts`,
    args,
  )

  const porEmpleado = new Map()
  for (const r of rows) {
    if (!porEmpleado.has(r.empleado_id)) {
      porEmpleado.set(r.empleado_id, {
        cedula: r.cedula, nombre: r.nombre, sede: r.sede_nombre,
        jornadaSemanal: r.jornada_semanal, marcas: [],
      })
    }
    porEmpleado.get(r.empleado_id).marcas.push(r)
  }

  return { registros: calcularRegistros(porEmpleado, { festivos, vigencias }), porEmpleado }
}

// La bitácora `envios_rh` y su función `registrarEnvio` se eliminaron junto
// con el empuje a nómina: ya no se "envía" nada, se calcula bajo demanda.
// La tabla queda en la base con su historial, sin escrituras nuevas.
