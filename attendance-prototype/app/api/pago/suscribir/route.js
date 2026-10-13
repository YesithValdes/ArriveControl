/**
 * app/api/pago/suscribir/route.js
 *
 * POST { plan, email } — crea la suscripción mensual en Mercado Pago y
 *       devuelve `initPoint`, la página donde el dueño autoriza el débito.
 *
 * Solo el dueño (permiso `cuenta`). Del navegador se acepta CUÁL plan y el
 * correo de su cuenta de Mercado Pago; el precio lo calcula el servidor. El
 * plan NO se activa aquí: lo activa el aviso de Mercado Pago cuando el cobro
 * queda aprobado (app/api/pago/mercadopago).
 */
import { NextResponse } from 'next/server'
import { estadoAcceso, estadoAHttp, estadoAMensaje } from '../../../../lib/sesion'
import { crearSuscripcion, ErrorSuscripcion } from '../../../../lib/suscripciones.js'
import { mismoOrigen } from '../../../../lib/origen.js'

export const runtime = 'nodejs'

export async function POST(req) {
  if (!mismoOrigen(req)) return NextResponse.json({ ok: false, error: 'Origen no permitido.' }, { status: 403 })
  const { estado, empresa, usuario } = await estadoAcceso('cuenta')
  if (estado !== 'OK') {
    return NextResponse.json({ ok: false, error: estadoAMensaje(estado) }, { status: estadoAHttp(estado) })
  }
  let c
  try { c = await req.json() } catch { return NextResponse.json({ ok: false, error: 'JSON inválido.' }, { status: 400 }) }
  try {
    const r = await crearSuscripcion({
      empresa, usuario, planId: c?.plan, email: c?.email ?? usuario.email,
      // A dónde vuelve tras autorizar. Es cortesía visual: lo que activa el
      // plan es el aviso de Mercado Pago, nunca este regreso.
      urlRetorno: `${new URL(req.url).origin}/admin/ajustes/plan?pago=listo`,
    })
    return NextResponse.json({ ok: true, ...r })
  } catch (e) {
    if (e instanceof ErrorSuscripcion) return NextResponse.json({ ok: false, error: e.message }, { status: e.status })
    if (e.code === '23505') return NextResponse.json({ ok: false, error: 'Ya se está preparando tu suscripción. Espera un momento.' }, { status: 409 })
    console.error('Suscribir:', e?.message || e)
    return NextResponse.json({ ok: false, error: 'No se pudo iniciar la suscripción.' }, { status: 500 })
  }
}
