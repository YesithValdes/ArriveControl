/**
 * app/api/foto-gestor/route.js
 * POST — sube la captura del registro como foto de perfil del colaborador en
 * el GESTOR, cuando allá no tiene. Es un relevo servidor→servidor: la clave de
 * integración (X-API-Key) no puede viajar al navegador, así que este endpoint
 * exige la sesión del admin (permiso CREAR, el mismo del alta) y reenvía al
 * gestor con la clave que vive solo en el entorno.
 *
 * Fire-and-soft: si el gestor rechaza (ya tenía foto, colaborador retirado…)
 * se devuelve el motivo, pero el registro del empleado ya quedó — la foto es
 * un extra, nunca bloquea el alta.
 */
import { NextResponse } from 'next/server'
import { estadoAcceso } from '../../../lib/sesion'

export const runtime = 'nodejs'

export async function POST(req) {
  const { estado } = await estadoAcceso('empleados')
  if (estado !== 'OK') {
    return NextResponse.json({ ok: false, error: 'Sin permiso.' }, { status: estado === 'SIN_SESION' ? 401 : 403 })
  }

  let c
  try { c = await req.json() } catch { return NextResponse.json({ ok: false, error: 'JSON inválido.' }, { status: 400 }) }
  const colaboradorId = String(c?.colaborador_id ?? '').trim()
  const imagen = String(c?.imagen ?? '')
  if (!colaboradorId || !imagen.startsWith('data:image/')) {
    return NextResponse.json({ ok: false, error: 'Faltan colaborador_id o imagen (data URL).' }, { status: 400 })
  }

  const url = `${process.env.GESTOR_URL || 'http://localhost:3000'}/api/integraciones/foto-colaborador`
  let respuesta
  try {
    respuesta = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': process.env.INTEGRACION_HORAS_API_KEY ?? '',
      },
      body: JSON.stringify({ colaboradorId, imagen, consentimiento: true }),
    })
  } catch (e) {
    return NextResponse.json({ ok: false, error: `No se pudo contactar al gestor: ${String(e)}` }, { status: 502 })
  }
  const datos = await respuesta.json().catch(() => ({ ok: false, error: `El gestor respondió ${respuesta.status}.` }))
  return NextResponse.json(datos, { status: respuesta.ok ? 200 : respuesta.status })
}
