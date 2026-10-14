import { createAuthEndpoint, createAuthMiddleware, getOAuthState, sessionMiddleware } from 'better-auth/api'
import { setSessionCookie } from 'better-auth/cookies'
import {
  aprobacionAndroid, ATRIBUTOS_COOKIE_ANDROID, canjeAndroidValido, consumirCodigoAndroid,
  COOKIE_ANDROID, emitirCodigoAndroid, enlaceAndroid, retornoAndroidAutorizado,
} from './authAndroid.js'

/** Reutiliza las tablas privadas de Better Auth; nunca entrega tokens por una URL. */
export function accesoGoogleAndroid(pool) {
  return {
    id: 'arrivecontrol-google-android',
    endpoints: {
      androidGoogleReturn: createAuthEndpoint('/android/return', {
        method: 'GET', requireHeaders: true, use: [sessionMiddleware],
      }, async (ctx) => {
        ctx.setHeader('cache-control', 'no-store')
        ctx.setHeader('referrer-policy', 'no-referrer')
        const cookie = await ctx.getSignedCookie(COOKIE_ANDROID, ctx.context.secret)
        let recibo
        try { recibo = cookie && JSON.parse(cookie) } catch { /* Cookie inválida: cerrar acceso. */ }
        ctx.setCookie(COOKIE_ANDROID, '', { ...ATRIBUTOS_COOKIE_ANDROID, maxAge: 0 })
        if (!await retornoAndroidAutorizado(pool, recibo, ctx.context.session)) {
          throw ctx.error('UNAUTHORIZED', { message: 'El acceso de Android no se completó o ya venció.' })
        }
        return ctx.json({ url: enlaceAndroid(recibo) })
      }),
      androidGoogleExchange: createAuthEndpoint('/android/exchange', {
        method: 'POST', requireHeaders: true,
      }, async (ctx) => {
        ctx.setHeader('cache-control', 'no-store')
        if (!canjeAndroidValido(ctx.body)) throw ctx.error('BAD_REQUEST', { message: 'Solicitud de acceso inválida.' })
        const aprobado = await consumirCodigoAndroid(pool, ctx.body)
        if (!aprobado) throw ctx.error('UNAUTHORIZED', { message: 'El acceso ya venció o no pertenece a este dispositivo.' })
        const user = await ctx.context.internalAdapter.findUserById(aprobado.userId)
        if (!user || user.activo !== true || (user.banned && (!user.banExpires || new Date(user.banExpires) > new Date()))) {
          throw ctx.error('FORBIDDEN', { message: 'Tu cuenta no tiene acceso.' })
        }
        // Una sesión independiente permite cerrar Android sin cerrar el navegador.
        const session = await ctx.context.internalAdapter.createSession(user.id)
        if (!session) throw ctx.error('INTERNAL_SERVER_ERROR', { message: 'No se pudo crear la sesión.' })
        await setSessionCookie(ctx, { session, user }, false)
        return ctx.json({ ok: true })
      }),
    },
    hooks: { after: [{
      // Better Auth expone aquí la plantilla de la ruta, no su URL resuelta.
      matcher: (ctx) => ctx.path === '/callback/:id' && ctx.params?.id === 'google',
      handler: createAuthMiddleware(async (ctx) => {
        const aprobado = aprobacionAndroid(await getOAuthState(), ctx.context.newSession, ctx.context.baseURL)
        if (!aprobado) return
        const recibo = await emitirCodigoAndroid(pool, aprobado)
        await ctx.setSignedCookie(COOKIE_ANDROID, JSON.stringify(recibo), ctx.context.secret, ATRIBUTOS_COOKIE_ANDROID)
        ctx.setHeader('cache-control', 'no-store')
        ctx.setHeader('referrer-policy', 'no-referrer')
      }),
    }] },
  }
}
