/**
 * app/api/sedes/route.js
 * GET  — lista de sedes (kiosco con device key, o panel con sesión).
 * POST — crea una sede (sesión + CREAR).
 */
import { NextResponse } from 'next/server'
import { pool } from '../../../lib/db.js'
import { estadoAcceso } from '../../../lib/sesion'

export const runtime = 'nodejs'

export async function GET() {
  // Lectura abierta: el kiosco la necesita sin sesión (ver /api/marcaciones)
  // y son solo nombres y coordenadas de las sedes.
  const { rows } = await pool.query(
    `select id, nombre, lat, lon, radio_m from asistencia.sedes order by nombre`,
  )
  return NextResponse.json({ ok: true, sedes: rows })
}

export async function POST(req) {
  const { estado } = await estadoAcceso('config')
  if (estado !== 'OK') return NextResponse.json({ ok: false, error: 'Sin permiso.' }, { status: estado === 'SIN_SESION' ? 401 : 403 })

  let c
  try { c = await req.json() } catch { return NextResponse.json({ ok: false, error: 'JSON inválido.' }, { status: 400 }) }
  const nombre = String(c?.nombre ?? '').trim()
  const lat = Number(c?.lat), lon = Number(c?.lon)
  if (!nombre) return NextResponse.json({ ok: false, error: 'La sede necesita un nombre.' }, { status: 400 })
  if (!Number.isFinite(lat) || Math.abs(lat) > 90 || !Number.isFinite(lon) || Math.abs(lon) > 180) {
    return NextResponse.json({ ok: false, error: 'Coordenadas inválidas.' }, { status: 400 })
  }

  try {
    const { rows } = await pool.query(
      `insert into asistencia.sedes (nombre, lat, lon, radio_m) values ($1,$2,$3,$4)
       returning id, nombre, lat, lon, radio_m`,
      [nombre, lat, lon, Number(c?.radio_m) > 0 ? Number(c.radio_m) : 50],
    )
    return NextResponse.json({ ok: true, sede: rows[0] })
  } catch (e) {
    if (e.code === '23505') return NextResponse.json({ ok: false, error: `Ya existe una sede llamada "${nombre}".` }, { status: 409 })
    throw e
  }
}
