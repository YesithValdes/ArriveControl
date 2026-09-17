/**
 * lib/nomina.js — Arma el lote de horas con recargo desde POSTGRES.
 *
 * Es solo la capa de datos: lee marcaciones y configuración, y delega el
 * cálculo en lib/calculoHoras.js (la regla de negocio, sin base de datos ni
 * red, para que sea probable). Lo consume `GET /api/horas`, que es la salida
 * de ArriveControl hacia nómina o hacia Excel.
 */
import { conEmpresa } from './db.js'
import { configLaboral } from './configLaboral.js'
import { calcularRegistros } from './calculoHoras.js'
import { lunesDe, domingoDe } from './semanaLaboral.js'
import { valorizarRegistro, CODIGOS_HORA } from './tiposHora.js'

/**
 * Tramos con recargo de todos los empleados en un rango [desde, hasta]
 * (fechas YYYY-MM-DD en día Bogotá). Sin rango: todo el historial.
 * @param {string} esquema  el de la empresa que se liquida
 * @returns {Promise<{registros: Array, porEmpleado: Map}>}
 */
export async function construirLote(esquema, rango = null) {
  const { festivos, vigencias, nocturno, factores, divisor, modoExtra, extraMinimaH } = await configLaboral(esquema)
  // Los parámetros de pago de HOY (modo, mínimo, franja nocturna, factores,
  // divisor) aplican a TODO el historial. Es decisión del cliente: un cambio
  // en Reglamento o Valorización se ve al instante en todos los períodos,
  // incluidos los ya calculados; no rige «desde la semana siguiente». La
  // tabla valorizacion_vigencias sigue guardando la historia, pero ya no
  // decide nada.

  // La hora extra se decide POR SEMANA (lunes → domingo), así que las marcas
  // se leen por semanas ENTERAS aunque el rango pedido corte una a la mitad:
  // una quincena que empieza en miércoles necesita el lunes y el martes para
  // saber si esa semana pasó de las 42 h. Al final se devuelven solo los
  // tramos cuya fecha cae dentro del rango pedido: cada tramo pertenece a un
  // único período, y el de una semana que cierra en el período siguiente
  // sale allá, cuando la semana ya cerró.
  const cond = ['not m.eliminada']
  const args = []
  if (rango?.desde) { args.push(lunesDe(rango.desde)); cond.push(`(m.ts at time zone 'America/Bogota')::date >= $${args.length}::date`) }
  if (rango?.hasta) { args.push(domingoDe(rango.hasta)); cond.push(`(m.ts at time zone 'America/Bogota')::date <= $${args.length}::date`) }

  // Todo en hora Bogotá desde SQL: fecha, minutos del día y timestamp.
  const { rows } = await conEmpresa(esquema, (db) => db.query(
    `select m.empleado_id, e.cedula, e.nombre, e.jornada_semanal, e.salario_mensual,
            -- El HORARIO del empleado: con él se cierra una entrada que quedó
            -- sin salida, en la hora en que su jornada terminaba. Sin esto el
            -- olvido de marcar la salida dejaba el día entero en cero.
            e.jornada_dias, e.entrada_esperada, e.salida_esperada, e.almuerzo_min,
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
        // Horario por día de la semana (manda cuando existe) y los campos
        // uniformes de respaldo. De aquí sale la hora con la que se cierra
        // una entrada sin salida.
        jornadaDias: r.jornada_dias,
        entradaEsperada: r.entrada_esperada,
        salidaEsperada: r.salida_esperada,
        almuerzoMin: r.almuerzo_min,
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
    nocturno,
    modoExtra,
    extraMinima: extraMinimaH,
  }).filter((r) => (!rango?.desde || r.fecha >= rango.desde) && (!rango?.hasta || r.fecha <= rango.hasta))

  // Valor en pesos de cada tramo, con los factores y el divisor de hoy. Quien
  // no tenga salario registrado sale con `valor: null` — el reporte lo muestra
  // como "sin salario" y no inventa.
  const valorizados = registros.map((r) => valorizarRegistro(r, {
    salarioMensual: porEmpleado.get(r._empleadoId)?.salarioMensual ?? null,
    factores,
    divisor,
  }))

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
 * El lote resumido POR EMPLEADO: lo mismo que muestra la tabla de Reportes.
 * Horas por tipo, total de extra, valor en pesos y estado de pago, con las
 * referencias de los tramos para que quien liquide pueda anotarlos.
 *
 * @param {{registros: Array, porEmpleado: Map}} lote  lo que devuelve construirLote
 * @returns {{empleados: Array, totales: object}}
 */
export function resumirLote({ registros, porEmpleado }) {
  const por = new Map()
  for (const r of registros) {
    if (!por.has(r.documento)) {
      const e = porEmpleado.get(r._empleadoId)
      por.set(r.documento, {
        documento: r.documento,
        nombre: e?.nombre ?? null,
        sede: e?.sede ?? null,
        horas: Object.fromEntries(CODIGOS_HORA.map((c) => [c, 0])),
        horasExtra: 0,
        valor: 0,
        sinSalario: false,
        referencias: [],
        referenciasPendientes: [],
      })
    }
    const p = por.get(r.documento)
    p.horas[r.tipoHora] = redondear(p.horas[r.tipoHora] + r.horas)
    p.horasExtra = redondear(p.horasExtra + r.horas)
    if (r.valor == null) p.sinSalario = true
    else p.valor += r.valor
    p.referencias.push(r.referenciaExterna)
    if (!r.pagado) p.referenciasPendientes.push(r.referenciaExterna)
  }
  const empleados = [...por.values()]
    .map((p) => ({
      ...p,
      // El peso se redondea UNA vez, sobre el total de la persona.
      valor: p.sinSalario ? null : Math.round(p.valor),
      pago: p.referenciasPendientes.length === 0 ? 'pagado'
        : p.referenciasPendientes.length === p.referencias.length ? 'pendiente' : 'parcial',
    }))
    .sort((a, b) => (b.valor ?? 0) - (a.valor ?? 0) || b.horasExtra - a.horasExtra)
  const totales = {
    empleados: empleados.length,
    horas: Object.fromEntries(CODIGOS_HORA.map((c) => [c, redondear(empleados.reduce((s, e) => s + e.horas[c], 0))])),
    horasExtra: redondear(empleados.reduce((s, e) => s + e.horasExtra, 0)),
    valor: Math.round(empleados.reduce((s, e) => s + (e.valor ?? 0), 0)),
    valorPendiente: Math.round(registros.reduce((s, r) => s + (!r.pagado && r.valor != null ? r.valor : 0), 0)),
    sinSalario: empleados.filter((e) => e.sinSalario).length,
  }
  return { empleados, totales }
}
const redondear = (h) => Math.round(h * 10000) / 10000

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
