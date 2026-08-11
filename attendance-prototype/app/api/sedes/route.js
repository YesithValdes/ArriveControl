/**
 * app/api/sedes/route.js
 * GET  — lista de sedes (kiosco con device key, o panel con sesión).
 * POST — crea una sede (sesión + CREAR).
 */
import { NextResponse } from 'next/server'
import { conEmpresa } from '../../../lib/db.js'
import { estadoAcceso, estadoAHttp, estadoAMensaje, empresaDeLaPeticion } from '../../../lib/sesion'

export const runtime = 'nodejs'

export async function GET(req) {
  // El kiosco la consulta SIN sesión, con su clave de dispositivo: de ahí sale
  // a qué empresa pertenece. Antes bastaba con no pedir nada, porque solo
  // había una empresa; ahora hay que saber de quién son estas sedes.
  const ctx = await empresaDeLaPeticion(req)
  if (!ctx) {
    return NextResponse.json({ ok: false, error: 'Sin acceso.' }, { status: 401 })
  }
  const { rows } = await conEmpresa(ctx.esquema, (db) => db.query(
    `select id, nombre, lat, lon, radio_m from sedes order by nombre`,
  ))
  return NextResponse.json({ ok: true, sedes: rows })
}

export async function POST(req) {
  const { estado, esquema } = await estadoAcceso('config')
  if (estado !== 'OK') return NextResponse.json({ ok: false, error: estadoAMensaje(estado) }, { status: estadoAHttp(estado) })

  let c
  try { c = await req.json() } catch { return NextResponse.json({ ok: false, error: 'JSON inválido.' }, { status: 400 }) }
  const nombre = String(c?.nombre ?? '').trim()
  const lat = Number(c?.lat), lon = Number(c?.lon)
  if (!nombre) return NextResponse.json({ ok: false, error: 'La sede necesita un nombre.' }, { status: 400 })
  if (!Number.isFinite(lat) || Math.abs(lat) > 90 || !Number.isFinite(lon) || Math.abs(lon) > 180) {
    return NextResponse.json({ ok: false, error: 'Coordenadas inválidas.' }, { status: 400 })
  }

  try {
    const { rows } = await conEmpresa(esquema, (db) => db.query(
      `insert into sedes (nombre, lat, lon, radio_m) values ($1,$2,$3,$4)
       returning id, nombre, lat, lon, radio_m`,
      [nombre, lat, lon, Number(c?.radio_m) > 0 ? Number(c.radio_m) : 50],
    ))
    return NextResponse.json({ ok: true, sede: rows[0] })
  } catch (e) {
    if (e.code === '23505') return NextResponse.json({ ok: false, error: `Ya existe una sede llamada "${nombre}".` }, { status: 409 })
    throw e
  }
}
