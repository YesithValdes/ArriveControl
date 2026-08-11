/**
 * app/api/usuarios/route.js
 * GET  — quién tiene acceso a ESTA empresa (usuarios activos + invitaciones
 *        pendientes, que son personas que todavía no han entrado).
 * POST — invita a alguien por correo.
 *
 * Ya no se crean cuentas con contraseña: se entra con Google, así que lo único
 * que puede hacer una empresa es AUTORIZAR un correo. Cuando esa persona entre
 * por primera vez, el hook de registro (lib/registro.js) encuentra su
 * invitación y la mete a esta empresa en vez de crearle una propia.
 *
 * Todos los usuarios de una empresa tienen el mismo poder (rol `empresa`): la
 * plataforma no reparte permisos internos, eso es asunto de la empresa.
 */
import { NextResponse } from 'next/server'
import { pool } from '../../../lib/auth'
import { estadoAcceso, estadoAHttp, estadoAMensaje } from '../../../lib/sesion'

export const runtime = 'nodejs'

export async function GET() {
  const { estado, empresa } = await estadoAcceso('usuarios')
  if (estado !== 'OK') {
    return NextResponse.json({ ok: false, error: estadoAMensaje(estado) }, { status: estadoAHttp(estado) })
  }
  // El filtro por empresa_id es lo único que impide ver los usuarios de otro
  // cliente: `control."user"` es la única tabla compartida entre empresas.
  const { rows: usuarios } = await pool.query(
    `select u.id, u.name as nombre, u.email, u.rol, u.activo,
            u.ultimo_acceso as "ultimoAcceso", u.created_at as "creadoEn"
       from control."user" u
      where u.empresa_id = $1
      order by u.created_at`,
    [empresa.id],
  )

  // Invitados que aún no han entrado: aparecen en la misma lista porque para
  // quien administra son lo mismo — gente con acceso concedido.
  const { rows: invitaciones } = await pool.query(
    `select id, email, creada_en as "creadaEn", expira_en as "expiraEn"
       from control.invitaciones
      where empresa_id = $1 and aceptada_en is null and expira_en > now()
      order by creada_en`,
    [empresa.id],
  )

  return NextResponse.json({ ok: true, usuarios, invitaciones })
}

export async function POST(req) {
  const { estado, empresa, usuario } = await estadoAcceso('usuarios')
  if (estado !== 'OK') {
    return NextResponse.json({ ok: false, error: estadoAMensaje(estado) }, { status: estadoAHttp(estado) })
  }

  let c
  try { c = await req.json() } catch { return NextResponse.json({ ok: false, error: 'JSON inválido.' }, { status: 400 }) }

  const email = String(c?.email ?? '').trim().toLowerCase()
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return NextResponse.json({ ok: false, error: 'Correo inválido.' }, { status: 400 })
  }

  // Si ya tiene cuenta, invitarlo no sirve de nada: el hook de registro solo
  // mira invitaciones en el PRIMER ingreso. Hay que decirlo con claridad en vez
  // de dejar una invitación que nunca se va a aceptar.
  const { rows: yaExiste } = await pool.query(
    `select empresa_id from control."user" where lower(email) = $1`, [email],
  )
  if (yaExiste[0]) {
    return NextResponse.json({
      ok: false,
      error: yaExiste[0].empresa_id === empresa.id
        ? 'Esa persona ya tiene acceso.'
        : 'Ese correo ya tiene cuenta en otra empresa.',
    }, { status: 409 })
  }

  try {
    const { rows } = await pool.query(
      `insert into control.invitaciones (empresa_id, email, invitado_por)
       values ($1, $2, $3)
       returning id, email, expira_en as "expiraEn"`,
      [empresa.id, email, usuario.email],
    )
    return NextResponse.json({ ok: true, invitacion: rows[0] })
  } catch (e) {
    // El índice parcial `invitacion_pendiente_unica` impide que dos empresas
    // inviten al mismo correo a la vez (si no, ganaría quien entre primero).
    if (e.code === '23505') {
      return NextResponse.json({ ok: false, error: 'Ese correo ya tiene una invitación pendiente.' }, { status: 409 })
    }
    return NextResponse.json({ ok: false, error: `No se pudo invitar: ${e.message}` }, { status: 400 })
  }
}
