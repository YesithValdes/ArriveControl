/**
 * lib/roles.js — Quién puede hacer qué en ArriveControl.
 *
 * Tres roles a propósito: en una empresa de 30 personas, cinco roles estorban.
 * Se agregan más cuando un cliente los pida, no antes.
 *
 * La acción `corregir` es la sensible: una marcación editada se convierte en
 * horas extra pagadas. Por eso `consulta` (el contador, quien arma la nómina)
 * ve todo pero no modifica nada — separación de funciones: quien liquida no
 * debería poder fabricar la asistencia que liquida.
 */

/** Acciones del sistema, en el vocabulario del negocio (no CRUD genérico). */
export const ACCIONES = ['ver', 'corregir', 'empleados', 'config', 'usuarios']

export const ROLES = {
  dueno: {
    etiqueta: 'Dueño',
    descripcion: 'Control total, incluida la gestión de usuarios.',
    acciones: ['ver', 'corregir', 'empleados', 'config', 'usuarios'],
    alcance: 'todas',
  },
  supervisor: {
    etiqueta: 'Supervisor de sede',
    descripcion: 'Ve y corrige la asistencia de su sede. No registra empleados ni cambia la configuración.',
    acciones: ['ver', 'corregir'],
    alcance: 'sede',
  },
  consulta: {
    etiqueta: 'Consulta',
    descripcion: 'Ve reportes y exporta, sin modificar nada. Pensado para quien arma la nómina.',
    acciones: ['ver'],
    alcance: 'todas',
  },
}

/** ¿Este rol puede ejecutar esta acción? */
export function puede(rol, accion) {
  return Boolean(ROLES[rol]?.acciones.includes(accion))
}

/**
 * Sede a la que está limitado un usuario, o null si ve todas.
 * El supervisor sin sede asignada no ve nada: es una configuración incompleta,
 * y es más seguro no mostrar nada que mostrarlo todo.
 */
export function sedeDelAlcance(usuario) {
  if (!usuario) return null
  return ROLES[usuario.rol]?.alcance === 'sede' ? (usuario.sedeId ?? '__sin_sede__') : null
}

/** Lista para pintar en la interfaz. */
export const listaRoles = () =>
  Object.entries(ROLES).map(([clave, r]) => ({ clave, ...r }))
