/**
 * lib/descanso.js — La anomalía «Descanso excedido».
 *
 * Sin base de datos ni red: se prueba en tests/run-tests.mjs.
 *
 * QUÉ ES: dentro de un mismo día la persona marcó una salida y volvió a
 * entrar, y esa pausa duró más que el descanso de su horario ese día más la
 * tolerancia (Ajustes → Reglamento → «Tolerancia de descanso»). Un día sin
 * descanso en el horario no se evalúa: no hay contra qué comparar.
 *
 * Es SOLO un aviso. No interviene en el cálculo de horas extra (diario,
 * semanal ni clasificación de horas): ese cálculo no importa nada de aquí.
 */

/** Descanso con que nace un horario nuevo cuando la empresa no fijó otro. */
export const DESCANSO_DEFECTO_MIN = 60
/** Tolerancia de fábrica sobre el descanso, en minutos. */
export const TOLERANCIA_DESCANSO_DEFECTO_MIN = 10

const num = (v, defecto) => (v == null || v === '' || Number.isNaN(Number(v)) ? defecto : Number(v))
export const descansoEmpresa = (v) => num(v, DESCANSO_DEFECTO_MIN)
export const toleranciaDescanso = (v) => num(v, TOLERANCIA_DESCANSO_DEFECTO_MIN)

/** "12:30" → 750. Null si no es una hora legible. */
const aMin = (hhmm) => {
  const [h, m] = String(hhmm ?? '').split(':').map(Number)
  return Number.isFinite(h) && Number.isFinite(m) ? h * 60 + m : null
}

/**
 * Minutos de descanso que permite el horario de un día: el rango del
 * almuerzo si lo tiene, o su duración (horarios viejos). 0 = sin descanso.
 * Acepta las dos formas de nombrar los campos (panel y base de datos).
 */
export function descansoDelHorario(franja) {
  if (!franja) return 0
  const desde = aMin(franja.almuerzoDesde ?? franja.almuerzo_desde)
  const hasta = aMin(franja.almuerzoHasta ?? franja.almuerzo_hasta)
  if (desde != null && hasta != null) return hasta - desde + (hasta < desde ? 1440 : 0)
  return Number(franja.almuerzoMin ?? franja.almuerzo_min) || 0
}

/**
 * Pausas que pasaron del descanso permitido en un día.
 *
 * @param {object} p
 * @param {Array<{type: 'in'|'out', ts: string}>} p.eventos  los del día, en orden
 * @param {object|null} p.franja       horario de ese día
 * @param {number} p.tolerancia        minutos
 * @returns {Array<{salida: object, regreso: object, minutos: number,
 *          permitido: number, exceso: number}>}
 */
export function descansosExcedidos({ eventos, franja, tolerancia }) {
  const permitido = descansoDelHorario(franja)
  if (permitido <= 0) return []
  const casos = []
  for (let i = 1; i < eventos.length - 1; i++) {
    const salida = eventos[i]
    const regreso = eventos[i + 1]
    // Una pausa es salida → entrada, con una entrada antes (estaba trabajando).
    if (salida.type !== 'out' || regreso.type !== 'in' || eventos[i - 1].type !== 'in') continue
    const minutos = (Date.parse(regreso.ts) - Date.parse(salida.ts)) / 60000
    if (minutos > permitido + tolerancia) {
      casos.push({ salida, regreso, minutos, permitido, exceso: minutos - permitido })
    }
  }
  return casos
}
