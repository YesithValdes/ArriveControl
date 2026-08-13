/**
 * app/api/horarios/route.js
 * GET  — lista de horarios (plantillas de jornada POR DÍAS, con nombre).
 * POST — crea un horario (sesión + permiso de configuración).
 *
 * Un horario define su franja día por día: { "0".."6": {entrada, salida,
 * almuerzo_min} }, 0=domingo … 6=sábado; día ausente = libre.
 */
import { NextResponse } from 'next/server'
import { conEmpresa } from '../../../lib/db.js'
import { estadoAcceso, estadoAHttp, estadoAMensaje, empresaDeLaPeticion } from '../../../lib/sesion'
import { validarDias } from '../../../lib/horariosDias.js'

export const runtime = 'nodejs'

export async function GET(req) {
  const ctx = await empresaDeLaPeticion(req)
  if (!ctx) {
    return NextResponse.json({ ok: false, error: 'Sin acceso.' }, { status: 401 })
  }
  const { rows } = await conEmpresa(ctx.esquema, (db) => db.query(
    `select id, nombre, dias from horarios order by nombre`,
  ))
  return NextResponse.json({ ok: true, horarios: rows })
}

export async function POST(req) {
  const { estado, esquema } = await estadoAcceso('config')
  if (estado !== 'OK') return NextResponse.json({ ok: false, error: estadoAMensaje(estado) }, { status: estadoAHttp(estado) })

  let c
  try { c = await req.json() } catch { return NextResponse.json({ ok: false, error: 'JSON inválido.' }, { status: 400 }) }
  const nombre = String(c?.nombre ?? '').trim()
  if (!nombre) return NextResponse.json({ ok: false, error: 'El horario necesita un nombre.' }, { status: 400 })
  const v = validarDias(c?.dias)
  if (v.error) return NextResponse.json({ ok: false, error: v.error }, { status: 400 })

  try {
    const { rows } = await conEmpresa(esquema, (db) => db.query(
      `insert into horarios (nombre, dias) values ($1, $2)
       returning id, nombre, dias`,
      [nombre, JSON.stringify(v.dias)],
    ))
    return NextResponse.json({ ok: true, horario: rows[0] })
  } catch (e) {
    if (e.code === '23505') return NextResponse.json({ ok: false, error: `Ya existe un horario llamado "${nombre}".` }, { status: 409 })
    throw e
  }
}
