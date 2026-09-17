/**
 * app/api/dispositivos/[id]/route.js
 * DELETE — revoca un dispositivo (sesión + ELIMINAR). El aparato queda fuera
 *          al instante: su clave deja de valer para marcar o bajar el roster.
 * PATCH  — { acceso_panel: true|false }: si el kiosco muestra el acceso al
 *          panel de administración (sesión + CONFIG).
 */
import { NextResponse } from 'next/server'
import { revocarDispositivo, fijarAccesoPanel } from '../../../../lib/dispositivos.js'
import { estadoAcceso, estadoAHttp, estadoAMensaje } from '../../../../lib/sesion'

export const runtime = 'nodejs'

export async function PATCH(req, { params }) {
  const { estado, empresa } = await estadoAcceso('config')
  if (estado !== 'OK') return NextResponse.json({ ok: false, error: estadoAMensaje(estado) }, { status: estadoAHttp(estado) })
  const { id } = await params
  let c
  try { c = await req.json() } catch { return NextResponse.json({ ok: false, error: 'JSON inválido.' }, { status: 400 }) }
  if (typeof c?.acceso_panel !== 'boolean') {
    return NextResponse.json({ ok: false, error: 'Falta acceso_panel (true o false).' }, { status: 400 })
  }
  const ok = await fijarAccesoPanel(empresa, id, c.acceso_panel)
  if (!ok) return NextResponse.json({ ok: false, error: 'Dispositivo no encontrado.' }, { status: 404 })
  return NextResponse.json({ ok: true, acceso_panel: c.acceso_panel })
}

export async function DELETE(req, { params }) {
  const { estado, empresa } = await estadoAcceso('config')
  if (estado !== 'OK') return NextResponse.json({ ok: false, error: estadoAMensaje(estado) }, { status: estadoAHttp(estado) })
  const { id } = await params
  // Se pasa la empresa para que nadie revoque el kiosco de otro cliente.
  const ok = await revocarDispositivo(empresa, id)
  if (!ok) return NextResponse.json({ ok: false, error: 'Dispositivo no encontrado.' }, { status: 404 })
  return NextResponse.json({ ok: true })
}
