/**
 * app/api/pago/iniciar/route.js
 *
 * POST — prepara un pago de la suscripción y devuelve la configuración ya
 *        FIRMADA para abrir el checkout de Bold en el navegador.
 *
 * La firma se calcula aquí y no en el navegador por una razón concreta: es lo
 * que impide que alguien edite el monto antes de pagar. La llave secreta nunca
 * sale del servidor — la propia documentación de Bold lo recomienda así.
 *
 * El pago queda registrado como PENDIENTE. Quien lo confirma es el webhook,
 * nunca el regreso del navegador: el cliente puede cerrar la pestaña justo
 * después de pagar, y el dinero igual entró.
 */
import { NextResponse } from 'next/server'
import { control } from '../../../../lib/db.js'
import { estadoAcceso, estadoAHttp, estadoAMensaje } from '../../../../lib/sesion'
import { datosDeCheckout, boldActivo } from '../../../../lib/bold.js'

export const runtime = 'nodejs'

export async function POST(req) {
  // `config` y no `ver`: contratar el plan es una decisión de quien administra
  // la empresa, no de cualquiera que pueda consultar.
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

  const origen = new URL(req.url).origin
  const datos = datosDeCheckout({
    empresaId: empresa.id,
    // A dónde vuelve la persona tras pagar. Es solo cortesía visual: la
    // activación la hace el webhook.
    urlRetorno: `${origen}/admin/ajustes/empresa?pago=listo`,
    descripcion: `Plan Empresa · ${empresa.nombre}`,
  })

  await control(
    `insert into control.pagos (empresa_id, referencia, monto_centavos, moneda, proveedor)
     values ($1, $2, $3, $4, 'bold')`,
    [empresa.id, datos.orderId, datos.montoCentavos, 'COP'],
  )

  return NextResponse.json({
    ok: true,
    checkout: datos.checkout,
    orderId: datos.orderId,
    montoCentavos: datos.montoCentavos,
    entorno: datos.entorno,
  })
}
