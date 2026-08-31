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
    // ── El almuerzo, como RANGO ──────────────────────────────────────
    //
    // Se escribe igual que la jornada —«de 13:00 a 14:00»— y de ahí sale su
    // duración. Antes se pedían la hora y los minutos por separado, que es el
    // mismo dato dicho de dos formas y una manera fácil de dejarlos peleados.
    //
    // El rango es OPCIONAL: los horarios creados antes de que existiera solo
    // tienen `almuerzo_min` y se respetan tal cual.
    //
    // En minutos y no como texto: un turno nocturno (22:00–06:00) termina al
    // día siguiente, y ahí "02:00" va DESPUÉS de "22:00" aunque el texto diga
    // lo contrario.
    const min = (h) => Number(h.slice(0, 2)) * 60 + Number(h.slice(3, 5))
    const hora = (x) => (x == null || x === '' ? null : String(x))
    const desde = hora(f.almuerzo_desde)
    const hasta = hora(f.almuerzo_hasta)

    if ((desde !== null && !HHMM.test(desde)) || (hasta !== null && !HHMM.test(hasta))) {
      return { error: `Día ${k}: el almuerzo debe ir de una hora HH:MM a otra.` }
    }
    if ((desde === null) !== (hasta === null)) {
      return { error: `Día ${k}: el almuerzo necesita las dos horas, la de inicio y la de fin.` }
    }

    let alm = Number(f.almuerzo_min ?? 0)
    if (desde !== null) {
      const ini = min(entrada)
      const fin = min(salida) <= ini ? min(salida) + 1440 : min(salida)
      const a1 = min(desde) < ini ? min(desde) + 1440 : min(desde)
      const a2 = min(hasta) <= a1 ? min(hasta) + 1440 : min(hasta)
      if (!(ini < a1 && a2 < fin)) {
        return { error: `Día ${k}: el almuerzo (${desde}–${hasta}) debe quedar dentro de la jornada.` }
      }
      // La duración SALE del rango: es el único sitio donde se decide, para
      // que no puedan contradecirse.
      alm = a2 - a1
      if (alm > 240) return { error: `Día ${k}: el almuerzo no puede pasar de 4 horas.` }
    }
    if (!Number.isInteger(alm) || alm < 0 || alm > 240) {
      return { error: `Día ${k}: almuerzo inválido (0 a 240 minutos).` }
    }
    dias[k] = {
      entrada, salida, almuerzo_min: alm,
      ...(desde ? { almuerzo_desde: desde, almuerzo_hasta: hasta } : {}),
    }
  }
  if (Object.keys(dias).length === 0) return { error: 'El horario necesita al menos un día laborable.' }
  return { dias }
}
