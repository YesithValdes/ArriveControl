/**
 * middleware.js — Le dice al servidor QUÉ se está pidiendo.
 *
 * Los handlers de Next no reciben la ruta ni el método por `headers()`, y el
 * acceso de soporte (lib/sesion.js) los necesita: para permitir solo lectura
 * (GET/HEAD) y para anotar en la bitácora qué se consultó.
 *
 * Se FIJAN aquí, en el borde, pisando cualquier valor que mande el cliente:
 * una cabecera x-arrive-metodo: GET puesta a mano en un POST no sobrevive.
 *
 * No decide nada ni bloquea nada: solo informa. Las reglas siguen donde
 * estaban.
 */
import { NextResponse } from 'next/server'

export function middleware(req) {
  const cabeceras = new Headers(req.headers)
  cabeceras.set('x-arrive-metodo', req.method)
  cabeceras.set('x-arrive-ruta', req.nextUrl.pathname)
  return NextResponse.next({ request: { headers: cabeceras } })
}

export const config = {
  matcher: ['/api/:path*', '/admin', '/admin/:path*'],
}
