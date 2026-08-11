/**
 * app/api/sedes/[id]/route.js
 * PATCH  — edita nombre/coordenadas/radio (el renombre no rompe nada:
 *          los empleados referencian por id).
 * DELETE — elimina la sede si no es la última; los empleados quedan sin sede
 *          (FK on delete set null).
 */
import { NextResponse } from 'next/server'
import { conEmpresa } from '../../../../lib/db.js'
import { estadoAcceso } from '../../../../lib/sesion'

export const runtime = 'nodejs'

export async function PATCH(req, { params }) {
  const { estado, esquema } = await estadoAcceso('config')
  if (estado !== 'OK') return NextResponse.json({ ok: false, error: 'Sin permiso.' }, { status: estado === 'SIN_SESION' ? 401 : 403 })

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
  for (const k of ['lat', 'lon', 'radio_m']) {
    if (k in c) {
      const v = Number(c[k])
      if (!Number.isFinite(v)) return NextResponse.json({ ok: false, error: `${k} inválido.` }, { status: 400 })
      args.push(v); sets.push(`${k} = $${args.length}`)
    }
  }
  if (sets.length === 0) return NextResponse.json({ ok: false, error: 'Nada que actualizar.' }, { status: 400 })

  args.push(id)
  try {
    const { rows } = await conEmpresa(esquema, (db) => db.query(
      `update sedes set ${sets.join(', ')} where id = $${args.length}
       returning id, nombre, lat, lon, radio_m`,
      args,
    ))
    if (rows.length === 0) return NextResponse.json({ ok: false, error: 'Sede no encontrada.' }, { status: 404 })
    return NextResponse.json({ ok: true, sede: rows[0] })
  } catch (e) {
    if (e.code === '23505') return NextResponse.json({ ok: false, error: 'Ya existe una sede con ese nombre.' }, { status: 409 })
    throw e
  }
}

export async function DELETE(req, { params }) {
  const { estado, esquema } = await estadoAcceso('config')
  if (estado !== 'OK') return NextResponse.json({ ok: false, error: 'Sin permiso.' }, { status: estado === 'SIN_SESION' ? 401 : 403 })

  const { id } = await params
  const total = (await conEmpresa(esquema, (db) => db.query(`select count(*)::int as n from sedes`))).rows[0].n
  if (total <= 1) return NextResponse.json({ ok: false, error: 'Debe existir al menos una sede.' }, { status: 400 })

  const { rows } = await conEmpresa(esquema, (db) => db.query(`delete from sedes where id = $1 returning id`, [id]))
  if (rows.length === 0) return NextResponse.json({ ok: false, error: 'Sede no encontrada.' }, { status: 404 })
  return NextResponse.json({ ok: true })
}
