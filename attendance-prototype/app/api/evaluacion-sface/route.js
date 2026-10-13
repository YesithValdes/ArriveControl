/**
 * app/api/evaluacion-sface/route.js — Evaluación de modelos faciales en el
 * kiosco web (SFace y, si se elige, AuraFace). El nombre de la ruta viene de
 * cuando solo existía SFace.
 *
 * Todo exige que el superadmin haya habilitado la empresa
 * (control.empresas.laboratorio_facial); si no, la evaluación no existe.
 *
 * KIOSCO (clave de aparato, o sesión con `corregir`):
 *   GET  ?kiosco=1 → { fase, hasta, modelos, inscritos: [{modelo, empleado_id, vectores}] }
 *                    Con la fase apagada no baja ningún vector.
 *   POST { tipo: 'inscripcion', modelo, empleado_id, vector }   solo en inscripción
 *   POST { tipo: 'intento', modelo, ... }                        solo en medición
 *
 * La ADMINISTRACIÓN (fases, modelos, reporte, borrar) la hace el superadmin,
 * empresa por empresa: app/api/plataforma/empresas/[id]/evaluacion
 * (lib/evaluacionModelos.js).
 *
 * Nada de esto toca `rostros` ni `marcaciones`: el modelo actual sigue
 * decidiendo quién marca.
 */
import { NextResponse } from 'next/server'
import { conEmpresa } from '../../../lib/db.js'
import { empresaDeLaPeticion } from '../../../lib/sesion'
import { laboratorioHabilitado } from '../../../lib/empresas.js'
import { SFACE_MAX_POR_PERSONA, esVector, faseVigente } from '../../../utils/evaluacionSface.js'

export const runtime = 'nodejs'

const json = (cuerpo, status = 200) => NextResponse.json(cuerpo, { status })
const NO_HABILITADA = 'La evaluación de modelos no está habilitada para esta empresa.'
const leerConfig = async (db) => (await db.query('select estado, hasta, modelos, actualizado_en from eval_sface_config where id')).rows[0]
const numONulo = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null)
const textoONulo = (v) => (typeof v === 'string' && v.length > 0 && v.length <= 64 ? v : null)
// Lo que no dice modelo es SFace: así siguen sirviendo los kioscos que aún
// tengan la versión anterior abierta.
const modeloDe = (c) => (c?.modelo == null ? 'sface' : c.modelo)

export async function GET(req) {
  const { searchParams } = new URL(req.url)

  if (searchParams.get('kiosco') === '1') {
    const ctx = await empresaDeLaPeticion(req, 'corregir')
    if (!ctx) return json({ ok: false, error: 'Sin acceso.' }, 401)
    // Sin habilitar, el kiosco ni se entera: fase apagada y nada que bajar.
    if (!laboratorioHabilitado(ctx.empresa)) return json({ ok: true, fase: 'apagada', modelos: [], inscritos: [] })
    const r = await conEmpresa(ctx.esquema, async (db) => {
      const config = await leerConfig(db)
      const fase = faseVigente(config)
      if (fase === 'apagada') return { fase, modelos: [], inscritos: [] }
      const { rows } = await db.query(
        `select r.modelo, r.empleado_id, array_agg(r.vector order by r.creado_en) as vectores
           from eval_sface_rostros r join empleados e on e.id = r.empleado_id
          where e.activo and r.modelo = any($1) group by r.modelo, r.empleado_id`,
        [config.modelos],
      )
      return { fase, hasta: config.hasta, modelos: config.modelos, inscritos: rows }
    })
    return json({ ok: true, ...r })
  }

  // La administración (fases, modelos, reporte) la hace el SUPERADMIN desde
  // la consola de plataforma: app/api/plataforma/empresas/[id]/evaluacion.
  return json({ ok: false, error: 'La evaluación se administra desde la consola de plataforma.' }, 403)
}

export async function POST(req) {
  const ctx = await empresaDeLaPeticion(req, 'corregir')
  if (!ctx) return json({ ok: false, error: 'Sin acceso.' }, 401)
  if (!laboratorioHabilitado(ctx.empresa)) return json({ ok: false, error: NO_HABILITADA }, 403)
  let c
  try { c = await req.json() } catch { return json({ ok: false, error: 'JSON inválido.' }, 400) }
  const dispositivo = ctx.dispositivo?.id ?? null
  const modelo = modeloDe(c)

  return conEmpresa(ctx.esquema, async (db) => {
    const config = await leerConfig(db)
    const fase = faseVigente(config)
    if (!config.modelos.includes(modelo)) return json({ ok: false, error: 'Ese modelo no está activo en la evaluación.' }, 409)

    if (c?.tipo === 'inscripcion') {
      if (fase !== 'inscripcion') return json({ ok: false, error: 'La evaluación no está en fase de inscripción.' }, 409)
      if (!textoONulo(c.empleado_id) || !esVector(c.vector, modelo)) return json({ ok: false, error: 'Datos de inscripción inválidos.' }, 400)
      // Un candado por persona y modelo: dos kioscos a la vez no pasan de 3.
      await db.query('select pg_advisory_xact_lock(hashtext($1))', [`eval:${modelo}:${c.empleado_id}`])
      const { rows: [n] } = await db.query('select count(*)::int as n from eval_sface_rostros where empleado_id = $1 and modelo = $2', [c.empleado_id, modelo])
      if (n.n >= SFACE_MAX_POR_PERSONA) return json({ ok: true, completo: true, vectores: n.n })
      try {
        await db.query('insert into eval_sface_rostros (empleado_id, vector, dispositivo_id, modelo) values ($1, $2, $3, $4)', [c.empleado_id, c.vector, dispositivo, modelo])
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
             (dispositivo_id, referencia_id, aceptado_actual, sim_actual, sface_top1, sface_sim1, sface_top2, sface_sim2, inscritos, ms, error, modelo)
           values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
          [dispositivo, textoONulo(c.referencia_id), c.aceptado_actual === true, numONulo(c.sim_actual),
           textoONulo(c.sface_top1), numONulo(c.sface_sim1), textoONulo(c.sface_top2), numONulo(c.sface_sim2),
           Number.isInteger(c.inscritos) ? c.inscritos : 0, Number.isFinite(c.ms) ? Math.round(c.ms) : null,
           typeof c.error === 'string' ? c.error.slice(0, 300) : null, modelo],
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
