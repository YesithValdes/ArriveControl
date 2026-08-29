/**
 * app/api/pago/planes/route.js
 *
 * GET — el catálogo tal como le corresponde a ESTA empresa: los planes con sus
 *       precios, cuál le queda corto según su gente, y si todavía le toca el
 *       precio de entrada.
 *
 * El catálogo sale del servidor, nunca del navegador: la pantalla solo pinta
 * lo que aquí se le diga. Y la oferta de entrada se ofrece únicamente a quien
 * nunca ha pagado — se sabe mirando su historial, no una bandera que alguien
 * podría olvidar de actualizar.
 */
import { NextResponse } from 'next/server'
import { control, conEmpresa } from '../../../../lib/db.js'
import { estadoAcceso, estadoAHttp, estadoAMensaje } from '../../../../lib/sesion'
import { catalogoPara } from '../../../../lib/planes.js'
import { boldActivo } from '../../../../lib/bold.js'

export const runtime = 'nodejs'

/** ¿Esta empresa ya pagó alguna vez? Decide si le corresponde la oferta. */
export async function yaPagoAlgunaVez(empresaId) {
  const { rows } = await control(
    `select 1 from control.pagos where empresa_id = $1 and estado = 'APROBADA' limit 1`,
    [empresaId],
  )
  return rows.length > 0
}

export async function GET() {
  const { estado, empresa } = await estadoAcceso('ver')
  if (estado !== 'OK') {
    return NextResponse.json({ ok: false, error: estadoAMensaje(estado) }, { status: estadoAHttp(estado) })
  }

  const [yaPago, empleados] = await Promise.all([
    yaPagoAlgunaVez(empresa.id),
    conEmpresa(empresa.esquema, async (db) =>
      Number((await db.query(`select count(*)::int as n from empleados where activo`)).rows[0].n)),
  ])

  return NextResponse.json({
    ok: true,
    ...catalogoPara({ yaPago, empleados }),
    empleados,
    planActual: empresa.plan_id ?? null,
    // Sin llaves configuradas no hay dónde pagar; el panel lo dice en vez de
    // ofrecer botones que terminarían en un error.
    disponible: boldActivo(),
  })
}
