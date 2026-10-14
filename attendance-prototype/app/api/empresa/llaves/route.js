/**
 * app/api/empresa/llaves/route.js — La llave de cifrado de la empresa, vista
 * por su dueño (lib/llaves.js).
 *
 * GET  — estado: si el cifrado está configurado, si la empresa tiene DEK y si
 *        ya generó su llave de recuperación (nunca la llave en sí).
 * POST — { accion: 'generar' }                 primera llave de recuperación
 *        { accion: 'reemplazar' }              una nueva; la anterior deja de servir
 *        { accion: 'verificar', llave: '…' }   ¿es esta la que tengo guardada?
 *
 * La llave de recuperación sale del servidor UNA sola vez, en la respuesta de
 * 'generar' o 'reemplazar'. Aquí solo queda la DEK envuelta y una huella.
 *
 * Solo el DUEÑO (acción 'cuenta'), con o sin suscripción vigente.
 */
import { NextResponse } from 'next/server'
import { estadoAcceso, estadoAHttp, estadoAMensaje } from '../../../../lib/sesion'
import { estadoLlaves, generarRecuperacion, verificarRecuperacion } from '../../../../lib/llaves.js'

export const runtime = 'nodejs'

// La respuesta lleva un secreto: que nada en el camino la guarde.
const SIN_CACHE = { 'Cache-Control': 'no-store' }
const acceso = () => estadoAcceso('cuenta', { ignorarSuscripcion: true })
// Ver el estado (GET): también un Invitado con seguridad:ver.
const accesoLectura = () => estadoAcceso('cuenta', { ignorarSuscripcion: true, permisoInvitado: 'seguridad:ver' })
const negar = (estado) => NextResponse.json({ ok: false, error: estadoAMensaje(estado) }, { status: estadoAHttp(estado) })

export async function GET() {
  const { estado, empresa } = await accesoLectura()
  if (estado !== 'OK') return negar(estado)
  return NextResponse.json({ ok: true, ...(await estadoLlaves(empresa)) }, { headers: SIN_CACHE })
}

export async function POST(req) {
  const { estado, empresa, usuario } = await acceso()
  if (estado !== 'OK') return negar(estado)
  let c
  try { c = await req.json() } catch { return NextResponse.json({ ok: false, error: 'JSON inválido.' }, { status: 400 }) }

  try {
    if (c?.accion === 'generar' || c?.accion === 'reemplazar') {
      const r = await generarRecuperacion(empresa, {
        creadaPor: usuario.email ?? usuario.id,
        reemplazar: c.accion === 'reemplazar',
      })
      if (r.error === 'YA_EXISTE') {
        return NextResponse.json(
          { ok: false, error: 'La empresa ya tiene llave de recuperación. Para cambiarla, reemplázala.' },
          { status: 409 },
        )
      }
      return NextResponse.json({ ok: true, llave: r.texto }, { headers: SIN_CACHE })
    }
    if (c?.accion === 'verificar') {
      return NextResponse.json({ ok: true, coincide: await verificarRecuperacion(empresa, c.llave) }, { headers: SIN_CACHE })
    }
  } catch (e) {
    // Lo normal aquí es el servidor sin ARRIVE_LLAVE_MAESTRA: se dice tal cual,
    // es un problema de la plataforma y no de la empresa.
    console.error('Llaves de empresa:', e.message)
    return NextResponse.json({ ok: false, error: 'El cifrado no está disponible en este momento. Avísanos.' }, { status: 503 })
  }
  return NextResponse.json({ ok: false, error: 'Acción desconocida.' }, { status: 400 })
}
