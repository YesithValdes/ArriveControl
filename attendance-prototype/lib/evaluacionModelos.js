/**
 * lib/evaluacionModelos.js — Administración de la evaluación de modelos
 * faciales de UNA empresa: fase, modelos, reporte e inscripciones.
 *
 * La usa la consola del SUPERADMIN (app/api/plataforma/empresas/[id]/evaluacion):
 * mientras la evaluación esté en prueba, la maneja la plataforma y no cada
 * empresa. Lo que hace el kiosco (bajar vectores, inscribir, medir) sigue en
 * app/api/evaluacion-sface.
 */
import { conEmpresa } from './db.js'
import { FASES, IDS_MODELOS, faseVigente, resumir, acepta, modelosValidos } from '../utils/evaluacionSface.js'

const leerConfig = async (db) => (await db.query('select estado, hasta, modelos, actualizado_en, actualizado_por from eval_sface_config where id')).rows[0]

/** Fase, modelos, inscritos por persona y un reporte por modelo. */
export async function panelEvaluacion(esquema) {
  return conEmpresa(esquema, async (db) => {
    const config = await leerConfig(db)
    const { rows: personas } = await db.query(
      `select e.id, e.nombre,
              coalesce(jsonb_object_agg(r.modelo, r.n) filter (where r.modelo is not null), '{}') as vectores
         from empleados e
         left join (select empleado_id, modelo, count(*)::int as n from eval_sface_rostros group by empleado_id, modelo) r
           on r.empleado_id = e.id
        where e.activo group by e.id, e.nombre order by e.nombre`,
    )
    const { rows: intentos } = await db.query(
      `select i.*, a.nombre as referencia_nombre, s.nombre as sface_nombre
         from eval_sface_intentos i
         left join empleados a on a.id = i.referencia_id
         left join empleados s on s.id = i.sface_top1
        order by i.ts desc limit 4000`,
    )
    // Un reporte por modelo, con los desacuerdos para revisar a mano.
    const reportes = {}
    for (const m of IDS_MODELOS) {
      const delModelo = intentos.filter((i) => i.modelo === m)
      if (delModelo.length === 0 && !config.modelos.includes(m)) continue
      reportes[m] = {
        resumen: resumir(delModelo, m),
        desacuerdos: delModelo.filter((i) => !i.error && (
          (i.aceptado_actual && (!acepta(m, i.sface_sim1, i.sface_sim2) || i.sface_top1 !== i.referencia_id))
          || (!i.aceptado_actual && acepta(m, i.sface_sim1, i.sface_sim2))
        )).slice(0, 50),
      }
    }
    return { config: { ...config, fase: faseVigente(config) }, personas, reportes }
  })
}

/**
 * Cambia la fase y/o los modelos. `cambios`: { estado?, hasta?, modelos? }.
 * @returns {{ok: true, config}|{error: string}}
 */
export async function cambiarEvaluacion(esquema, cambios, quien) {
  const c = cambios ?? {}
  if (c.estado !== undefined && !FASES.includes(c.estado)) return { error: 'Fase inválida.' }
  let modelos = null
  if (c.modelos !== undefined) {
    modelos = modelosValidos(c.modelos)
    if (!modelos) return { error: 'Elige al menos un modelo válido.' }
  }
  if (c.estado === undefined && !modelos) return { error: 'Nada que cambiar.' }
  let hasta = null
  if (c.hasta != null && c.hasta !== '') {
    const d = new Date(c.hasta)
    if (Number.isNaN(d.getTime()) || d <= new Date()) return { error: 'La fecha de fin debe ser futura.' }
    hasta = d.toISOString()
  }
  const config = await conEmpresa(esquema, async (db) => {
    if (c.estado !== undefined) {
      await db.query(
        `update eval_sface_config set estado = $1, hasta = $2, actualizado_en = now(), actualizado_por = $3 where id`,
        [c.estado, c.estado === 'apagada' ? null : hasta, quien],
      )
    }
    if (modelos) {
      await db.query(`update eval_sface_config set modelos = $1, actualizado_en = now(), actualizado_por = $2 where id`, [modelos, quien])
    }
    return leerConfig(db)
  })
  return { ok: true, config: { ...config, fase: faseVigente(config) } }
}

/** Borra las inscripciones de una persona, o todo (inscripciones y mediciones). */
export async function borrarEvaluacion(esquema, { empleadoId = null, todo = false } = {}) {
  if (!empleadoId && !todo) return { error: 'Indica empleado_id o todo=1.' }
  const borrados = await conEmpresa(esquema, async (db) => {
    if (todo) {
      const r = await db.query('delete from eval_sface_rostros')
      await db.query('delete from eval_sface_intentos')
      return r.rowCount
    }
    return (await db.query('delete from eval_sface_rostros where empleado_id = $1', [empleadoId])).rowCount
  })
  return { ok: true, borrados }
}
