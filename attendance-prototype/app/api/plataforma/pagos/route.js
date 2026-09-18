/**
 * app/api/plataforma/pagos/route.js
 *
 * GET — todos los pagos de la plataforma (los últimos 200), con la empresa.
 * Solo superadmin.
 */
import { NextResponse } from 'next/server'
import { soloSuperadmin } from '../../../../lib/guardaPlataforma.js'
import { listarPagos } from '../../../../lib/plataforma.js'

export const runtime = 'nodejs'

export async function GET() {
  const { error } = await soloSuperadmin()
  if (error) return error
  const pagos = await listarPagos()
  return NextResponse.json({ ok: true, pagos })
}
