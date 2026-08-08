/**
 * app/api/dispositivos/[id]/route.js
 * DELETE — revoca un dispositivo (sesión + ELIMINAR). El aparato queda fuera
 *          al instante: su clave deja de valer para marcar o bajar el roster.
 */
import { NextResponse } from 'next/server'
import { revocarDispositivo } from '../../../../lib/dispositivos.js'
import { estadoAcceso } from '../../../../lib/sesion'

export const runtime = 'nodejs'

export async function DELETE(req, { params }) {
  const { estado } = await estadoAcceso('config')
  if (estado !== 'OK') return NextResponse.json({ ok: false, error: 'Sin permiso.' }, { status: estado === 'SIN_SESION' ? 401 : 403 })
  const { id } = await params
  const ok = await revocarDispositivo(id)
  if (!ok) return NextResponse.json({ ok: false, error: 'Dispositivo no encontrado.' }, { status: 404 })
  return NextResponse.json({ ok: true })
}
