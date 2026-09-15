/**
 * lib/calculoHoras.js — La REGLA DE NEGOCIO: de marcaciones a horas con recargo.
 *
 * Es la única implementación de este cálculo en todo el producto: el panel la
 * usa para sus reportes y la plataforma de nómina la consume por API. Si se
 * rompe aquí, se paga mal. Por eso vive sin base de datos ni red: entra una
 * lista de marcaciones, sale una lista de tramos — y así se puede probar
 * (ver tests/run-tests.mjs).
 *
 * REGLA (definida por la empresa el 2026-09-13): la jornada se controla POR
 * SEMANA, no por día. Es la jornada flexible del art. 161-d del CST (Ley
 * 2101): las horas de la semana (42 de fábrica, Ajustes → Reglamento) se
 * reparten entre lunes y sábado como haga falta, y un día largo compensa uno
 * corto.
 *
 *  - Durante la semana solo se ACUMULA. No hay «hora extra» hasta que la
 *    semana cierra (termina el domingo). Antes se decidía por día contra 7 h
 *    planas, y a quien tenía horario de 7h 30 se le regalaban 30 min diarios
 *    mientras el sábado corto nunca daba extra.
 *  - Al cerrar: lo que pase de las horas de la semana es extra. Las primeras
 *    42 h son ordinarias; desde el minuto en que se cruzan, TODO lo que sigue
 *    es extra y toma su tipo por el reloj. Así cada tramo sale con su día y
 *    su franja: se sabe dónde se hicieron.
 *  - Domingo y festivo NO entran en esa cuenta: lo que se trabaje esos días
 *    lleva recargo desde la primera hora, se cumplan o no las 42 (art. 179),
 *    y por eso sale aunque la semana siga en curso.
 *  - Un festivo entre semana es día que no se trabaja, pero la semana no se
 *    acorta: se ACREDITAN las horas del horario de ese día a la cuenta.
 *  - Nocturno: cada tramo se PARTE en la franja nocturna configurada
 *    (21:00–06:00 de fábrica) y cada pedazo sale con su propio código.
 *
 * Cuánto es extra lo dice lib/semanaLaboral.js (la misma función que usa el
 * panel, para que el cajón de una persona y la nómina nunca digan números
 * distintos). Aquí se decide en QUÉ horas cayó y de qué clase. Los cuatro
 * códigos (HED, HEN, HEDDF, HENDF) y sus factores viven en lib/tiposHora.js.
 */
import { horasSemanaEn } from './jornada.js'
import { codigoDeTramo, partirPorNocturno, NOCTURNO_DEFECTO } from './tiposHora.js'
import { resumenSemana, lunesDe, diaSemana, EXTRA_MINIMA_H } from './semanaLaboral.js'

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
  // final del día. Estirarlo hasta la salida sería pagar un almuerzo y una
  // tarde de los que no hay ni rastro.
  //
  // La hora sale del HORARIO, donde se configura por día. No se deduce: hay
  // gente con una hora de almuerzo y gente con dos, y cualquier punto medio
  // calculado caería mal en los dos casos. Un día sin hora configurada —o sin
  // pausa, como un sábado corrido— no tiene este tope y cierra al final.
  const iniAlmuerzo = minutosDeHora(usaDias ? delDia.almuerzo_desde : empleado.almuerzoDesde)
  if (iniAlmuerzo != null) {
    // Turno que cruza medianoche: el almuerzo de un 22:00–06:00 es de
    // madrugada, y en minutos absolutos va después de la entrada.
    const alz = iniAlmuerzo < inicio ? iniAlmuerzo + 1440 : iniAlmuerzo
    // Solo si entró ANTES de esa hora: quien entra después ya pasó el
    // almuerzo y su tope vuelve a ser el final de la jornada.
    if (entrada.minutos < alz) return alz
  }
  return finReal
}

/**
 * Convierte las marcaciones de UN empleado en pares entrada→salida: los
 * turnos de verdad, con sus horas, ANTES de decidir cuáles son extra.
 *
 * Es la mitad del cálculo que cuenta el tiempo; la otra mitad
 * (`calcularRegistros`) decide qué parte de ese tiempo lleva recargo. Va
 * aparte para que se pueda auditar el total trabajado con exactamente la
 * misma regla con la que se liquida —no con una copia que un día diverja—.
 *
 * Una entrada que nadie cerró ya NO se descarta: se cierra en la hora de
 * salida del horario del empleado. Es lo que pasa de verdad —la persona
 * trabajó y se le olvidó marcar— y dejar el día en cero le quitaba la
 * jornada entera por un olvido.
 *
 * Solo se cierran días YA TERMINADOS: la jornada de hoy sigue abierta
 * porque todavía puede llegar a marcar su salida.
 *
 * @param {{jornadaDias?: object, entradaEsperada?: string, salidaEsperada?: string,
 *          almuerzoDesde?: string, marcas: Array}} e
 *        Cada marca: { tipo, fecha (YYYY-MM-DD Bogotá), minutos (del día),
 *        epoch (segundos), dow (0=dom … 6=sáb) }, en orden cronológico.
 * @param {{festivos: Set<string>, hoy?: string}} cfg
 * @returns {Array<{fecha: string, desde: number, hasta: number, horas: number,
 *          dow: number, dominical: boolean, automatico?: true}>}
 *        `desde`/`hasta` en minutos desde las 0:00 del día de entrada
 *        (`hasta` puede pasar de 1440 si el turno cruza la medianoche).
 *        `automatico` marca los que se cerraron por horario, no por marcación.
 */
export function emparejarMarcas(e, { festivos, hoy = hoyEnBogota() }) {
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
  return pares
}

/**
 * Horas del HORARIO de un empleado en una fecha: salida − entrada − almuerzo.
 * Null si ese día no tiene horario. Es lo que se ACREDITA cuando el día cae
 * en festivo: no se trabaja, y la semana no se acorta por eso.
 *
 * Misma fuente que `finDeHorario`: el horario por día cuando existe, y los
 * campos uniformes de respaldo para los empleados de antes.
 */
export const horasDeHorario = (empleado, fecha) => {
  const usaDias = empleado.jornadaDias != null
  const delDia = usaDias ? empleado.jornadaDias[String(diaSemana(fecha))] : null
  if (usaDias && !delDia) return null

  const inicio = minutosDeHora(usaDias ? delDia.entrada : empleado.entradaEsperada)
  const fin = minutosDeHora(usaDias ? delDia.salida : empleado.salidaEsperada)
  if (inicio == null || fin == null) return null
  let duracion = fin - inicio
  if (duracion <= 0) duracion += 1440 // cruza medianoche

  let almuerzo = Number(usaDias ? delDia.almuerzo_min : empleado.almuerzoMin) || 0
  if (!almuerzo && usaDias) {
    // Horarios con el rango de almuerzo pero sin los minutos calculados.
    const desde = minutosDeHora(delDia.almuerzo_desde)
    const hasta = minutosDeHora(delDia.almuerzo_hasta)
    if (desde != null && hasta != null) almuerzo = hasta - desde + (hasta < desde ? 1440 : 0)
  }
  return Math.max(0, duracion - almuerzo) / 60
}

/**
 * Tramos con recargo de UNA semana.
 *
 * @param {object} p
 * @param {Array} p.pares     los de `emparejarMarcas` que caen en esa semana
 * @param {number|null} p.extra  horas extra de la semana según
 *        `resumenSemana` — NULL mientras la semana siga en curso: entonces
 *        solo salen los domingos y festivos, que no dependen de la cuenta.
 * @param {(fecha: string) => {inicio: number, fin: number}} p.franjaDe
 *        franja nocturna vigente en cada fecha
 * @returns {Array<{fecha, horaInicio, horaFin, horas, tipoHora}>}
 */
export function tramosDeSemana({ pares, extra, franjaDe }) {
  const tramos = []

  /**
   * Parte un rango en la franja nocturna y agrega un tramo por pedazo.
   *
   * El mínimo de 0,5 h del contrato con RH se controla ANTES de partir,
   * sobre el rango completo: si se aplicara a cada pedazo, una extra de 1 h
   * repartida 0,6 diurna + 0,4 nocturna perdería los 24 minutos nocturnos y
   * se le pagaría de menos a la persona. Una vez que el rango califica, sus
   * pedazos entran completos aunque alguno sea corto.
   */
  const agregar = (fecha, desde, hasta, dominical) => {
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

  // ── Domingo y festivo: recargo desde la primera hora ────────────────
  //
  // No dependen de cuántas horas lleve la semana, así que salen apenas
  // termina el día, con la semana abierta o cerrada. Cada par se parte en
  // la franja nocturna y sale como HEDDF (diurna) o HENDF (nocturna).
  const ordinarios = []
  for (const p of pares) {
    if (!p.dominical) { ordinarios.push(p); continue }
    if (p.horas < EXTRA_MINIMA_H) continue // mínimo del contrato RH
    agregar(p.fecha, p.desde, p.hasta, true)
  }

  // ── Lunes a sábado: solo con la semana cerrada ──────────────────────
  //
  // Las primeras horas de la semana —hasta la jornada semanal— son
  // ordinarias; lo que sigue es extra. Se recorre desde el final hacia
  // atrás tomando de cada turno sus ÚLTIMAS horas: el punto donde se
  // cruzaron las 42 puede caer a mitad de un turno, y ese turno se parte
  // ahí. El mínimo de 0,5 h se mide sobre la extra de la semana entera; una
  // vez que califica, los pedazos que le tocan a cada turno entran
  // completos, aunque el primero que se recorta sea de minutos.
  if (extra != null && extra >= EXTRA_MINIMA_H) {
    let restante = extra
    ordinarios.sort((a, b) => a.fecha.localeCompare(b.fecha) || a.desde - b.desde)
    for (let i = ordinarios.length - 1; i >= 0 && restante > 0.001; i--) {
      const p = ordinarios[i]
      const toma = Math.min(p.horas, restante)
      restante -= toma
      agregar(p.fecha, p.hasta - toma * 60, p.hasta, false)
    }
  }

  return tramos.sort((a, b) => a.fecha.localeCompare(b.fecha) || a.horaInicio.localeCompare(b.horaInicio))
}

/**
 * Convierte marcaciones en tramos con recargo.
 *
 * @param {Map<string, {cedula: string, nombre: string, sede: string,
 *          jornadaDias?: object, marcas: Array}>} porEmpleado
 *        Cada marca: { tipo, fecha (YYYY-MM-DD Bogotá), minutos (del día),
 *        epoch (segundos), dow (0=dom … 6=sáb) }, en orden cronológico.
 *        OJO: para que la semana cuadre, las marcas deben cubrir semanas
 *        ENTERAS (lib/nomina.js ensancha el rango al lunes y al domingo).
 * @param {{festivos: Set<string>, vigencias: Array,
 *          nocturno?: {inicio: number, fin: number} | (fecha: string) => {inicio: number, fin: number},
 *          hoy?: string}} cfg
 *        `vigencias`: jornada semanal de la empresa (lib/jornada.js).
 *        `nocturno` en minutos desde medianoche; sin él se usa 21:00–06:00.
 *        Puede ser una FUNCIÓN de la fecha: la franja es un parámetro con
 *        vigencias, y un tramo de marzo debe partirse con la franja de marzo.
 *        `hoy`: fecha Bogotá con la que se decide qué semanas ya cerraron.
 * @returns {Array} registros listos para exportar o entregar por API
 */
export function calcularRegistros(
  porEmpleado,
  { festivos, vigencias, nocturno = NOCTURNO_DEFECTO, hoy = hoyEnBogota() },
) {
  const franjaDe = typeof nocturno === 'function' ? nocturno : () => nocturno
  const registros = []
  for (const [empId, e] of porEmpleado) {
    const pares = emparejarMarcas(e, { festivos, hoy })
    if (pares.length === 0) continue

    // ── Por SEMANA ──────────────────────────────────────────────────
    const porSemana = new Map()
    for (const p of pares) {
      const lunes = lunesDe(p.fecha)
      if (!porSemana.has(lunes)) porSemana.set(lunes, [])
      porSemana.get(lunes).push(p)
    }

    for (const [lunes, ps] of porSemana) {
      // CUÁNTO es extra lo decide la misma función que usa el panel.
      const horasPorDia = new Map()
      for (const p of ps) horasPorDia.set(p.fecha, (horasPorDia.get(p.fecha) ?? 0) + p.horas)
      const semana = resumenSemana({
        lunes,
        horasPorDia,
        festivos,
        horasHorario: (fecha) => horasDeHorario(e, fecha),
        horasSemana: horasSemanaEn(vigencias, lunes),
        hoy,
      })

      // DÓNDE cayó y de qué clase.
      const tramos = tramosDeSemana({ pares: ps, extra: semana.extra, franjaDe })

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
          observaciones: `${e.sede ?? ''} · semana del ${lunes}`,
          _empleadoId: empId, // interno: para la bitácora; se quita antes de salir
          _semana: lunes,
        })
      }
    }
  }
  return registros
}
