/**
 * app/api/correcciones/route.js
 * GET — historial de auditoría para el panel (quién cambió qué y por qué).
 */
import { NextResponse } from 'next/server'
import { pool } from '../../../lib/db.js'
import { estadoAcceso } from '../../../lib/sesion'

export const runtime = 'nodejs'

export async function GET() {
  const { estado } = await estadoAcceso('VER')
  if (estado !== 'OK') return NextResponse.json({ ok: false, error: 'Sin acceso.' }, { status: estado === 'SIN_SESION' ? 401 : 403 })

  const { rows } = await pool.query(
    `select c.id, c.marcacion_id, c.admin_email, c.accion, c.valor_anterior,
            c.valor_nuevo, c.motivo, c.ts,
            e.nombre as empleado_nombre
       from asistencia.correcciones c
       left join asistencia.marcaciones m on m.id = c.marcacion_id
       left join asistencia.empleados e on e.id = m.empleado_id
      order by c.ts desc
      limit 500`,
  )
  return NextResponse.json({ ok: true, correcciones: rows })
}
