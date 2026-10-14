/**
 * Permisos individuales de un usuario Invitado o de una invitación pendiente
 * de ESTA empresa (lib/roles.js, MODULOS_INVITADO).
 *
 * Solo quien tiene permiso `usuarios` (el Propietario): un Invitado nunca lo
 * tiene, así que no puede cambiar ni sus permisos ni los de otros. La fila
 * se busca por id Y empresa_id, así que no se tocan personas de otra empresa.
 * Lo exclusivo del Propietario se descarta al guardar (normalizar).
 */
import { NextResponse } from 'next/server'
import { pool } from '../../../../lib/auth'
import { estadoAcceso, estadoAHttp, estadoAMensaje } from '../../../../lib/sesion'
import { SECCIONES_INVITADO, MODULOS_INVITADO, PERFILES_INVITADO, VISTAS_INVITADO, normalizarPermisosInvitado, permisosInvitado } from '../../../../lib/roles.js'

export const runtime = 'nodejs'

async function acceso(req) {
  const ctx = await estadoAcceso('usuarios')
  if (ctx.estado !== 'OK') return { error: NextResponse.json({ ok: false, error: estadoAMensaje(ctx.estado) }, { status: estadoAHttp(ctx.estado) }) }
  const query = new URL(req.url).searchParams
  const tipo = query.get('tipo'), id = query.get('id')
  if (!id || !['usuario', 'invitacion'].includes(tipo)) return { error: NextResponse.json({ ok: false, error: 'Selecciona una persona Invitada.' }, { status: 400 }) }
  return { ...ctx, target: { id, tabla: tipo === 'usuario' ? 'control."user"' : 'control.invitaciones', pendiente: tipo === 'invitacion' ? ' and aceptada_en is null and expira_en > now()' : '' } }
}

export async function GET(req) {
  const { empresa, target, error } = await acceso(req)
  if (error) return error
  const { rows } = await pool.query(
    `select permisos_invitado from ${target.tabla} where id = $1 and empresa_id = $2 and rol = 'invitado'${target.pendiente}`,
    [target.id, empresa.id],
  )
  if (!rows.length) return NextResponse.json({ ok: false, error: 'Persona Invitada no encontrada.' }, { status: 404 })
  return NextResponse.json({
    ok: true, permisos: permisosInvitado(rows[0]),
    secciones: SECCIONES_INVITADO, modulos: MODULOS_INVITADO, vistas: VISTAS_INVITADO,
    perfiles: PERFILES_INVITADO.map((p) => ({ clave: p.clave, etiqueta: p.etiqueta, permisos: normalizarPermisosInvitado(p.permisos) })),
  })
}

export async function PUT(req) {
  const { empresa, target, error } = await acceso(req)
  if (error) return error
  let body
  try { body = await req.json() } catch { return NextResponse.json({ ok: false, error: 'JSON inválido.' }, { status: 400 }) }
  if (!Array.isArray(body?.permisos) || body.permisos.some(p => typeof p !== 'string')) return NextResponse.json({ ok: false, error: 'Falta una lista válida de permisos.' }, { status: 400 })
  const permisos = normalizarPermisosInvitado(body.permisos)
  const { rowCount } = await pool.query(
    `update ${target.tabla} set permisos_invitado = $3 where id = $1 and empresa_id = $2 and rol = 'invitado'${target.pendiente}`,
    [target.id, empresa.id, permisos],
  )
  if (!rowCount) return NextResponse.json({ ok: false, error: 'Persona Invitada no encontrada.' }, { status: 404 })
  return NextResponse.json({ ok: true, permisos })
}
