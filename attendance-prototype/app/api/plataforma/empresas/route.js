/**
 * app/api/plataforma/empresas/route.js
 * GET — todas las empresas, con su tamaño y su último uso. SOLO superadmin.
 *
 * Es la única API que ve a todos los inquilinos, y por eso su guarda es
 * distinta a la del resto: no pasa por `estadoAcceso` (que exige empresa y el
 * superadmin no tiene) sino por el rol directamente.
 */
import { NextResponse } from 'next/server'
import { soloSuperadmin } from '../../../../lib/guardaPlataforma.js'
import { listarEmpresas } from '../../../../lib/plataforma.js'

export const runtime = 'nodejs'

export async function GET() {
  const { error } = await soloSuperadmin()
  if (error) return error
  return NextResponse.json({ ok: true, empresas: await listarEmpresas() })
}
