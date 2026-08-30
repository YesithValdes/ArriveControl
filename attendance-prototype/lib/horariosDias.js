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
    // A qué hora empieza el almuerzo. Es OPCIONAL —un horario viejo puede no
    // tenerla— y solo tiene sentido si hay almuerzo: sin pausa no hay hora que
    // guardar. Se usa para cerrar el día de quien entró en la mañana y no
    // volvió a marcar, así que no puede caer fuera de la jornada.
    const desde = f.almuerzo_desde == null || f.almuerzo_desde === '' ? null : String(f.almuerzo_desde)
    if (desde !== null && !HHMM.test(desde)) {
      return { error: `Día ${k}: la hora de almuerzo debe ser HH:MM.` }
    }
    if (desde !== null && alm === 0) {
      return { error: `Día ${k}: hay hora de almuerzo pero la pausa dura 0 minutos.` }
    }
    if (desde !== null) {
      // En minutos y no como texto: un turno nocturno (22:00–06:00) termina
      // al día siguiente, y ahí "02:00" es mayor que "22:00" aunque el texto
      // diga lo contrario.
      const min = (h) => Number(h.slice(0, 2)) * 60 + Number(h.slice(3, 5))
      const ini = min(entrada)
      const fin = min(salida) <= ini ? min(salida) + 1440 : min(salida)
      const alz = min(desde) < ini ? min(desde) + 1440 : min(desde)
      if (!(ini < alz && alz < fin)) {
        return { error: `Día ${k}: el almuerzo (${desde}) debe quedar entre la entrada y la salida.` }
      }
    }
    dias[k] = { entrada, salida, almuerzo_min: alm, ...(desde ? { almuerzo_desde: desde } : {}) }
  }
  if (Object.keys(dias).length === 0) return { error: 'El horario necesita al menos un día laborable.' }
  return { dias }
}
