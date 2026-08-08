/**
 * lib/sesion.js — Sesión y permisos, contra las tablas PROPIAS de ArriveControl.
 *
 * Antes preguntaba al gestor de empleados (public."user", rol, rol_permiso).
 * Ahora los usuarios y sus roles viven aquí (ver lib/roles.js), que es lo que
 * permite desplegar y vender esta app sin el gestor.
 */
import { headers } from 'next/headers'
import { auth, pool } from './auth'
import { puede, sedeDelAlcance } from './roles.js'

/**
 * Usuario de la sesión con su rol, o null si no hay sesión válida.
 * No redirige: eso lo decide quien llama.
 */
export async function obtenerSesion() {
  const sesion = await auth.api.getSession({ headers: await headers() })
  if (!sesion?.user) return null

  const { rows } = await pool.query(
    `select id, email, name as nombre, rol, sede_id as "sedeId", activo
       from asistencia."user" where id = $1`,
    [sesion.user.id],
  )
  return rows[0] ?? null
}

/** ¿El usuario puede ejecutar esta acción? (ver | corregir | empleados | config | usuarios) */
export function tienePermiso(usuario, accion) {
  return puede(usuario?.rol, accion)
}

/**
 * Estado de acceso a una acción. Devuelve un objeto en vez de redirigir, para
 * que la página o el endpoint decidan qué responder.
 *
 * `sedeLimite` viene con la sede a la que está restringido el usuario
 * (supervisor) o null si ve todas: quien consulta datos debe filtrar por ella.
 *
 * @param {'ver'|'corregir'|'empleados'|'config'|'usuarios'} accion
 */
export async function estadoAcceso(accion = 'ver') {
  const usuario = await obtenerSesion()
  if (!usuario) return { estado: 'SIN_SESION', usuario: null, sedeLimite: null }
  if (!usuario.activo) return { estado: 'CUENTA_INACTIVA', usuario, sedeLimite: null }
  if (!tienePermiso(usuario, accion)) return { estado: 'SIN_PERMISO', usuario, sedeLimite: null }
  return { estado: 'OK', usuario, sedeLimite: sedeDelAlcance(usuario) }
}
