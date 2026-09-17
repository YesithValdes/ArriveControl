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
import { accesoHoras, rangoPedido } from '../../../lib/accesoHoras.js'

export const runtime = 'nodejs'

export async function GET(req) {
  const { esquema, error } = await accesoHoras(req, 'ver')
  if (error) return error

  // Por período de pago (mes + quincena) o por desde/hasta; sin nada, todo.
  const rango = rangoPedido(new URL(req.url).searchParams)
  if (rango?.error) return NextResponse.json({ ok: false, error: rango.error }, { status: 400 })

  const { registros, porEmpleado } = await construirLote(esquema, rango)

  // Los campos internos (_empleadoId, _semana) no salen de aquí; el nombre
  // sí, para que quien reciba el lote no tenga que cruzar la cédula.
  return NextResponse.json({
    ok: true,
    desde: rango?.desde ?? null,
    hasta: rango?.hasta ?? null,
    total: registros.length,
    registros: registros.map(({ _empleadoId, _semana, ...r }) => ({
      ...r,
      nombre: porEmpleado.get(_empleadoId)?.nombre ?? null,
      sede: porEmpleado.get(_empleadoId)?.sede ?? null,
    })),
  })
}
