import { randomBytes } from 'node:crypto'
import { auth } from '../../../../lib/auth'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(request) {
  // Una sesión web previa nunca basta: el plugin exige el recibo firmado de este OAuth.
  const resultado = await auth.api.androidGoogleReturn({ headers: request.headers, asResponse: true })
  const correcto = resultado.ok && !new URL(request.url).searchParams.has('error')
  const datos = correcto ? await resultado.json() : null
  const nonce = randomBytes(18).toString('base64url')
  const cabeceras = new Headers(resultado.headers)
  cabeceras.set('Content-Type', 'text/html; charset=utf-8')
  cabeceras.set('Cache-Control', 'no-store')
  cabeceras.set('Referrer-Policy', 'no-referrer')
  cabeceras.set('X-Content-Type-Options', 'nosniff')
  cabeceras.set('Content-Security-Policy', `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'`)
  const mensaje = correcto ? 'Ya puedes continuar en AsistencIA.' : 'El inicio con Google no se completó o venció. Vuelve a la app e inténtalo nuevamente.'
  // URL construida exclusivamente con app permitida y dos valores Base64url.
  const volver = correcto ? `<a href="${datos.url}">Volver a AsistencIA</a><script nonce="${nonce}">window.location.replace(${JSON.stringify(datos.url)})</script>` : ''
  return new Response(`<!doctype html><html lang="es"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>AsistencIA</title><style nonce="${nonce}">body{font-family:system-ui,sans-serif;background:#10233f;color:#fff;margin:0;min-height:100dvh;display:grid;place-items:center}main{max-width:360px;padding:28px;text-align:center}a{display:block;background:#fff;color:#10233f;border-radius:10px;padding:14px;margin-top:24px;font-weight:700;text-decoration:none}</style><main><h1>AsistencIA</h1><p>${mensaje}</p>${volver}</main></html>`, { status: correcto ? 200 : 400, headers: cabeceras })
}
