/**
 * app/api/usuarios/[id]/route.js
 * PATCH  — activa o desactiva a alguien de la empresa.
 * DELETE — revoca una invitación que todavía no se ha aceptado.
 *
 * Ya no hay roles que repartir: todos los usuarios de una empresa tienen el
 * mismo poder. Lo único que se administra es quién sigue teniendo acceso —
 * desactivar es lo que se hace cuando alguien deja la empresa.
 *
 * Dos reglas que no se pueden saltar:
 *  - Siempre debe quedar al menos un usuario ACTIVO: si no, nadie podría
 *    volver a entrar a esa empresa nunca.
 *  - Nadie puede desactivarse a sí mismo (la forma más común de bloquearse).
 */
import { NextResponse } from 'next/server'
import { pool } from '../../../../lib/auth'
import { estadoAcceso, estadoAHttp, estadoAMensaje } from '../../../../lib/sesion'

export const runtime = 'nodejs'

export async function PATCH(req, { params }) {
  const { estado, usuario, empresa } = await estadoAcceso('usuarios')
  if (estado !== 'OK') {
    return NextResponse.json({ ok: false, error: estadoAMensaje(estado) }, { status: estadoAHttp(estado) })
  }

  const { id } = await params
  let c
  try { c = await req.json() } catch { return NextResponse.json({ ok: false, error: 'JSON inválido.' }, { status: 400 }) }

  const { rows: actuales } = await pool.query(
    `select id, activo from control."user" where id = $1 and empresa_id = $2`, [id, empresa.id],
  )
  if (actuales.length === 0) return NextResponse.json({ ok: false, error: 'Usuario no encontrado.' }, { status: 404 })

  const nuevoActivo = 'activo' in c ? Boolean(c.activo) : actuales[0].activo

  if (id === usuario.id && !nuevoActivo) {
    return NextResponse.json({ ok: false, error: 'No puedes desactivarte a ti mismo.' }, { status: 400 })
  }

  if (!nuevoActivo) {
    const { rows } = await pool.query(
      `select count(*)::int as n from control."user"
        where activo and empresa_id = $2 and id <> $1`, [id, empresa.id],
    )
    if (rows[0].n === 0) {
      return NextResponse.json(
        { ok: false, error: 'Debe quedar al menos una persona con acceso.' },
        { status: 400 },
      )
    }
  }

  const { rows } = await pool.query(
    `update control."user" set activo = $2, updated_at = now()
      where id = $1 and empresa_id = $3
      returning id, name as nombre, email, rol, activo`,
    [id, nuevoActivo, empresa.id],
  )
  return NextResponse.json({ ok: true, usuario: rows[0] })
}

/** Revoca una invitación pendiente (el id es el de `control.invitaciones`). */
export async function DELETE(_req, { params }) {
  const { estado, empresa } = await estadoAcceso('usuarios')
  if (estado !== 'OK') {
    return NextResponse.json({ ok: false, error: estadoAMensaje(estado) }, { status: estadoAHttp(estado) })
  }
  const { id } = await params
  const { rowCount } = await pool.query(
    `delete from control.invitaciones
      where id = $1 and empresa_id = $2 and aceptada_en is null`,
    [id, empresa.id],
  )
  if (rowCount === 0) return NextResponse.json({ ok: false, error: 'Invitación no encontrada.' }, { status: 404 })
  return NextResponse.json({ ok: true })
}
