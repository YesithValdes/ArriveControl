/**
 * app/api/intentos/route.js
 * POST — el kiosco reporta cada intento de reconocimiento (aceptado o no).
 * Alimenta las métricas FAR/FRR y la detección de suplantación.
 * Autenticado con la clave de dispositivo, como /api/marcaciones.
 */
import { NextResponse } from 'next/server'
import { conEmpresa } from '../../../lib/db.js'
import { empresaDeLaPeticion } from '../../../lib/sesion'

export const runtime = 'nodejs'

export async function POST(req) {
  // La empresa sale de la clave del dispositivo: un intento pertenece al
  // cliente cuyo kiosco lo produjo, y sin saber cuál no hay dónde guardarlo.
  const ctx = await empresaDeLaPeticion(req)
  if (!ctx) return NextResponse.json({ ok: false, error: 'Dispositivo no reconocido.' }, { status: 401 })

  let c
  try { c = await req.json() } catch { return NextResponse.json({ ok: false, error: 'JSON inválido.' }, { status: 400 }) }
  if (typeof c?.aceptado !== 'boolean') {
    return NextResponse.json({ ok: false, error: 'Falta aceptado (boolean).' }, { status: 400 })
  }

  await conEmpresa(ctx.esquema, (db) => db.query(
    `insert into intentos_kiosco (empleado_id, aceptado, distancia, liveness_ok, sede_id)
     values ($1,$2,$3,$4,$5)`,
    [c.empleado_id ?? null, c.aceptado, c.distancia ?? null, c.liveness_ok ?? null, c.sede_id ?? null],
  ))
  return NextResponse.json({ ok: true })
}
