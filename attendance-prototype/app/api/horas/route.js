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
 *  a) Clave de API (X-API-Key): para que otro sistema (el gestor de nómina)
 *     la consuma servidor-a-servidor, sin sesión de navegador.
 *  b) Sesión con permiso VER: para el panel de administración.
 */
import { NextResponse } from 'next/server'
import { construirLote } from '../../../lib/nomina.js'
import { estadoAcceso } from '../../../lib/sesion'

export const runtime = 'nodejs'

/** Clave propia de ArriveControl; cae a la compartida heredada si no está. */
const claveEsperada = () =>
  process.env.ARRIVECONTROL_API_KEY || process.env.INTEGRACION_HORAS_API_KEY || ''

export async function GET(req) {
  const clave = claveEsperada()
  const enviada = req.headers.get('x-api-key')
  const conClave = Boolean(clave) && enviada === clave

  if (!conClave) {
    // Sin clave válida se exige sesión del panel. Si venía una clave y no
    // coincide, se responde 401 sin mirar la sesión: es un sistema, no una
    // persona, y merece un error claro.
    if (enviada) {
      return NextResponse.json({ ok: false, error: 'Clave de API inválida.' }, { status: 401 })
    }
    const { estado } = await estadoAcceso('VER')
    if (estado !== 'OK') {
      return NextResponse.json({ ok: false, error: 'Sin acceso.' }, { status: estado === 'SIN_SESION' ? 401 : 403 })
    }
  }

  const { searchParams } = new URL(req.url)
  const desde = searchParams.get('desde')
  const hasta = searchParams.get('hasta')
  const rango = desde && hasta ? { desde, hasta } : null

  const { registros } = await construirLote(rango)

  // Los campos internos (_empleadoId, _semana) no salen de aquí.
  return NextResponse.json({
    ok: true,
    total: registros.length,
    registros: registros.map(({ _empleadoId, _semana, ...r }) => r),
  })
}
