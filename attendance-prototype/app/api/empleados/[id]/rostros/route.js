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
import {
  euclideanDistance, MATCH_THRESHOLD, MARGEN_MINIMO,
  esDescriptorV2, similitudCosenoV2, V2_LIMITE_COLISION_SIM,
} from '../../../../../utils/faceMath.js'

export const runtime = 'nodejs'

/**
 * Un rostro nuevo es SOSPECHOSO si se parece a otro empleado tanto como para
 * que el kiosco pueda confundirlos. El listón está por encima del umbral de
 * aceptación a propósito: no basta con que hoy no colisione — tiene que haber
 * margen para que mañana, con otra luz, tampoco.
 *
 * Con v2 disponible EN AMBOS LADOS manda v2 (separa mucho mejor: parejas que
 * v1 confunde quedan lejos en v2, y al revés v1 puede dar falsas alarmas).
 * El chequeo v1 solo aplica contra rostros que aún no tienen v2.
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
  const v2 = esDescriptorV2(c?.descriptor_v2) ? c.descriptor_v2 : null

  const r = await conEmpresa(esquema, async (db) => {
    const yo = await db.query(`select id, nombre from empleados where id = $1 and activo`, [id])
    if (yo.rowCount === 0) return { error: 'NO_EXISTE' }

    // Contra los rostros de LOS DEMÁS: si el nuevo se parece demasiado a otra
    // persona, guardarlo sería sembrar la confusión que luego cuesta rastrear.
    const otros = await db.query(
      `select r.descriptor, r.descriptor_v2, e.nombre
         from rostros r join empleados e on e.id = r.empleado_id
        where e.activo and e.id <> $1`, [id],
    )
    let choque = null
    for (const o of otros.rows) {
      if (v2 && Array.isArray(o.descriptor_v2)) {
        // v2 contra v2: la medida buena. Se reporta como SIMILITUD.
        const s = similitudCosenoV2(v2, o.descriptor_v2)
        if (s > V2_LIMITE_COLISION_SIM && (!choque || s > (choque.similitud ?? -1))) {
          choque = { nombre: o.nombre, similitud: s }
        }
      } else {
        const d = euclideanDistance(c.descriptor, o.descriptor)
        if (d < LIMITE_COLISION && !choque?.similitud && (!choque || d < choque.distancia)) {
          choque = { nombre: o.nombre, distancia: d }
        }
      }
    }
    if (choque && !c.forzar) return { choque }

    const ins = await db.query(
      `insert into rostros (empleado_id, descriptor, descriptor_v2, origen) values ($1,$2,$3,$4) returning id, creado_en`,
      [id, c.descriptor, v2, c.origen === 'kiosco' ? 'kiosco' : 'registro'],
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
    const medida = r.choque.similitud != null
      ? `similitud ${r.choque.similitud.toFixed(3)}`
      : `distancia ${r.choque.distancia.toFixed(3)}`
    return NextResponse.json({
      ok: false,
      error: `Esta foto se parece demasiado a ${r.choque.nombre} (${medida}). Toma otra de frente y con mejor luz, o el kiosco podría confundirlos.`,
      choque: {
        nombre: r.choque.nombre,
        ...(r.choque.similitud != null
          ? { similitud: Math.round(r.choque.similitud * 1000) / 1000 }
          : { distancia: Math.round(r.choque.distancia * 1000) / 1000 }),
      },
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
