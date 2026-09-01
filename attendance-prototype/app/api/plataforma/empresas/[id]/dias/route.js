/**
 * app/api/plataforma/empresas/[id]/dias/route.js
 *
 * POST — regala días de servicio: { dias: 7, que: 'prueba' | 'suscripcion' }
 *
 * Va aparte del PATCH que cambia plan/tope/estado porque no es lo mismo:
 * aquel FIJA un valor y este SUMA sobre lo que ya hay. Mezclarlos habría
 * significado mandar una fecha calculada desde el navegador, y una fecha de
 * vencimiento no se calcula en el cliente.
 *
 * Solo superadmin, como todo lo de esta consola.
 */
import { NextResponse } from 'next/server'
import { soloSuperadmin } from '../../../../../../lib/guardaPlataforma.js'
import { regalarDias } from '../../../../../../lib/plataforma.js'

export const runtime = 'nodejs'

export async function POST(req, { params }) {
  const { error } = await soloSuperadmin()
  if (error) return error
  const { id } = await params
  let c
  try { c = await req.json() } catch { return NextResponse.json({ ok: false, error: 'JSON inválido.' }, { status: 400 }) }
  const r = await regalarDias(id, c?.dias, c?.que)
  if (r.error) return NextResponse.json({ ok: false, error: r.error }, { status: 400 })
  return NextResponse.json({ ok: true, ...r })
}
