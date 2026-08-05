/**
 * lib/nomina.js — Cálculo de tramos para la plataforma RH, SOBRE POSTGRES.
 *
 * Lee asistencia.marcaciones/empleados/config y produce el lote del contrato.
 *
 * REGLA DE NEGOCIO (definida por la empresa): la jornada se controla POR DÍA.
 *  - Jornada: 6 días a la semana; las horas por día (7) las define la jornada
 *    legal vigente que publica el GESTOR (lib/configLaboral.js), no una config local.
 *  - Extra DIARIA: lo que exceda las horas del día, atribuido a las últimas
 *    horas trabajadas de ESE día (tramos con rango horario real).
 *  - Domingo/festivo: día especial completo — las horas ordinarias van como
 *    RD (recargo dominical) y el exceso del día como HEDD (extra dominical).
 *  - Nocturno: se envían solo códigos diurnos; la plataforma RH parte el
 *    tramo en su hora de corte nocturno (su parámetro, no el nuestro).
 *
 * Como la extra queda definida al CERRAR CADA DÍA, el envío puede ser diario
 * (p. ej. cada madrugada, con los tramos del día anterior).
 */
import { pool } from './db.js'
import { configLaboral, horasDiaEn } from './configLaboral.js'

const round1 = (n) => Math.round(n * 10) / 10
const hhmm = (min) => `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`

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
      porEmpleado.set(r.empleado_id, { cedula: r.cedula, nombre: r.nombre, sede: r.sede_nombre, jornadaSemanal: r.jornada_semanal, marcas: [] })
    }
    porEmpleado.get(r.empleado_id).marcas.push(r)
  }

  const registros = []
  for (const [empId, e] of porEmpleado) {
    // Pares entrada→salida (una entrada sin cerrar no suma).
    const pares = []
    let abierta = null
    for (const m of e.marcas) {
      if (m.tipo === 'entrada') abierta = m
      else if (m.tipo === 'salida' && abierta) {
        pares.push({
          fecha: abierta.fecha,
          desde: abierta.minutos,
          hasta: m.minutos,
          horas: (m.epoch - abierta.epoch) / 3600,
          dow: abierta.dow,
          dominical: abierta.dow === 0 || festivos.has(abierta.fecha),
        })
        abierta = null
      }
    }
    if (pares.length === 0) continue

    const semana = pares[0].fecha
    const tramos = []

    // ── Cálculo POR DÍA ─────────────────────────────────────────────
    const porDia = new Map()
    for (const p of pares) {
      if (!porDia.has(p.fecha)) porDia.set(p.fecha, [])
      porDia.get(p.fecha).push(p)
    }

    for (const [fecha, ps] of porDia) {
      const dominical = ps[0].dominical

      // DOMINGO/FESTIVO: no es día de jornada (se trabajan 6 días, L–S),
      // así que TODO lo trabajado ese día es extra dominical (HEDD),
      // desde la primera hora. Cada par completo es un tramo.
      if (dominical) {
        for (const p of ps) {
          if (p.horas < 0.5) continue // mínimo del contrato RH
          tramos.push({
            fecha, horaInicio: hhmm(p.desde), horaFin: hhmm(p.hasta),
            horas: round1(p.horas), tipoHora: 'HEDD',
          })
        }
        continue
      }

      // DÍA HÁBIL: extra = lo que exceda las horas del día, atribuido a las
      // últimas horas trabajadas de ESE día (de atrás hacia adelante).
      const horasDia = ps.reduce((s, p) => s + p.horas, 0)
      // Jornada del día: la pactada del empleado para ese día de la semana
      // (jornada distribuida, Ley 2101) o, sin pacto, la legal vigente.
      // dow: 1=lunes … 6=sábado (el domingo nunca llega aquí: rama dominical).
      const pactada = e.jornadaSemanal?.[ps[0].dow - 1]
      const jornadaDia = pactada ?? horasDiaEn(vigencias, fecha)
      let restante = Math.max(0, horasDia - jornadaDia)
      for (let i = ps.length - 1; i >= 0 && restante > 0.001; i--) {
        const p = ps[i]
        const toma = Math.min(p.horas, restante)
        restante -= toma
        // Mínimo del contrato RH: horas >= 0.5. Un fragmento menor (p. ej. los
        // 0,2 h que sobran al repartir la extra entre pausas) se DESCARTA:
        // el gestor lo rechazaría de todos modos. (Pendiente con KUPOCELL:
        // definir si estos residuos se acumulan de otra forma.)
        if (toma < 0.5) continue
        const tomaMin = Math.round(toma * 60)
        tramos.push({
          fecha, horaInicio: hhmm(p.hasta - tomaMin), horaFin: hhmm(p.hasta),
          horas: round1(toma), tipoHora: 'HED',
        })
      }
    }
    tramos.sort((a, b) => a.fecha.localeCompare(b.fecha) || a.horaInicio.localeCompare(b.horaInicio))

    for (const t of tramos) {
      registros.push({
        documento: e.cedula,
        fecha: t.fecha,
        horaInicio: t.horaInicio,
        horaFin: t.horaFin,
        tipoHora: t.tipoHora,
        horas: t.horas,
        // Referencia con la CÉDULA (estable entre re-cargas de empleados),
        // nunca con nuestro id interno: si el empleado se borra y se recrea,
        // el mismo tramo debe producir la MISMA referencia para que el gestor
        // lo deduplique y jamás pague horas dos veces. Incluye el rango
        // horario para que dos tramos del mismo tipo y día no choquen.
        referenciaExterna: `arrive-${e.cedula}-${t.fecha.replaceAll('-', '')}-${t.horaInicio.replace(':', '')}-${t.horaFin.replace(':', '')}-${t.tipoHora}`,
        observaciones: `${e.sede ?? ''} · semana del ${semana}`,
        _empleadoId: empId, // interno: para la bitácora; se quita antes de enviar
        _semana: semana,
      })
    }
  }
  return { registros, porEmpleado }
}

/** Registra en la bitácora qué se envió y qué respondió el gestor. */
export async function registrarEnvio(registros, respuestaGestor, enviadoPor) {
  const rechazadas = new Map((respuestaGestor.rechazados ?? []).map((r) => [r.referenciaExterna, r]))
  for (const r of registros) {
    const rechazo = rechazadas.get(r.referenciaExterna)
    const { _empleadoId, _semana, ...payload } = r
    await pool.query(
      `insert into asistencia.envios_rh (referencia_externa, empleado_id, semana, payload, estado, motivo_rechazo, enviado_por)
       values ($1,$2,$3,$4,$5,$6,$7)
       on conflict (referencia_externa) do update
         set estado = $5, motivo_rechazo = $6, enviado_por = $7, ts = now()`,
      [r.referenciaExterna, _empleadoId, _semana, JSON.stringify(payload),
       rechazo ? 'rechazado' : 'aplicado', rechazo?.motivo ?? null, enviadoPor],
    )
  }
}
