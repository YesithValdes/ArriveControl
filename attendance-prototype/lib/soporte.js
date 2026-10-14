/**
 * lib/soporte.js — Acceso de soporte autorizado por la empresa (solo servidor).
 *
 * El superadmin NO tiene acceso permanente a los datos de ninguna empresa.
 * Para ayudar a una, necesita que ella lo autorice:
 *
 *   1. El DUEÑO autoriza desde Ajustes → Seguridad: un motivo y una ventana
 *      de hasta 72 horas (el tope lo impone también la base).
 *   2. El superadmin, desde /plataforma, ve las autorizaciones vigentes y
 *      «entra» a una. Queda una cookie con el id de la autorización.
 *   3. Mientras la autorización siga vigente, ve el panel de esa empresa en
 *      SOLO LECTURA (lib/sesion.js), y cada consulta o intento queda en
 *      control.soporte_accesos. Al vencer o revocarse, deja de ver en la
 *      petición siguiente: la vigencia se comprueba en la base cada vez.
 *   4. El dueño ve la bitácora y puede revocar en cualquier momento.
 *
 * Tablas en control/017_llaves_y_soporte.sql.
 */
import { control } from './db.js'

/** Máximo que puede durar una autorización. La base lo impone igual. */
export const HORAS_MAXIMAS = 72

/** Cookie del superadmin que está dentro de una empresa como soporte. */
export const COOKIE_SOPORTE = 'arrive_soporte'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
export const esIdValido = (id) => UUID.test(String(id ?? ''))

const CAMPOS = `id, empresa_id, autorizada_por, autorizada_por_email, motivo, desde, hasta,
  revocada_en, revocada_por, creada_en,
  (revocada_en is null and now() >= desde and now() < hasta) as vigente`

/**
 * El dueño autoriza al soporte. Una sola vigente a la vez: dos ventanas
 * superpuestas harían más difícil saber cuál cubrió qué acceso.
 *
 * @returns {Promise<{autorizacion: object}|{error: string}>}
 */
export async function autorizarSoporte({ empresa, usuario, horas, motivo }) {
  const h = Number(horas)
  if (!Number.isInteger(h) || h < 1 || h > HORAS_MAXIMAS) {
    return { error: `La autorización dura entre 1 y ${HORAS_MAXIMAS} horas.` }
  }
  const m = String(motivo ?? '').trim()
  if (m.length < 5) return { error: 'Escribe para qué autorizas al soporte (mínimo 5 caracteres).' }
  if (m.length > 500) return { error: 'El motivo es demasiado largo (máximo 500 caracteres).' }

  const { rows: vigentes } = await control(
    `select 1 from control.soporte_autorizaciones
      where empresa_id = $1 and revocada_en is null and now() < hasta`,
    [empresa.id],
  )
  if (vigentes.length > 0) {
    return { error: 'Ya hay una autorización vigente. Revócala antes de dar otra.' }
  }

  const { rows } = await control(
    `insert into control.soporte_autorizaciones
       (empresa_id, autorizada_por, autorizada_por_email, motivo, desde, hasta)
     values ($1, $2, $3, $4, now(), now() + make_interval(hours => $5))
     returning ${CAMPOS}`,
    [empresa.id, usuario.id, usuario.email ?? null, m, h],
  )
  return { autorizacion: rows[0] }
}

/** El dueño revoca. Solo una que siga sin revocar y sea de SU empresa. */
export async function revocarSoporte({ empresa, usuario, id }) {
  if (!esIdValido(id)) return null
  const { rows } = await control(
    `update control.soporte_autorizaciones
        set revocada_en = now(), revocada_por = $3
      where id = $1 and empresa_id = $2 and revocada_en is null
      returning ${CAMPOS}`,
    [id, empresa.id, usuario.email ?? usuario.id],
  )
  return rows[0] ?? null
}

/** Autorizaciones de una empresa, las más recientes primero. */
export async function autorizacionesDe(empresa, limite = 50) {
  const { rows } = await control(
    `select ${CAMPOS} from control.soporte_autorizaciones
      where empresa_id = $1 order by creada_en desc limit $2`,
    [empresa.id, limite],
  )
  return rows
}

/** Bitácora de accesos del soporte a una empresa. */
export async function accesosDe(empresa, limite = 200) {
  const { rows } = await control(
    `select id, autorizacion_id, usuario_email, accion, metodo, ruta, detalle, ip, ts
       from control.soporte_accesos
      where empresa_id = $1 order by ts desc limit $2`,
    [empresa.id, limite],
  )
  return rows
}

/** La autorización, solo si está vigente AHORA (no revocada y dentro de la ventana). */
export async function autorizacionVigente(id) {
  if (!esIdValido(id)) return null
  const { rows } = await control(
    `select ${CAMPOS} from control.soporte_autorizaciones
      where id = $1 and revocada_en is null and now() >= desde and now() < hasta`,
    [id],
  )
  return rows[0] ?? null
}

/** Para la consola del superadmin: lo vigente en toda la plataforma. */
export async function autorizacionesVigentes() {
  const { rows } = await control(
    `select a.id, a.empresa_id, e.nombre as empresa_nombre, a.autorizada_por_email,
            a.motivo, a.desde, a.hasta,
            (select max(ts) from control.soporte_accesos s where s.autorizacion_id = a.id) as ultimo_acceso
       from control.soporte_autorizaciones a
       join control.empresas e on e.id = a.empresa_id
      where a.revocada_en is null and now() >= a.desde and now() < a.hasta
      order by a.hasta`,
  )
  return rows
}

/**
 * Anota un acceso. Si la anotación falla, LANZA: quien llama debe negar el
 * acceso. Un acceso de soporte que no queda registrado no puede ocurrir.
 */
export async function registrarAcceso({ autorizacion, usuario, accion, metodo = null, ruta = null, detalle = null, ip = null, userAgent = null }) {
  await control(
    `insert into control.soporte_accesos
       (autorizacion_id, empresa_id, usuario_id, usuario_email, accion, metodo, ruta, detalle, ip, user_agent)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
    [
      autorizacion.id, autorizacion.empresa_id, usuario.id, usuario.email ?? null, accion,
      metodo, ruta ? String(ruta).slice(0, 300) : null, detalle ? String(detalle).slice(0, 300) : null,
      ip ? String(ip).slice(0, 100) : null, userAgent ? String(userAgent).slice(0, 300) : null,
    ],
  )
}
