/**
 * lib/mercadopago.js — Integración con Mercado Pago (solo servidor).
 *
 * Variables de entorno (en Vercel, nunca en el código ni en el navegador):
 *   MP_ACCESS_TOKEN    Access Token de la aplicación. Con prefijo TEST- es el
 *                      de pruebas; sin él, producción.
 *   MP_WEBHOOK_SECRET  «Clave secreta» de las notificaciones (Tus
 *                      integraciones → Webhooks). Sin ella NO se acepta ningún
 *                      aviso: mejor no activar un plan que aceptar uno falso.
 *
 * Sin MP_ACCESS_TOKEN el módulo queda APAGADO y el panel no ofrece pagar.
 *
 * Reglas de seguridad de este archivo:
 *   · El token jamás sale del servidor ni se escribe en logs.
 *   · Un aviso solo se cree si su firma (x-signature) es válida, y aun así
 *     NO se usa su contenido: se vuelve a consultar el recurso en la API con
 *     nuestro token (lib/suscripciones.js).
 *   · Comparaciones de firma en tiempo constante.
 */
import { createHmac, timingSafeEqual } from 'node:crypto'

const API = 'https://api.mercadopago.com'

/**
 * Base de la API. Solo FUERA de producción se puede apuntar a un simulador
 * (MP_API_BASE) para las pruebas automáticas; en producción es siempre la real.
 */
const base = () => (process.env.NODE_ENV !== 'production' && process.env.MP_API_BASE) || API

export function configMp() {
  const token = process.env.MP_ACCESS_TOKEN
  if (!token) return null
  return {
    token,
    secretoWebhook: process.env.MP_WEBHOOK_SECRET || null,
    entorno: token.startsWith('TEST-') ? 'test' : 'prod',
  }
}
export const mpActivo = () => configMp() !== null

/** Error de la API de Mercado Pago, con su estado HTTP (sin datos sensibles). */
export class ErrorMp extends Error {
  constructor(mensaje, status, detalle = null) {
    super(mensaje)
    this.status = status
    this.detalle = detalle
  }
}

/**
 * Llamada a la API con el token del servidor. Tope de 15 s: un Mercado Pago
 * lento no debe colgar la función. `idempotencia` evita duplicar una creación
 * si la red corta y se reintenta.
 */
export async function llamarMp(metodo, ruta, cuerpo = null, { idempotencia = null } = {}) {
  const cfg = configMp()
  if (!cfg) throw new ErrorMp('Mercado Pago no está configurado.', 503)
  const headers = { Authorization: `Bearer ${cfg.token}`, 'Content-Type': 'application/json' }
  if (idempotencia) headers['X-Idempotency-Key'] = idempotencia
  let r
  try {
    r = await fetch(`${base()}${ruta}`, {
      method: metodo,
      headers,
      body: cuerpo ? JSON.stringify(cuerpo) : undefined,
      signal: AbortSignal.timeout(15000),
      cache: 'no-store',
    })
  } catch (e) {
    throw new ErrorMp(`No se pudo contactar a Mercado Pago (${e?.name === 'TimeoutError' ? 'tiempo agotado' : 'red'}).`, 502)
  }
  const texto = await r.text()
  let datos = null
  try { datos = texto ? JSON.parse(texto) : null } catch { /* respuesta no JSON */ }
  if (!r.ok) {
    // Solo el mensaje y la causa de Mercado Pago; nunca encabezados ni token.
    const causa = datos?.message || datos?.error || `HTTP ${r.status}`
    throw new ErrorMp(`Mercado Pago rechazó ${metodo} ${ruta.split('?')[0]}: ${causa}`, r.status, datos?.cause ?? null)
  }
  return datos
}

/**
 * ¿La firma de un aviso es auténtica?
 *
 * Mercado Pago envía `x-signature: ts=<ms>,v1=<hex>` y `x-request-id`. La
 * firma es HMAC-SHA256 (hex), con la clave secreta, del manifiesto
 * `id:<data.id>;request-id:<x-request-id>;ts:<ts>;` — data.id sale de la URL
 * y, si es alfanumérico, en minúsculas. Las partes ausentes se omiten.
 *
 * @returns {boolean}
 */
export function firmaValida({ xSignature, xRequestId, dataId, secreto }) {
  if (!secreto || typeof xSignature !== 'string') return false
  const partes = Object.fromEntries(
    xSignature.split(',').map((p) => p.trim().split('=')).filter((kv) => kv.length === 2).map(([k, v]) => [k.trim(), v.trim()]),
  )
  const { ts, v1 } = partes
  if (!ts || !v1 || !/^[0-9a-f]{64}$/i.test(v1)) return false
  let manifiesto = ''
  if (dataId) manifiesto += `id:${/^[a-z0-9]+$/i.test(dataId) ? dataId.toLowerCase() : dataId};`
  if (xRequestId) manifiesto += `request-id:${xRequestId};`
  manifiesto += `ts:${ts};`
  const esperada = createHmac('sha256', secreto).update(manifiesto).digest()
  const recibida = Buffer.from(v1, 'hex')
  return recibida.length === esperada.length && timingSafeEqual(recibida, esperada)
}

// ── Recursos ────────────────────────────────────────────────────────────────

/** Id de NUESTRA cuenta (el cobrador). Sirve para comprobar que un recurso es nuestro. */
let cuentaProm = null
export function miCuentaId() {
  if (!cuentaProm) {
    cuentaProm = llamarMp('GET', '/users/me').then((u) => String(u.id))
    cuentaProm.catch(() => { cuentaProm = null })
  }
  return cuentaProm
}

/**
 * Crea una suscripción SIN plan asociado, en estado pendiente: Mercado Pago
 * devuelve `init_point`, la página donde el cliente autoriza el cobro.
 */
export function crearPreapproval({ referencia, motivo, email, montoCop, urlRetorno }) {
  return llamarMp('POST', '/preapproval', {
    reason: motivo,
    external_reference: referencia,
    payer_email: email,
    back_url: urlRetorno,
    status: 'pending',
    auto_recurring: {
      frequency: 1,
      frequency_type: 'months',
      transaction_amount: montoCop,
      currency_id: 'COP',
    },
  }, { idempotencia: `preapproval-${referencia}` })
}

export const leerPreapproval = (id) => llamarMp('GET', `/preapproval/${encodeURIComponent(id)}`)
export const leerPagoAutorizado = (id) => llamarMp('GET', `/authorized_payments/${encodeURIComponent(id)}`)
export const cancelarPreapproval = (id) => llamarMp('PUT', `/preapproval/${encodeURIComponent(id)}`, { status: 'cancelled' })
export const cambiarMontoPreapproval = (id, montoCop) =>
  llamarMp('PUT', `/preapproval/${encodeURIComponent(id)}`, { auto_recurring: { transaction_amount: montoCop, currency_id: 'COP' } })

/** ¿Es una URL de pago de Mercado Pago? Solo a esas se redirige al cliente. */
export function esUrlDeMercadoPago(url) {
  try {
    const u = new URL(url)
    // Solo el simulador de pruebas (fuera de producción) puede ir sin https.
    if (u.protocol !== 'https:') {
      return Boolean(process.env.NODE_ENV !== 'production' && process.env.MP_API_BASE && u.origin === new URL(process.env.MP_API_BASE).origin)
    }
    return /(^|\.)mercadopago\.com(\.[a-z]{2})?$/.test(u.hostname) || /(^|\.)mercadolibre\.com(\.[a-z]{2})?$/.test(u.hostname)
  } catch {
    return false
  }
}
