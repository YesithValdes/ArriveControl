/**
 * lib/sesion.js — Lectura de la sesión y de los permisos del usuario,
 * contra la misma base de datos que el gestor de empleados.
 *
 * Replica la semántica de `src/server/sesion.ts` y `src/lib/permisos/tipos.ts`
 * del gestor: el rol del usuario tiene filas en `rol_permiso` con (modulo,
 * accion, alcance), y "tener permiso" es que exista la fila exacta.
 *
 * El módulo que le corresponde a esta app es `asistencia`.
 */
import { headers } from 'next/headers'
import { auth, pool } from './auth'

export const MODULO = 'asistencia'

/**
 * Devuelve el usuario de la sesión con su rol y permisos, o null si no hay
 * sesión válida. No redirige: eso lo decide quien llama.
 */
export async function obtenerSesion() {
  const sesion = await auth.api.getSession({ headers: await headers() })
  if (!sesion?.user) return null

  const { rows } = await pool.query(
    `select u.id, u.email, u.name as nombre, u.rol_id as "rolId", u.estado,
            u.debe_cambiar_password as "debeCambiarPassword", r.nombre as "rolNombre"
       from "user" u
       join rol r on r.id = u.rol_id
      where u.id = $1`,
    [sesion.user.id],
  )
  const usuario = rows[0]
  if (!usuario) return null

  const { rows: permisos } = await pool.query(
    `select modulo, accion, alcance from rol_permiso where rol_id = $1`,
    [usuario.rolId],
  )

  return { ...usuario, permisos }
}

/** ¿El rol del usuario tiene esta acción sobre este módulo? */
export function tienePermiso(usuario, modulo, accion) {
  return Boolean(usuario?.permisos?.some((p) => p.modulo === modulo && p.accion === accion))
}

/**
 * Estado de acceso al panel de administración de asistencia. Devuelve un
 * objeto en vez de redirigir, para que la página decida qué mostrar.
 */
export async function estadoAcceso(accion = 'VER') {
  const usuario = await obtenerSesion()
  if (!usuario) return { estado: 'SIN_SESION', usuario: null }
  if (usuario.estado !== 'ACTIVO') return { estado: 'CUENTA_INACTIVA', usuario }
  if (usuario.debeCambiarPassword) return { estado: 'DEBE_CAMBIAR_PASSWORD', usuario }
  if (!tienePermiso(usuario, MODULO, accion)) return { estado: 'SIN_PERMISO', usuario }
  return { estado: 'OK', usuario }
}
