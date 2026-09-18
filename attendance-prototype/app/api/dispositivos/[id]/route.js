/**
 * app/api/dispositivos/[id]/route.js
 * DELETE — elimina el dispositivo (sesión + CONFIG). Su clave deja de valer
 *          al instante y desaparece de la lista; sus marcaciones se conservan.
 * PATCH  — { nombre?, sede_id?, acceso_panel? }: renombrar, cambiar la sede o
 *          decidir si el kiosco muestra el acceso al panel (sesión + CONFIG).
 */
import { NextResponse } from 'next/server'
import { eliminarDispositivo, editarDispositivo, fijarAccesoPanel } from '../../../../lib/dispositivos.js'
import { estadoAcceso, estadoAHttp, estadoAMensaje } from '../../../../lib/sesion'

export const runtime = 'nodejs'

export async function PATCH(req, { params }) {
  const { estado, empresa } = await estadoAcceso('config')
  if (estado !== 'OK') return NextResponse.json({ ok: false, error: estadoAMensaje(estado) }, { status: estadoAHttp(estado) })
  const { id } = await params
  let c
  try { c = await req.json() } catch { return NextResponse.json({ ok: false, error: 'JSON inválido.' }, { status: 400 }) }

  if ('nombre' in c || 'sede_id' in c) {
    const nombre = 'nombre' in c ? String(c.nombre ?? '').trim() : null
    if ('nombre' in c && !nombre) return NextResponse.json({ ok: false, error: 'El nombre no puede quedar vacío.' }, { status: 400 })
    const r = await editarDispositivo(empresa, id, { nombre, sedeId: 'sede_id' in c ? (c.sede_id || null) : undefined })
    if (r.error === 'SEDE_NO_ENCONTRADA') return NextResponse.json({ ok: false, error: 'Esa sede no existe en tu empresa.' }, { status: 400 })
    if (r.error) return NextResponse.json({ ok: false, error: 'Dispositivo no encontrado.' }, { status: 404 })
  }
  if ('acceso_panel' in c) {
    if (typeof c.acceso_panel !== 'boolean') return NextResponse.json({ ok: false, error: 'acceso_panel debe ser true o false.' }, { status: 400 })
    const ok = await fijarAccesoPanel(empresa, id, c.acceso_panel)
    if (!ok) return NextResponse.json({ ok: false, error: 'Dispositivo no encontrado.' }, { status: 404 })
  }
  if (!('nombre' in c) && !('sede_id' in c) && !('acceso_panel' in c)) {
    return NextResponse.json({ ok: false, error: 'Nada que cambiar.' }, { status: 400 })
  }
  return NextResponse.json({ ok: true })
}

export async function DELETE(req, { params }) {
  const { estado, empresa } = await estadoAcceso('config')
  if (estado !== 'OK') return NextResponse.json({ ok: false, error: estadoAMensaje(estado) }, { status: estadoAHttp(estado) })
  const { id } = await params
  // Se pasa la empresa para que nadie elimine el kiosco de otro cliente.
  const ok = await eliminarDispositivo(empresa, id)
  if (!ok) return NextResponse.json({ ok: false, error: 'Dispositivo no encontrado.' }, { status: 404 })
  return NextResponse.json({ ok: true })
}
