/**
 * app/api/horarios/[id]/route.js
 * PATCH  — edita nombre y/o el mapa de días de un horario. No reescribe a
 *          los empleados que ya lo tenían: sus jornadas fueron copiadas.
 * DELETE — elimina el horario (los empleados conservan su jornada copiada).
 */
import { NextResponse } from 'next/server'
import { conEmpresa } from '../../../../lib/db.js'
import { estadoAcceso, estadoAHttp, estadoAMensaje } from '../../../../lib/sesion'
import { validarDias } from '../../../../lib/horariosDias.js'

export const runtime = 'nodejs'

export async function PATCH(req, { params }) {
  const { estado, esquema } = await estadoAcceso('config')
  if (estado !== 'OK') return NextResponse.json({ ok: false, error: estadoAMensaje(estado) }, { status: estadoAHttp(estado) })

  const { id } = await params
  let c
  try { c = await req.json() } catch { return NextResponse.json({ ok: false, error: 'JSON inválido.' }, { status: 400 }) }

  const sets = []
  const args = []
  if ('nombre' in c) {
    const n = String(c.nombre).trim()
    if (!n) return NextResponse.json({ ok: false, error: 'El nombre no puede quedar vacío.' }, { status: 400 })
    args.push(n); sets.push(`nombre = $${args.length}`)
  }
  if ('dias' in c) {
    const v = validarDias(c.dias)
    if (v.error) return NextResponse.json({ ok: false, error: v.error }, { status: 400 })
    args.push(JSON.stringify(v.dias)); sets.push(`dias = $${args.length}`)
  }
  if (sets.length === 0) return NextResponse.json({ ok: false, error: 'Nada que actualizar.' }, { status: 400 })

  args.push(id)
  try {
    const { rows } = await conEmpresa(esquema, (db) => db.query(
      `update horarios set ${sets.join(', ')} where id = $${args.length}
       returning id, nombre, dias`,
      args,
    ))
    if (rows.length === 0) return NextResponse.json({ ok: false, error: 'Horario no encontrado.' }, { status: 404 })
    return NextResponse.json({ ok: true, horario: rows[0] })
  } catch (e) {
    if (e.code === '23505') return NextResponse.json({ ok: false, error: 'Ya existe un horario con ese nombre.' }, { status: 409 })
    throw e
  }
}

export async function DELETE(req, { params }) {
  const { estado, esquema } = await estadoAcceso('config')
  if (estado !== 'OK') return NextResponse.json({ ok: false, error: estadoAMensaje(estado) }, { status: estadoAHttp(estado) })

  const { id } = await params
  const { rows } = await conEmpresa(esquema, (db) => db.query(`delete from horarios where id = $1 returning id`, [id]))
  if (rows.length === 0) return NextResponse.json({ ok: false, error: 'Horario no encontrado.' }, { status: 404 })
  return NextResponse.json({ ok: true })
}
