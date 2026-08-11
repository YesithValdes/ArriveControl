/**
 * lib/registro.js — Qué pasa la PRIMERA vez que alguien entra con Google.
 *
 * El registro es self-service: nadie aprueba a mano. Quien inicia sesión sale
 * con empresa, y hay exactamente dos caminos:
 *
 *   1. Lo INVITARON  → entra a la empresa que lo invitó.
 *   2. Nadie lo invitó → se le crea una empresa nueva, con su esquema.
 *
 * EL ORDEN IMPORTA y es la única regla delicada de este archivo: primero se
 * busca invitación, y solo si no hay se crea empresa. Al revés, el empleado que
 * su jefe acaba de invitar terminaría con una empresa propia y vacía en lugar
 * de entrar a la de él — y con un esquema basura que alguien tendría que ir a
 * borrar después.
 *
 * Se llama desde el hook `user.create.after` de Better Auth (lib/auth.js), o
 * sea DESPUÉS de que el usuario ya existe. Por eso nunca crea usuarios: solo
 * les asigna empresa.
 */
import { control } from './db.js'
import { crearEmpresa } from './empresas.js'

/**
 * Nombre inicial de la empresa de quien se registra sin invitación.
 *
 * Sale del dominio del correo corporativo (`ana@kupocell.com` → «Kupocell»)
 * porque es lo más cercano a la verdad que se puede saber sin preguntar. Con un
 * correo genérico (Gmail, Hotmail…) no hay dominio útil, así que se usa el
 * nombre de la persona. En ambos casos es un BORRADOR: se cambia en Ajustes.
 */
const GENERICOS = new Set([
  'gmail.com', 'hotmail.com', 'outlook.com', 'yahoo.com', 'yahoo.es',
  'icloud.com', 'live.com', 'proton.me', 'protonmail.com',
])

export function nombreInicialDeEmpresa({ email, name }) {
  const dominio = String(email ?? '').split('@')[1]?.toLowerCase() ?? ''
  if (dominio && !GENERICOS.has(dominio)) {
    const marca = dominio.split('.')[0].replace(/[-_]+/g, ' ')
    return marca.charAt(0).toUpperCase() + marca.slice(1)
  }
  const persona = String(name ?? '').trim() || String(email ?? '').split('@')[0]
  return `Empresa de ${persona}`
}

/** El dominio solo se guarda si es corporativo: de un Gmail no dice nada. */
const dominioCorporativo = (email) => {
  const d = String(email ?? '').split('@')[1]?.toLowerCase() ?? ''
  return d && !GENERICOS.has(d) ? d : null
}

/**
 * Invitación PENDIENTE y no vencida para ese correo, o null.
 * La comparación va en minúsculas: Google devuelve el correo como lo escribió
 * la persona, y `Ana@…` no debe fallar contra una invitación a `ana@…`.
 */
async function invitacionDe(email) {
  const { rows } = await control(
    `select id, empresa_id from control.invitaciones
      where lower(email) = lower($1) and aceptada_en is null and expira_en > now()
      order by creada_en desc limit 1`,
    [email],
  )
  return rows[0] ?? null
}

/**
 * Asigna empresa a un usuario recién creado. Idempotente: si ya tiene, no hace
 * nada — el hook de Better Auth puede reintentarse y no debe crear dos empresas.
 *
 * @param {{id: string, email: string, name?: string}} usuario
 * @returns {Promise<{empresaId: string, via: 'invitacion'|'nueva'|'ya_tenia'|'superadmin'}>}
 */
export async function asignarEmpresa(usuario) {
  const { rows } = await control(
    `select empresa_id, rol from control."user" where id = $1`, [usuario.id],
  )
  const actual = rows[0]
  // El superadmin se siembra a mano y no pertenece a ninguna empresa: crearle
  // una aquí sería justo lo contrario de lo que significa su rol.
  if (actual?.rol === 'superadmin') return { empresaId: null, via: 'superadmin' }
  if (actual?.empresa_id) return { empresaId: actual.empresa_id, via: 'ya_tenia' }

  // 1) ¿Lo invitaron? Primero esto, siempre.
  const invitacion = await invitacionDe(usuario.email)
  if (invitacion) {
    await control(
      `update control."user" set empresa_id = $1, rol = 'empresa', updated_at = now()
        where id = $2`,
      [invitacion.empresa_id, usuario.id],
    )
    await control(
      `update control.invitaciones set aceptada_en = now() where id = $1`,
      [invitacion.id],
    )
    return { empresaId: invitacion.empresa_id, via: 'invitacion' }
  }

  // 2) Nadie lo invitó: empresa nueva. `crearEmpresa` hace el CREATE SCHEMA y
  //    corre las migraciones de empresa/ en una sola transacción.
  const empresa = await crearEmpresa({
    nombre: nombreInicialDeEmpresa(usuario),
    dominio: dominioCorporativo(usuario.email),
  })
  await control(
    `update control."user" set empresa_id = $1, rol = 'empresa', updated_at = now()
      where id = $2`,
    [empresa.id, usuario.id],
  )
  return { empresaId: empresa.id, via: 'nueva' }
}
