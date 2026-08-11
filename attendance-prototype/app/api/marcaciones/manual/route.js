/**
 * app/api/marcaciones/manual/route.js
 * POST — el ADMIN agrega una marcación manual (la salida olvidada, el día en
 * campo…). Exige motivo y deja la fila de auditoría en `correcciones`.
 * Marcación y auditoría van en la MISMA transacción: nunca un cambio sin rastro.
 */
import { NextResponse } from 'next/server'
import { conEmpresa } from '../../../../lib/db.js'
import { estadoAcceso } from '../../../../lib/sesion'

export const runtime = 'nodejs'

export async function POST(req) {
  const { estado, usuario, esquema } = await estadoAcceso('corregir')
  if (estado !== 'OK') return NextResponse.json({ ok: false, error: 'Sin permiso.' }, { status: estado === 'SIN_SESION' ? 401 : 403 })

  let c
  try { c = await req.json() } catch { return NextResponse.json({ ok: false, error: 'JSON inválido.' }, { status: 400 }) }
  const { empleado_id: empleadoId, tipo, ts, motivo, sede_id: sedeId } = c ?? {}
  if (!empleadoId || !['entrada', 'salida'].includes(tipo) || !ts) {
    return NextResponse.json({ ok: false, error: 'Faltan empleado_id, tipo (entrada|salida) o ts.' }, { status: 400 })
  }
  if (!String(motivo ?? '').trim()) {
    return NextResponse.json({ ok: false, error: 'El motivo es obligatorio.' }, { status: 400 })
  }

  try {
    // La marcación y su auditoría van en la MISMA transacción, la que abre
    // `conEmpresa`: nunca un cambio sin rastro.
    const marcacion = await conEmpresa(esquema, async (client) => {
      const ins = await client.query(
        `insert into marcaciones (empleado_id, tipo, ts, sede_id, origen)
         values ($1,$2,$3,$4,'manual') returning *`,
        [empleadoId, tipo, ts, sedeId ?? null],
      )
      await client.query(
        `insert into correcciones (marcacion_id, admin_user_id, admin_email, accion, valor_nuevo, motivo)
         values ($1,$2,$3,'crear',$4,$5)`,
        [ins.rows[0].id, usuario.id, usuario.email, JSON.stringify({ tipo, ts }), motivo.trim()],
      )
      return ins.rows[0]
    })
    return NextResponse.json({ ok: true, marcacion })
  } catch (e) {
    // 23503 = llave foránea: el empleado no existe EN ESTA empresa.
    if (e.code === '23503') return NextResponse.json({ ok: false, error: 'Empleado no encontrado.' }, { status: 404 })
    throw e
  }
}
