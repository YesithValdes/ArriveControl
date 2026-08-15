/**
 * lib/nomina.js — Arma el lote de horas con recargo desde POSTGRES.
 *
 * Es solo la capa de datos: lee marcaciones y configuración, y delega el
 * cálculo en lib/calculoHoras.js (la regla de negocio, sin base de datos ni
 * red, para que sea probable). Lo consume `GET /api/horas`, que es la salida
 * de ArriveControl hacia nómina o hacia Excel.
 */
import { conEmpresa } from './db.js'
import { configLaboral, vigenciasPago, pagoVigenteEn } from './configLaboral.js'
import { calcularRegistros } from './calculoHoras.js'
import { valorizarRegistro } from './tiposHora.js'

/**
 * Tramos con recargo de todos los empleados en un rango [desde, hasta]
 * (fechas YYYY-MM-DD en día Bogotá). Sin rango: todo el historial.
 * @param {string} esquema  el de la empresa que se liquida
 * @returns {Promise<{registros: Array, porEmpleado: Map}>}
 */
export async function construirLote(esquema, rango = null) {
  const { festivos, vigencias, nocturno, factores, divisor } = await configLaboral(esquema)
  // Parámetros de pago CON HISTORIA: cada tramo se clasifica y valoriza con lo
  // que regía en SU fecha, no con lo de hoy. `actualPago` es el respaldo para
  // esquemas de antes de la migración 002 (sin tabla de vigencias).
  const actualPago = { factores, divisor, nocturno }
  const historicoPago = await vigenciasPago(esquema).catch(() => [])
  const pagoDe = (fecha) => pagoVigenteEn(historicoPago, fecha, actualPago)

  const cond = ['not m.eliminada']
  const args = []
  if (rango?.desde) { args.push(rango.desde); cond.push(`(m.ts at time zone 'America/Bogota')::date >= $${args.length}::date`) }
  if (rango?.hasta) { args.push(rango.hasta); cond.push(`(m.ts at time zone 'America/Bogota')::date <= $${args.length}::date`) }

  // Todo en hora Bogotá desde SQL: fecha, minutos del día y timestamp.
  const { rows } = await conEmpresa(esquema, (db) => db.query(
    `select m.empleado_id, e.cedula, e.nombre, e.jornada_semanal, e.salario_mensual,
            s.nombre as sede_nombre, m.tipo,
            to_char(m.ts at time zone 'America/Bogota', 'YYYY-MM-DD') as fecha,
            -- Minutos FRACCIONARIOS (con los segundos): 14:03:18 → 843.3.
            -- Descartar los segundos por marcación era acumulativo: dos
            -- redondeos de 30 s al día durante un mes son minutos enteros
            -- pagados de más o de menos.
            (extract(hour from m.ts at time zone 'America/Bogota') * 60
             + extract(minute from m.ts at time zone 'America/Bogota')
             + extract(second from m.ts at time zone 'America/Bogota') / 60)::float as minutos,
            extract(epoch from m.ts) as epoch,
            extract(dow from m.ts at time zone 'America/Bogota')::int as dow
       from marcaciones m
       join empleados e on e.id = m.empleado_id
       left join sedes s on s.id = m.sede_id
      where ${cond.join(' and ')}
      order by m.empleado_id, m.ts`,
    args,
  ))

  const porEmpleado = new Map()
  for (const r of rows) {
    if (!porEmpleado.has(r.empleado_id)) {
      porEmpleado.set(r.empleado_id, {
        cedula: r.cedula, nombre: r.nombre, sede: r.sede_nombre,
        jornadaSemanal: r.jornada_semanal,
        // numeric de Postgres llega como texto: sin Number() el valor hora
        // saldría de una división entre string y daría NaN silenciosamente.
        salarioMensual: r.salario_mensual == null ? null : Number(r.salario_mensual),
        marcas: [],
      })
    }
    porEmpleado.get(r.empleado_id).marcas.push(r)
  }

  const registros = calcularRegistros(porEmpleado, {
    festivos,
    vigencias,
    nocturno: (fecha) => pagoDe(fecha).nocturno,
  })

  // Valor en pesos de cada tramo, con los factores y el divisor vigentes EN LA
  // FECHA del tramo. Quien no tenga salario registrado sale con `valor: null`
  // — el reporte lo muestra como "sin salario" y no inventa.
  const valorizados = registros.map((r) => {
    const pago = pagoDe(r.fecha)
    return valorizarRegistro(r, {
      salarioMensual: porEmpleado.get(r._empleadoId)?.salarioMensual ?? null,
      factores: pago.factores,
      divisor: pago.divisor,
    })
  })

  // ¿Cuáles de estos tramos ya están anotados como pagados? Se consulta por
  // las referencias del lote, no por rango de fechas: un tramo cuya marcación
  // se corrigió tiene OTRA referencia y debe salir como no pagado, aunque su
  // fecha caiga dentro de algo que ya se liquidó.
  const pagadas = await referenciasPagadas(esquema, valorizados.map((r) => r.referenciaExterna))

  return {
    registros: valorizados.map((r) => ({ ...r, pagado: pagadas.has(r.referenciaExterna) })),
    porEmpleado,
  }
}

/**
 * Subconjunto de referencias que ya están marcadas como pagadas.
 * @param {string} esquema
 * @param {string} esquema
 * @param {string[]} referencias
 * @returns {Promise<Set<string>>}
 */
export async function referenciasPagadas(esquema, referencias) {
  if (referencias.length === 0) return new Set()
  return conEmpresa(esquema, async (db) => {
    const { rows } = await db.query(
      `select referencia_externa from horas_pagadas
        where referencia_externa = any($1::text[])`,
      [referencias],
    )
    return new Set(rows.map((r) => r.referencia_externa))
  })
}

// La bitácora `envios_rh` y su función `registrarEnvio` se eliminaron junto
// con el empuje a nómina: ya no se "envía" nada, se calcula bajo demanda.
// La tabla queda en la base con su historial, sin escrituras nuevas.
