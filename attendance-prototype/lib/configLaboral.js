/**
 * lib/configLaboral.js — Configuración laboral leída del GESTOR RH (solo servidor).
 *
 * Fuente única: la jornada legal y los festivos viven en el gestor
 * (GET /api/integraciones/config-laboral). Aquí NO se editan — la pantalla de
 * ajustes solo los muestra y enlaza al gestor para cambiarlos.
 *
 * Caché en memoria con TTL corto; si el gestor no responde se usa la última
 * copia buena aunque esté vencida (mejor una config de hace una hora que
 * tumbar el kiosco o un reporte).
 */

const TTL_MS = 5 * 60 * 1000

/** @type {{ datos: object, expira: number } | null} */
let cache = null

async function pedirAlGestor() {
  const base = process.env.GESTOR_URL || 'http://localhost:3000'
  const anio = new Date().getFullYear()
  const url = `${base}/api/integraciones/config-laboral?anioDesde=${anio - 1}&anioHasta=${anio + 1}`
  const res = await fetch(url, {
    headers: { 'X-API-Key': process.env.INTEGRACION_HORAS_API_KEY ?? '' },
  })
  const datos = await res.json()
  if (!res.ok || !datos.ok) throw new Error(datos.error ?? `El gestor respondió ${res.status}.`)
  return datos
}

/**
 * Config laboral vigente, desde el gestor (con caché y último-bueno).
 * @returns {Promise<{
 *   festivos: Set<string>,
 *   vigencias: Array<{desde: string, horasSemana: number, horasDia: number}>,
 *   sabadoHabil: boolean,
 *   editarEn: string,
 *   desactualizada: boolean,
 * }>}
 */
export async function configLaboral() {
  const ahora = Date.now()
  if (cache && ahora < cache.expira) return { ...cache.datos, desactualizada: false }
  try {
    const d = await pedirAlGestor()
    const datos = {
      festivos: new Set(d.festivos ?? []),
      vigencias: d.jornada?.vigencias ?? [],
      sabadoHabil: d.jornada?.sabadoHabil ?? true,
      editarEn: d.editarEn ?? '/configuracion/parametros-nomina',
    }
    cache = { datos, expira: ahora + TTL_MS }
    return { ...datos, desactualizada: false }
  } catch (e) {
    if (cache) return { ...cache.datos, desactualizada: true } // último-bueno vencido
    throw new Error(`No se pudo leer la configuración laboral del gestor: ${e.message}`)
  }
}

/** Horas de jornada del DÍA vigentes en una fecha (YYYY-MM-DD). */
export function horasDiaEn(vigencias, fechaISO) {
  const v = vigencias.find((x) => fechaISO >= x.desde) ?? vigencias[vigencias.length - 1]
  return v?.horasDia ?? 7
}

/** Horas de jornada SEMANAL vigentes en una fecha (YYYY-MM-DD). */
export function horasSemanaEn(vigencias, fechaISO) {
  const v = vigencias.find((x) => fechaISO >= x.desde) ?? vigencias[vigencias.length - 1]
  return v?.horasSemana ?? 42
}
