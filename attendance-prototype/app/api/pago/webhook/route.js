/**
 * app/api/pago/webhook/route.js
 *
 * POST — recibe los eventos de Wompi. Es la ÚNICA vía por la que se activa un
 *        plan de pago: el regreso del navegador no sirve como prueba (la
 *        persona puede cerrar la pestaña, o falsificar la vuelta).
 *
 * Tres reglas que no se pueden relajar:
 *
 *  1. VERIFICAR LA FIRMA. Sin ella, cualquiera se activa el plan con un curl.
 *  2. RESPONDER 200 aunque el evento no nos sirva. Wompi reintenta hasta tres
 *     veces en 24 horas ante cualquier otra respuesta, y un evento que nunca
 *     vamos a poder procesar se reintentaría en vano.
 *  3. SER IDEMPOTENTE. Como los reintentos existen, el mismo pago puede
 *     llegar varias veces; quien lo impide es la restricción única sobre la
 *     transacción, no una comprobación en el código.
 *
 * No exige sesión, y así tiene que ser: quien llama es la pasarela.
 */
import { NextResponse } from 'next/server'
import { control } from '../../../../lib/db.js'
import { eventoAutentico, configWompi } from '../../../../lib/wompi.js'
import { olvidarEmpresas } from '../../../../lib/empresas.js'

export const runtime = 'nodejs'

/** Un pago aprobado cubre un mes desde hoy, o desde el vencimiento vigente
 *  si la empresa renueva antes de tiempo (no se le regalan días ni se le
 *  quitan). */
const DIAS_CUBIERTOS = 30

export async function POST(req) {
  const cfg = configWompi()
  let evento
  try {
    evento = await req.json()
  } catch {
    return NextResponse.json({ ok: true, ignorado: 'cuerpo ilegible' })
  }

  if (!cfg?.secretoEventos || !eventoAutentico(evento, cfg.secretoEventos)) {
    // 401 a propósito: es el único caso donde NO queremos que reintente en
    // silencio, porque significa que algo está mal configurado o alguien está
    // intentando activarse un plan por su cuenta.
    console.error('Pago: evento con firma inválida, descartado.')
    return NextResponse.json({ ok: false, error: 'Firma inválida.' }, { status: 401 })
  }

  if (evento.event !== 'transaction.updated') {
    return NextResponse.json({ ok: true, ignorado: evento.event })
  }

  const tx = evento.data?.transaction ?? {}
  const referencia = tx.reference
  const estadoTx = tx.status // APPROVED | DECLINED | VOIDED | ERROR
  if (!referencia) return NextResponse.json({ ok: true, ignorado: 'sin referencia' })

  try {
    const { rows } = await control(
      `select p.id, p.empresa_id, p.estado, e.vence_en
         from control.pagos p join control.empresas e on e.id = p.empresa_id
        where p.referencia = $1`,
      [referencia],
    )
    // Referencia que no generamos nosotros (otro comercio, o una prueba
    // manual). Se acepta el evento para que no lo reintente eternamente.
    if (rows.length === 0) return NextResponse.json({ ok: true, ignorado: 'referencia desconocida' })

    const pago = rows[0]
    // Ya resuelto: es un reintento de Wompi. Se responde 200 sin volver a
    // extender la suscripción — este es el corazón de la idempotencia.
    if (pago.estado !== 'PENDIENTE') {
      return NextResponse.json({ ok: true, repetido: true })
    }

    if (estadoTx !== 'APPROVED') {
      await control(
        `update control.pagos set estado = $2, transaccion = $3, evento = $4, resuelto_en = now()
          where id = $1`,
        [pago.id, estadoTx ?? 'ERROR', tx.id ?? null, JSON.stringify(evento)],
      )
      return NextResponse.json({ ok: true, estado: estadoTx })
    }

    // Aprobado: se extiende desde el vencimiento vigente si aún no ha pasado
    // (renovar antes no debe costar días), o desde hoy si ya venció.
    const base = pago.vence_en && new Date(pago.vence_en) > new Date() ? new Date(pago.vence_en) : new Date()
    const hasta = new Date(base.getTime() + DIAS_CUBIERTOS * 86400000)

    await control(
      `update control.pagos
          set estado = 'APROBADA', transaccion = $2, evento = $3, cubre_hasta = $4, resuelto_en = now()
        where id = $1`,
      [pago.id, tx.id ?? null, JSON.stringify(evento), hasta.toISOString()],
    )
    await control(
      `update control.empresas
          set plan = 'pago', estado = 'activa', limite_empleados = null,
              vence_en = $2, pago_proveedor = 'wompi', pago_referencia = $3
        where id = $1`,
      [pago.empresa_id, hasta.toISOString(), referencia],
    )
    // La empresa se cachea 60 s por petición; sin esto el panel seguiría
    // mostrando el plan viejo hasta que expire el caché.
    olvidarEmpresas()

    console.log(`Pago aprobado: empresa ${pago.empresa_id} cubierta hasta ${hasta.toISOString()}`)
    return NextResponse.json({ ok: true, cubreHasta: hasta.toISOString() })
  } catch (e) {
    // Un fallo NUESTRO sí merece reintento: se responde 500 para que Wompi
    // vuelva a intentarlo dentro de su ventana de 24 horas.
    console.error('Pago: no se pudo procesar el evento:', e?.message || e)
    return NextResponse.json({ ok: false }, { status: 500 })
  }
}
