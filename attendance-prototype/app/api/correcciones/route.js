/**
 * app/api/correcciones/route.js
 * GET — historial de auditoría para el panel (quién cambió qué y por qué).
 */
import { NextResponse } from 'next/server'
import { conEmpresa, control } from '../../../lib/db.js'
import { estadoAcceso, estadoAHttp, estadoAMensaje } from '../../../lib/sesion'

export const runtime = 'nodejs'

export async function GET() {
  const { estado, esquema } = await estadoAcceso('ver')
  if (estado !== 'OK') return NextResponse.json({ ok: false, error: estadoAMensaje(estado) }, { status: estadoAHttp(estado) })

  const { rows } = await conEmpresa(esquema, (db) => db.query(
    `select c.id, c.marcacion_id, c.admin_email, c.accion, c.valor_anterior,
            c.valor_nuevo, c.motivo, c.ts,
            e.nombre as empleado_nombre
       from correcciones c
       left join marcaciones m on m.id = c.marcacion_id
       left join empleados e on e.id = m.empleado_id
      order by c.ts desc
      limit 500`,
  ))
  // El nombre de quien ajustó vive en control."user" (la identidad es global):
  // se cruza aquí para que el Historial diga «Alexis Valdés» y no un correo.
  const ids = [...new Set(rows.map((r) => r.admin_user_id).filter(Boolean))]
  const nombres = new Map()
  if (ids.length) {
    const { rows: us } = await control(`select id, name from control."user" where id = any($1::text[])`, [ids])
    for (const u of us) nombres.set(u.id, u.name)
  }
  return NextResponse.json({
    ok: true,
    correcciones: rows.map((r) => ({ ...r, admin_nombre: nombres.get(r.admin_user_id) ?? null })),
  })
}
