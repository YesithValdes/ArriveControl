/**
 * app/api/empresa/route.js — La empresa vista por SÍ MISMA.
 *
 * GET   — nombre, NIT, plan, cuántos empleados caben y la clave de API.
 * PATCH — renombrar, cambiar NIT, o regenerar la clave de API.
 *
 * Distinto de /api/plataforma/empresas (el superadmin viendo a TODAS): aquí
 * una empresa solo puede tocarse a sí misma, y ni el plan ni el estado — esos
 * los administra la plataforma.
 */
import { randomBytes } from 'node:crypto'
import { NextResponse } from 'next/server'
import { control } from '../../../lib/db.js'
import { olvidarEmpresas, cabeOtroEmpleado } from '../../../lib/empresas.js'
import { estadoAcceso, estadoAHttp, estadoAMensaje } from '../../../lib/sesion'

export const runtime = 'nodejs'

export async function GET() {
  const { estado, empresa } = await estadoAcceso('config')
  if (estado !== 'OK') return NextResponse.json({ ok: false, error: estadoAMensaje(estado) }, { status: estadoAHttp(estado) })

  const { actuales, limite } = await cabeOtroEmpleado(empresa)
  return NextResponse.json({
    ok: true,
    empresa: {
      nombre: empresa.nombre,
      nit: empresa.nit ?? '',
      plan: empresa.plan,
      estado: empresa.estado,
      empleados: actuales,
      limiteEmpleados: limite,
      // La clave viaja completa: quien puede verla es quien la va a pegar en
      // el sistema de nómina. Enmascararla aquí solo estorbaría.
      apiKey: empresa.api_key,
    },
  })
}

export async function PATCH(req) {
  const { estado, empresa } = await estadoAcceso('config')
  if (estado !== 'OK') return NextResponse.json({ ok: false, error: estadoAMensaje(estado) }, { status: estadoAHttp(estado) })

  let c
  try { c = await req.json() } catch { return NextResponse.json({ ok: false, error: 'JSON inválido.' }, { status: 400 }) }

  // Regenerar la clave es una acción aparte, no un campo: invalida al instante
  // la integración de nómina que estuviera usando la anterior, y por eso el
  // panel la confirma antes de llamar aquí.
  if (c?.regenerarApiKey === true) {
    const nueva = randomBytes(24).toString('base64url')
    await control(`update control.empresas set api_key = $1 where id = $2`, [nueva, empresa.id])
    olvidarEmpresas()
    return NextResponse.json({ ok: true, apiKey: nueva })
  }

  const sets = []
  const args = []
  if ('nombre' in c) {
    const v = String(c.nombre ?? '').trim()
    if (v.length < 2 || v.length > 80) {
      return NextResponse.json({ ok: false, error: 'El nombre debe tener entre 2 y 80 caracteres.' }, { status: 400 })
    }
    args.push(v); sets.push(`nombre = $${args.length}`)
  }
  if ('nit' in c) {
    const v = String(c.nit ?? '').trim()
    if (v.length > 20) return NextResponse.json({ ok: false, error: 'NIT demasiado largo.' }, { status: 400 })
    args.push(v || null); sets.push(`nit = $${args.length}`)
  }
  if (sets.length === 0) return NextResponse.json({ ok: false, error: 'Nada que cambiar.' }, { status: 400 })

  args.push(empresa.id)
  const { rows } = await control(
    `update control.empresas set ${sets.join(', ')} where id = $${args.length}
     returning nombre, nit`,
    args,
  )
  olvidarEmpresas()
  return NextResponse.json({ ok: true, empresa: rows[0] })
}
