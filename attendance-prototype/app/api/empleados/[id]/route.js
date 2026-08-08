/**
 * app/api/empleados/[id]/route.js
 * PATCH  — edita datos no biométricos (o el rostro si llega descriptor).
 * DELETE — baja LÓGICA (activo = false): el historial de marcaciones se
 *          conserva; el kiosco deja de reconocerlo.
 */
import { NextResponse } from 'next/server'
import { pool } from '../../../../lib/db.js'
import { estadoAcceso } from '../../../../lib/sesion'

export const runtime = 'nodejs'

const CAMPOS = {
  nombre: 'nombre',
  cedula: 'cedula',
  sede_id: 'sede_id',
  entrada_esperada: 'entrada_esperada',
  salida_esperada: 'salida_esperada',
  almuerzo_min: 'almuerzo_min',
  jornada_semanal: 'jornada_semanal',
  descriptor_facial: 'descriptor_facial',
  activo: 'activo',
}

/** Jornada distribuida válida: null (estándar) o [lun..sáb] con horas 0–12. */
const jornadaValida = (v) =>
  v === null || (Array.isArray(v) && v.length === 6 && v.every((h) => typeof h === 'number' && h >= 0 && h <= 12))

export async function PATCH(req, { params }) {
  const { estado } = await estadoAcceso('empleados')
  if (estado !== 'OK') return NextResponse.json({ ok: false, error: 'Sin permiso.' }, { status: estado === 'SIN_SESION' ? 401 : 403 })

  const { id } = await params
  let c
  try { c = await req.json() } catch { return NextResponse.json({ ok: false, error: 'JSON inválido.' }, { status: 400 }) }

  const sets = []
  const args = []
  for (const [k, col] of Object.entries(CAMPOS)) {
    if (k in (c ?? {})) {
      let v = c[k]
      if (k === 'cedula' && v != null) v = String(v).replace(/\D/g, '') || null
      if (k === 'nombre') { v = String(v).trim(); if (!v) return NextResponse.json({ ok: false, error: 'El nombre no puede quedar vacío.' }, { status: 400 }) }
      if (k === 'jornada_semanal' && !jornadaValida(v)) {
        return NextResponse.json({ ok: false, error: 'jornada_semanal debe ser null o 6 horas (lun–sáb) entre 0 y 12.' }, { status: 400 })
      }
      args.push(v)
      sets.push(`${col} = $${args.length}`)
    }
  }
  if (sets.length === 0) return NextResponse.json({ ok: false, error: 'Nada que actualizar.' }, { status: 400 })

  args.push(id)
  try {
    const { rows } = await pool.query(
      `update asistencia.empleados set ${sets.join(', ')} where id = $${args.length}
       returning id, nombre, cedula, sede_id, entrada_esperada, salida_esperada, almuerzo_min, jornada_semanal, activo`,
      args,
    )
    if (rows.length === 0) return NextResponse.json({ ok: false, error: 'Empleado no encontrado.' }, { status: 404 })
    return NextResponse.json({ ok: true, empleado: rows[0] })
  } catch (e) {
    if (e.code === '23505') return NextResponse.json({ ok: false, error: 'Ya existe un empleado con esa cédula.' }, { status: 409 })
    throw e
  }
}

export async function DELETE(req, { params }) {
  const { estado } = await estadoAcceso('empleados')
  if (estado !== 'OK') return NextResponse.json({ ok: false, error: 'Sin permiso.' }, { status: estado === 'SIN_SESION' ? 401 : 403 })

  const { id } = await params
  const { rows } = await pool.query(
    `update asistencia.empleados set activo = false where id = $1 returning id`,
    [id],
  )
  if (rows.length === 0) return NextResponse.json({ ok: false, error: 'Empleado no encontrado.' }, { status: 404 })
  return NextResponse.json({ ok: true })
}
