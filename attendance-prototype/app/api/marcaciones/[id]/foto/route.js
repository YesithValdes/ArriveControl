/**
 * app/api/marcaciones/[id]/foto/route.js
 *
 * GET — la foto del registro de una marcación (JPEG): el cuadro de la cámara
 *       en el momento en que el kiosco confirmó la identidad. Solo el panel,
 *       con permiso VER. 404 si la marcación no tiene foto o el colaborador tiene
 *       desactivado «Guardar foto»: la foto sigue guardada, pero no se muestra.
 */
import { NextResponse } from 'next/server'
import { conEmpresa } from '../../../../../lib/db.js'
import { estadoAcceso, estadoAHttp, estadoAMensaje } from '../../../../../lib/sesion'

export const runtime = 'nodejs'

export async function GET(req, { params }) {
  const { estado, esquema } = await estadoAcceso('ver', { permisoInvitado: 'marcaciones:ver_foto' })
  if (estado !== 'OK') {
    return NextResponse.json({ ok: false, error: estadoAMensaje(estado) }, { status: estadoAHttp(estado) })
  }
  const { id } = await params
  const { rows } = await conEmpresa(esquema, (db) => db.query(
    `select m.foto from marcaciones m join empleados e on e.id = m.empleado_id
      where m.id = $1 and octet_length(m.foto) > 0 and e.guardar_foto`, [id],
  ))
  if (!rows[0]) return new NextResponse(null, { status: 404 })
  // Se revalida en cada vista: si apagan «Guardar foto» del colaborador, la
  // foto debe dejar de verse aunque el navegador la tuviera guardada.
  return new NextResponse(rows[0].foto, {
    headers: { 'Content-Type': 'image/jpeg', 'Cache-Control': 'private, no-cache' },
  })
}
