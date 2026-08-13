/**
 * app/api/dispositivos/canjear/route.js
 * POST — el APARATO cambia un código de vinculación por su clave definitiva.
 *
 * Es el ÚNICO endpoint del sistema que se atiende sin sesión y sin clave de
 * dispositivo: el kiosco todavía no tiene ninguna de las dos, y el código es
 * toda su credencial. Por eso el código es de un solo uso, caduca en minutos y
 * se marca como usado en la misma transacción en que se crea el aparato.
 *
 * La clave se devuelve UNA sola vez. Queda en ese aparato y en ningún otro
 * lado: en la base solo vive su hash.
 */
import { NextResponse } from 'next/server'
import { canjearVinculacion } from '../../../../lib/dispositivos.js'

export const runtime = 'nodejs'

/** Mensajes pensados para quien está de pie frente a la tablet. */
const MENSAJES = {
  CODIGO_INVALIDO: 'Ese código no existe. Revisa los 8 dígitos.',
  CODIGO_USADO: 'Ese código ya se usó en otro aparato. Genera uno nuevo desde el panel.',
  CODIGO_VENCIDO: 'El código venció. Genera uno nuevo desde el panel.',
}

export async function POST(req) {
  let c
  try { c = await req.json() } catch { return NextResponse.json({ ok: false, error: 'JSON inválido.' }, { status: 400 }) }

  const r = await canjearVinculacion(c?.codigo)
  if (r.error) {
    // 400 para todos los casos, con el mismo tiempo de respuesta: distinguir
    // «no existe» de «vencido» con códigos HTTP distintos le diría a quien
    // pruebe a ciegas cuáles acertó.
    return NextResponse.json({ ok: false, error: MENSAJES[r.error] ?? 'Código inválido.' }, { status: 400 })
  }

  return NextResponse.json({
    ok: true,
    dispositivo: { clave: r.clave, nombre: r.nombre, sede_id: r.sedeId },
    empresa: r.empresa,
  })
}
