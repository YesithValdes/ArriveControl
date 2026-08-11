/**
 * app/api/horas/pagadas/route.js
 * POST — marca (o desmarca) tramos de hora extra como YA PAGADOS.
 *
 * Es una ANOTACIÓN, no un pago: ArriveControl no mueve dinero. Sirve para
 * saber qué quedó liquidado afuera y no pagarlo dos veces.
 *
 * Se recibe la lista de `referencias` de los tramos, no un rango de fechas:
 * la referencia identifica un tramo concreto y sobrevive a los recálculos,
 * mientras que un rango se rompe apenas alguien corrige una marcación.
 *
 * Permiso `liquidar`: lo tiene el dueño y el rol de consulta (quien arma la
 * nómina). No exige `corregir` a propósito — anotar un pago no debe requerir
 * poder modificar la asistencia que se está pagando.
 */
import { NextResponse } from 'next/server'
import { conEmpresa } from '../../../../lib/db.js'
import { estadoAcceso } from '../../../../lib/sesion'

export const runtime = 'nodejs'

/** Tope por petición: una marcación masiva accidental no debe tumbar la base. */
const MAX_REFERENCIAS = 5000

export async function POST(req) {
  const { estado, usuario, esquema } = await estadoAcceso('liquidar')
  if (estado !== 'OK') {
    return NextResponse.json(
      { ok: false, error: 'Sin permiso para marcar horas como pagadas.' },
      { status: estado === 'SIN_SESION' ? 401 : 403 },
    )
  }

  let c
  try { c = await req.json() } catch { return NextResponse.json({ ok: false, error: 'JSON inválido.' }, { status: 400 }) }

  const referencias = Array.isArray(c?.referencias) ? c.referencias.filter((r) => typeof r === 'string' && r) : null
  if (!referencias || referencias.length === 0) {
    return NextResponse.json({ ok: false, error: 'Falta la lista de referencias.' }, { status: 400 })
  }
  if (referencias.length > MAX_REFERENCIAS) {
    return NextResponse.json({ ok: false, error: `Máximo ${MAX_REFERENCIAS} tramos por petición.` }, { status: 400 })
  }

  // Desmarcar es tan legítimo como marcar: alguien se equivoca de fila y tiene
  // que poder deshacerlo sin entrar a la base de datos.
  if (c.pagado === false) {
    const { rowCount } = await conEmpresa(esquema, (db) => db.query(
      `delete from horas_pagadas where referencia_externa = any($1::text[])`,
      [referencias],
    ))
    return NextResponse.json({ ok: true, pagado: false, afectados: rowCount })
  }

  // La cédula sale de la referencia (arrive-{cédula}-{fecha}-…) para poder
  // auditar lo pagado de una persona sin re-parsear después.
  const documentos = referencias.map((r) => r.split('-')[1] ?? '')
  const { rowCount } = await conEmpresa(esquema, (db) => db.query(
    `insert into horas_pagadas (referencia_externa, documento, pagado_por)
     select * from unnest($1::text[], $2::text[], $3::text[])
     on conflict (referencia_externa) do nothing`,
    [referencias, documentos, referencias.map(() => usuario.email ?? usuario.nombre ?? 'admin')],
  ))
  return NextResponse.json({ ok: true, pagado: true, afectados: rowCount })
}
