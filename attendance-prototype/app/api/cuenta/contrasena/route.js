/**
 * app/api/cuenta/contrasena/route.js
 * POST — le pone (o cambia) la contraseña de esta app a quien ya inició sesión.
 *
 * Existe por un motivo concreto: Google NO permite autenticarse dentro de la
 * ventana de una app de Android. Sin una contraseña propia no hay forma de
 * abrir el panel desde el celular.
 *
 * No necesita saber la contraseña anterior, y no es un descuido: quien llega
 * aquí YA demostró quién es —tiene sesión válida, normalmente recién abierta
 * con Google—, así que la identidad está probada por un medio más fuerte que
 * una contraseña. Es también lo que hace innecesario montar un servicio de
 * correo: quien la olvide entra con Google y se pone otra.
 */
import { NextResponse } from 'next/server'
import { headers } from 'next/headers'
import { auth } from '../../../../lib/auth'
import { obtenerSesion } from '../../../../lib/sesion'

export const runtime = 'nodejs'

export async function POST(req) {
  const usuario = await obtenerSesion()
  if (!usuario) return NextResponse.json({ ok: false, error: 'Sin sesión.' }, { status: 401 })

  let c
  try { c = await req.json() } catch { return NextResponse.json({ ok: false, error: 'JSON inválido.' }, { status: 400 }) }

  const contrasena = String(c?.contrasena ?? '')
  if (contrasena.length < 8) {
    return NextResponse.json({ ok: false, error: 'La contraseña debe tener al menos 8 caracteres.' }, { status: 400 })
  }
  // Da acceso a salarios y marcaciones de toda una empresa: la más obvia de
  // todas no debería pasar.
  if (/^(12345678|contrasena|password|00000000)$/i.test(contrasena)) {
    return NextResponse.json({ ok: false, error: 'Esa contraseña es demasiado común. Usa otra.' }, { status: 400 })
  }

  try {
    // Better Auth la cifra y crea la credencial si el usuario no tenía.
    await auth.api.setPassword({
      body: { newPassword: contrasena },
      headers: await headers(),
    })
    return NextResponse.json({ ok: true })
  } catch (e) {
    const msg = String(e?.body?.message ?? e?.message ?? e)
    return NextResponse.json({ ok: false, error: `No se pudo guardar: ${msg}` }, { status: 400 })
  }
}
