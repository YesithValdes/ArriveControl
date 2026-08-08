/**
 * app/api/colaboradores-gestor/route.js
 * GET ?buscar=texto — busca colaboradores ACTIVOS del gestor de empleados
 * (public.colaborador, misma base) para el registro de empleados de asistencia.
 *
 * El gestor es la UNICA fuente de identidad: aqui no se digitan nombres ni
 * cedulas, se ELIGEN. Se exponen solo los campos minimos para identificar a
 * la persona (nada de salud, salario ni datos sensibles), y se marca si ya
 * esta registrada en asistencia para no ofrecerla dos veces.
 *
 * Requiere sesion con permiso CREAR sobre `asistencia` (el mismo del alta).
 */
import { NextResponse } from 'next/server'
import { pool } from '../../../lib/db.js'
import { estadoAcceso } from '../../../lib/sesion'

export const runtime = 'nodejs'

export async function GET(req) {
  const { estado } = await estadoAcceso('empleados')
  if (estado !== 'OK') {
    return NextResponse.json({ ok: false, error: 'Sin permiso.' }, { status: estado === 'SIN_SESION' ? 401 : 403 })
  }

  const buscar = (new URL(req.url).searchParams.get('buscar') ?? '').trim().toLowerCase()
  if (buscar.length < 2) return NextResponse.json({ ok: true, colaboradores: [] })

  // busqueda_normalizada ya viene sin tildes y en minusculas desde el gestor.
  const { rows } = await pool.query(
    `select c.id, c.nombres, c.apellidos, c.numero_documento as cedula,
            s.nombre as sede_gestor,
            (e.id is not null) as ya_registrado,
            (c.foto_path is not null) as tiene_foto
       from public.colaborador c
       join public.sede s on s.id = c.sede_id
       left join asistencia.empleados e on e.colaborador_id = c.id
      where c.estado = 'ACTIVO'
        and (c.busqueda_normalizada like '%' || $1 || '%'
             or c.numero_documento like $1 || '%')
      order by c.apellidos, c.nombres
      limit 15`,
    [buscar],
  )
  return NextResponse.json({ ok: true, colaboradores: rows })
}
