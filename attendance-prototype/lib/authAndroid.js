import { createHash, randomBytes } from 'node:crypto'
import { uuidv7 } from './uuidv7.js'

const APPS = new Set(['co.asistencia.kiosco', 'co.asistencia.kiosco.pruebas'])
const SECRETO = /^[A-Za-z0-9_-]{43}$/
const PREFIJO = 'android-handoff-v1:'
const esSecreto = (valor) => typeof valor === 'string' && SECRETO.test(valor)
export const COOKIE_ANDROID = '__Secure-arrivecontrol.android_handoff'
export const ATRIBUTOS_COOKIE_ANDROID = {
  httpOnly: true, secure: true, sameSite: 'lax', path: '/auth/android/return', maxAge: 60,
}

export function flujoAndroidValido(flujo) {
  return Boolean(flujo && APPS.has(flujo.app) && esSecreto(flujo.state) && esSecreto(flujo.challenge))
}

export function canjeAndroidValido(cuerpo) {
  return Boolean(cuerpo && esSecreto(cuerpo.code) && esSecreto(cuerpo.state) &&
    typeof cuerpo.verifier === 'string' && /^[A-Za-z0-9_-]{43,128}$/.test(cuerpo.verifier))
}

export const resumenAndroid = (texto) => createHash('sha256').update(texto).digest('base64url')
export const retornoAndroid = (baseURL) => `${new URL(baseURL).origin}/auth/android/return`

/** Solo el estado OAuth validado y una sesión CREADA por ese callback autorizan el salto. */
export function aprobacionAndroid(estadoOAuth, nuevaSesion, baseURL) {
  if (!flujoAndroidValido(estadoOAuth?.androidHandoff) || estadoOAuth.link ||
    estadoOAuth.callbackURL !== retornoAndroid(baseURL) || !nuevaSesion?.session?.id ||
    !nuevaSesion.user?.id || nuevaSesion.session.userId !== nuevaSesion.user.id) return null
  return {
    app: estadoOAuth.androidHandoff.app,
    challenge: estadoOAuth.androidHandoff.challenge,
    state: estadoOAuth.androidHandoff.state,
    userId: nuevaSesion.user.id,
    browserSessionId: nuevaSesion.session.id,
  }
}

export async function emitirCodigoAndroid(pool, aprobacion) {
  const code = randomBytes(32).toString('base64url')
  await pool.query(
    `insert into control.verification (id, identifier, value, expires_at, created_at, updated_at)
     values ($1, $2, $3, now() + interval '60 seconds', now(), now())`,
    [uuidv7(), `${PREFIJO}${resumenAndroid(code)}`, JSON.stringify(aprobacion)],
  )
  return { ...aprobacion, code }
}

export async function retornoAndroidAutorizado(pool, recibo, sesion) {
  if (!canjeAndroidValido({ ...recibo, verifier: recibo?.code }) || !APPS.has(recibo?.app) ||
    recibo.browserSessionId !== sesion?.session?.id || recibo.userId !== sesion?.user?.id) return false
  const { rows } = await pool.query(
    `select 1 from control.verification
     where identifier = $1 and expires_at > now()
       and value::jsonb ->> 'state' = $2 and value::jsonb ->> 'app' = $3
       and value::jsonb ->> 'browserSessionId' = $4 and value::jsonb ->> 'userId' = $5
     limit 1`,
    [`${PREFIJO}${resumenAndroid(recibo.code)}`, recibo.state, recibo.app, recibo.browserSessionId, recibo.userId],
  )
  return rows.length === 1
}

/** Una sola sentencia: un verifier/state incorrecto NO consume el código. */
export async function consumirCodigoAndroid(pool, cuerpo) {
  if (!canjeAndroidValido(cuerpo)) return null
  const { rows } = await pool.query(
    `delete from control.verification as v
     where v.identifier = $1 and v.expires_at > now()
       and v.value::jsonb ->> 'challenge' = $2 and v.value::jsonb ->> 'state' = $3
       and v.value::jsonb ->> 'app' = any($4::text[])
       and exists (
         select 1 from control."user" as u
         join control.session as s on s.user_id = u.id
         where u.id = v.value::jsonb ->> 'userId'
           and s.id = v.value::jsonb ->> 'browserSessionId' and s.expires_at > now()
           and u.activo = true
           and (coalesce(u.banned, false) = false or u.ban_expires <= now())
           and exists (select 1 from control.account as a where a.user_id = u.id and a.provider_id = 'google')
       )
     returning v.value`,
    [`${PREFIJO}${resumenAndroid(cuerpo.code)}`, resumenAndroid(cuerpo.verifier), cuerpo.state, [...APPS]],
  )
  return rows.length === 1 ? JSON.parse(rows[0].value) : null
}

export function enlaceAndroid(recibo) {
  if (!APPS.has(recibo?.app) || !esSecreto(recibo?.code) || !esSecreto(recibo?.state)) return null
  return `${recibo.app}://auth/google?code=${recibo.code}&state=${recibo.state}`
}
