/**
 * app/api/empleados/[id]/rostros/route.js
 *
 * Los rostros de UN empleado ya registrado. Existe para no obligar a dar de
 * alta otra vez a quien solo necesita otra foto: los datos (cédula, horario,
 * correo…) se piden una sola vez en la vida.
 *
 * GET    — cuántos rostros tiene y cuándo se tomaron (nunca los descriptores:
 *          son dato biométrico y el panel no los necesita para listarlos).
 * POST   — agrega un rostro. Antes de guardarlo comprueba que no colisione con
 *          OTRO empleado, que es como entraron al sistema las parejas que
 *          después se confunden.
 * DELETE — quita un rostro (?rostro=<id>). Nunca deja a alguien sin ninguno.
 */
import { NextResponse } from 'next/server'
import { conEmpresa } from '../../../../../lib/db.js'
import { estadoAcceso } from '../../../../../lib/sesion'
import { euclideanDistance, MATCH_THRESHOLD, MARGEN_MINIMO } from '../../../../../utils/faceMath.js'

export const runtime = 'nodejs'

/**
 * Un rostro nuevo es SOSPECHOSO si se parece a otro empleado tanto como para
 * que el kiosco pueda confundirlos. El listón está por encima del umbral de
 * aceptación a propósito: no basta con que hoy no colisione — tiene que haber
 * margen para que mañana, con otra luz, tampoco.
 */
const LIMITE_COLISION = MATCH_THRESHOLD + MARGEN_MINIMO // 0.60

const esDescriptor = (d) =>
  Array.isArray(d) && d.length === 128 && d.every((n) => typeof n === 'number' && Number.isFinite(n))

export async function GET(req, { params }) {
  const { estado, esquema } = await estadoAcceso('ver')
  if (estado !== 'OK') return NextResponse.json({ ok: false, error: 'Sin permiso.' }, { status: estado === 'SIN_SESION' ? 401 : 403 })

  const { id } = await params
  const { rows } = await conEmpresa(esquema, (db) => db.query(
    `select id, origen, creado_en from rostros where empleado_id = $1 order by creado_en`, [id],
  ))
  return NextResponse.json({ ok: true, rostros: rows })
}

export async function POST(req, { params }) {
  const { estado, esquema } = await estadoAcceso('empleados')
  if (estado !== 'OK') return NextResponse.json({ ok: false, error: 'Sin permiso.' }, { status: estado === 'SIN_SESION' ? 401 : 403 })

  const { id } = await params
  let c
  try { c = await req.json() } catch { return NextResponse.json({ ok: false, error: 'JSON inválido.' }, { status: 400 }) }
  if (!esDescriptor(c?.descriptor)) {
    return NextResponse.json({ ok: false, error: 'La foto no trae un rostro válido.' }, { status: 400 })
  }

  const r = await conEmpresa(esquema, async (db) => {
    const yo = await db.query(`select id, nombre from empleados where id = $1 and activo`, [id])
    if (yo.rowCount === 0) return { error: 'NO_EXISTE' }

    // Contra los rostros de LOS DEMÁS: si el nuevo se parece demasiado a otra
    // persona, guardarlo sería sembrar la confusión que luego cuesta rastrear.
    const otros = await db.query(
      `select r.descriptor, e.nombre
         from rostros r join empleados e on e.id = r.empleado_id
        where e.activo and e.id <> $1`, [id],
    )
    let choque = null
    for (const o of otros.rows) {
      const d = euclideanDistance(c.descriptor, o.descriptor)
      if (d < LIMITE_COLISION && (!choque || d < choque.distancia)) choque = { nombre: o.nombre, distancia: d }
    }
    if (choque && !c.forzar) return { choque }

    const ins = await db.query(
      `insert into rostros (empleado_id, descriptor, origen) values ($1,$2,$3) returning id, creado_en`,
      [id, c.descriptor, c.origen === 'kiosco' ? 'kiosco' : 'registro'],
    )
    // Sin rostro principal (empleado creado sin foto), el primero lo ocupa.
    await db.query(
      `update empleados set descriptor_facial = $2 where id = $1 and descriptor_facial is null`,
      [id, c.descriptor],
    )
    const total = await db.query(`select count(*)::int n from rostros where empleado_id = $1`, [id])
    return { rostro: ins.rows[0], total: total.rows[0].n, aviso: choque ?? null }
  })

  if (r.error === 'NO_EXISTE') return NextResponse.json({ ok: false, error: 'Empleado no encontrado.' }, { status: 404 })
  if (r.choque) {
    return NextResponse.json({
      ok: false,
      error: `Esta foto se parece demasiado a ${r.choque.nombre} (distancia ${r.choque.distancia.toFixed(3)}). Toma otra de frente y con mejor luz, o el kiosco podría confundirlos.`,
      choque: { nombre: r.choque.nombre, distancia: Math.round(r.choque.distancia * 1000) / 1000 },
    }, { status: 409 })
  }
  return NextResponse.json({ ok: true, ...r })
}

export async function DELETE(req, { params }) {
  const { estado, esquema } = await estadoAcceso('empleados')
  if (estado !== 'OK') return NextResponse.json({ ok: false, error: 'Sin permiso.' }, { status: estado === 'SIN_SESION' ? 401 : 403 })

  const { id } = await params
  const rostroId = new URL(req.url).searchParams.get('rostro')
  if (!rostroId) return NextResponse.json({ ok: false, error: 'Falta cuál rostro quitar.' }, { status: 400 })

  const r = await conEmpresa(esquema, async (db) => {
    const { rows } = await db.query(`select id, descriptor from rostros where empleado_id = $1 order by creado_en`, [id])
    if (rows.length <= 1) return { error: 'ULTIMO' }
    const borrado = await db.query(`delete from rostros where id = $1 and empleado_id = $2 returning id`, [rostroId, id])
    if (borrado.rowCount === 0) return { error: 'NO_EXISTE' }
    // El principal debe seguir siendo uno de los que quedan.
    const resto = rows.filter((x) => x.id !== rostroId)
    await db.query(`update empleados set descriptor_facial = $2 where id = $1`, [id, resto[0].descriptor])
    return { total: resto.length }
  })

  if (r.error === 'ULTIMO') {
    return NextResponse.json({ ok: false, error: 'Es su único rostro: sin él no podría marcar. Agrega otro antes de quitar este.' }, { status: 409 })
  }
  if (r.error === 'NO_EXISTE') return NextResponse.json({ ok: false, error: 'Ese rostro no existe.' }, { status: 404 })
  return NextResponse.json({ ok: true, ...r })
}
