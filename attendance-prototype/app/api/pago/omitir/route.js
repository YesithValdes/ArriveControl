/**
 * app/api/pago/omitir/route.js
 *
 * POST — «ahora no». Marca que la empresa ya resolvió la pantalla de
 *        bienvenida, para no volver a mostrársela, y la deja seguir con su
 *        prueba.
 *
 * Existe porque la pantalla de suscripción es OPCIONAL: quien quiere pagar de
 * una no debería gastar sus días de prueba para poder hacerlo, y quien no
 * quiere no debería toparse con la misma pantalla en cada visita.
 */
import { NextResponse } from 'next/server'
import { control } from '../../../../lib/db.js'
import { estadoAcceso, estadoAHttp, estadoAMensaje } from '../../../../lib/sesion'
import { olvidarEmpresas } from '../../../../lib/empresas.js'

export const runtime = 'nodejs'

export async function POST() {
  const { estado, empresa } = await estadoAcceso('ver')
  if (estado !== 'OK') {
    return NextResponse.json({ ok: false, error: estadoAMensaje(estado) }, { status: estadoAHttp(estado) })
  }
  // `coalesce`: si ya estaba resuelta se respeta la fecha original, que es el
  // dato con valor (cuándo la vio por primera vez).
  await control(
    `update control.empresas set bienvenida_en = coalesce(bienvenida_en, now()) where id = $1`,
    [empresa.id],
  )
  olvidarEmpresas()
  return NextResponse.json({ ok: true })
}
