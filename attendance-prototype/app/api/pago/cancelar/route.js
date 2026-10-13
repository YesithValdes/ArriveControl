/**
 * app/api/pago/cancelar/route.js
 *
 * POST — cancela la suscripción en Mercado Pago (no habrá más cobros). El
 *        plan sigue activo hasta el vencimiento de lo ya pagado.
 *
 * Solo el dueño (permiso `cuenta`).
 */
import { NextResponse } from 'next/server'
import { estadoAcceso, estadoAHttp, estadoAMensaje } from '../../../../lib/sesion'
import { cancelarSuscripcion, ErrorSuscripcion } from '../../../../lib/suscripciones.js'
import { mismoOrigen } from '../../../../lib/origen.js'

export const runtime = 'nodejs'

export async function POST(req) {
  if (!mismoOrigen(req)) return NextResponse.json({ ok: false, error: 'Origen no permitido.' }, { status: 403 })
  // Cancelar es del dueño (`cuenta`), y debe poder hacerlo aunque el plan ya
  // esté vencido: justamente para que no le sigan cobrando.
  const { estado, empresa } = await estadoAcceso('cuenta')
  if (estado !== 'OK' && estado !== 'SUSCRIPCION_VENCIDA') {
    return NextResponse.json({ ok: false, error: estadoAMensaje(estado) }, { status: estadoAHttp(estado) })
  }
  try {
    return NextResponse.json(await cancelarSuscripcion({ empresa }))
  } catch (e) {
    if (e instanceof ErrorSuscripcion) return NextResponse.json({ ok: false, error: e.message }, { status: e.status })
    console.error('Cancelar suscripción:', e?.message || e)
    return NextResponse.json({ ok: false, error: 'No se pudo cancelar.' }, { status: 500 })
  }
}
