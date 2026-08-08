/**
 * app/api/config/route.js
 * GET   — configuración laboral vigente.
 * PATCH — la edita. Qué se puede editar depende del modo:
 *   · CONECTADO (hay gestor): jornada y festivos son SOLO LECTURA, los manda
 *     el gestor de nómina para que no existan dos verdades. Aquí solo la
 *     gracia de puntualidad, que es propia de asistencia.
 *   · AUTÓNOMO (sin gestor): todo se edita aquí, porque no hay nadie más.
 */
import { NextResponse } from 'next/server'
import { pool } from '../../../lib/db.js'
import { configLaboral, modoConectado } from '../../../lib/configLaboral.js'
import { horasSemanaEn } from '../../../lib/jornada.js'
import { estadoAcceso } from '../../../lib/sesion'

export const runtime = 'nodejs'

/** URL del gestor que puede abrir el NAVEGADOR (puede diferir de la interna). */
const urlPublicaGestor = () => process.env.GESTOR_PUBLIC_URL || process.env.GESTOR_URL || ''

export async function GET() {
  const { estado } = await estadoAcceso('ver')
  if (estado !== 'OK') return NextResponse.json({ ok: false, error: 'Sin acceso.' }, { status: estado === 'SIN_SESION' ? 401 : 403 })

  const { rows } = await pool.query(`select gracia_min from asistencia.config_laboral where id`)

  let laboral
  try {
    laboral = await configLaboral()
  } catch (e) {
    // Solo puede pasar en modo conectado: el gestor no respondió y no hay caché.
    return NextResponse.json({
      ok: true,
      config: { gracia_min: rows[0].gracia_min, horas_semana: null, festivos: null },
      gestor_error: e.message,
      gestor_url: urlPublicaGestor(),
      modo: 'conectado',
    })
  }

  const hoy = new Date().toISOString().slice(0, 10)
  return NextResponse.json({
    ok: true,
    modo: laboral.propia ? 'autonomo' : 'conectado',
    config: {
      gracia_min: rows[0].gracia_min,
      horas_semana: horasSemanaEn(laboral.vigencias, hoy),
      festivos: [...laboral.festivos].sort(),
    },
    // Qué NO se puede editar desde aquí (vacío en modo autónomo).
    solo_lectura: laboral.propia ? [] : ['horas_semana', 'festivos'],
    gestor_url: laboral.editarEn ? `${urlPublicaGestor()}${laboral.editarEn}` : null,
    desactualizada: laboral.desactualizada,
  })
}

export async function PATCH(req) {
  const { estado } = await estadoAcceso('config')
  if (estado !== 'OK') return NextResponse.json({ ok: false, error: 'Sin permiso.' }, { status: estado === 'SIN_SESION' ? 401 : 403 })

  let c
  try { c = await req.json() } catch { return NextResponse.json({ ok: false, error: 'JSON inválido.' }, { status: 400 }) }

  const conectado = modoConectado()
  if (conectado && ('horas_semana' in c || 'festivos' in c)) {
    return NextResponse.json(
      { ok: false, error: 'La jornada y los festivos se editan en el gestor de nómina, no aquí.', gestor_url: urlPublicaGestor() },
      { status: 409 },
    )
  }

  const sets = []
  const args = []

  if ('gracia_min' in c) {
    const v = Number(c.gracia_min)
    if (!Number.isInteger(v) || v < 0 || v > 240) return NextResponse.json({ ok: false, error: 'La gracia debe ser un número entre 0 y 240 minutos.' }, { status: 400 })
    args.push(v); sets.push(`gracia_min = $${args.length}`)
  }

  if (!conectado) {
    if ('horas_semana' in c) {
      const v = Number(c.horas_semana)
      if (!Number.isInteger(v) || v < 1 || v > 84) return NextResponse.json({ ok: false, error: 'La jornada semanal debe estar entre 1 y 84 horas.' }, { status: 400 })
      args.push(v); sets.push(`horas_semana = $${args.length}`)
    }
    if ('festivos' in c) {
      // Solo los festivos EXTRA de la empresa: el calendario oficial de
      // Colombia se calcula solo, no hay que cargarlo a mano.
      if (!Array.isArray(c.festivos) || c.festivos.some((f) => !/^\d{4}-\d{2}-\d{2}$/.test(f))) {
        return NextResponse.json({ ok: false, error: 'Los festivos deben ser una lista de fechas AAAA-MM-DD.' }, { status: 400 })
      }
      args.push(c.festivos); sets.push(`festivos = $${args.length}`)
    }
  }

  if (sets.length === 0) return NextResponse.json({ ok: false, error: 'Nada que actualizar.' }, { status: 400 })

  const { rows } = await pool.query(
    `update asistencia.config_laboral set ${sets.join(', ')} where id
     returning gracia_min, horas_semana, festivos`,
    args,
  )
  return NextResponse.json({ ok: true, config: rows[0] })
}
