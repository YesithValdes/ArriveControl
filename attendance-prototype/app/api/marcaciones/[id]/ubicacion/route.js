/**
 * app/api/marcaciones/[id]/ubicacion/route.js
 *
 * POST — Adjunta la ubicación GPS a una marcación que se registró SIN ella.
 *
 * El kiosco no espera al GPS para registrar: si el fix no está listo en un
 * par de segundos, la marcación sale igual (la hora es lo importante) y el
 * punto se manda aquí apenas llega. Antes esa marcación quedaba para siempre
 * sin ubicación — cerca del 30 % en producción, sobre todo las primeras del
 * día (la app recién abierta) y las de tablets quietas (Android deja de
 * refrescar el fix cuando el aparato no se mueve).
 *
 * Reglas, todas del lado del servidor:
 *  · misma empresa que la marcación (clave de aparato o sesión, como al marcar);
 *  · solo si la marcación NO tiene ubicación (nunca se pisa una que sí);
 *  · solo si es reciente (VENTANA_MIN): un punto de hace una hora diría
 *    dónde está el aparato ahora, no dónde se marcó;
 *  · se guarda solo si el empleado tiene «validar ubicación», igual que al
 *    marcar (lib/marcaciones.js).
 */
import { NextResponse, after } from 'next/server'
import { conEmpresa } from '../../../../../lib/db.js'
import { empresaDeLaPeticion } from '../../../../../lib/sesion'
import { guardarDireccion } from '../../../../../lib/marcaciones'
import { direccionDesdeCoordenadas } from '../../../../../lib/geocodificar.js'

export const runtime = 'nodejs'

const VENTANA_MIN = 15

export async function POST(req, { params }) {
  const ctx = await empresaDeLaPeticion(req)
  if (!ctx) return NextResponse.json({ ok: false, error: 'No autorizado.' }, { status: 401 })

  const { id } = await params
  let c
  try { c = await req.json() } catch { return NextResponse.json({ ok: false, error: 'JSON inválido.' }, { status: 400 }) }
  const lat = Number(c?.lat)
  const lon = Number(c?.lon)
  const precisionM = Number.isFinite(Number(c?.precision_m)) ? Math.round(Number(c.precision_m)) : null
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) {
    return NextResponse.json({ ok: false, error: 'Coordenadas inválidas.' }, { status: 400 })
  }

  const r = await conEmpresa(ctx.esquema, async (db) => {
    const { rows } = await db.query(
      `update marcaciones m
          set lat = $2, lon = $3, precision_m = $4
         from empleados e
        where m.id = $1 and e.id = m.empleado_id
          and m.lat is null and not m.eliminada
          and e.validar_ubicacion
          and m.ts > now() - ($5 || ' minutes')::interval
        returning m.id`,
      [id, lat, lon, precisionM, String(VENTANA_MIN)],
    )
    return rows[0] ?? null
  })
  // Si no aplicó (ya tenía ubicación, es vieja, no es de esta empresa o el
  // empleado no guarda GPS) se responde ok: no hay nada que el kiosco pueda
  // hacer distinto, y reintentar sería inútil.
  if (!r) return NextResponse.json({ ok: true, aplicada: false })

  after(async () => {
    const direccion = await direccionDesdeCoordenadas(lat, lon)
    await guardarDireccion(ctx.esquema, id, direccion).catch(() => {})
  })
  return NextResponse.json({ ok: true, aplicada: true })
}
