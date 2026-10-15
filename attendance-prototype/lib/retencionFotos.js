/**
 * lib/retencionFotos.js — Borra las fotos del registro viejas.
 *
 * La foto de cada marcación (db/migrations/empresa/024_foto_marcacion.sql) es
 * un rostro: dato biométrico, sensible según la Ley 1581 de 2012. Solo se
 * justifica guardarla mientras sirve para lo que se tomó —comprobar quién
 * marcó—, y los reclamos llegan en las semanas siguientes, no al año.
 *
 * Cada noche (dentro del cron del resumen diario) se vacía `foto` en las
 * marcaciones de más de DIAS_RETENCION días. La marcación NO se toca: hora,
 * sede, ubicación y tipo siguen ahí para la nómina. Se saltan las fotos con
 * `foto_retenida` (reclamo o investigación abierta).
 */
import { conEmpresa } from './db.js'

export const DIAS_RETENCION = 90

/** Vacía las fotos vencidas de una empresa. Devuelve cuántas borró. */
export async function borrarFotosVencidas(esquema, dias = DIAS_RETENCION) {
  return conEmpresa(esquema, async (db) => {
    const { rowCount } = await db.query(
      `update marcaciones set foto = null
        where foto is not null
          and not foto_retenida
          and ts < now() - make_interval(days => $1)`,
      [dias],
    )
    return rowCount
  })
}
