/**
 * app/api/pago/mercadopago/route.js — Avisos (webhooks) de Mercado Pago.
 *
 * Se configura en Mercado Pago → Tus integraciones → Webhooks, con esta URL
 * (https://<dominio>/api/pago/mercadopago) y los eventos «Planes y
 * suscripciones».
 *
 * Seguridad, en este orden:
 *   1. Sin MP_WEBHOOK_SECRET configurado no se acepta nada (503).
 *   2. La firma `x-signature` debe ser válida (HMAC con la clave secreta,
 *      comparada en tiempo constante). Si no, 401 y no se toca nada.
 *   3. Del aviso solo se toman el TIPO y el ID. El recurso se vuelve a leer en
 *      la API de Mercado Pago con nuestro token: el contenido del aviso nunca
 *      decide nada (lib/suscripciones.js).
 *   4. Idempotente: un aviso repetido no registra ni extiende dos veces.
 *
 * Respuestas: 200 cuando quedó procesado (o no aplica); 500 si falló algo
 * NUESTRO, para que Mercado Pago reintente.
 */
import { NextResponse } from 'next/server'
import { configMp, firmaValida } from '../../../../lib/mercadopago.js'
import { procesarAviso } from '../../../../lib/suscripciones.js'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const TIPOS = new Set(['subscription_preapproval', 'subscription_authorized_payment', 'payment', 'subscription_preapproval_plan'])

export async function POST(req) {
  const cfg = configMp()
  if (!cfg?.secretoWebhook) {
    console.error('Mercado Pago: aviso rechazado, falta MP_WEBHOOK_SECRET.')
    return NextResponse.json({ ok: false }, { status: 503 })
  }

  const url = new URL(req.url)
  let cuerpo = null
  try { cuerpo = await req.json() } catch { /* sin cuerpo: se usan los parámetros */ }
  // El ID sale SOLO de la URL: es el que cubre la firma. Uno que viniera solo
  // en el cuerpo no está firmado y se podría cambiar reusando una firma vieja.
  const dataId = url.searchParams.get('data.id')
  const tipo = url.searchParams.get('type') ?? cuerpo?.type

  const valida = firmaValida({
    xSignature: req.headers.get('x-signature'),
    xRequestId: req.headers.get('x-request-id'),
    dataId: dataId ?? undefined,
    secreto: cfg.secretoWebhook,
  })
  if (!valida) return NextResponse.json({ ok: false }, { status: 401 })

  // Del aviso solo se usan el tipo y el id, ya validados en forma.
  if (!TIPOS.has(tipo) || dataId == null || !/^[A-Za-z0-9_-]{1,64}$/.test(String(dataId))) {
    return NextResponse.json({ ok: true, ignorado: true })
  }
  try {
    const resultado = await procesarAviso({ tipo, id: String(dataId) })
    return NextResponse.json({ ok: true, resultado })
  } catch (e) {
    // Un recurso que Mercado Pago dice que no existe no se va a arreglar con
    // reintentos; un fallo de red o de base, sí.
    if (e?.status === 404) return NextResponse.json({ ok: true, ignorado: 'recurso inexistente' })
    console.error('Mercado Pago: no se pudo procesar el aviso:', e?.message || e)
    return NextResponse.json({ ok: false }, { status: 500 })
  }
}
