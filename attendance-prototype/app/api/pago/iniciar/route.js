/**
 * app/api/pago/iniciar/route.js
 *
 * POST — prepara el pago de un plan y devuelve la configuración ya FIRMADA
 *        para abrir el checkout de Bold.
 *
 * Del navegador solo se acepta CUÁL plan y CUÁNTOS meses. El precio lo calcula
 * el servidor con su propio catálogo: si viniera del cliente, cualquiera
 * pediría el plan grande por un dólar. Y la firma se calcula aquí, con la
 * llave secreta que nunca sale del servidor, para que el monto no se pueda
 * alterar en el camino.
 *
 * El pago queda como PENDIENTE. Quien lo confirma es el webhook, nunca el
 * regreso del navegador: el cliente puede cerrar la pestaña justo después de
 * pagar, y el dinero igual entró.
 */
import { NextResponse } from 'next/server'
import { control, conEmpresa } from '../../../../lib/db.js'
import { estadoAcceso, estadoAHttp, estadoAMensaje } from '../../../../lib/sesion'
import { datosDeCheckout, boldActivo } from '../../../../lib/bold.js'
import { planPorId, cotizar, MAX_MESES_ENTRADA } from '../../../../lib/planes.js'
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

  // Que la gente que ya tiene registrada QUEPA en el plan que compra. Sin esta
  // comprobación alguien pagaría el plan pequeño teniendo cincuenta empleados
  // y se encontraría con que no puede agregar a nadie más.
  const empleados = await conEmpresa(empresa.esquema, async (db) =>
    Number((await db.query(`select count(*)::int as n from empleados where activo`)).rows[0].n))
  if (plan.empleados != null && empleados > plan.empleados) {
    return NextResponse.json({
      ok: false,
      error: `Tienes ${empleados} empleados registrados y el plan ${plan.nombre} cubre hasta ${plan.empleados}. Elige uno más amplio.`,
    }, { status: 409 })
  }

  // El precio de entrada es de UNA sola vez. Se comprueba aquí y no solo al
  // pintar la pantalla: ocultar un botón no impide llamar a esta ruta.
  const conEntrada = !(await yaPagoAlgunaVez(empresa.id))
  const { meses, porMes, total } = cotizar(plan, cuerpo?.meses, conEntrada)
  if (conEntrada && meses > MAX_MESES_ENTRADA) {
    return NextResponse.json({ ok: false, error: `El precio de entrada cubre hasta ${MAX_MESES_ENTRADA} meses.` }, { status: 400 })
  }

  const origen = new URL(req.url).origin
  const datos = datosDeCheckout({
    empresaId: empresa.id,
    monto: total,
    // A dónde vuelve la persona tras pagar. Es solo cortesía visual: la
    // activación la hace el webhook.
    urlRetorno: `${origen}/admin/ajustes/plan?pago=listo`,
    descripcion: `Control Registro · plan ${plan.nombre} · ${meses} mes${meses === 1 ? '' : 'es'}`,
  })

  await control(
    `insert into control.pagos (empresa_id, referencia, monto, moneda, proveedor, meses, plan_id, plan_contratado)
     values ($1, $2, $3, $4, 'bold', $5, $6, $7)`,
    [empresa.id, datos.orderId, total, datos.moneda, meses, plan.id, plan.id],
  )

  return NextResponse.json({
    ok: true,
    checkout: datos.checkout,
    orderId: datos.orderId,
    plan: plan.id,
    meses,
    porMes,
    total,
    conEntrada,
    // El panel lo usa para advertir que no se está cobrando de verdad.
    entorno: datos.entorno,
  })
}
