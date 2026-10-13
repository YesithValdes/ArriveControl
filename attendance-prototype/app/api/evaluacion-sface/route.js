/**
 * app/api/evaluacion-sface/route.js — Evaluación de SFace en el kiosco web.
 *
 * Todo exige que el superadmin haya habilitado la empresa
 * (control.empresas.laboratorio_facial); si no, la evaluación no existe.
 *
 * KIOSCO (clave de aparato, o sesión con `corregir`):
 *   GET  ?kiosco=1 → { fase, hasta, inscritos: [{empleado_id, vectores}] }
 *                    Con la fase apagada no baja ningún vector.
 *   POST { tipo: 'inscripcion', empleado_id, vector }   solo en fase inscripción
 *   POST { tipo: 'intento', ... }                        solo en fase medición
 *
 * PANEL (sesión con `empleados`):
 *   GET            → fase, inscritos por persona y reporte
 *   PATCH { estado, hasta? } → cambia de fase
 *   DELETE ?empleado_id=… | ?todo=1 → borra inscripciones (y con todo=1, también
 *                    los intentos): los vectores son datos biométricos.
 *
 * Nada de esto toca `rostros` ni `marcaciones`: el modelo actual sigue
 * decidiendo quién marca.
 */
import { NextResponse } from 'next/server'
import { conEmpresa } from '../../../lib/db.js'
import { estadoAcceso, estadoAHttp, estadoAMensaje, empresaDeLaPeticion } from '../../../lib/sesion'
import { laboratorioHabilitado } from '../../../lib/empresas.js'
import {
  FASES, SFACE_MAX_POR_PERSONA, esVectorSface, faseVigente, resumir, aceptaSface,
} from '../../../utils/evaluacionSface.js'

export const runtime = 'nodejs'

const json = (cuerpo, status = 200) => NextResponse.json(cuerpo, { status })
const NO_HABILITADA = 'La evaluación de modelos no está habilitada para esta empresa.'
const leerConfig = async (db) => (await db.query('select estado, hasta, actualizado_en from eval_sface_config where id')).rows[0]
const numONulo = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null)
const textoONulo = (v) => (typeof v === 'string' && v.length > 0 && v.length <= 64 ? v : null)

export async function GET(req) {
  const { searchParams } = new URL(req.url)

  if (searchParams.get('kiosco') === '1') {
    const ctx = await empresaDeLaPeticion(req, 'corregir')
    if (!ctx) return json({ ok: false, error: 'Sin acceso.' }, 401)
    // Sin habilitar, el kiosco ni se entera: fase apagada y nada que bajar.
    if (!laboratorioHabilitado(ctx.empresa)) return json({ ok: true, fase: 'apagada', inscritos: [] })
    const r = await conEmpresa(ctx.esquema, async (db) => {
      const config = await leerConfig(db)
      const fase = faseVigente(config)
      if (fase === 'apagada') return { fase, inscritos: [] }
      const { rows } = await db.query(
        `select r.empleado_id, array_agg(r.vector order by r.creado_en) as vectores
           from eval_sface_rostros r join empleados e on e.id = r.empleado_id
          where e.activo group by r.empleado_id`,
      )
      return { fase, hasta: config.hasta, inscritos: rows }
    })
    return json({ ok: true, ...r })
  }

  const { estado, esquema, empresa } = await estadoAcceso('empleados')
  if (estado !== 'OK') return json({ ok: false, error: estadoAMensaje(estado) }, estadoAHttp(estado))
  if (!laboratorioHabilitado(empresa)) return json({ ok: false, error: NO_HABILITADA }, 403)
  const r = await conEmpresa(esquema, async (db) => {
    const config = await leerConfig(db)
    const { rows: personas } = await db.query(
      `select e.id, e.nombre, count(r.id)::int as vectores
         from empleados e left join eval_sface_rostros r on r.empleado_id = e.id
        where e.activo group by e.id, e.nombre order by e.nombre`,
    )
    const { rows: intentos } = await db.query(
      `select i.*, a.nombre as referencia_nombre, s.nombre as sface_nombre
         from eval_sface_intentos i
         left join empleados a on a.id = i.referencia_id
         left join empleados s on s.id = i.sface_top1
        order by i.ts desc limit 2000`,
    )
    // Para revisar a mano: donde los dos modelos NO estuvieron de acuerdo.
    const desacuerdos = intentos.filter((i) => !i.error && (
      (i.aceptado_actual && (!aceptaSface(i.sface_sim1, i.sface_sim2) || i.sface_top1 !== i.referencia_id))
      || (!i.aceptado_actual && aceptaSface(i.sface_sim1, i.sface_sim2))
    )).slice(0, 50)
    return { config: { ...config, fase: faseVigente(config) }, personas, resumen: resumir(intentos), desacuerdos }
  })
  return json({ ok: true, ...r })
}

export async function PATCH(req) {
  const { estado, esquema, empresa, usuario } = await estadoAcceso('empleados')
  if (estado !== 'OK') return json({ ok: false, error: estadoAMensaje(estado) }, estadoAHttp(estado))
  if (!laboratorioHabilitado(empresa)) return json({ ok: false, error: NO_HABILITADA }, 403)
  let c
  try { c = await req.json() } catch { return json({ ok: false, error: 'JSON inválido.' }, 400) }
  if (!FASES.includes(c?.estado)) return json({ ok: false, error: 'Fase inválida.' }, 400)
  let hasta = null
  if (c.hasta != null && c.hasta !== '') {
    const d = new Date(c.hasta)
    if (Number.isNaN(d.getTime()) || d <= new Date()) return json({ ok: false, error: 'La fecha de fin debe ser futura.' }, 400)
    hasta = d.toISOString()
  }
  const config = await conEmpresa(esquema, async (db) => {
    await db.query(
      `update eval_sface_config set estado = $1, hasta = $2, actualizado_en = now(), actualizado_por = $3 where id`,
      [c.estado, c.estado === 'apagada' ? null : hasta, usuario.email],
    )
    return leerConfig(db)
  })
  return json({ ok: true, config: { ...config, fase: faseVigente(config) } })
}

export async function POST(req) {
  const ctx = await empresaDeLaPeticion(req, 'corregir')
  if (!ctx) return json({ ok: false, error: 'Sin acceso.' }, 401)
  if (!laboratorioHabilitado(ctx.empresa)) return json({ ok: false, error: NO_HABILITADA }, 403)
  let c
  try { c = await req.json() } catch { return json({ ok: false, error: 'JSON inválido.' }, 400) }
  const dispositivo = ctx.dispositivo?.id ?? null

  return conEmpresa(ctx.esquema, async (db) => {
    const fase = faseVigente(await leerConfig(db))

    if (c?.tipo === 'inscripcion') {
      if (fase !== 'inscripcion') return json({ ok: false, error: 'La evaluación no está en fase de inscripción.' }, 409)
      if (!textoONulo(c.empleado_id) || !esVectorSface(c.vector)) return json({ ok: false, error: 'Datos de inscripción inválidos.' }, 400)
      // Un candado por persona: dos kioscos a la vez no pasan de 3 vectores.
      await db.query('select pg_advisory_xact_lock(hashtext($1))', [`eval_sface:${c.empleado_id}`])
      const { rows: [n] } = await db.query('select count(*)::int as n from eval_sface_rostros where empleado_id = $1', [c.empleado_id])
      if (n.n >= SFACE_MAX_POR_PERSONA) return json({ ok: true, completo: true, vectores: n.n })
      try {
        await db.query('insert into eval_sface_rostros (empleado_id, vector, dispositivo_id) values ($1, $2, $3)', [c.empleado_id, c.vector, dispositivo])
      } catch (e) {
        if (e.code === '23503') return json({ ok: false, error: 'Colaborador no encontrado.' }, 404)
        throw e
      }
      return json({ ok: true, vectores: n.n + 1 })
    }

    if (c?.tipo === 'intento') {
      if (fase !== 'medicion') return json({ ok: false, error: 'La evaluación no está en fase de medición.' }, 409)
      try {
        await db.query(
          `insert into eval_sface_intentos
             (dispositivo_id, referencia_id, aceptado_actual, sim_actual, sface_top1, sface_sim1, sface_top2, sface_sim2, inscritos, ms, error)
           values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
          [dispositivo, textoONulo(c.referencia_id), c.aceptado_actual === true, numONulo(c.sim_actual),
           textoONulo(c.sface_top1), numONulo(c.sface_sim1), textoONulo(c.sface_top2), numONulo(c.sface_sim2),
           Number.isInteger(c.inscritos) ? c.inscritos : 0, Number.isFinite(c.ms) ? Math.round(c.ms) : null,
           typeof c.error === 'string' ? c.error.slice(0, 300) : null],
        )
      } catch (e) {
        if (e.code === '23503') return json({ ok: false, error: 'Colaborador no encontrado.' }, 404)
        throw e
      }
      return json({ ok: true })
    }

    return json({ ok: false, error: 'tipo debe ser inscripcion o intento.' }, 400)
  })
}

export async function DELETE(req) {
  const { estado, esquema, empresa } = await estadoAcceso('empleados')
  if (estado !== 'OK') return json({ ok: false, error: estadoAMensaje(estado) }, estadoAHttp(estado))
  if (!laboratorioHabilitado(empresa)) return json({ ok: false, error: NO_HABILITADA }, 403)
  const { searchParams } = new URL(req.url)
  const empleado = searchParams.get('empleado_id')
  const todo = searchParams.get('todo') === '1'
  if (!empleado && !todo) return json({ ok: false, error: 'Indica empleado_id o todo=1.' }, 400)
  const borrados = await conEmpresa(esquema, async (db) => {
    if (todo) {
      const r = await db.query('delete from eval_sface_rostros')
      await db.query('delete from eval_sface_intentos')
      return r.rowCount
    }
    return (await db.query('delete from eval_sface_rostros where empleado_id = $1', [empleado])).rowCount
  })
  return json({ ok: true, borrados })
}
