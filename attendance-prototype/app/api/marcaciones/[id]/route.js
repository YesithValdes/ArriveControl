/**
 * app/api/marcaciones/[id]/route.js
 * PATCH  — corrige hora y/o tipo de una marcación (motivo obligatorio).
 * DELETE — soft-delete de una marcación errónea (motivo obligatorio, va en
 *          el query string: ?motivo=...).
 * Ambos dejan su fila de auditoría en `correcciones` con el antes/después,
 * en la misma transacción que el cambio.
 */
import { NextResponse } from 'next/server'
import { conEmpresa } from '../../../../lib/db.js'
import { estadoAcceso } from '../../../../lib/sesion'

export const runtime = 'nodejs'

export async function PATCH(req, { params }) {
  const { estado, usuario, esquema } = await estadoAcceso('corregir')
  if (estado !== 'OK') return NextResponse.json({ ok: false, error: 'Sin permiso.' }, { status: estado === 'SIN_SESION' ? 401 : 403 })

  const { id } = await params
  let c
  try { c = await req.json() } catch { return NextResponse.json({ ok: false, error: 'JSON inválido.' }, { status: 400 }) }
  const { ts, tipo, motivo } = c ?? {}
  if (!ts && !tipo) return NextResponse.json({ ok: false, error: 'Nada que corregir (ts y/o tipo).' }, { status: 400 })
  if (tipo && !['entrada', 'salida'].includes(tipo)) return NextResponse.json({ ok: false, error: 'tipo inválido.' }, { status: 400 })
  if (!String(motivo ?? '').trim()) return NextResponse.json({ ok: false, error: 'El motivo es obligatorio.' }, { status: 400 })

  // `conEmpresa` abre la transacción y fija el esquema. El cambio y su fila de
  // auditoría van dentro de ella: o quedan los dos, o no queda ninguno.
  const r = await conEmpresa(esquema, async (client) => {
    const antes = await client.query(
      `select id, tipo, ts from marcaciones where id = $1 and not eliminada for update`, [id],
    )
    // Se sale devolviendo, sin `rollback`: la transacción la cierra el
    // envoltorio, y aquí todavía no se escribió nada.
    if (antes.rowCount === 0) return { noEncontrada: true }
    const prev = antes.rows[0]

    const upd = await client.query(
      `update marcaciones set ts = coalesce($2, ts), tipo = coalesce($3, tipo)
        where id = $1 returning *`,
      [id, ts ?? null, tipo ?? null],
    )
    const accion = tipo && tipo !== prev.tipo ? 'editar_tipo' : 'editar_hora'
    await client.query(
      `insert into correcciones
         (marcacion_id, admin_user_id, admin_email, accion, valor_anterior, valor_nuevo, motivo)
       values ($1,$2,$3,$4,$5,$6,$7)`,
      [id, usuario.id, usuario.email, accion,
       JSON.stringify({ tipo: prev.tipo, ts: prev.ts }),
       JSON.stringify({ tipo: upd.rows[0].tipo, ts: upd.rows[0].ts }),
       motivo.trim()],
    )
    return { marcacion: upd.rows[0] }
  })

  if (r.noEncontrada) return NextResponse.json({ ok: false, error: 'Marcación no encontrada.' }, { status: 404 })
  // No se notifica a nadie: la nómina lee las marcaciones al liquidar, así que
  // una corrección queda reflejada sola en el siguiente cálculo.
  return NextResponse.json({ ok: true, marcacion: r.marcacion })
}

export async function DELETE(req, { params }) {
  const { estado, usuario, esquema } = await estadoAcceso('corregir')
  if (estado !== 'OK') return NextResponse.json({ ok: false, error: 'Sin permiso.' }, { status: estado === 'SIN_SESION' ? 401 : 403 })

  const { id } = await params
  const motivo = new URL(req.url).searchParams.get('motivo')
  if (!String(motivo ?? '').trim()) return NextResponse.json({ ok: false, error: 'El motivo es obligatorio (?motivo=...).' }, { status: 400 })

  const r = await conEmpresa(esquema, async (client) => {
    const antes = await client.query(
      `select tipo, ts from marcaciones where id = $1 and not eliminada for update`, [id],
    )
    if (antes.rowCount === 0) return { noEncontrada: true }
    // Baja LÓGICA: una marcación se paga, así que nunca se borra de verdad.
    await client.query(`update marcaciones set eliminada = true where id = $1`, [id])
    await client.query(
      `insert into correcciones (marcacion_id, admin_user_id, admin_email, accion, valor_anterior, motivo)
       values ($1,$2,$3,'eliminar',$4,$5)`,
      [id, usuario.id, usuario.email, JSON.stringify(antes.rows[0]), motivo.trim()],
    )
    return {}
  })

  if (r.noEncontrada) return NextResponse.json({ ok: false, error: 'Marcación no encontrada.' }, { status: 404 })
  return NextResponse.json({ ok: true })
}
