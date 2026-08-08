/**
 * app/api/colaboradores-gestor/route.js
 * GET ?buscar=texto — busca colaboradores ACTIVOS en el gestor de nómina para
 * registrarlos en asistencia.
 *
 * En MODO CONECTADO se pide por HTTP al gestor (ya no se lee su base: son dos
 * sistemas separados). En MODO AUTÓNOMO no aplica: los empleados se registran
 * aquí con nombre y cédula, así que devuelve una lista vacía.
 */
import { NextResponse } from 'next/server'
import { pool } from '../../../lib/db.js'
import { estadoAcceso } from '../../../lib/sesion'
import { buscarColaboradores } from '../../../lib/gestor.js'
import { modoConectado } from '../../../lib/configLaboral.js'

export const runtime = 'nodejs'

export async function GET(req) {
  const { estado } = await estadoAcceso('empleados')
  if (estado !== 'OK') {
    return NextResponse.json({ ok: false, error: 'Sin permiso.' }, { status: estado === 'SIN_SESION' ? 401 : 403 })
  }
  if (!modoConectado()) {
    return NextResponse.json({ ok: true, colaboradores: [], modo: 'autonomo' })
  }

  const buscar = (new URL(req.url).searchParams.get('buscar') ?? '').trim()
  if (buscar.length < 2) return NextResponse.json({ ok: true, colaboradores: [] })

  let colaboradores
  try {
    colaboradores = await buscarColaboradores(buscar)
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: `No se pudo consultar el gestor de nómina: ${e.message}` },
      { status: 502 },
    )
  }

  // Cuáles de esos ya están registrados aquí, para no ofrecerlos dos veces.
  // Se resuelve con datos PROPIOS, sin cruzar a la base del gestor.
  const ids = colaboradores.map((c) => c.id)
  const yaRegistrados = new Set()
  if (ids.length > 0) {
    const { rows } = await pool.query(
      `select colaborador_id::text as id from asistencia.empleados
        where colaborador_id = any($1::uuid[])`,
      [ids],
    )
    for (const r of rows) yaRegistrados.add(r.id)
  }

  return NextResponse.json({
    ok: true,
    colaboradores: colaboradores.map((c) => ({ ...c, ya_registrado: yaRegistrados.has(c.id) })),
  })
}
