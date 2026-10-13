/**
 * app/api/plataforma/empresas/[id]/evaluacion/route.js — La evaluación de
 * modelos faciales de una empresa, administrada por el SUPERADMIN.
 *
 * GET    → { empresa: {id, nombre, habilitada}, config, personas, reportes }
 * PATCH  { habilitada? , estado?, hasta?, modelos? }
 *          `habilitada` es el permiso de la empresa (control.empresas.
 *          laboratorio_facial): sin él, los kioscos no se enteran de nada.
 * DELETE ?empleado_id=… | ?todo=1
 *
 * Nada de esto toca rostros ni marcaciones: el modelo actual sigue decidiendo.
 */
import { NextResponse } from 'next/server'
import { soloSuperadmin } from '../../../../../../lib/guardaPlataforma.js'
import { empresaPorId, laboratorioHabilitado } from '../../../../../../lib/empresas.js'
import { actualizarEmpresa } from '../../../../../../lib/plataforma.js'
import { panelEvaluacion, cambiarEvaluacion, borrarEvaluacion } from '../../../../../../lib/evaluacionModelos.js'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const json = (cuerpo, status = 200) => NextResponse.json(cuerpo, { status })

async function laEmpresa(params) {
  const { id } = await params
  return empresaPorId(id)
}

export async function GET(_req, { params }) {
  const { error } = await soloSuperadmin()
  if (error) return error
  const empresa = await laEmpresa(params)
  if (!empresa) return json({ ok: false, error: 'Esa empresa no existe.' }, 404)
  const datos = await panelEvaluacion(empresa.esquema)
  return json({ ok: true, empresa: { id: empresa.id, nombre: empresa.nombre, habilitada: laboratorioHabilitado(empresa) }, ...datos })
}

export async function PATCH(req, { params }) {
  const { error, usuario } = await soloSuperadmin()
  if (error) return error
  const empresa = await laEmpresa(params)
  if (!empresa) return json({ ok: false, error: 'Esa empresa no existe.' }, 404)
  let c
  try { c = await req.json() } catch { return json({ ok: false, error: 'JSON inválido.' }, 400) }

  if (typeof c?.habilitada === 'boolean') {
    const r = await actualizarEmpresa(empresa.id, { laboratorioFacial: c.habilitada })
    if (r.error) return json({ ok: false, error: r.error }, 400)
    // Al quitar el permiso, la evaluación también queda apagada.
    if (!c.habilitada) await cambiarEvaluacion(empresa.esquema, { estado: 'apagada' }, usuario.email)
  }
  const { habilitada, ...resto } = c ?? {}
  if (Object.keys(resto).length > 0) {
    const r = await cambiarEvaluacion(empresa.esquema, resto, usuario.email)
    if (r.error) return json({ ok: false, error: r.error }, 400)
  }
  return json({ ok: true })
}

export async function DELETE(req, { params }) {
  const { error } = await soloSuperadmin()
  if (error) return error
  const empresa = await laEmpresa(params)
  if (!empresa) return json({ ok: false, error: 'Esa empresa no existe.' }, 404)
  const { searchParams } = new URL(req.url)
  const r = await borrarEvaluacion(empresa.esquema, { empleadoId: searchParams.get('empleado_id'), todo: searchParams.get('todo') === '1' })
  if (r.error) return json({ ok: false, error: r.error }, 400)
  return json(r)
}
