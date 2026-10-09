/**
 * app/api/marcaciones/[id]/foto/route.js
 *
 * GET — la foto del registro de una marcación (JPEG): el cuadro de la cámara
 *       en el momento en que el kiosco confirmó la identidad. Solo el panel,
 *       con permiso VER. 404 si la marcación no tiene foto.
 */
import { NextResponse } from 'next/server'
import { conEmpresa } from '../../../../../lib/db.js'
import { estadoAcceso, estadoAHttp, estadoAMensaje } from '../../../../../lib/sesion'

export const runtime = 'nodejs'

export async function GET(req, { params }) {
  const { estado, esquema } = await estadoAcceso('ver')
  if (estado !== 'OK') {
    return NextResponse.json({ ok: false, error: estadoAMensaje(estado) }, { status: estadoAHttp(estado) })
  }
  const { id } = await params
  const { rows } = await conEmpresa(esquema, (db) => db.query(
    `select foto from marcaciones where id = $1 and foto is not null`, [id],
  ))
  if (!rows[0]) return new NextResponse(null, { status: 404 })
  // La foto de una marcación no cambia nunca: se puede cachear sin revalidar.
  return new NextResponse(rows[0].foto, {
    headers: { 'Content-Type': 'image/jpeg', 'Cache-Control': 'private, max-age=604800, immutable' },
  })
}
