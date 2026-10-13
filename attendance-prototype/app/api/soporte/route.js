/**
 * app/api/soporte/route.js — La empresa autoriza al soporte (lib/soporte.js).
 *
 * GET  — autorizaciones (vigente e históricas) y la bitácora de accesos.
 * POST — autorizar: { horas: 1..72, motivo }.
 *
 * Solo el DUEÑO (acción 'cuenta'). Funciona aunque la suscripción haya
 * vencido: pedir ayuda o cortarla no puede depender de estar al día.
 */
import { NextResponse } from 'next/server'
import { estadoAcceso, estadoAHttp, estadoAMensaje } from '../../../lib/sesion'
import { autorizarSoporte, autorizacionesDe, accesosDe, HORAS_MAXIMAS } from '../../../lib/soporte.js'

export const runtime = 'nodejs'

const acceso = () => estadoAcceso('cuenta', { ignorarSuscripcion: true })
// Ver el estado (GET): también un Invitado con seguridad:ver.
const accesoLectura = () => estadoAcceso('cuenta', { ignorarSuscripcion: true, permisoInvitado: 'seguridad:ver' })
const negar = (estado) => NextResponse.json({ ok: false, error: estadoAMensaje(estado) }, { status: estadoAHttp(estado) })

export async function GET() {
  const { estado, empresa } = await accesoLectura()
  if (estado !== 'OK') return negar(estado)
  const [autorizaciones, accesos] = await Promise.all([autorizacionesDe(empresa), accesosDe(empresa)])
  return NextResponse.json({ ok: true, horasMaximas: HORAS_MAXIMAS, autorizaciones, accesos })
}

export async function POST(req) {
  const { estado, empresa, usuario } = await acceso()
  if (estado !== 'OK') return negar(estado)
  let c
  try { c = await req.json() } catch { return NextResponse.json({ ok: false, error: 'JSON inválido.' }, { status: 400 }) }
  const r = await autorizarSoporte({ empresa, usuario, horas: c?.horas, motivo: c?.motivo })
  if (r.error) return NextResponse.json({ ok: false, error: r.error }, { status: 400 })
  return NextResponse.json({ ok: true, autorizacion: r.autorizacion })
}
