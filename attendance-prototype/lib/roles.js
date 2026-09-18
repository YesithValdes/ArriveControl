/**
 * lib/roles.js — Quién puede hacer qué en ArriveControl.
 *
 * Un rol de PLATAFORMA y tres DENTRO de cada empresa:
 *
 *   superadmin → alcance plataforma. Crea y elimina empresas. No entra al
 *                panel de asistencia de ninguna: no tiene empresa_id, así que
 *                `estadoAcceso` lo deja en SIN_EMPRESA por construcción.
 *   empresa    → el DUEÑO. Puede todo, incluida la cuenta: plan y pagos,
 *                clave de API, invitar y quitar gente, cambiar roles.
 *   admin      → ADMINISTRADOR. Toda la operación: asistencia, corregir
 *                marcaciones, colaboradores, horarios, sedes, dispositivos,
 *                reglamento y valorización, cerrar períodos. No toca la
 *                cuenta ni invita a nadie.
 *   consulta   → CONSULTA. Solo ve: asistencia, reportes, historial, exportar.
 *
 * Cuántas personas pueden entrar al panel lo decide el PLAN (lib/planes.js):
 * es una funcionalidad que se vende, no un regalo de la cuenta.
 *
 * El vocabulario de ACCIONES es lo que usan las rutas para declarar qué
 * exigen; repartir permisos es cambiar esta tabla y nada más.
 */

/**
 * Acciones del sistema, en el vocabulario del negocio (no CRUD genérico).
 *   ver        leer asistencia, reportes, historial, exportar
 *   corregir   agregar, cambiar y eliminar marcaciones
 *   empleados  registrar y editar colaboradores (rostros, salario, horario)
 *   config     reglamento, valorización, horarios, sedes, dispositivos
 *   liquidar   cerrar y reabrir períodos, anotar pagos
 *   usuarios   invitar y desactivar gente del panel, cambiar roles
 *   cuenta     Mi empresa: nombre y NIT, clave de API, plan y pagos
 */
export const ACCIONES = ['ver', 'corregir', 'empleados', 'config', 'liquidar', 'usuarios', 'cuenta']

export const ROLES = {
  empresa: {
    etiqueta: 'Propietario',
    descripcion: 'Todo, incluida la cuenta: plan, clave de API y quién entra.',
    acciones: [...ACCIONES],
    alcance: 'todas',
  },
  admin: {
    etiqueta: 'Administrador',
    descripcion: 'Toda la operación: asistencia, correcciones, colaboradores, reglamento, sedes, dispositivos y cierres. No toca la cuenta ni invita.',
    acciones: ['ver', 'corregir', 'empleados', 'config', 'liquidar'],
    alcance: 'todas',
  },
  consulta: {
    etiqueta: 'Consulta',
    descripcion: 'Solo ver: asistencia, reportes, historial y exportar.',
    acciones: ['ver'],
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

/** ¿Es un rol que se puede dar a alguien de la empresa? */
export const esRolDeEmpresa = (rol) => rol === 'empresa' || rol === 'admin' || rol === 'consulta'

/**
 * Sede a la que está limitado un usuario, o null si ve todas.
 *
 * Hoy devuelve siempre null: ningún rol está limitado a una sede. Se conserva
 * porque las consultas la reciben y filtran con ella; el día que exista un
 * rol por sede, se cambia aquí.
 */
export function sedeDelAlcance() {
  return null
}

/** Roles asignables DENTRO de una empresa (superadmin no lo es: se siembra). */
export const listaRoles = () =>
  Object.entries(ROLES)
    .filter(([clave]) => clave !== 'superadmin')
    .map(([clave, r]) => ({ clave, ...r }))
