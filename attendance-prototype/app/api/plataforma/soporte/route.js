/**
 * app/api/plataforma/soporte/route.js — El superadmin y el acceso de soporte.
 *
 * GET    — autorizaciones VIGENTES en toda la plataforma (de qué empresa, por
 *          qué, hasta cuándo) y en cuál está dentro ahora, si alguna.
 * POST   — entrar a una: { autorizacionId }. Deja la cookie y anota 'entrar'.
 * DELETE — salir: borra la cookie y anota 'salir'.
 *
 * Entrar no da nada por sí solo: cada petición dentro de la empresa vuelve a
 * comprobar en la base que la autorización siga vigente (lib/sesion.js).
 */
import { NextResponse } from 'next/server'
import { cookies, headers } from 'next/headers'
import { soloSuperadmin } from '../../../../lib/guardaPlataforma.js'
import {
  COOKIE_SOPORTE, autorizacionesVigentes, autorizacionVigente, registrarAcceso,
} from '../../../../lib/soporte.js'

export const runtime = 'nodejs'

async function datosDePeticion() {
  const h = await headers()
  return {
    metodo: h.get('x-arrive-metodo'),
    ruta: h.get('x-arrive-ruta'),
    ip: h.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null,
    userAgent: h.get('user-agent'),
  }
}

export async function GET() {
  const { error } = await soloSuperadmin()
  if (error) return error
  const actual = (await cookies()).get(COOKIE_SOPORTE)?.value ?? null
  const vigentes = await autorizacionesVigentes()
  return NextResponse.json({
    ok: true,
    vigentes,
    dentroDe: vigentes.some((a) => a.id === actual) ? actual : null,
  })
}

export async function POST(req) {
  const { usuario, error } = await soloSuperadmin()
  if (error) return error
  let c
  try { c = await req.json() } catch { return NextResponse.json({ ok: false, error: 'JSON inválido.' }, { status: 400 }) }

  const autorizacion = await autorizacionVigente(c?.autorizacionId)
  if (!autorizacion) {
    return NextResponse.json({ ok: false, error: 'Esa autorización no existe, venció o fue revocada.' }, { status: 404 })
  }
  await registrarAcceso({ autorizacion, usuario, accion: 'entrar', ...(await datosDePeticion()) })

  const res = NextResponse.json({ ok: true, destino: '/admin', hasta: autorizacion.hasta })
  res.cookies.set(COOKIE_SOPORTE, autorizacion.id, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    path: '/',
    // Nunca más allá de la autorización. Aunque durara más, no serviría: la
    // vigencia se comprueba en la base en cada petición.
    expires: new Date(autorizacion.hasta),
  })
  return res
}

export async function DELETE() {
  const { usuario, error } = await soloSuperadmin()
  if (error) return error
  const id = (await cookies()).get(COOKIE_SOPORTE)?.value
  const autorizacion = id ? await autorizacionVigente(id) : null
  if (autorizacion) {
    await registrarAcceso({ autorizacion, usuario, accion: 'salir', ...(await datosDePeticion()) })
  }
  const res = NextResponse.json({ ok: true, destino: '/plataforma' })
  res.cookies.delete(COOKIE_SOPORTE)
  return res
}
