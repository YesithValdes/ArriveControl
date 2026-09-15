/**
 * app/api/prueba-reconocimiento/route.js
 *
 * GET — Genera el ENLACE del modo prueba del kiosco para la empresa de la
 *       sesión: `/?prueba=<token>`. Se abre en cualquier celular sin iniciar
 *       sesión, vale 24 h y solo sirve para reconocer (nunca registra).
 *
 * Exige sesión con permiso VER: quien puede ver el panel puede probar el
 * reconocimiento. Ver lib/pruebaReconocimiento.js.
 */
import { NextResponse } from 'next/server'
import { estadoAcceso, estadoAHttp, estadoAMensaje } from '../../../lib/sesion'
import { firmarEnlacePrueba, VIGENCIA_PRUEBA_H } from '../../../lib/pruebaReconocimiento.js'

export const runtime = 'nodejs'

export async function GET() {
  const acceso = await estadoAcceso('ver')
  if (acceso.estado !== 'OK') {
    return NextResponse.json({ ok: false, error: estadoAMensaje(acceso.estado) }, { status: estadoAHttp(acceso.estado) })
  }
  const { token, vence } = firmarEnlacePrueba(acceso.empresa.id)
  return NextResponse.json({ ok: true, url: `/?prueba=${token}`, vence, horas: VIGENCIA_PRUEBA_H })
}
