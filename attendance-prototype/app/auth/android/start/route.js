import { auth } from '../../../../lib/auth'
import { flujoAndroidValido, retornoAndroid } from '../../../../lib/authAndroid'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(request) {
  const entrada = new URL(request.url)
  const flujo = Object.fromEntries(['app', 'challenge', 'state'].map((nombre) => [nombre, entrada.searchParams.get(nombre)]))
  if (!flujoAndroidValido(flujo) || ['app', 'challenge', 'state'].some((nombre) => entrada.searchParams.getAll(nombre).length !== 1)) {
    return new Response('Solicitud de Android inválida.', { status: 400, headers: { 'Cache-Control': 'no-store' } })
  }
  // Se usa el origen configurado, nunca un Host/returnURL controlado por la petición.
  const callbackURL = retornoAndroid(process.env.BETTER_AUTH_URL)
  const resultado = await auth.api.signInSocial({
    headers: request.headers,
    body: {
      provider: 'google', callbackURL, newUserCallbackURL: callbackURL,
      errorCallbackURL: callbackURL, additionalData: { androidHandoff: flujo },
    },
    asResponse: true,
  })
  if (!resultado.ok) return resultado
  const { url } = await resultado.json()
  const destino = new URL(url)
  if (destino.protocol !== 'https:' || destino.hostname !== 'accounts.google.com') {
    return new Response('No se pudo abrir Google.', { status: 502, headers: { 'Cache-Control': 'no-store' } })
  }
  // Los Set-Cookie de estado OAuth pertenecen al navegador que abrió esta ruta.
  const cabeceras = new Headers(resultado.headers)
  cabeceras.delete('content-type')
  cabeceras.set('Location', destino.href)
  cabeceras.set('Cache-Control', 'no-store')
  cabeceras.set('Referrer-Policy', 'no-referrer')
  return new Response(null, { status: 303, headers: cabeceras })
}
