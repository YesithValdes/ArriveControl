/**
 * app/api/horas/resumen/route.js
 * GET — Las horas extra de un período RESUMIDAS POR EMPLEADO: lo mismo que
 *       la tabla de Reportes del panel, para un sistema de nómina o de
 *       gestión que quiera el total por persona sin sumar tramos.
 *
 * Cada empleado trae sus horas por tipo (HED, HEN, HEDDF, HENDF), el total
 * de extra, el valor en pesos (null si no tiene salario registrado), el
 * estado de pago y las referencias de sus tramos — con ellas se anota el
 * pago en POST /api/horas/pagadas. El detalle tramo a tramo está en
 * GET /api/horas con el mismo rango.
 *
 * Entra con X-API-Key (sistema) o con sesión y permiso VER (panel).
 */
import { NextResponse } from 'next/server'
import { construirLote, resumirLote } from '../../../../lib/nomina.js'
import { accesoHoras, fechaValida } from '../../../../lib/accesoHoras.js'

export const runtime = 'nodejs'

export async function GET(req) {
  const { esquema, error } = await accesoHoras(req, 'ver')
  if (error) return error

  const { searchParams } = new URL(req.url)
  const desde = searchParams.get('desde')
  const hasta = searchParams.get('hasta')
  // Aquí el rango es obligatorio: un resumen «de todo el historial» no es
  // un período de pago de nadie.
  if (!(fechaValida(desde) && fechaValida(hasta) && desde <= hasta)) {
    return NextResponse.json({ ok: false, error: 'Se necesitan desde y hasta (YYYY-MM-DD), con desde ≤ hasta.' }, { status: 400 })
  }

  const { empleados, totales } = resumirLote(await construirLote(esquema, { desde, hasta }))
  return NextResponse.json({ ok: true, desde, hasta, totales, empleados })
}
