/**
 * app/api/empleados/route.js
 * GET  — roster de empleados activos.
 *        · Con X-Device-Key (kiosco): INCLUYE descriptor facial (lo necesita
 *          para la comparación 1:N local).
 *        · Con sesión del gestor (panel): SIN descriptores (no los necesita
 *          y son el 95% del peso).
 * POST — alta de empleado (registro por foto). Sesión + permiso CREAR.
 */
import { NextResponse } from 'next/server'
import { pool } from '../../../lib/db.js'
import { estadoAcceso } from '../../../lib/sesion'

export const runtime = 'nodejs'

export async function GET(req) {
  // ?rostros=1 → modo KIOSCO (sin autenticación, ver nota en /api/marcaciones):
  // solo id + nombre + descriptor, lo mínimo para la comparación facial 1:N.
  if (new URL(req.url).searchParams.get('rostros') === '1') {
    const { rows } = await pool.query(
      `select id, nombre, sede_id, descriptor_facial
         from asistencia.empleados where activo order by nombre`,
    )
    return NextResponse.json({ ok: true, empleados: rows })
  }

  const { estado } = await estadoAcceso('VER')
  if (estado !== 'OK') return NextResponse.json({ ok: false, error: 'Sin acceso.' }, { status: estado === 'SIN_SESION' ? 401 : 403 })

  const { searchParams } = new URL(req.url)
  const incluirInactivos = searchParams.get('inactivos') === '1'
  const { rows } = await pool.query(
    `select e.id, e.nombre, e.cedula, e.sede_id, s.nombre as sede_nombre,
            e.entrada_esperada, e.salida_esperada, e.almuerzo_min, e.jornada_semanal, e.activo, e.creado_en,
            (e.descriptor_facial is not null) as tiene_rostro
       from asistencia.empleados e
       left join asistencia.sedes s on s.id = e.sede_id
      ${incluirInactivos ? '' : 'where e.activo'}
      order by e.nombre`,
  )
  return NextResponse.json({ ok: true, empleados: rows })
}

export async function POST(req) {
  const { estado } = await estadoAcceso('CREAR')
  if (estado !== 'OK') return NextResponse.json({ ok: false, error: 'Sin permiso para registrar empleados.' }, { status: estado === 'SIN_SESION' ? 401 : 403 })

  let c
  try { c = await req.json() } catch { return NextResponse.json({ ok: false, error: 'JSON inválido.' }, { status: 400 }) }
  const nombre = String(c?.nombre ?? '').trim()
  if (!nombre) return NextResponse.json({ ok: false, error: 'El nombre es obligatorio.' }, { status: 400 })
  const cedula = c?.cedula ? String(c.cedula).replace(/\D/g, '') : null
  const descriptor = Array.isArray(c?.descriptor_facial) && c.descriptor_facial.length === 128 ? c.descriptor_facial : null
  // Jornada distribuida (opcional): [lun..sáb], 6 horas-por-día entre 0 y 12.
  const jornada = Array.isArray(c?.jornada_semanal)
    && c.jornada_semanal.length === 6
    && c.jornada_semanal.every((h) => typeof h === 'number' && h >= 0 && h <= 12)
    ? c.jornada_semanal : null

  try {
    const { rows } = await pool.query(
      `insert into asistencia.empleados
         (nombre, cedula, sede_id, entrada_esperada, salida_esperada, almuerzo_min, jornada_semanal, descriptor_facial)
       values ($1,$2,$3,$4,$5,$6,$7,$8)
       returning id, nombre, cedula, sede_id, entrada_esperada, salida_esperada, almuerzo_min, jornada_semanal, activo, creado_en`,
      [nombre, cedula, c.sede_id ?? null, c.entrada_esperada ?? null, c.salida_esperada ?? null,
       c.almuerzo_min ?? 60, jornada, descriptor],
    )
    return NextResponse.json({ ok: true, empleado: rows[0] })
  } catch (e) {
    if (e.code === '23505') return NextResponse.json({ ok: false, error: 'Ya existe un empleado con esa cédula.' }, { status: 409 })
    throw e
  }
}
