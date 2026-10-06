/**
 * app/api/jornadas/route.js
 * GET — la jornada de cada empleado activo: su mapa de días (`dias`, la copia
 *       del horario asignado) y, para quien no lo tiene, la franja uniforme de
 *       respaldo (`entrada`/`salida`, que aplica a todos los días).
 *
 * Lo pide el sistema de gestión humana con la clave de API (X-API-Key) para
 * importar los horarios; con sesión del panel, el permiso de ver. La cédula
 * (`documento`) es la llave de cruce entre los dos sistemas.
 */
import { NextResponse } from 'next/server'
import { conEmpresa } from '../../../lib/db.js'
import { estadoAcceso, estadoAHttp, estadoAMensaje } from '../../../lib/sesion'
import { empresaDeApiKey } from '../../../lib/empresas.js'

export const runtime = 'nodejs'

export async function GET(req) {
  const clave = req.headers.get('x-api-key')
  let esquema
  if (clave) {
    const { empresa, status, error } = await empresaDeApiKey(clave)
    if (!empresa) return NextResponse.json({ ok: false, error }, { status })
    esquema = empresa.esquema
  } else {
    const acceso = await estadoAcceso('ver')
    if (acceso.estado !== 'OK') return NextResponse.json({ ok: false, error: estadoAMensaje(acceso.estado) }, { status: estadoAHttp(acceso.estado) })
    esquema = acceso.esquema
  }

  const { rows } = await conEmpresa(esquema, (db) => db.query(
    `select e.cedula as documento, e.nombre, s.nombre as sede, e.jornada_dias as dias,
            left(e.entrada_esperada::text, 5) as entrada, left(e.salida_esperada::text, 5) as salida,
            e.almuerzo_min
       from empleados e
       left join sedes s on s.id = e.sede_id
      where e.activo and e.cedula is not null
      order by e.nombre`,
  ))
  return NextResponse.json({ ok: true, jornadas: rows })
}
