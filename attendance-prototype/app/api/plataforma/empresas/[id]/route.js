/**
 * app/api/plataforma/empresas/[id]/route.js
 * PATCH  — plan, tope de empleados o estado de una empresa.
 * DELETE — la elimina ENTERA (usuarios, fila y esquema). Exige repetir el
 *          nombre del esquema en el cuerpo: { confirmacion: "t_acme" }.
 */
import { NextResponse } from 'next/server'
import { soloSuperadmin } from '../../../../../lib/guardaPlataforma.js'
import { actualizarEmpresa, eliminarEmpresa } from '../../../../../lib/plataforma.js'

export const runtime = 'nodejs'

export async function PATCH(req, { params }) {
  const { error } = await soloSuperadmin()
  if (error) return error
  const { id } = await params
  let c
  try { c = await req.json() } catch { return NextResponse.json({ ok: false, error: 'JSON inválido.' }, { status: 400 }) }
  const r = await actualizarEmpresa(id, c ?? {})
  if (r.error) return NextResponse.json({ ok: false, error: r.error }, { status: 400 })
  return NextResponse.json(r)
}

export async function DELETE(req, { params }) {
  const { error } = await soloSuperadmin()
  if (error) return error
  const { id } = await params
  let c
  try { c = await req.json() } catch { c = null }
  const r = await eliminarEmpresa(id, c?.confirmacion)
  if (r.error) return NextResponse.json({ ok: false, error: r.error }, { status: 400 })
  return NextResponse.json(r)
}
