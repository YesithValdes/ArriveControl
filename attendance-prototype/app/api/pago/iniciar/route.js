/**
 * app/api/pago/iniciar/route.js
 *
 * POST — prepara un pago de la suscripción y devuelve los datos ya FIRMADOS
 *        para abrir el checkout de Wompi.
 *
 * La firma se calcula aquí y no en el navegador por una razón concreta: es lo
 * que impide que alguien edite el monto en la URL y pague mil pesos por un
 * plan de cien mil. El secreto de integridad nunca sale del servidor.
 *
 * El pago queda registrado como PENDIENTE. Quien lo confirma es el webhook,
 * nunca el regreso del navegador: el cliente puede cerrar la pestaña justo
 * después de pagar, y el dinero igual entró.
 */
import { NextResponse } from 'next/server'
import { control } from '../../../../lib/db.js'
import { estadoAcceso, estadoAHttp, estadoAMensaje } from '../../../../lib/sesion'
import { datosDeCheckout, wompiActivo } from '../../../../lib/wompi.js'

export const runtime = 'nodejs'

export async function POST(req) {
  // `config` y no `ver`: contratar el plan es una decisión de quien administra
  // la empresa, no de cualquiera que pueda consultar.
  const { estado, empresa, usuario } = await estadoAcceso('config')
  if (estado !== 'OK') {
    return NextResponse.json({ ok: false, error: estadoAMensaje(estado) }, { status: estadoAHttp(estado) })
  }
  if (!wompiActivo()) {
    return NextResponse.json(
      { ok: false, error: 'Los pagos en línea todavía no están habilitados. Escríbenos y activamos tu plan.' },
      { status: 503 },
    )
  }

  const origen = new URL(req.url).origin
  const datos = datosDeCheckout({
    empresaId: empresa.id,
    correo: usuario?.email ?? null,
    // A dónde vuelve la persona tras pagar. Es solo cortesía visual: la
    // activación la hace el webhook.
    urlRetorno: `${origen}/admin/ajustes/empresa?pago=listo`,
  })

  await control(
    `insert into control.pagos (empresa_id, referencia, monto_centavos, moneda, proveedor)
     values ($1, $2, $3, $4, 'wompi')`,
    [empresa.id, datos.referencia, datos.montoCentavos, 'COP'],
  )

  return NextResponse.json({
    ok: true,
    checkout: { url: datos.url, campos: datos.campos },
    referencia: datos.referencia,
    montoCentavos: datos.montoCentavos,
    entorno: datos.entorno,
  })
}
