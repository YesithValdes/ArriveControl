/**
 * app/api/colillas/route.js — Colillas de pago (desprendibles de horas).
 *
 * GET  ?documento=<cédula>                 las guardadas de ese colaborador
 * POST { documento, desde, hasta }          genera y guarda una nueva
 *
 * Las cifras las calcula el servidor (lib/colillas.js); el cuerpo solo dice
 * de quién y qué período. Permiso `liquidar` (Reportes, junto al cierre); un
 * Invitado necesita «Generar y consultar colillas» (cierres:colillas).
 */
import { NextResponse } from 'next/server'
import { estadoAcceso, estadoAHttp, estadoAMensaje } from '../../../lib/sesion'
import { rangoPedido } from '../../../lib/periodoHoras.js'
import { generarColilla, colillasDe } from '../../../lib/colillas.js'

export const runtime = 'nodejs'

const acceso = () => estadoAcceso('liquidar', { permisoInvitado: 'cierres:colillas' })
const documentoDe = (v) => String(v ?? '').replace(/\D/g, '')

export async function GET(req) {
  const { estado, esquema } = await acceso()
  if (estado !== 'OK') return NextResponse.json({ ok: false, error: estadoAMensaje(estado) }, { status: estadoAHttp(estado) })
  const documento = documentoDe(new URL(req.url).searchParams.get('documento'))
  if (!documento) return NextResponse.json({ ok: false, error: 'Falta la cédula del colaborador.' }, { status: 400 })
  return NextResponse.json({ ok: true, colillas: await colillasDe(esquema, documento) })
}

export async function POST(req) {
  const { estado, esquema, usuario } = await acceso()
  if (estado !== 'OK') return NextResponse.json({ ok: false, error: estadoAMensaje(estado) }, { status: estadoAHttp(estado) })
  let c
  try { c = await req.json() } catch { return NextResponse.json({ ok: false, error: 'JSON inválido.' }, { status: 400 }) }
  const documento = documentoDe(c?.documento)
  if (!documento) return NextResponse.json({ ok: false, error: 'Falta la cédula del colaborador.' }, { status: 400 })
  const rango = rangoPedido(new URLSearchParams({ desde: c?.desde ?? '', hasta: c?.hasta ?? '' }))
  if (!rango || rango.error) return NextResponse.json({ ok: false, error: rango?.error ?? 'Indica el período (desde y hasta).' }, { status: 400 })

  const colilla = await generarColilla(esquema, {
    documento, desde: rango.desde, hasta: rango.hasta, quien: usuario?.email ?? usuario?.nombre ?? null,
  })
  if (!colilla) return NextResponse.json({ ok: false, error: 'Colaborador no encontrado.' }, { status: 404 })
  return NextResponse.json({ ok: true, colilla }, { status: 201 })
}
