/**
 * app/api/pago/iniciar/route.js
 *
 * POST — prepara el pago de un paquete y devuelve la configuración ya FIRMADA
 *        para abrir el checkout de Bold.
 *
 * Del navegador solo se acepta CUÁL paquete quiere. El precio y los meses
 * salen del catálogo del servidor: si vinieran del cliente, cualquiera pediría
 * tres meses por un dólar. Y la firma se calcula aquí, con la llave secreta
 * que nunca sale del servidor, para que el monto no se pueda alterar en el
 * camino.
 *
 * El pago queda como PENDIENTE. Quien lo confirma es el webhook, nunca el
 * regreso del navegador: el cliente puede cerrar la pestaña justo después de
 * pagar, y el dinero igual entró.
 */
import { NextResponse } from 'next/server'
import { control } from '../../../../lib/db.js'
import { estadoAcceso, estadoAHttp, estadoAMensaje } from '../../../../lib/sesion'
import { datosDeCheckout, boldActivo } from '../../../../lib/bold.js'
import { planPorId } from '../../../../lib/planes.js'
import { yaPagoAlgunaVez } from '../planes/route.js'

export const runtime = 'nodejs'

export async function POST(req) {
  // `config` y no `ver`: contratar es una decisión de quien administra la
  // empresa, no de cualquiera que pueda consultar.
  const { estado, empresa } = await estadoAcceso('config')
  if (estado !== 'OK') {
    return NextResponse.json({ ok: false, error: estadoAMensaje(estado) }, { status: estadoAHttp(estado) })
  }
  if (!boldActivo()) {
    return NextResponse.json(
      { ok: false, error: 'Los pagos en línea todavía no están habilitados. Escríbenos y activamos tu plan.' },
      { status: 503 },
    )
  }

  let cuerpo
  try { cuerpo = await req.json() } catch { cuerpo = {} }
  const plan = planPorId(cuerpo?.plan)
  if (!plan) {
    return NextResponse.json({ ok: false, error: 'Ese plan no existe.' }, { status: 400 })
  }

  // La oferta de entrada es de UNA sola vez. Se comprueba aquí y no solo al
  // pintar la pantalla: ocultar un botón no impide que alguien llame a esta
  // ruta con el identificador del paquete barato.
  if (plan.oferta && await yaPagoAlgunaVez(empresa.id)) {
    return NextResponse.json(
      { ok: false, error: 'El precio de entrada es por una sola vez y ya lo usaste. Elige la renovación mensual.' },
      { status: 409 },
    )
  }

  const origen = new URL(req.url).origin
  const datos = datosDeCheckout({
    empresaId: empresa.id,
    monto: plan.precio,
    // A dónde vuelve la persona tras pagar. Es solo cortesía visual: la
    // activación la hace el webhook.
    urlRetorno: `${origen}/admin/ajustes/empresa?pago=listo`,
    descripcion: `Control Registro · ${plan.etiqueta} · ${empresa.nombre}`,
  })

  await control(
    `insert into control.pagos (empresa_id, referencia, monto, moneda, proveedor, meses, plan_id)
     values ($1, $2, $3, $4, 'bold', $5, $6)`,
    [empresa.id, datos.orderId, plan.precio, datos.moneda, plan.meses, cuerpo.plan],
  )

  return NextResponse.json({
    ok: true,
    checkout: datos.checkout,
    orderId: datos.orderId,
    monto: plan.precio,
    meses: plan.meses,
    // El panel lo usa para advertir que no se está cobrando de verdad.
    entorno: datos.entorno,
  })
}
