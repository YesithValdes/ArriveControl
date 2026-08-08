/**
 * app/api/horas/route.js
 * GET — Horas con recargo (tramos) calculadas desde las marcaciones de un
 *       rango. Es la SALIDA de ArriveControl: lo que después consumirá una
 *       plataforma de nómina, o lo que se exportará a Excel/PDF.
 *
 * ArriveControl decide QUÉ horas son extra (conoce el turno y la jornada);
 * quien liquide decide cómo se clasifican y pagan. Ver docs del contrato.
 *
 * Nota: este endpoint reemplaza al viejo `enviar-horas`, que además empujaba
 * las horas al gestor. Ese empuje se eliminó: ahora es la nómina la que pide
 * las horas cuando liquida, de modo que corregir una marcación se refleja
 * sola en el siguiente cálculo (sin copias que se desactualicen).
 */
import { NextResponse } from 'next/server'
import { construirLote } from '../../../lib/nomina.js'
import { estadoAcceso } from '../../../lib/sesion'

export const runtime = 'nodejs'

export async function GET(req) {
  const { estado } = await estadoAcceso('VER')
  if (estado !== 'OK') {
    return NextResponse.json({ ok: false, error: 'Sin acceso.' }, { status: estado === 'SIN_SESION' ? 401 : 403 })
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
