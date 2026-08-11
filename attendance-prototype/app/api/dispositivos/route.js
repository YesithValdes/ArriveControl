/**
 * app/api/dispositivos/route.js
 * POST — ACTIVA este dispositivo del kiosco (sesión + CREAR). Devuelve la
 *        clave UNA sola vez; el kiosco la guarda en localStorage.
 * GET  — lista los dispositivos para el panel (sesión + VER).
 */
import { NextResponse } from 'next/server'
import { activarDispositivo, listarDispositivos } from '../../../lib/dispositivos.js'
import { estadoAcceso, estadoAHttp, estadoAMensaje } from '../../../lib/sesion'

export const runtime = 'nodejs'

export async function POST(req) {
  const { estado, usuario, empresa } = await estadoAcceso('config')
  if (estado !== 'OK') {
    return NextResponse.json(
      { ok: false, error: estado === 'SIN_SESION' ? 'Inicia sesión como administrador para activar este dispositivo.' : 'No tienes permiso para activar dispositivos.' },
      { status: estado === 'SIN_SESION' ? 401 : 403 },
    )
  }

  let c
  try { c = await req.json() } catch { return NextResponse.json({ ok: false, error: 'JSON inválido.' }, { status: 400 }) }
  const nombre = String(c?.nombre ?? '').trim()
  if (!nombre) return NextResponse.json({ ok: false, error: 'Ponle un nombre al dispositivo (p. ej. "Tablet recepción").' }, { status: 400 })

  const d = await activarDispositivo({ empresa, nombre, sedeId: c?.sede_id ?? null, activadoPor: usuario.email })
  if (d.error === 'SEDE_NO_ENCONTRADA') {
    return NextResponse.json({ ok: false, error: 'Esa sede no existe en tu empresa.' }, { status: 400 })
  }
  return NextResponse.json({ ok: true, dispositivo: d })
}

export async function GET() {
  const { estado, empresa } = await estadoAcceso('ver')
  if (estado !== 'OK') return NextResponse.json({ ok: false, error: estadoAMensaje(estado) }, { status: estadoAHttp(estado) })
  return NextResponse.json({ ok: true, dispositivos: await listarDispositivos(empresa) })
}
