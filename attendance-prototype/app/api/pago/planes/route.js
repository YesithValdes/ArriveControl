/**
 * app/api/pago/planes/route.js
 *
 * GET — el catálogo tal como le corresponde a ESTA empresa: los planes con sus
 *       precios en dólares Y en pesos (TRM del día), cuál le queda corto
 *       según su gente, si todavía le toca el precio de entrada y cómo va su
 *       suscripción.
 *
 * El catálogo sale del servidor, nunca del navegador: la pantalla solo pinta
 * lo que aquí se le diga. Y la oferta de entrada se ofrece únicamente a quien
 * nunca ha pagado — se sabe mirando su historial, no una bandera que alguien
 * podría olvidar de actualizar.
 */
import { NextResponse } from 'next/server'
import { conEmpresa } from '../../../../lib/db.js'
import { estadoAcceso, estadoAHttp, estadoAMensaje } from '../../../../lib/sesion'
import { catalogoPara } from '../../../../lib/planes.js'
import { mpActivo, configMp } from '../../../../lib/mercadopago.js'
import { yaPagoAlgunaVez, preciosEnPesos, suscripcionDe } from '../../../../lib/suscripciones.js'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET() {
  const { estado, empresa } = await estadoAcceso('ver')
  if (estado !== 'OK') {
    return NextResponse.json({ ok: false, error: estadoAMensaje(estado) }, { status: estadoAHttp(estado) })
  }

  const [yaPago, empleados, suscripcion] = await Promise.all([
    yaPagoAlgunaVez(empresa.id),
    conEmpresa(empresa.esquema, async (db) =>
      Number((await db.query(`select count(*)::int as n from empleados where activo`)).rows[0].n)),
    suscripcionDe(empresa.id),
  ])
  const catalogo = catalogoPara({ yaPago, empleados })
  // Sin TRM no se puede mostrar el precio en pesos, pero el catálogo en
  // dólares sí: la pantalla lo dice en vez de romperse.
  const pesos = await preciosEnPesos(catalogo.planes, { conEntrada: catalogo.conEntrada }).catch(() => null)

  return NextResponse.json({
    ok: true,
    ...catalogo,
    pesos,
    empleados,
    planActual: empresa.plan_id ?? null,
    suscripcion: suscripcion && {
      estado: suscripcion.estado,
      plan: suscripcion.plan_id,
      montoCop: suscripcion.monto_cop,
      usdMensual: suscripcion.usd_mensual,
      entradaPendiente: suscripcion.entrada_pendiente,
      proximoCobro: suscripcion.proximo_cobro,
      email: suscripcion.payer_email,
    },
    // Sin llaves configuradas no hay dónde pagar; el panel lo dice en vez de
    // ofrecer botones que terminarían en un error.
    disponible: mpActivo() && pesos !== null,
    entorno: configMp()?.entorno ?? null,
  })
}
