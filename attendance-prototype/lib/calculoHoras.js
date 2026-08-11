/**
 * lib/calculoHoras.js — La REGLA DE NEGOCIO: de marcaciones a horas con recargo.
 *
 * Es la única implementación de este cálculo en todo el producto: el panel la
 * usa para sus reportes y la plataforma de nómina la consume por API. Si se
 * rompe aquí, se paga mal. Por eso vive sin base de datos ni red: entra una
 * lista de marcaciones, sale una lista de tramos — y así se puede probar
 * (ver tests/run-tests.mjs).
 *
 * REGLA (definida por la empresa): la jornada se controla POR DÍA.
 *  - Jornada: 6 días a la semana; las horas por día salen de la jornada
 *    pactada del empleado o, sin pacto, de la legal vigente (Ley 2101).
 *  - Extra DIARIA: lo que exceda las horas del día, atribuido a las últimas
 *    horas trabajadas de ESE día (tramos con rango horario real).
 *  - Domingo/festivo: día especial completo — todo lo trabajado es extra.
 *  - Nocturno: cada tramo extra se PARTE en la franja nocturna configurada
 *    (21:00–06:00 de fábrica), y cada pedazo sale con su propio código. Antes
 *    esto se delegaba a quien liquidara; ahora ArriveControl lo resuelve
 *    porque es él quien conoce el turno real, y porque sin partir el tramo no
 *    se puede poner un valor en pesos al lado.
 *
 * Los cuatro códigos posibles (HED, HEN, HEDDF, HENDF) y sus factores de pago
 * viven en lib/tiposHora.js, no aquí: este archivo decide QUÉ hora es extra y
 * de qué clase; cuánto vale es un parámetro que se edita en Ajustes.
 */
import { horasDiaEn } from './jornada.js'
import { codigoDeTramo, partirPorNocturno, NOCTURNO_DEFECTO } from './tiposHora.js'

const round1 = (n) => Math.round(n * 10) / 10

/** Minutos → HH:MM, normalizando cruces de medianoche (1560 → "02:00"). */
const hhmm = (min) => {
  const m = ((Math.round(min) % 1440) + 1440) % 1440
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
}

/**
 * Convierte marcaciones en tramos con recargo.
 *
 * @param {Map<string, {cedula: string, nombre: string, sede: string,
 *          jornadaSemanal: number[]|null, marcas: Array}>} porEmpleado
 *        Cada marca: { tipo, fecha (YYYY-MM-DD Bogotá), minutos (del día),
 *        epoch (segundos), dow (0=dom … 6=sáb) }, en orden cronológico.
 * @param {{festivos: Set<string>, vigencias: Array,
 *          nocturno?: {inicio: number, fin: number} | (fecha: string) => {inicio: number, fin: number}}} cfg
 *        `nocturno` en minutos desde medianoche; sin él se usa 21:00–06:00.
 *        Puede ser una FUNCIÓN de la fecha: la franja es un parámetro con
 *        vigencias, y un tramo de marzo debe partirse con la franja de marzo.
 * @returns {Array} registros listos para exportar o entregar por API
 */
export function calcularRegistros(porEmpleado, { festivos, vigencias, nocturno = NOCTURNO_DEFECTO }) {
  const franjaDe = typeof nocturno === 'function' ? nocturno : () => nocturno
  const registros = []
  for (const [empId, e] of porEmpleado) {
    // Pares entrada→salida (una entrada sin cerrar no suma).
    const pares = []
    let abierta = null
    for (const m of e.marcas) {
      if (m.tipo === 'entrada') abierta = m
      else if (m.tipo === 'salida' && abierta) {
        const horas = (m.epoch - abierta.epoch) / 3600
        pares.push({
          fecha: abierta.fecha, // el turno pertenece al día en que ENTRÓ
          desde: abierta.minutos,
          // Fin en minutos ABSOLUTOS desde las 0:00 del día de entrada: un
          // turno 22:00→02:00 termina en el minuto 1560, no en el 120. Sin
          // esto, restar la extra daba horas negativas (bug de medianoche).
          hasta: abierta.minutos + Math.round(horas * 60),
          horas,
          dow: abierta.dow,
          dominical: abierta.dow === 0 || festivos.has(abierta.fecha),
        })
        abierta = null
      }
    }
    if (pares.length === 0) continue

    const semana = pares[0].fecha
    const tramos = []

    /**
     * Parte un rango extra en la franja nocturna y agrega un tramo por pedazo.
     *
     * El mínimo de 0,5 h del contrato con RH se controla ANTES de partir,
     * sobre el rango completo: si se aplicara a cada pedazo, una extra de 1 h
     * repartida 0,6 diurna + 0,4 nocturna perdería los 24 minutos nocturnos y
     * se le pagaría de menos a la persona. Una vez que el rango califica, sus
     * pedazos entran completos aunque alguno sea corto.
     */
    const agregarExtra = (fecha, desde, hasta, dominical) => {
      for (const p of partirPorNocturno(desde, hasta, franjaDe(fecha))) {
        tramos.push({
          fecha,
          horaInicio: hhmm(p.desde),
          horaFin: hhmm(p.hasta),
          horas: round1((p.hasta - p.desde) / 60),
          tipoHora: codigoDeTramo({ nocturna: p.nocturna, dominical }),
        })
      }
    }

    // ── Cálculo POR DÍA ─────────────────────────────────────────────
    const porDia = new Map()
    for (const p of pares) {
      if (!porDia.has(p.fecha)) porDia.set(p.fecha, [])
      porDia.get(p.fecha).push(p)
    }

    for (const [fecha, ps] of porDia) {
      // DOMINGO/FESTIVO: no es día de jornada (se trabajan 6 días, L–S),
      // así que TODO lo trabajado ese día es extra dominical, desde la primera
      // hora. Cada par completo se parte en la franja nocturna y sale como
      // HEDDF (diurna) o HENDF (nocturna).
      if (ps[0].dominical) {
        for (const p of ps) {
          if (p.horas < 0.5) continue // mínimo del contrato RH
          agregarExtra(fecha, p.desde, p.hasta, true)
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
        // quien liquida lo rechazaría de todos modos. (Pendiente con KUPOCELL:
        // definir si estos residuos se acumulan de otra forma.)
        if (toma < 0.5) continue
        const tomaMin = Math.round(toma * 60)
        agregarExtra(fecha, p.hasta - tomaMin, p.hasta, false)
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
        // el mismo tramo debe producir la MISMA referencia para que quien
        // liquida lo deduplique y jamás pague horas dos veces. Incluye el
        // rango horario para que dos tramos del mismo tipo y día no choquen.
        referenciaExterna: `arrive-${e.cedula}-${t.fecha.replaceAll('-', '')}-${t.horaInicio.replace(':', '')}-${t.horaFin.replace(':', '')}-${t.tipoHora}`,
        observaciones: `${e.sede ?? ''} · semana del ${semana}`,
        _empleadoId: empId, // interno: para la bitácora; se quita antes de salir
        _semana: semana,
      })
    }
  }
  return registros
}
