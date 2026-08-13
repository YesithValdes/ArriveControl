/**
 * app/api/dispositivos/vincular/route.js
 * POST — genera un código para activar un kiosco desde el propio aparato.
 * GET  — códigos todavía vivos de esta empresa.
 *
 * Lo usa el ADMINISTRADOR desde el panel, con sesión. El aparato nunca pasa
 * por aquí: él canjea el código en /api/dispositivos/canjear.
 */
import { NextResponse } from 'next/server'
import { crearVinculacion, vinculacionesPendientes, formatearCodigo } from '../../../../lib/dispositivos.js'
import { estadoAcceso, estadoAHttp, estadoAMensaje } from '../../../../lib/sesion'

export const runtime = 'nodejs'

export async function GET() {
  const { estado, empresa } = await estadoAcceso('ver')
  if (estado !== 'OK') return NextResponse.json({ ok: false, error: estadoAMensaje(estado) }, { status: estadoAHttp(estado) })

  const pendientes = await vinculacionesPendientes(empresa)
  return NextResponse.json({
    ok: true,
    vinculaciones: pendientes.map((v) => ({ ...v, codigoLegible: formatearCodigo(v.codigo) })),
  })
}

export async function POST(req) {
  const { estado, empresa, usuario } = await estadoAcceso('config')
  if (estado !== 'OK') return NextResponse.json({ ok: false, error: estadoAMensaje(estado) }, { status: estadoAHttp(estado) })

  let c
  try { c = await req.json() } catch { return NextResponse.json({ ok: false, error: 'JSON inválido.' }, { status: 400 }) }

  const nombre = String(c?.nombre ?? '').trim()
  if (!nombre) {
    return NextResponse.json({ ok: false, error: 'Ponle un nombre al dispositivo (p. ej. «Celular recepción»).' }, { status: 400 })
  }
  // La sede es OPCIONAL: un kiosco fijo lleva la suya (sus marcaciones se
  // atribuyen a ese local); un dispositivo móvil (celular) va sin sede y
  // registra desde cualquier lugar.
  const sedeId = String(c?.sede_id ?? '').trim() || null

  const r = await crearVinculacion({
    empresa,
    nombre,
    sedeId,
    creadaPor: usuario.email,
  })
  if (r.error === 'SEDE_NO_ENCONTRADA') {
    return NextResponse.json({ ok: false, error: 'Esa sede no existe en tu empresa.' }, { status: 400 })
  }
  if (r.error) {
    return NextResponse.json({ ok: false, error: 'No se pudo generar el código. Reintenta.' }, { status: 500 })
  }

  return NextResponse.json({
    ok: true,
    codigo: r.codigo,
    codigoLegible: formatearCodigo(r.codigo),
    expira_en: r.expira_en,
  })
}
