/**
 * lib/horariosDias.js — Validación del horario POR DÍAS de la semana.
 *
 * Forma canónica (API y base de datos):
 *   { "0".."6": { entrada: "HH:MM", salida: "HH:MM", almuerzo_min: int } }
 * con 0=domingo … 6=sábado (el mismo convenio que Date.getDay()). Un día
 * ausente (o null) es día libre. Un horario necesita al menos un día laborable.
 */

// HH:MM real: rechaza "99:99", que el regex laxo de antes dejaba pasar.
export const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/

/**
 * Normaliza y valida el mapa de días.
 * @returns {{dias: object} | {error: string}}
 */
export function validarDias(v) {
  if (v == null || typeof v !== 'object' || Array.isArray(v)) {
    return { error: 'dias debe ser un objeto { "0".."6": { entrada, salida, almuerzo_min } }.' }
  }
  const dias = {}
  for (const [k, f] of Object.entries(v)) {
    if (!/^[0-6]$/.test(k)) return { error: `Día inválido: "${k}" (0=domingo … 6=sábado).` }
    if (f == null) continue // día libre explícito: se omite del mapa
    const entrada = String(f.entrada ?? '')
    const salida = String(f.salida ?? '')
    if (!HHMM.test(entrada) || !HHMM.test(salida)) {
      return { error: `Día ${k}: entrada y salida deben ser horas HH:MM válidas.` }
    }
    const alm = Number(f.almuerzo_min ?? 0)
    if (!Number.isInteger(alm) || alm < 0 || alm > 240) {
      return { error: `Día ${k}: almuerzo inválido (0 a 240 minutos).` }
    }
    dias[k] = { entrada, salida, almuerzo_min: alm }
  }
  if (Object.keys(dias).length === 0) return { error: 'El horario necesita al menos un día laborable.' }
  return { dias }
}
