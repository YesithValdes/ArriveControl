/**
 * app/api/dispositivos/[id]/route.js
 * DELETE — revoca un dispositivo (sesión + ELIMINAR). El aparato queda fuera
 *          al instante: su clave deja de valer para marcar o bajar el roster.
 */
import { NextResponse } from 'next/server'
import { revocarDispositivo } from '../../../../lib/dispositivos.js'
import { estadoAcceso, estadoAHttp, estadoAMensaje } from '../../../../lib/sesion'

export const runtime = 'nodejs'

export async function DELETE(req, { params }) {
  const { estado, empresa } = await estadoAcceso('config')
  if (estado !== 'OK') return NextResponse.json({ ok: false, error: estadoAMensaje(estado) }, { status: estadoAHttp(estado) })
  const { id } = await params
  // Se pasa la empresa para que nadie revoque el kiosco de otro cliente.
  const ok = await revocarDispositivo(empresa, id)
  if (!ok) return NextResponse.json({ ok: false, error: 'Dispositivo no encontrado.' }, { status: 404 })
  return NextResponse.json({ ok: true })
}
