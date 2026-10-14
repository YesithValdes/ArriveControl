/**
 * app/api/soporte/[id]/route.js
 * DELETE — el dueño REVOCA una autorización de soporte. Surte efecto en la
 *          siguiente petición del soporte: la vigencia se lee de la base cada
 *          vez (lib/sesion.js), no se confía en la cookie.
 */
import { NextResponse } from 'next/server'
import { estadoAcceso, estadoAHttp, estadoAMensaje } from '../../../../lib/sesion'
import { revocarSoporte } from '../../../../lib/soporte.js'

export const runtime = 'nodejs'

export async function DELETE(req, { params }) {
  const { estado, empresa, usuario } = await estadoAcceso('cuenta', { ignorarSuscripcion: true })
  if (estado !== 'OK') return NextResponse.json({ ok: false, error: estadoAMensaje(estado) }, { status: estadoAHttp(estado) })
  const { id } = await params
  const autorizacion = await revocarSoporte({ empresa, usuario, id })
  if (!autorizacion) {
    return NextResponse.json({ ok: false, error: 'Esa autorización no existe o ya estaba revocada.' }, { status: 404 })
  }
  return NextResponse.json({ ok: true, autorizacion })
}
