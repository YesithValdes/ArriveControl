/**
 * lib/salidaTardia.js — La anomalía «Salida tardía».
 *
 * Sin base de datos ni red: se prueba en tests/run-tests.mjs.
 *
 * QUÉ ES: la persona SÍ marcó su salida y la marcó más tarde que el fin de su
 * horario de ese día, por más de la tolerancia (Ajustes → Reglamento →
 * «Tolerancia de salida»). Sin horario ese día no hay contra qué compararla.
 *
 * Es SOLO un aviso. No interviene en el cálculo de horas extra (diario,
 * semanal ni clasificación de horas): ese cálculo no importa nada de aquí, y
 * esta anomalía no lee ni depende de ninguno de sus parámetros.
 */

/** Tolerancia de fábrica, en minutos, cuando la empresa no ha fijado una. */
export const TOLERANCIA_SALIDA_DEFECTO_MIN = 15

/** "17:30" → 1050. Null si no es una hora legible. */
const aMin = (hhmm) => {
  const [h, m] = String(hhmm ?? '').split(':').map(Number)
  return Number.isFinite(h) && Number.isFinite(m) ? h * 60 + m : null
}

/** Tolerancia efectiva en minutos: la de la empresa, o la de fábrica. */
export const toleranciaSalida = (salidaTardeMin) =>
  salidaTardeMin == null || salidaTardeMin === '' || Number.isNaN(Number(salidaTardeMin))
    ? TOLERANCIA_SALIDA_DEFECTO_MIN
    : Number(salidaTardeMin)

/**
 * Minutos que una salida pasó del fin del horario de su turno.
 *
 * @param {object} p
 * @param {string} p.fechaEntrada  YYYY-MM-DD Bogotá del día en que ENTRÓ
 * @param {number} p.salidaMs      instante de la salida marcada
 * @param {{entrada: string, salida: string}|null} p.franja  horario de ese día
 * @returns {number|null}  minutos (pueden ser negativos), o null sin horario
 */
export function minutosDespuesDelHorario({ fechaEntrada, salidaMs, franja }) {
  if (!franja) return null
  const ini = aMin(franja.entrada)
  let fin = aMin(franja.salida)
  if (fin == null) return null
  // Turno que cruza la medianoche: su fin es del día siguiente.
  if (ini != null && fin <= ini) fin += 1440
  const finMs = Date.parse(`${fechaEntrada}T00:00:00-05:00`) + fin * 60000
  return (salidaMs - finMs) / 60000
}

/** ¿Es salida tardía? Solo cuando pasó del horario por MÁS de la tolerancia. */
export const esSalidaTardia = (minutos, salidaTardeMin) =>
  minutos != null && minutos > toleranciaSalida(salidaTardeMin)
