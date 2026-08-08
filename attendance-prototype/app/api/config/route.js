/**
 * app/api/config/route.js
 * GET   — configuración laboral. Jornada y festivos vienen del GESTOR RH
 *         (fuente única, solo lectura aquí); solo `gracia_min` es local.
 * PATCH — edita únicamente `gracia_min`. Jornada y festivos se cambian en el
 *         gestor (el GET devuelve `gestor_url` para enlazar allá).
 */
import { NextResponse } from 'next/server'
import { pool } from '../../../lib/db.js'
import { configLaboral, horasSemanaEn } from '../../../lib/configLaboral.js'
import { estadoAcceso } from '../../../lib/sesion'

export const runtime = 'nodejs'

/** URL del gestor que puede abrir el NAVEGADOR (puede diferir de la interna). */
const urlPublicaGestor = () => process.env.GESTOR_PUBLIC_URL || process.env.GESTOR_URL || 'http://localhost:3000'

export async function GET() {
  const { estado } = await estadoAcceso('ver')
  if (estado !== 'OK') return NextResponse.json({ ok: false, error: 'Sin acceso.' }, { status: estado === 'SIN_SESION' ? 401 : 403 })

  const { rows } = await pool.query(`select gracia_min from asistencia.config_laboral where id`)

  let laboral
  try {
    laboral = await configLaboral()
  } catch (e) {
    // Sin gestor no hay jornada ni festivos que mostrar; la gracia sí.
    return NextResponse.json({
      ok: true,
      config: { gracia_min: rows[0].gracia_min, horas_semana: null, festivos: null },
      gestor_error: e.message,
      gestor_url: urlPublicaGestor(),
    })
  }

  const hoy = new Date().toISOString().slice(0, 10)
  return NextResponse.json({
    ok: true,
    config: {
      gracia_min: rows[0].gracia_min,
      horas_semana: horasSemanaEn(laboral.vigencias, hoy),
      festivos: [...laboral.festivos].sort(),
    },
    solo_lectura: ['horas_semana', 'festivos'],
    gestor_url: `${urlPublicaGestor()}${laboral.editarEn}`,
    desactualizada: laboral.desactualizada,
  })
}

export async function PATCH(req) {
  const { estado } = await estadoAcceso('config')
  if (estado !== 'OK') return NextResponse.json({ ok: false, error: 'Sin permiso.' }, { status: estado === 'SIN_SESION' ? 401 : 403 })

  let c
  try { c = await req.json() } catch { return NextResponse.json({ ok: false, error: 'JSON inválido.' }, { status: 400 }) }

  if ('horas_semana' in c || 'festivos' in c) {
    return NextResponse.json(
      { ok: false, error: 'La jornada y los festivos se editan en el gestor RH, no aquí.', gestor_url: urlPublicaGestor() },
      { status: 409 },
    )
  }
  if (!('gracia_min' in c)) return NextResponse.json({ ok: false, error: 'Nada que actualizar.' }, { status: 400 })

  const v = Number(c.gracia_min)
  if (!Number.isInteger(v) || v < 0 || v > 240) return NextResponse.json({ ok: false, error: 'gracia_min inválida (0–240).' }, { status: 400 })

  const { rows } = await pool.query(
    `update asistencia.config_laboral set gracia_min = $1 where id returning gracia_min`,
    [v],
  )
  return NextResponse.json({ ok: true, config: rows[0] })
}
