/**
 * app/api/resumen-diario/route.js
 * GET — el resumen del día de cada colaborador: lo MISMO que va en el correo
 *       de cada noche (marcaciones, horas trabajadas, novedades), para que el
 *       sistema de la empresa lo consulte en vez de recibirlo.
 *
 *   ?fecha=AAAA-MM-DD   el día (por defecto, hoy en Bogotá)
 *   ?documento=…        solo esa cédula
 *
 * Entra con la clave de API (X-API-Key) o con sesión que pueda VER. La
 * empresa puede apagarlo en Ajustes → Reglamento → Resumen diario.
 */
import { NextResponse } from 'next/server'
import { accesoHoras } from '../../../lib/accesoHoras.js'
import { fechaValida } from '../../../lib/periodoHoras.js'
import { destinoResumen, resumenesDeEmpresa, hoyEnBogota } from '../../../lib/enviosDiarios.js'
import { formatearResumen } from '../../../lib/resumenDiario.js'

export const runtime = 'nodejs'

export async function GET(req) {
  const { esquema, error } = await accesoHoras(req, 'ver')
  if (error) return error

  const q = new URL(req.url).searchParams
  const fecha = q.get('fecha') || hoyEnBogota()
  if (!fechaValida(fecha)) return NextResponse.json({ ok: false, error: 'fecha debe venir como AAAA-MM-DD.' }, { status: 400 })
  const documento = (q.get('documento') || '').trim()

  if (!(await destinoResumen(esquema)).api) {
    return NextResponse.json({
      ok: false,
      error: 'La empresa tiene apagada la consulta del resumen diario por API (Ajustes → Reglamento → Resumen diario).',
    }, { status: 403 })
  }

  const resumenes = (await resumenesDeEmpresa(esquema, fecha))
    .filter((r) => r.resumen && (!documento || String(r.empleado.cedula ?? '') === documento))
    .map(formatearResumen)

  return NextResponse.json({ ok: true, fecha, total: resumenes.length, resumenes })
}
