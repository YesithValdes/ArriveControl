/**
 * lib/sincronizarNomina.js — Sincronización AUTOMÁTICA con la plataforma RH.
 *
 * Cada mutación de marcaciones (kiosco, manual, edición, eliminación) llama a
 * `sincronizar(fechas)` dentro de `after()` de Next: corre DESPUÉS de enviar la
 * respuesta (no retrasa la UI) y la plataforma espera a que termine, así que
 * funciona igual en local y en serverless (Vercel). Se reconstruye el lote del
 * rango afectado y se envía al gestor, que reemplaza tramos solapados y
 * reliquida los periodos afectados: la nómina queda al día sin pulsar nada.
 *
 * Eliminaciones: un turno borrado del todo ya no produce tramo, así que el
 * solape no lo cubre. Se resuelve comparando contra la bitácora `envios_rh`:
 * toda referencia aplicada del rango que ya no salga en el lote nuevo viaja
 * en `anulaciones` y el gestor la borra de la nómina.
 *
 * Fire-and-forget: si el gestor está caído, se registra el error en consola y
 * el siguiente cambio (o un envío manual desde Reportes) vuelve a intentar.
 */
import { pool } from './db.js'
import { construirLote, registrarEnvio } from './nomina.js'

// Coalescencia dentro del proceso: si llegan cambios mientras hay un envío en
// vuelo, sus fechas se acumulan y se envían en la siguiente vuelta del bucle.
const pendientes = new Set()
let enviando = false

/** Día Bogotá (YYYY-MM-DD) de un timestamp; null si no es una fecha válida. */
export function fechaBogota(ts) {
  const d = new Date(ts)
  if (Number.isNaN(d.getTime())) return null
  return d.toLocaleDateString('en-CA', { timeZone: 'America/Bogota' })
}

/**
 * Fechas afectadas por una marcación: su día Bogotá Y el día anterior, porque
 * un turno que cruza medianoche pertenece al día de la ENTRADA (una salida a
 * la 1:00 a.m. cierra el turno de ayer). Sin el día anterior en el rango, el
 * par entrada→salida quedaría partido y el tramo se perdería.
 */
export function fechasAfectadas(ts) {
  const f = fechaBogota(ts)
  if (!f) return []
  const d = new Date(`${f}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() - 1)
  return [d.toISOString().slice(0, 10), f]
}

/**
 * Sincroniza con el gestor las fechas (YYYY-MM-DD) afectadas por un cambio de
 * marcaciones. Llamar dentro de `after(() => sincronizar(fechas))`. Nunca
 * lanza: la marcación ya quedó guardada; la sincronización es un efecto
 * posterior y el siguiente cambio (o el botón de Reportes) reintenta.
 */
export async function sincronizar(fechas) {
  for (const f of fechas) if (f) pendientes.add(f)
  if (enviando) return // el envío en vuelo tomará estas fechas en su siguiente vuelta
  enviando = true
  try {
    while (pendientes.size > 0) {
      const lote = [...pendientes].sort()
      pendientes.clear()
      await enviarRango(lote)
    }
  } catch (e) {
    console.error('[sync-nomina] Error:', e.message)
  } finally {
    enviando = false
  }
}

async function enviarRango(fechas) {
  {
    const rango = { desde: fechas[0], hasta: fechas[fechas.length - 1] }
    const { registros } = await construirLote(rango)
    const refsNuevas = new Set(registros.map((r) => r.referenciaExterna))

    // Referencias ya aplicadas en el rango que el lote nuevo NO trae:
    // el turno se eliminó (o cambió de forma) → anular en el gestor.
    const { rows: previas } = await pool.query(
      `select referencia_externa from asistencia.envios_rh
        where estado = 'aplicado'
          and payload->>'fecha' between $1 and $2`,
      [rango.desde, rango.hasta],
    )
    const anulaciones = previas
      .map((p) => p.referencia_externa)
      .filter((ref) => !refsNuevas.has(ref))

    if (registros.length === 0 && anulaciones.length === 0) return

    const url = `${process.env.GESTOR_URL || 'http://localhost:3000'}/api/integraciones/horas`
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': process.env.INTEGRACION_HORAS_API_KEY ?? '',
      },
      body: JSON.stringify({
        registros: registros.map(({ _empleadoId, _semana, ...r }) => r),
        anulaciones,
      }),
    })
    const datos = await res.json()
    if (!res.ok || datos.ok === false) {
      console.error('[sync-nomina] El gestor rechazó el lote:', JSON.stringify(datos).slice(0, 300))
      return
    }

    if (registros.length > 0) await registrarEnvio(registros, datos, 'sync-automatica')
    if (anulaciones.length > 0) {
      await pool.query(`delete from asistencia.envios_rh where referencia_externa = any($1)`, [anulaciones])
    }
    console.log(
      `[sync-nomina] ${rango.desde}→${rango.hasta}: ${datos.aplicados} aplicadas, ` +
      `${datos.reemplazados} reemplazadas, ${datos.anulados} anuladas, ${datos.duplicados} duplicadas.` +
      (datos.periodosRecalculando?.length ? ` Reliquidando: ${datos.periodosRecalculando.join(', ')}.` : ''),
    )
  }
}
