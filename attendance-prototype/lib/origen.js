/**
 * lib/origen.js — ¿La petición viene de NUESTRO sitio?
 *
 * Segunda defensa contra peticiones falsificadas desde otra página (CSRF) en
 * las acciones que mueven dinero. La primera es la cookie de sesión con
 * SameSite=Lax. Un navegador siempre manda `Origin` en un POST; si viene de
 * otro sitio, se rechaza.
 */
export function mismoOrigen(req) {
  const origen = req.headers.get('origin')
  if (!origen) return true // no es un navegador (o es una petición del mismo sitio antigua)
  const permitidos = new Set([new URL(req.url).origin])
  for (const u of [process.env.BETTER_AUTH_URL, ...(process.env.BETTER_AUTH_TRUSTED_ORIGINS ?? '').split(',')]) {
    try { if (u && u.trim()) permitidos.add(new URL(u.trim()).origin) } catch { /* valor mal escrito: se ignora */ }
  }
  return permitidos.has(origen)
}
