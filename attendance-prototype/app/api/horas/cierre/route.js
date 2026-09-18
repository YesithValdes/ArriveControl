/**
 * app/api/horas/cierre/route.js
 * Cerrar y reabrir períodos de horas extra.
 *
 * POST   — cierra el período (mes + quincena, o desde/hasta) para las cédulas
 *          de `documentos`, o para TODOS los que tengan extras si no viene la
 *          lista. Lo liquidado queda congelado y anotado como pagado.
 * DELETE — reabre (mismo cuerpo): borra el cierre y la anotación de pago;
 *          el período vuelve a calcularse en vivo.
 *
 * Entra con X-API-Key (el sistema de nómina) o con sesión y permiso
 * `liquidar` (Reportes). El cuerpo es JSON.
 */
import { NextResponse } from 'next/server'
import { accesoHoras, rangoPedido } from '../../../../lib/accesoHoras.js'
import { cerrarPeriodo, reabrirPeriodo } from '../../../../lib/cierres.js'

export const runtime = 'nodejs'

/** El período y las cédulas del cuerpo, con los mismos parámetros que los GET. */
async function leerCuerpo(req) {
  let c
  try { c = await req.json() } catch { return { error: 'JSON inválido.' } }
  const params = new URLSearchParams()
  for (const k of ['mes', 'quincena', 'desde', 'hasta']) if (c?.[k] != null) params.set(k, String(c[k]))
  const rango = rangoPedido(params)
  if (rango?.error) return { error: rango.error }
  if (!rango) return { error: 'Indica el período: mes=YYYY-MM (y quincena=1|2), o desde y hasta.' }
  let documentos = null
  if (c?.documentos != null) {
    if (!Array.isArray(c.documentos)) return { error: 'documentos debe ser una lista de cédulas.' }
    documentos = c.documentos.map((d) => String(d).replace(/\D/g, '')).filter(Boolean)
    if (documentos.length === 0) return { error: 'La lista de documentos está vacía.' }
    if (documentos.length > 1000) return { error: 'Máximo 1000 cédulas por petición.' }
  }
  return { rango, documentos }
}

export async function POST(req) {
  const { esquema, quien, error } = await accesoHoras(req, 'liquidar')
  if (error) return error
  const cuerpo = await leerCuerpo(req)
  if (cuerpo.error) return NextResponse.json({ ok: false, error: cuerpo.error }, { status: 400 })
  const r = await cerrarPeriodo(esquema, { ...cuerpo.rango, documentos: cuerpo.documentos, quien })
  return NextResponse.json({ ok: true, ...cuerpo.rango, ...r })
}

export async function DELETE(req) {
  const { esquema, error } = await accesoHoras(req, 'liquidar')
  if (error) return error
  const cuerpo = await leerCuerpo(req)
  if (cuerpo.error) return NextResponse.json({ ok: false, error: cuerpo.error }, { status: 400 })
  const r = await reabrirPeriodo(esquema, { ...cuerpo.rango, documentos: cuerpo.documentos })
  return NextResponse.json({ ok: true, ...cuerpo.rango, ...r })
}
