/**
 * app/api/usuarios/[id]/route.js
 * PATCH — cambia el rol, la sede o el estado (activo) de un usuario.
 *
 * Dos reglas de seguridad que no se pueden saltar:
 *  - Siempre debe quedar al menos un dueño ACTIVO (si no, nadie podría volver
 *    a administrar la cuenta).
 *  - Nadie puede quitarse a sí mismo el rol de dueño ni desactivarse: es la
 *    forma más común de quedar bloqueado por error.
 */
import { NextResponse } from 'next/server'
import { pool } from '../../../../lib/auth'
import { estadoAcceso } from '../../../../lib/sesion'
import { ROLES } from '../../../../lib/roles.js'

export const runtime = 'nodejs'

export async function PATCH(req, { params }) {
  const { estado, usuario } = await estadoAcceso('usuarios')
  if (estado !== 'OK') {
    return NextResponse.json({ ok: false, error: 'Sin permiso.' }, { status: estado === 'SIN_SESION' ? 401 : 403 })
  }

  const { id } = await params
  let c
  try { c = await req.json() } catch { return NextResponse.json({ ok: false, error: 'JSON inválido.' }, { status: 400 }) }

  const { rows: actuales } = await pool.query(
    `select id, rol, activo from asistencia."user" where id = $1`, [id],
  )
  if (actuales.length === 0) return NextResponse.json({ ok: false, error: 'Usuario no encontrado.' }, { status: 404 })
  const actual = actuales[0]

  const nuevoRol = 'rol' in c ? String(c.rol) : actual.rol
  const nuevoActivo = 'activo' in c ? Boolean(c.activo) : actual.activo
  if (!ROLES[nuevoRol]) return NextResponse.json({ ok: false, error: 'Rol inválido.' }, { status: 400 })

  if (id === usuario.id && (nuevoRol !== 'dueno' || !nuevoActivo)) {
    return NextResponse.json(
      { ok: false, error: 'No puedes quitarte a ti mismo el rol de dueño ni desactivarte. Pídeselo a otro dueño.' },
      { status: 400 },
    )
  }

  // ¿Quedaría la cuenta sin ningún dueño activo?
  const dejaDeSerDueno = actual.rol === 'dueno' && (nuevoRol !== 'dueno' || !nuevoActivo)
  if (dejaDeSerDueno) {
    const { rows } = await pool.query(
      `select count(*)::int as n from asistencia."user" where rol = 'dueno' and activo and id <> $1`, [id],
    )
    if (rows[0].n === 0) {
      return NextResponse.json(
        { ok: false, error: 'Debe quedar al menos un dueño activo. Nombra otro antes de hacer este cambio.' },
        { status: 400 },
      )
    }
  }

  // El supervisor necesita sede; los demás roles no la usan.
  const sedeId = ROLES[nuevoRol].alcance === 'sede' ? (c?.sede_id ?? null) : null
  if (ROLES[nuevoRol].alcance === 'sede' && !sedeId) {
    return NextResponse.json({ ok: false, error: 'Un supervisor necesita una sede asignada.' }, { status: 400 })
  }

  const { rows } = await pool.query(
    `update asistencia."user"
        set rol = $2, activo = $3, sede_id = $4, updated_at = now()
      where id = $1
      returning id, name as nombre, email, rol, sede_id as "sedeId", activo`,
    [id, nuevoRol, nuevoActivo, sedeId],
  )
  return NextResponse.json({ ok: true, usuario: rows[0] })
}
