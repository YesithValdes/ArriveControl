/**
 * lib/resumenDiario.js — El día de cada empleado, listo para el correo.
 *
 * Sale de aquí y no del cálculo de nómina (lib/calculoHoras.js) porque
 * responden preguntas distintas: aquel decide qué horas son EXTRA y cuánto
 * valen, y este cuenta qué pasó — a qué horas marcó, cuánto trabajó y qué
 * quedó raro. Se apoyan en las mismas reglas de horario, eso sí.
 *
 * Sin base de datos ni red: entran filas, salen resúmenes. Así se puede
 * probar (ver tests/run-tests.mjs).
 */

/** "17:30:00" | "17:30" → 1050. Null si no es una hora legible. */
const minutosDeHora = (h) => {
  if (!h) return null
  const [a, b] = String(h).split(':').map(Number)
  return Number.isFinite(a) && Number.isFinite(b) ? a * 60 + b : null
}

/** Segundos → "7:30:00". */
export const hhmmss = (seg) => {
  const s = Math.max(0, Math.round(seg))
  return `${Math.floor(s / 3600)}:${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`
}

/** Segundos → "7h 30m", para asuntos y titulares. */
export const horasCortas = (seg) => {
  const s = Math.max(0, Math.round(seg))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  return h > 0 ? `${h}h ${String(m).padStart(2, '0')}m` : `${m} min`
}

/** La franja del empleado para un día de la semana (0=dom … 6=sáb). */
export function franjaDelDia(empleado, dow) {
  const d = empleado?.jornada_dias?.[String(dow)]
  if (empleado?.jornada_dias) return d ?? null // con mapa por días, ausente = libre
  if (!empleado?.entrada_esperada || !empleado?.salida_esperada) return null
  return {
    entrada: String(empleado.entrada_esperada).slice(0, 5),
    salida: String(empleado.salida_esperada).slice(0, 5),
    almuerzo_desde: null,
  }
}

// Los mismos márgenes que usa el panel para su bandeja de novedades
// (services/panelStore.js): holgados a propósito, para que el resumen no
// convierta en incidencia un retraso normal.
const TARDE_MIN = 180
const TEMPRANO_MIN = 90

/**
 * Arma el resumen del día de UNA persona.
 *
 * @param {{nombre: string, correo: string, jornada_dias: object|null,
 *          entrada_esperada: string|null, salida_esperada: string|null}} empleado
 * @param {Array<{tipo: 'entrada'|'salida', minutos: number, sede: string|null}>} marcas
 *        del día, en orden, con los minutos desde las 0:00 hora Bogotá.
 * @param {number} dow  día de la semana de esa fecha (0=dom … 6=sáb)
 * @returns {{trabajadoSeg, marcas, avisos, franja, sede}|null}
 *          null si ese día no marcó nada: no hay resumen que mandar.
 */
export function resumenDelDia(empleado, marcas, dow) {
  if (!marcas || marcas.length === 0) return null

  const franja = franjaDelDia(empleado, dow)
  const finJornada = minutosDeHora(franja?.salida)
  const iniJornada = minutosDeHora(franja?.entrada)
  const almuerzo = minutosDeHora(franja?.almuerzo_desde)

  const eventos = []
  const avisos = []
  let trabajadoSeg = 0
  let abierta = null

  for (const m of marcas) {
    if (m.tipo === 'entrada') {
      // Dos entradas seguidas: faltó una salida en medio y no se sabe cuándo
      // se fue. La primera no suma — igual que en el cálculo de nómina.
      if (abierta) eventos.push({ tipo: 'entrada', minutos: abierta.minutos, huerfana: true })
      abierta = m
      continue
    }
    if (!abierta) continue // salida suelta: no hay turno que cerrar
    trabajadoSeg += (m.minutos - abierta.minutos) * 60
    eventos.push({ tipo: 'entrada', minutos: abierta.minutos })
    eventos.push({ tipo: 'salida', minutos: m.minutos })
    abierta = null
  }

  // Quedó dentro al terminar el día: se cierra con su horario, la misma regla
  // que aplica la nómina — hasta el almuerzo si nunca lo marcó, y hasta el
  // fin de jornada si volvió después.
  if (abierta) {
    const tope = almuerzo != null && abierta.minutos < almuerzo ? almuerzo : finJornada
    eventos.push({ tipo: 'entrada', minutos: abierta.minutos })
    if (tope != null && tope > abierta.minutos) {
      trabajadoSeg += (tope - abierta.minutos) * 60
      eventos.push({ tipo: 'salida', minutos: tope, automatica: true })
      avisos.push({
        clase: 'sin-salida',
        texto: `No marcaste tu salida. El día se cerró a las ${enDoce(tope)}, ${
          tope === almuerzo ? 'la hora en que empieza tu almuerzo' : 'la hora en que termina tu horario'}.`,
      })
    } else {
      // Sin horario, o entró pasada su hora de salida: no hay con qué cerrar.
      avisos.push({ clase: 'sin-salida', texto: 'No marcaste tu salida, y ese tramo no se pudo contar.' })
    }
  }

  const primeraEntrada = eventos.find((e) => e.tipo === 'entrada')
  if (iniJornada != null && primeraEntrada && primeraEntrada.minutos >= iniJornada + TARDE_MIN) {
    avisos.push({ clase: 'tarde', texto: `Tu entrada fue a las ${enDoce(primeraEntrada.minutos)} y tu horario empieza a las ${enDoce(iniJornada)}.` })
  }
  const ultima = eventos[eventos.length - 1]
  if (finJornada != null && ultima?.tipo === 'salida' && !ultima.automatica
      && ultima.minutos < finJornada - TEMPRANO_MIN) {
    avisos.push({ clase: 'temprano', texto: `Saliste a las ${enDoce(ultima.minutos)} y tu horario termina a las ${enDoce(finJornada)}.` })
  }

  return {
    trabajadoSeg,
    marcas: eventos.filter((e) => !e.huerfana),
    avisos,
    franja,
    sede: marcas.find((m) => m.sede)?.sede ?? null,
  }
}

/** 1050 → "05:30 p. m.". Acepta pasar de 1440 (turnos que cruzan medianoche). */
export function enDoce(min) {
  const m = ((Math.round(min) % 1440) + 1440) % 1440
  const h24 = Math.floor(m / 60)
  const h = h24 % 12 === 0 ? 12 : h24 % 12
  return `${String(h).padStart(2, '0')}:${String(m % 60).padStart(2, '0')} ${h24 < 12 ? 'a. m.' : 'p. m.'}`
}
