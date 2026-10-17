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
import { olvidarEmpresas, COOKIE_BIENVENIDA } from '../../../../lib/empresas.js'

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
  // La caché de empresas vive en memoria POR INSTANCIA: `olvidarEmpresas` solo
  // limpia la de esta. Si /admin lo atiende otra, hasta 60 s seguiría viendo
  // `bienvenida_en` vacío y lo devolvería a la bienvenida. La cookie avisa ya.
  const res = NextResponse.json({ ok: true })
  res.cookies.set(COOKIE_BIENVENIDA, String(empresa.id), {
    path: '/', httpOnly: true, sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production', maxAge: 60 * 60 * 24 * 365,
  })
  return res
}
