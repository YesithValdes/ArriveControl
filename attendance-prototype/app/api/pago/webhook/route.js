/**
 * app/api/pago/webhook/route.js
 *
 * POST — recibe los eventos de Bold. Es la ÚNICA vía por la que se activa un
 *        plan de pago: el regreso del navegador no sirve como prueba (la
 *        persona puede cerrar la pestaña, o falsificar la vuelta).
 *
 * Cuatro reglas que no se pueden relajar:
 *
 *  1. VERIFICAR LA FIRMA sobre el cuerpo CRUDO. Sin ella, cualquiera se activa
 *     el plan con un curl.
 *  2. RESPONDER RÁPIDO. Bold espera un 200 en menos de 2 segundos y reintenta
 *     hasta 5 veces en 24 horas; por eso el trabajo se hace antes de cualquier
 *     cosa lenta y nunca se llama a servicios externos aquí.
 *  3. RESPONDER 200 aunque el evento no nos sirva: reintentarlo no cambiaría
 *     nada. El 500 se reserva para fallos nuestros, donde el reintento ayuda.
 *  4. SER IDEMPOTENTE. Como los reintentos existen, el mismo pago llega varias
 *     veces; quien lo impide es el estado PENDIENTE junto con la restricción
 *     única sobre la transacción, no un `if` suelto.
 *
 * No exige sesión, y así tiene que ser: quien llama es la pasarela.
 */
import { NextResponse } from 'next/server'
import { control } from '../../../../lib/db.js'
import { eventoAutentico, configBold } from '../../../../lib/bold.js'
import { olvidarEmpresas } from '../../../../lib/empresas.js'

export const runtime = 'nodejs'

/** Un pago aprobado cubre un mes desde hoy, o desde el vencimiento vigente si
 *  la empresa renueva antes de tiempo (no se le regalan días ni se le quitan). */
const DIAS_CUBIERTOS = 30

export async function POST(req) {
  const cfg = configBold()

  // El cuerpo CRUDO, no el objeto: la firma se calcula sobre el texto exacto
  // que llegó, y volver a serializar el JSON cambiaría espacios u orden de
  // claves y haría fallar eventos legítimos.
  const cuerpoCrudo = await req.text()
  const firma = req.headers.get('x-bold-signature')

  if (!cfg || typeof cfg.secretoWebhook !== 'string' || !eventoAutentico(cuerpoCrudo, firma, cfg.secretoWebhook)) {
    // 401 a propósito: es el único caso donde NO conviene que reintente en
    // silencio, porque significa que algo está mal configurado o que alguien
    // está intentando activarse un plan por su cuenta.
    console.error('Pago: evento con firma inválida, descartado.')
    return NextResponse.json({ ok: false, error: 'Firma inválida.' }, { status: 401 })
  }

  let evento
  try {
    evento = JSON.parse(cuerpoCrudo)
  } catch {
    return NextResponse.json({ ok: true, ignorado: 'cuerpo ilegible' })
  }

  // Formato CloudEvents: el tipo va arriba y los datos de la venta en `data`.
  const tipo = evento?.type
  const datos = evento?.data ?? {}
  // La referencia que enviamos como orderId vuelve aquí. Bold la nombra de
  // varias formas según el canal, así que se aceptan las conocidas.
  const referencia = datos.metadata?.reference ?? datos.reference ?? datos.external_reference ?? datos.order_id
  const transaccion = datos.payment_id ?? evento?.subject ?? null

  if (!['SALE_APPROVED', 'SALE_REJECTED', 'VOID_APPROVED', 'VOID_REJECTED'].includes(tipo)) {
    return NextResponse.json({ ok: true, ignorado: tipo ?? 'sin tipo' })
  }
  if (!referencia) return NextResponse.json({ ok: true, ignorado: 'sin referencia' })

  try {
    const { rows } = await control(
      `select p.id, p.empresa_id, p.estado, e.vence_en
         from control.pagos p join control.empresas e on e.id = p.empresa_id
        where p.referencia = $1`,
      [referencia],
    )
    // Referencia que no generamos nosotros (otra integración, o una prueba
    // manual). Se acepta el evento para que no lo reintente eternamente.
    if (rows.length === 0) return NextResponse.json({ ok: true, ignorado: 'referencia desconocida' })

    const pago = rows[0]
    // Ya resuelto: es un reintento de Bold. Se responde 200 sin volver a
    // extender la suscripción — este es el corazón de la idempotencia.
    if (pago.estado !== 'PENDIENTE') {
      return NextResponse.json({ ok: true, repetido: true })
    }

    if (tipo !== 'SALE_APPROVED') {
      await control(
        `update control.pagos set estado = $2, transaccion = $3, evento = $4, resuelto_en = now()
          where id = $1`,
        [pago.id, tipo, transaccion, cuerpoCrudo],
      )
      return NextResponse.json({ ok: true, estado: tipo })
    }

    // Aprobado: se extiende desde el vencimiento vigente si aún no ha pasado
    // (renovar antes no debe costar días), o desde hoy si ya venció.
    const base = pago.vence_en && new Date(pago.vence_en) > new Date() ? new Date(pago.vence_en) : new Date()
    const hasta = new Date(base.getTime() + DIAS_CUBIERTOS * 86400000)

    await control(
      `update control.pagos
          set estado = 'APROBADA', transaccion = $2, evento = $3, cubre_hasta = $4, resuelto_en = now()
        where id = $1`,
      [pago.id, transaccion, cuerpoCrudo, hasta.toISOString()],
    )
    await control(
      `update control.empresas
          set plan = 'pago', estado = 'activa', limite_empleados = null,
              vence_en = $2, pago_proveedor = 'bold', pago_referencia = $3
        where id = $1`,
      [pago.empresa_id, hasta.toISOString(), referencia],
    )
    // La empresa se cachea 60 s por petición; sin esto el panel seguiría
    // mostrando el plan viejo hasta que expire el caché.
    olvidarEmpresas()

    console.log(`Pago aprobado: empresa ${pago.empresa_id} cubierta hasta ${hasta.toISOString()}`)
    return NextResponse.json({ ok: true, cubreHasta: hasta.toISOString() })
  } catch (e) {
    // Un fallo NUESTRO sí merece reintento: se responde 500 para que Bold
    // vuelva a intentarlo dentro de su ventana de 24 horas.
    console.error('Pago: no se pudo procesar el evento:', e?.message || e)
    return NextResponse.json({ ok: false }, { status: 500 })
  }
}
