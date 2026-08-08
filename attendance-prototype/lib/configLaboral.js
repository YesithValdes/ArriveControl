/**
 * lib/configLaboral.js — Jornada y festivos, de DOS fuentes posibles.
 *
 *  · MODO CONECTADO (hay GESTOR_URL): manda el gestor de nómina. Es la fuente
 *    única para que asistencia y nómina no calculen con reglas distintas.
 *  · MODO AUTÓNOMO (no hay gestor): ArriveControl usa su propia configuración
 *    (`asistencia.config_laboral`) y el calendario oficial de festivos de
 *    Colombia. Así el producto funciona vendido solo.
 *
 * El interruptor es la variable de entorno, no una opción en pantalla: si el
 * cliente compró el gestor, se configura y manda; si no, ArriveControl decide.
 */
import { getHolidaysForYear } from 'colombian-holidays'
import { pool } from './db.js'
import { vigenciasDeHorasSemana } from './jornada.js'

const TTL_MS = 5 * 60 * 1000

/** @type {{ datos: object, expira: number } | null} */
let cache = null

/** ¿Hay una plataforma de nómina configurada que mande sobre estas reglas? */
export const modoConectado = () => Boolean(process.env.GESTOR_URL)

async function pedirAlGestor() {
  const base = process.env.GESTOR_URL
  const anio = new Date().getFullYear()
  const url = `${base}/api/integraciones/config-laboral?anioDesde=${anio - 1}&anioHasta=${anio + 1}`
  const res = await fetch(url, {
    headers: { 'X-API-Key': process.env.INTEGRACION_HORAS_API_KEY ?? '' },
  })
  const datos = await res.json()
  if (!res.ok || !datos.ok) throw new Error(datos.error ?? `El gestor respondió ${res.status}.`)
  return {
    festivos: new Set(datos.festivos ?? []),
    vigencias: datos.jornada?.vigencias ?? [],
    sabadoHabil: datos.jornada?.sabadoHabil ?? true,
    editarEn: datos.editarEn ?? '/configuracion/parametros-nomina',
    propia: false,
  }
}

/** Configuración propia: la fila de `config_laboral` + festivos de Colombia. */
async function leerPropia() {
  const { rows } = await pool.query(
    `select horas_semana, festivos from asistencia.config_laboral where id`,
  )
  const cfg = rows[0] ?? { horas_semana: 42, festivos: [] }

  // Calendario oficial (Ley 51 de 1983, traslado Emiliani) para el año en
  // curso y los vecinos, más los festivos que la empresa haya agregado.
  const anio = new Date().getFullYear()
  const festivos = new Set()
  for (let a = anio - 1; a <= anio + 1; a++) {
    for (const h of getHolidaysForYear(a)) festivos.add(h.celebrationDate)
  }
  for (const f of cfg.festivos ?? []) {
    festivos.add(f instanceof Date ? f.toISOString().slice(0, 10) : String(f).slice(0, 10))
  }

  return {
    festivos,
    vigencias: vigenciasDeHorasSemana(cfg.horas_semana),
    sabadoHabil: true,
    editarEn: null, // se edita aquí mismo, en Ajustes → Reglamento laboral
    propia: true,
  }
}

/**
 * Config laboral vigente. Con caché corta y política de "último bueno": si el
 * gestor no responde se usa la última copia aunque esté vencida (mejor una
 * configuración de hace una hora que tumbar el kiosco).
 *
 * @returns {Promise<{festivos: Set<string>, vigencias: Array, sabadoHabil: boolean,
 *   editarEn: string|null, propia: boolean, desactualizada: boolean}>}
 */
export async function configLaboral() {
  if (!modoConectado()) {
    // Sin gestor no hay red de por medio: se lee y ya, sin caché ni respaldo.
    return { ...(await leerPropia()), desactualizada: false }
  }

  const ahora = Date.now()
  if (cache && ahora < cache.expira) return { ...cache.datos, desactualizada: false }
  try {
    const datos = await pedirAlGestor()
    cache = { datos, expira: ahora + TTL_MS }
    return { ...datos, desactualizada: false }
  } catch (e) {
    if (cache) return { ...cache.datos, desactualizada: true } // último-bueno vencido
    throw new Error(`No se pudo leer la configuración laboral del gestor: ${e.message}`)
  }
}

// Re-exportados por compatibilidad con quien ya los importaba de aquí.
export { horasDiaEn, horasSemanaEn } from './jornada.js'
