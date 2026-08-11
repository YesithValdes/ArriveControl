/**
 * lib/roles.js — Quién puede hacer qué en ArriveControl.
 *
 * DOS roles, y son de dos mundos distintos (no compiten entre sí):
 *
 *   superadmin → alcance PLATAFORMA. Crea y elimina empresas. No entra al
 *                panel de asistencia de ninguna: no tiene empresa_id, así que
 *                `estadoAcceso` lo deja en SIN_EMPRESA por construcción.
 *   empresa    → alcance SU EMPRESA, y ahí puede todo.
 *
 * Antes había tres roles dentro de la empresa (dueño, supervisor, consulta).
 * Se quitaron a propósito: la confidencialidad de los datos es de la empresa y
 * repartir permisos internos es asunto suyo. Varias personas pueden entrar a la
 * misma empresa —cada una con su cuenta de Google— con idénticos permisos.
 *
 * El vocabulario de ACCIONES se conserva aunque hoy un solo rol las tenga
 * todas: es lo que usan las rutas para declarar qué exigen, y hace que volver a
 * partir permisos algún día sea cambiar esta tabla y nada más.
 */

/** Acciones del sistema, en el vocabulario del negocio (no CRUD genérico). */
export const ACCIONES = ['ver', 'corregir', 'empleados', 'config', 'usuarios', 'liquidar']

export const ROLES = {
  empresa: {
    etiqueta: 'Empresa',
    descripcion: 'Administra toda la asistencia de su empresa.',
    acciones: [...ACCIONES],
    alcance: 'todas',
  },
  superadmin: {
    etiqueta: 'Superadministrador',
    descripcion: 'Administra la plataforma: crea y elimina empresas.',
    // Ninguna acción del panel: sus permisos son de otro plano (control.empresas),
    // y se verifican con `esSuperadmin`, no con `puede`.
    acciones: [],
    alcance: 'plataforma',
  },
}

/** ¿Este rol puede ejecutar esta acción dentro de una empresa? */
export function puede(rol, accion) {
  return Boolean(ROLES[rol]?.acciones.includes(accion))
}

/** ¿Es el administrador de la plataforma? */
export const esSuperadmin = (usuario) => usuario?.rol === 'superadmin'

/**
 * Sede a la que está limitado un usuario, o null si ve todas.
 *
 * Hoy devuelve siempre null: sin rol de supervisor nadie está limitado a una
 * sede. Se conserva porque las consultas la reciben y filtran con ella; el día
 * que vuelva a existir un rol por sede, se cambia aquí.
 */
export function sedeDelAlcance() {
  return null
}

/** Roles asignables DENTRO de una empresa (superadmin no lo es: se siembra). */
export const listaRoles = () =>
  Object.entries(ROLES)
    .filter(([clave]) => clave !== 'superadmin')
    .map(([clave, r]) => ({ clave, ...r }))
