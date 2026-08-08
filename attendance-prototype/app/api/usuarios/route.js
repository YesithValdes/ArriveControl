/**
 * app/api/usuarios/route.js
 * GET  — lista los usuarios de ArriveControl (sesión + permiso `usuarios`).
 * POST — crea uno con su rol y contraseña inicial.
 *
 * El registro abierto está deshabilitado: solo un dueño da de alta usuarios.
 */
import { NextResponse } from 'next/server'
import { auth, pool } from '../../../lib/auth'
import { estadoAcceso } from '../../../lib/sesion'
import { ROLES, listaRoles } from '../../../lib/roles.js'

export const runtime = 'nodejs'

export async function GET() {
  const { estado } = await estadoAcceso('usuarios')
  if (estado !== 'OK') {
    return NextResponse.json({ ok: false, error: 'Sin acceso.' }, { status: estado === 'SIN_SESION' ? 401 : 403 })
  }
  const { rows } = await pool.query(
    `select u.id, u.name as nombre, u.email, u.rol, u.sede_id as "sedeId",
            s.nombre as "sedeNombre", u.activo, u.ultimo_acceso as "ultimoAcceso", u.created_at as "creadoEn"
       from asistencia."user" u
       left join asistencia.sedes s on s.id = u.sede_id
      order by u.created_at`,
  )
  return NextResponse.json({ ok: true, usuarios: rows, roles: listaRoles() })
}

export async function POST(req) {
  const { estado } = await estadoAcceso('usuarios')
  if (estado !== 'OK') {
    return NextResponse.json({ ok: false, error: 'Sin permiso para crear usuarios.' }, { status: estado === 'SIN_SESION' ? 401 : 403 })
  }

  let c
  try { c = await req.json() } catch { return NextResponse.json({ ok: false, error: 'JSON inválido.' }, { status: 400 }) }

  const nombre = String(c?.nombre ?? '').trim()
  const email = String(c?.email ?? '').trim().toLowerCase()
  const password = String(c?.password ?? '')
  const rol = String(c?.rol ?? '')

  if (!nombre) return NextResponse.json({ ok: false, error: 'El nombre es obligatorio.' }, { status: 400 })
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return NextResponse.json({ ok: false, error: 'Correo inválido.' }, { status: 400 })
  if (password.length < 8) return NextResponse.json({ ok: false, error: 'La contraseña debe tener al menos 8 caracteres.' }, { status: 400 })
  if (!ROLES[rol]) return NextResponse.json({ ok: false, error: 'Rol inválido.' }, { status: 400 })
  // El supervisor sin sede no vería nada: se exige elegirla al crearlo.
  const sedeId = c?.sede_id || null
  if (ROLES[rol].alcance === 'sede' && !sedeId) {
    return NextResponse.json({ ok: false, error: 'Un supervisor necesita una sede asignada.' }, { status: 400 })
  }

  try {
    const creado = await auth.api.createUser({
      body: {
        email,
        password,
        name: nombre,
        data: { rol, sedeId: ROLES[rol].alcance === 'sede' ? sedeId : null, activo: true },
      },
    })
    return NextResponse.json({ ok: true, usuario: { id: creado.user.id, email: creado.user.email, nombre, rol } })
  } catch (e) {
    const msg = String(e?.body?.message ?? e?.message ?? e)
    if (/exist/i.test(msg)) return NextResponse.json({ ok: false, error: 'Ya existe un usuario con ese correo.' }, { status: 409 })
    return NextResponse.json({ ok: false, error: `No se pudo crear el usuario: ${msg}` }, { status: 400 })
  }
}
