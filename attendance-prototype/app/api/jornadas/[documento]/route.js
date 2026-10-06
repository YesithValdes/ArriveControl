/**
 * app/api/jornadas/[documento]/route.js
 * PUT — { dias } reemplaza la jornada por días de un empleado, buscado por su
 *       CÉDULA. Es como el sistema de gestión humana le cambia el horario a
 *       alguien: allá se asigna y aquí queda la copia con la que se calculan
 *       las horas extra, se cierra una salida olvidada y se marca la tardanza.
 *
 * Clave de API (X-API-Key) o sesión con permiso de empleados. El mapa pasa por
 * la misma validación que el panel (validarDias).
 */
import { NextResponse } from 'next/server'
import { conEmpresa } from '../../../../lib/db.js'
import { estadoAcceso, estadoAHttp, estadoAMensaje } from '../../../../lib/sesion'
import { empresaDeApiKey } from '../../../../lib/empresas.js'
import { validarDias } from '../../../../lib/horariosDias.js'

export const runtime = 'nodejs'

export async function PUT(req, { params }) {
  const clave = req.headers.get('x-api-key')
  let esquema
  if (clave) {
    const { empresa, status, error } = await empresaDeApiKey(clave)
    if (!empresa) return NextResponse.json({ ok: false, error }, { status })
    esquema = empresa.esquema
  } else {
    const acceso = await estadoAcceso('empleados')
    if (acceso.estado !== 'OK') return NextResponse.json({ ok: false, error: estadoAMensaje(acceso.estado) }, { status: estadoAHttp(acceso.estado) })
    esquema = acceso.esquema
  }

  const { documento } = await params
  const cedula = String(documento ?? '').replace(/[.\s-]/g, '')
  if (!cedula) return NextResponse.json({ ok: false, error: 'Falta la cédula.' }, { status: 400 })

  let c
  try { c = await req.json() } catch { return NextResponse.json({ ok: false, error: 'JSON inválido.' }, { status: 400 }) }
  const v = validarDias(c?.dias)
  if (v.error) return NextResponse.json({ ok: false, error: v.error }, { status: 400 })

  const { rows } = await conEmpresa(esquema, (db) => db.query(
    `update empleados set jornada_dias = $1 where cedula = $2 returning id, nombre, jornada_dias`,
    [JSON.stringify(v.dias), cedula],
  ))
  if (rows.length === 0) return NextResponse.json({ ok: false, error: `No hay ningún empleado con la cédula ${cedula}.` }, { status: 404 })
  return NextResponse.json({ ok: true, empleado: rows[0] })
}
