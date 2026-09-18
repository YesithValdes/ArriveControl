/**
 * app/api/plataforma/empresas/[id]/pagos/route.js
 *
 * GET — lo que la empresa ha comprado: sus pagos, del más reciente al más
 * viejo. Solo superadmin.
 */
import { NextResponse } from 'next/server'
import { soloSuperadmin } from '../../../../../../lib/guardaPlataforma.js'
import { pagosDeEmpresa } from '../../../../../../lib/plataforma.js'

export const runtime = 'nodejs'

export async function GET(_req, { params }) {
  const { error } = await soloSuperadmin()
  if (error) return error
  const { id } = await params
  const pagos = await pagosDeEmpresa(id)
  return NextResponse.json({ ok: true, pagos })
}
