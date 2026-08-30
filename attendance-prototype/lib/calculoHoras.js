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

// Horas de un tramo con precisión de SEGUNDO (4 decimales: 1 s = 0.0003 h).
// Antes se redondeaba a 1 decimal (1.6456 → «1.7») y el reporte no cuadraba
// con el hh:mm:ss de asistencia; los segundos son acumulativos y se conservan
// de punta a punta — redondear es tarea de la presentación, no del cálculo.
const horasExactas = (n) => Math.round(n * 10000) / 10000

/** Minutos → HH:MM, normalizando cruces de medianoche (1560 → "02:00"). */
const hhmm = (min) => {
  const m = ((Math.round(min) % 1440) + 1440) % 1440
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
}

/** Fecha de HOY en Bogotá (UTC-5 fijo, sin horario de verano). */
const hoyEnBogota = () => new Date(Date.now() - 5 * 3600000).toISOString().slice(0, 10)

/**
 * Tope de un turno para decidir si una salida es del mismo turno o de otro.
 *
 * Solo se aplica cuando la salida cae en OTRO día: dentro del mismo día
 * cualquier salida marcada empareja, por larga que sea la jornada. Doce horas
 * es la misma ventana que usa el kiosco para alternar entrada/salida
 * (NIGHT_WINDOW_MS en services/panelStore.js), y deja pasar los turnos
 * nocturnos de verdad (22:00→06:00 son ocho).
 */
const MAX_TURNO_H = 12

/** "17:30:00" | "17:30" → 1050. Null si no es una hora legible. */
const minutosDeHora = (hora) => {
  if (!hora) return null
  const [h, m] = String(hora).split(':').map(Number)
  return Number.isFinite(h) && Number.isFinite(m) ? h * 60 + m : null
}

/**
 * Hora en que TERMINA el horario del empleado para el día de esa marcación,
 * en minutos desde las 0:00 del día en que entró. Null si ese día no tiene
 * horario pactado.
 *
 * Puede pasar de 1440 a propósito: en un turno 22:00–06:00 la salida es del
 * día siguiente (minuto 1800), y así el cierre automático cruza la medianoche
 * igual que lo hace un turno marcado de verdad.
 *
 * `jornadaDias` manda cuando existe —es el horario POR DÍA de la semana, y un
 * día ausente es día libre, sin hora que aplicar—. Los campos uniformes son el
 * respaldo de los empleados registrados antes de que los horarios fueran por
 * día (ver db/migrations/empresa/006_horarios_por_dia.sql).
 */
const finDeHorario = (empleado, entrada) => {
  const delDia = empleado.jornadaDias?.[String(entrada.dow)]
  const usaDias = empleado.jornadaDias != null
  // Con horario por día pero SIN ese día: es día libre, no hay con qué cerrar.
  if (usaDias && !delDia) return null

  const fin = minutosDeHora(usaDias ? delDia.salida : empleado.salidaEsperada)
  if (fin == null) return null

  const inicio = minutosDeHora(usaDias ? delDia.entrada : empleado.entradaEsperada)
  // Turno que cruza la medianoche: su salida pertenece al día siguiente.
  const finReal = inicio != null && fin <= inicio ? fin + 1440 : fin

  // ── El almuerzo también es un momento en que hay que marcar ──────────
  //
  // Quien entró en la mañana y no volvió a marcar NUNCA marcó su salida a
  // almorzar, así que lo único que consta es la mañana: se cierra ahí, no al
  // final del día. Estirarlo hasta la salida sería pagarle un almuerzo y una
  // tarde de los que no hay ni rastro —y le saldría MEJOR que a quien marca
  // bien, que sí se descuenta su hora de almuerzo—.
  //
  // A qué hora empieza el almuerzo no se guarda en ninguna parte, y las horas
  // reales varían demasiado para adivinarlas. Se usa el reparto que el propio
  // horario implica: las horas de TRABAJO (sin contar el almuerzo) partidas
  // por la mitad. Un 09:00–17:30 con 60 min da 7 h 30 de trabajo, o sea 3 h 45
  // antes de almorzar: las 12:45.
  const almuerzo = Number(usaDias ? delDia.almuerzo_min : empleado.almuerzoMin) || 0
  if (almuerzo > 0 && inicio != null) {
    const iniAlmuerzo = inicio + Math.round((finReal - inicio - almuerzo) / 2)
    // Solo si entró ANTES de esa hora: quien entra por la tarde ya pasó el
    // almuerzo y su tope es el final de la jornada.
    if (entrada.minutos < iniAlmuerzo) return iniAlmuerzo
  }
  return finReal
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
export function calcularRegistros(
  porEmpleado,
  { festivos, vigencias, nocturno = NOCTURNO_DEFECTO, hoy = hoyEnBogota() },
) {
  const franjaDe = typeof nocturno === 'function' ? nocturno : () => nocturno
  const registros = []
  for (const [empId, e] of porEmpleado) {
    // ── Pares entrada→salida ────────────────────────────────────────
    //
    // Una entrada que nadie cerró ya NO se descarta: se cierra en la hora de
    // salida del horario del empleado. Es lo que pasa de verdad —la persona
    // trabajó y se le olvidó marcar— y dejar el día en cero le quitaba la
    // jornada entera por un olvido.
    //
    // Solo se cierran días YA TERMINADOS: la jornada de hoy sigue abierta
    // porque todavía puede llegar a marcar su salida.
    const pares = []
    let abierta = null

    /** Par entre dos marcaciones REALES. Nunca se recorta al horario. */
    const parReal = (entrada, salida) => {
      const horas = (salida.epoch - entrada.epoch) / 3600
      return {
        fecha: entrada.fecha, // el turno pertenece al día en que ENTRÓ
        desde: entrada.minutos,
        // Fin en minutos ABSOLUTOS desde las 0:00 del día de entrada: un
        // turno 22:00→02:00 termina en el minuto 1560, no en el 120. Sin
        // esto, restar la extra daba horas negativas (bug de medianoche).
        // Fraccionario: los segundos viajan (843.3, no 843).
        hasta: entrada.minutos + horas * 60,
        horas,
        dow: entrada.dow,
        dominical: entrada.dow === 0 || festivos.has(entrada.fecha),
      }
    }

    /**
     * Cierra una entrada que quedó sin salida, en la hora de su horario.
     *
     * Devuelve null —y entonces esa entrada NO cuenta— en tres casos:
     *  · el día todavía no termina: aún puede marcar su salida;
     *  · ese día no tiene horario (o no tiene ninguno): sin hora pactada no
     *    hay con qué cerrar, e inventarla sería pagar lo que nadie acordó;
     *  · la entrada quedó DESPUÉS de su hora de salida: quien llega pasada
     *    su jornada no abre un día nuevo, y el día se queda con lo que ya
     *    hubiera marcado antes.
     */
    const parAutomatico = (entrada) => {
      if (entrada.fecha >= hoy) return null
      const fin = finDeHorario(e, entrada)
      if (fin == null || fin <= entrada.minutos) return null
      return {
        fecha: entrada.fecha,
        desde: entrada.minutos,
        hasta: fin,
        horas: (fin - entrada.minutos) / 60,
        dow: entrada.dow,
        dominical: entrada.dow === 0 || festivos.has(entrada.fecha),
        automatico: true,
      }
    }

    /**
     * Resuelve la entrada abierta, sea cerrándola con su horario o
     * descartándola.
     *
     * `siguiente` es la marcación que la desplaza, si la hay. Cuando es del
     * MISMO día no se cierra por horario: dos entradas seguidas significan
     * que faltó una salida en medio, y estirar la primera hasta la hora del
     * horario la solaparía con la segunda — el mismo rato contado dos veces.
     * Sin saber cuándo se fue, ese tramo no se cuenta.
     */
    const soltarAbierta = (siguiente = null) => {
      if (!abierta) return
      const mismoDia = siguiente != null && siguiente.fecha === abierta.fecha
      const p = mismoDia ? null : parAutomatico(abierta)
      if (p) pares.push(p)
      abierta = null
    }

    for (const m of e.marcas) {
      if (m.tipo === 'entrada') {
        soltarAbierta(m) // la anterior se quedó sin cerrar
        abierta = m
      } else if (m.tipo === 'salida') {
        if (!abierta) continue // salida suelta: no hay turno que cerrar
        // Una salida que llega en OTRO día y más de MAX_TURNO_H después no
        // pertenece a este turno: es de una jornada posterior, y la entrada
        // de en medio quedó abandonada. Sin esto, una entrada del lunes sin
        // cerrar se emparejaba con la salida del martes y producía un turno
        // de treinta horas — y el cierre por horario no llegaba a aplicarse.
        // Mismo día siempre empareja: un 09:00→23:00 es largo pero real, y
        // una salida marcada JAMÁS se recorta.
        const horas = (m.epoch - abierta.epoch) / 3600
        if (m.fecha !== abierta.fecha && horas > MAX_TURNO_H) {
          soltarAbierta(m)
          continue
        }
        pares.push(parReal(abierta, m))
        abierta = null
      }
    }
    soltarAbierta() // la última del periodo, si quedó abierta
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
          horas: horasExactas((p.hasta - p.desde) / 60),
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
        agregarExtra(fecha, p.hasta - toma * 60, p.hasta, false)
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
