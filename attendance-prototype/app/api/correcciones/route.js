/**
 * app/api/correcciones/route.js
 * GET — historial de auditoría para el panel (quién cambió qué y por qué).
 */
import { NextResponse } from 'next/server'
import { conEmpresa } from '../../../lib/db.js'
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
  return NextResponse.json({ ok: true, correcciones: rows })
}
