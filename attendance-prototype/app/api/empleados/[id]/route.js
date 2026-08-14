/**
 * app/api/empleados/[id]/route.js
 * PATCH  — edita datos no biométricos (o el rostro si llega descriptor).
 * DELETE — baja LÓGICA (activo = false): el historial de marcaciones se
 *          conserva; el kiosco deja de reconocerlo.
 */
import { NextResponse } from 'next/server'
import { conEmpresa } from '../../../../lib/db.js'
import { estadoAcceso } from '../../../../lib/sesion'
import { validarDias } from '../../../../lib/horariosDias.js'
import { cabeOtroEmpleado } from '../../../../lib/empresas.js'

export const runtime = 'nodejs'

const CAMPOS = {
  nombre: 'nombre',
  cedula: 'cedula',
  // A dónde llega el comprobante de cada marcación; null = no se envía.
  correo: 'correo',
  sede_id: 'sede_id',
  entrada_esperada: 'entrada_esperada',
  salida_esperada: 'salida_esperada',
  almuerzo_min: 'almuerzo_min',
  // Jornada POR DÍAS (copia del horario asignado); null = usar los uniformes.
  jornada_dias: 'jornada_dias',
  jornada_semanal: 'jornada_semanal',
  salario_mensual: 'salario_mensual',
  descriptor_facial: 'descriptor_facial',
  activo: 'activo',
  // Exigir que marque en su sede (la sede en sí es solo organizativa).
  validar_sede: 'validar_sede',
  // Sin sede: registrar la ubicación GPS de cada marcación.
  validar_ubicacion: 'validar_ubicacion',
}

/** Jornada distribuida válida: null (estándar) o [lun..sáb] con horas 0–12. */
const jornadaValida = (v) =>
  v === null || (Array.isArray(v) && v.length === 6 && v.every((h) => typeof h === 'number' && h >= 0 && h <= 12))

/**
 * Salario mensual: OPCIONAL. null borra el que hubiera (y sus horas dejan de
 * valorizarse); cualquier otro valor debe ser un número positivo.
 */
const salarioValido = (v) => v === null || (typeof v === 'number' && Number.isFinite(v) && v > 0)

export async function PATCH(req, { params }) {
  const { estado, esquema, empresa } = await estadoAcceso('empleados')
  if (estado !== 'OK') return NextResponse.json({ ok: false, error: 'Sin permiso.' }, { status: estado === 'SIN_SESION' ? 401 : 403 })

  const { id } = await params
  let c
  try { c = await req.json() } catch { return NextResponse.json({ ok: false, error: 'JSON inválido.' }, { status: 400 }) }

  // REACTIVAR a alguien archivado ocupa cupo otra vez: mismo tope que un alta.
  if (c?.activo === true && empresa) {
    const cupo = await cabeOtroEmpleado(empresa)
    if (!cupo.cabe) {
      return NextResponse.json({
        ok: false,
        error: `No hay cupo para reactivarlo: el plan llega hasta ${cupo.limite} empleados activos y ya tienes ${cupo.actuales}. Desactiva a otro o pasa a plan de pago.`,
      }, { status: 402 })
    }
  }

  const sets = []
  const args = []
  for (const [k, col] of Object.entries(CAMPOS)) {
    if (k in (c ?? {})) {
      let v = c[k]
      if (k === 'cedula' && v != null) v = String(v).replace(/\D/g, '') || null
      if (k === 'nombre') { v = String(v).trim(); if (!v) return NextResponse.json({ ok: false, error: 'El nombre no puede quedar vacío.' }, { status: 400 }) }
      if (k === 'correo') {
        v = String(v ?? '').trim().toLowerCase() || null
        if (v && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) {
          return NextResponse.json({ ok: false, error: 'El correo no parece válido. Corrígelo o déjalo vacío.' }, { status: 400 })
        }
      }
      if (k === 'jornada_dias') {
        if (v === null) {
          // null borra la jornada por días: vuelve a mandar la uniforme.
        } else {
          const r = validarDias(v)
          if (r.error) return NextResponse.json({ ok: false, error: r.error }, { status: 400 })
          v = JSON.stringify(r.dias)
        }
      }
      if (k === 'jornada_semanal' && !jornadaValida(v)) {
        return NextResponse.json({ ok: false, error: 'jornada_semanal debe ser null o 6 horas (lun–sáb) entre 0 y 12.' }, { status: 400 })
      }
      if (k === 'salario_mensual' && !salarioValido(v)) {
        return NextResponse.json({ ok: false, error: 'El salario mensual debe ser un número mayor que cero, o null para dejarlo sin registrar.' }, { status: 400 })
      }
      args.push(v)
      sets.push(`${col} = $${args.length}`)
    }
  }
  if (sets.length === 0) return NextResponse.json({ ok: false, error: 'Nada que actualizar.' }, { status: 400 })

  args.push(id)
  try {
    const { rows } = await conEmpresa(esquema, (db) => db.query(
      `update empleados set ${sets.join(', ')} where id = $${args.length}
       returning id, nombre, cedula, correo, sede_id, entrada_esperada, salida_esperada, almuerzo_min, jornada_dias, jornada_semanal, salario_mensual, activo`,
      args,
    ))
    if (rows.length === 0) return NextResponse.json({ ok: false, error: 'Empleado no encontrado.' }, { status: 404 })
    return NextResponse.json({ ok: true, empleado: rows[0] })
  } catch (e) {
    if (e.code === '23505') return NextResponse.json({ ok: false, error: 'Ya existe un empleado con esa cédula.' }, { status: 409 })
    throw e
  }
}

export async function DELETE(req, { params }) {
  const { estado, esquema } = await estadoAcceso('empleados')
  if (estado !== 'OK') return NextResponse.json({ ok: false, error: 'Sin permiso.' }, { status: estado === 'SIN_SESION' ? 401 : 403 })

  const { id } = await params
  const { rows } = await conEmpresa(esquema, (db) => db.query(
    `update empleados set activo = false where id = $1 returning id`,
    [id],
  ))
  if (rows.length === 0) return NextResponse.json({ ok: false, error: 'Empleado no encontrado.' }, { status: 404 })
  return NextResponse.json({ ok: true })
}
