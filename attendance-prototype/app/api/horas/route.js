/**
 * app/api/horas/route.js
 * GET — Horas con recargo (tramos) calculadas desde las marcaciones de un
 *       rango. Es la SALIDA de ArriveControl: lo que consume una plataforma
 *       de nómina, o lo que se exporta a Excel/PDF.
 *
 * ArriveControl decide QUÉ horas son extra (conoce el turno y la jornada);
 * quien liquide decide cómo se clasifican y pagan. Ver docs del contrato.
 *
 * Dos formas de entrar (una basta):
 *  a) Clave de API (X-API-Key): para que un sistema de nómina externo
 *     la consuma servidor-a-servidor, sin sesión de navegador.
 *  b) Sesión con permiso VER: para el panel de administración.
 */
import { NextResponse } from 'next/server'
import { construirLote } from '../../../lib/nomina.js'
import { estadoAcceso, estadoAHttp, estadoAMensaje } from '../../../lib/sesion'
import { empresaPorApiKey } from '../../../lib/empresas.js'

export const runtime = 'nodejs'

export async function GET(req) {
  const enviada = req.headers.get('x-api-key')
  let esquema = null

  if (enviada) {
    // Cada empresa tiene su PROPIA clave, guardada en control.empresas. Antes
    // era una sola variable de entorno para toda la instalación, que con
    // varios clientes entregaría las horas de cualquiera a cualquiera.
    // Se responde 401 sin mirar la sesión: es un sistema, no una persona.
    const empresa = await empresaPorApiKey(enviada)
    if (!empresa) {
      return NextResponse.json({ ok: false, error: 'Clave de API inválida.' }, { status: 401 })
    }
    esquema = empresa.esquema
  } else {
    const acceso = await estadoAcceso('ver')
    if (acceso.estado !== 'OK') {
      return NextResponse.json({ ok: false, error: estadoAMensaje(acceso.estado) }, { status: estadoAHttp(acceso.estado) })
    }
    esquema = acceso.esquema
  }

  const { searchParams } = new URL(req.url)
  const desde = searchParams.get('desde')
  const hasta = searchParams.get('hasta')
  const rango = desde && hasta ? { desde, hasta } : null

  const { registros } = await construirLote(esquema, rango)

  // Los campos internos (_empleadoId, _semana) no salen de aquí.
  return NextResponse.json({
    ok: true,
    total: registros.length,
    registros: registros.map(({ _empleadoId, _semana, ...r }) => r),
  })
}
