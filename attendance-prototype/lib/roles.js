/**
 * lib/roles.js — Quién puede hacer qué en ArriveControl.
 *
 * Un rol de PLATAFORMA y cuatro DENTRO de cada empresa:
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
 *   invitado   → INVITADO. Configurable por persona: de entrada puede lo
 *                mismo que el Administrador, y el dueño apaga permisos uno a
 *                uno (control.user.permisos_invitado). Nunca más que el
 *                Administrador: no invita ni toca la cuenta.
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
  invitado: {
    etiqueta: 'Invitado',
    descripcion: 'Configurable: de entrada lo mismo que el Administrador; el propietario elige qué permisos tiene.',
    // Los de fábrica. Los efectivos salen de cada persona (permisosInvitado).
    acciones: ['ver', 'corregir', 'empleados', 'config', 'liquidar'],
    alcance: 'todas',
    configurable: true,
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

/**
 * Permisos individuales del INVITADO, guardados por persona en
 * control.user.permisos_invitado (o en la invitación mientras no entra).
 * NULL = todo lo que puede el Administrador.
 *
 * Cada clave es `modulo:accion` y corresponde a algo que revisa el SERVIDOR
 * (estadoAcceso → permisoInvitado). Inventario hecho sobre las rutas reales:
 *
 *  · `vista`: una pantalla del panel (dashboard, asistencia e historial,
 *    anomalías, reportes, detalle de marcaciones). Se pueden apagar, pero
 *    siempre queda al menos una: sin ninguna no hay panel al que entrar.
 *    Todas se arman con la misma carga (panelStore.syncPanel: marcaciones,
 *    empleados, sedes, horarios, reglamento y novedades), así que esas
 *    lecturas piden `panel:ver` = cualquier vista. Si pidieran el «ver» de
 *    cada módulo, apagar uno tumbaría el panel entero.
 *  · El «ver» de los demás módulos abre su pantalla y sus datos delicados
 *    (rostros, soportes, kioscos, seguridad), no la carga base.
 *  · `soloPropietario`: nunca se le da a un Invitado. normalizar lo quita y
 *    puede() lo niega aunque llegara guardado.
 *  · `sensible`: delicado; el modal lo marca.
 *  · `soloPantalla`: no tiene endpoint propio (se arma en el navegador con
 *    datos que ya ve); se respeta escondiendo el botón.
 */
export const SECCIONES_INVITADO = [
  { clave: 'operacion', etiqueta: 'Operación diaria' },
  { clave: 'personas', etiqueta: 'Personas y organización' },
  { clave: 'administracion', etiqueta: 'Administración y seguridad' },
]

export const MODULOS_INVITADO = [
  {
    clave: 'asistencia', seccion: 'operacion', etiqueta: 'Dashboard, anomalías y reportes',
    ayuda: 'Las pantallas de consulta del panel: el dashboard, la asistencia e historial, las anomalías y los reportes. Puedes apagarlas, pero debe quedar al menos una vista para poder entrar.',
    acciones: [
      { clave: 'ver', etiqueta: 'Ver dashboard', vista: true },
      { clave: 'historial', etiqueta: 'Ver asistencia e historial', vista: true },
      { clave: 'anomalias', etiqueta: 'Ver anomalías', vista: true },
      { clave: 'reportes', etiqueta: 'Ver reportes', vista: true },
      // Se exporta desde Reportes: exportar enciende «Ver reportes», no el dashboard.
      { clave: 'exportar', etiqueta: 'Exportar reportes (Excel / CSV)', soloPantalla: true, requiere: 'reportes' },
    ],
  },
  {
    clave: 'marcaciones', seccion: 'operacion', etiqueta: 'Marcaciones',
    ayuda: 'El detalle de entradas y salidas de cada colaborador. Apagar «Ver» esconde ese detalle; la asistencia se sigue calculando con ellas.',
    acciones: [
      { clave: 'ver', etiqueta: 'Ver el detalle de marcaciones', vista: true },
      { clave: 'ver_foto', etiqueta: 'Ver la foto de cada registro', sensible: true },
      { clave: 'crear', etiqueta: 'Agregar marcación manual' },
      { clave: 'editar', etiqueta: 'Editar marcaciones' },
      { clave: 'eliminar', etiqueta: 'Eliminar marcaciones', sensible: true },
    ],
  },
  {
    clave: 'colaboradores', seccion: 'personas', etiqueta: 'Colaboradores',
    ayuda: 'Registro de colaboradores: datos, salario, rostro y foto de perfil.',
    acciones: [
      { clave: 'ver', etiqueta: 'Ver colaboradores y sus rostros' },
      { clave: 'crear', etiqueta: 'Registrar colaboradores' },
      { clave: 'editar', etiqueta: 'Editar datos, salario y rostro' },
      { clave: 'eliminar', etiqueta: 'Archivar o eliminar colaboradores', sensible: true },
    ],
  },
  {
    clave: 'novedades', seccion: 'personas', etiqueta: 'Permisos e incapacidades',
    ayuda: 'Permisos, incapacidades y licencias de cada colaborador, con sus soportes.',
    acciones: [
      { clave: 'ver', etiqueta: 'Ver permisos e incapacidades' },
      { clave: 'crear', etiqueta: 'Registrar permisos e incapacidades' },
      { clave: 'soportes', etiqueta: 'Ver y adjuntar soportes', sensible: true },
      { clave: 'descontar', etiqueta: 'Descontar horas no trabajadas', sensible: true },
      { clave: 'eliminar', etiqueta: 'Anular permisos e incapacidades', sensible: true },
    ],
  },
  {
    clave: 'horarios', seccion: 'personas', etiqueta: 'Horarios',
    ayuda: 'Plantillas de jornada por cargo o turno, y la jornada asignada a cada colaborador.',
    acciones: [
      { clave: 'ver', etiqueta: 'Ver horarios' },
      { clave: 'asignar', etiqueta: 'Asignar horario a colaboradores' },
      { clave: 'crear', etiqueta: 'Crear horarios' },
      { clave: 'editar', etiqueta: 'Editar horarios' },
      { clave: 'eliminar', etiqueta: 'Eliminar horarios', sensible: true },
    ],
  },
  {
    clave: 'equipos', seccion: 'personas', etiqueta: 'Áreas de colaboradores',
    ayuda: 'Crear áreas de trabajo (Marketing, Ventas, Soporte…) y administrar sus integrantes. Una persona puede pertenecer a varias áreas.',
    acciones: [
      { clave: 'ver', etiqueta: 'Ver áreas' },
      { clave: 'crear', etiqueta: 'Crear áreas' },
      { clave: 'editar', etiqueta: 'Editar áreas y sus integrantes' },
      { clave: 'eliminar', etiqueta: 'Eliminar áreas', sensible: true },
    ],
  },
  {
    clave: 'sedes', seccion: 'personas', etiqueta: 'Sedes',
    ayuda: 'Ubicaciones de la empresa y el radio dentro del que se puede marcar.',
    acciones: [
      { clave: 'ver', etiqueta: 'Ver sedes' },
      { clave: 'crear', etiqueta: 'Crear sedes' },
      { clave: 'editar', etiqueta: 'Editar sedes' },
      { clave: 'eliminar', etiqueta: 'Eliminar sedes', sensible: true },
    ],
  },
  {
    clave: 'dispositivos', seccion: 'personas', etiqueta: 'Dispositivos (kiosco)',
    ayuda: 'Tablets y celulares donde marcan los colaboradores.',
    acciones: [
      { clave: 'ver', etiqueta: 'Ver dispositivos y códigos' },
      { clave: 'crear', etiqueta: 'Vincular dispositivos' },
      { clave: 'editar', etiqueta: 'Editar dispositivos' },
      { clave: 'eliminar', etiqueta: 'Desvincular dispositivos', sensible: true },
    ],
  },
  {
    clave: 'reglamento', seccion: 'administracion', etiqueta: 'Configuración',
    ayuda: 'Reglamento laboral (tolerancias, horas extra, recargos) y valorización de horas.',
    acciones: [
      { clave: 'ver', etiqueta: 'Ver configuración' },
      { clave: 'editar', etiqueta: 'Editar reglamento laboral: tolerancias y horas extras', sensible: true },
    ],
  },
  {
    clave: 'cierres', seccion: 'administracion', etiqueta: 'Cierres y pagos',
    ayuda: 'Cerrar períodos de horas extra, anotar lo pagado, reabrir un cierre y generar el comprobante de pago de horas de cada colaborador. La nómina se lleva las horas con la clave de API de la empresa, no desde aquí.',
    acciones: [
      { clave: 'ver', etiqueta: 'Ver cierres y pagos' },
      { clave: 'cerrar', etiqueta: 'Cerrar períodos' },
      { clave: 'pagos', etiqueta: 'Anotar pagos de horas extra' },
      { clave: 'reabrir', etiqueta: 'Reabrir cierres', sensible: true },
      { clave: 'colillas', etiqueta: 'Generar y consultar comprobantes de pago', sensible: true },
    ],
  },
  {
    clave: 'seguridad', seccion: 'administracion', etiqueta: 'Seguridad y datos de la empresa',
    ayuda: 'Estado del cifrado, accesos del soporte y respaldo completo de los datos de la empresa.',
    acciones: [
      { clave: 'ver', etiqueta: 'Ver seguridad, datos de la empresa y accesos de soporte' },
      { clave: 'exportar', etiqueta: 'Exportar todos los datos de la empresa', sensible: true },
      { clave: 'llave', etiqueta: 'Descargar llave de recuperación', soloPropietario: true, sensible: true },
      { clave: 'soporte', etiqueta: 'Autorizar acceso de soporte', soloPropietario: true, sensible: true },
    ],
  },
]

const clavesDe = (filtro) => MODULOS_INVITADO.flatMap((m) => m.acciones.filter(filtro).map((a) => `${m.clave}:${a.clave}`))
/** Todas las claves del catálogo, incluidas las del Propietario (se muestran bloqueadas). */
export const CLAVES_INVITADO = clavesDe(() => true)
/** Las que se le pueden dar a un Invitado. */
export const PERMISOS_INVITADO = clavesDe((a) => !a.soloPropietario)
/** Ya no hay permisos fijos: las vistas se apagan (dejando al menos una). */
export const PERMISOS_INVITADO_FIJOS = []
/** Las vistas del panel; con cualquiera de ellas se carga lo que el panel necesita. */
export const VISTAS_INVITADO = clavesDe((a) => a.vista)
export const PERMISOS_SOLO_PROPIETARIO = clavesDe((a) => a.soloPropietario)

/** Perfiles rápidos del modal. «Personalizado» es cualquier otra combinación. */
export const PERFILES_INVITADO = [
  { clave: 'admin', etiqueta: 'Administrador completo', permisos: PERMISOS_INVITADO },
  {
    clave: 'supervisor', etiqueta: 'Supervisor',
    // Ver todo, más agregar y editar marcaciones, ver fotos, asignar
    // horarios y gestionar permisos e incapacidades. Sin eliminar, sin
    // configuración, cierres ni seguridad.
    permisos: [
      ...clavesDe((a) => a.clave === 'ver' || a.vista).filter((k) => !/^(reglamento|cierres|seguridad):/.test(k)),
      'marcaciones:ver_foto', 'marcaciones:crear', 'marcaciones:editar',
      'horarios:asignar',
      'novedades:crear', 'novedades:soportes', 'novedades:descontar',
    ],
  },
  { clave: 'lectura', etiqueta: 'Solo lectura', permisos: clavesDe((a) => (a.clave === 'ver' || a.vista) && !a.soloPropietario) },
]

/**
 * Normaliza una lista de permisos de Invitado: quita lo que no existe o es
 * del Propietario, cada acción enciende lo que requiere (su «ver», o lo que
 * diga `requiere`; las vistas no dependen de nada), y si no queda ninguna
 * vista se deja el dashboard, para que la persona pueda entrar. Las listas
 * guardadas con el catálogo anterior las tradujo la migración control/023.
 */
export function normalizarPermisosInvitado(lista) {
  const pedidos = new Set(Array.isArray(lista) ? lista : [])
  for (const m of MODULOS_INVITADO) {
    for (const a of m.acciones) {
      if (a.clave === 'ver' || a.vista || !pedidos.has(`${m.clave}:${a.clave}`)) continue
      pedidos.add(`${m.clave}:${a.requiere ?? 'ver'}`)
    }
  }
  if (!VISTAS_INVITADO.some((k) => pedidos.has(k))) pedidos.add('asistencia:ver')
  return PERMISOS_INVITADO.filter((p) => pedidos.has(p))
}

/** Permisos efectivos de una persona o invitación (sin lista: los de Administrador). */
export function permisosInvitado(persona) {
  return Array.isArray(persona?.permisos_invitado)
    ? normalizarPermisosInvitado(persona.permisos_invitado)
    : [...PERMISOS_INVITADO]
}

/**
 * Acción general → qué la concede al Invitado, para las rutas que no
 * declaran su permiso y para las banderas del panel. Basta una.
 */
const ACCION_A_INVITADO = {
  ver: VISTAS_INVITADO,
  corregir: ['marcaciones:crear', 'marcaciones:editar', 'marcaciones:eliminar'],
  empleados: ['colaboradores:crear', 'colaboradores:editar', 'colaboradores:eliminar', 'novedades:crear', 'novedades:eliminar', 'horarios:asignar'],
  config: ['horarios:crear', 'horarios:editar', 'horarios:eliminar', 'sedes:crear', 'sedes:editar', 'sedes:eliminar',
    'dispositivos:crear', 'dispositivos:editar', 'dispositivos:eliminar', 'reglamento:editar', 'seguridad:exportar', 'equipos:crear', 'equipos:editar', 'equipos:eliminar'],
  liquidar: ['cierres:cerrar', 'cierres:pagos', 'cierres:reabrir'],
  usuarios: [],
  cuenta: [],
}

/**
 * Lo único del área del Propietario (acción `cuenta`) que un Invitado puede
 * llegar a tener: LEER la seguridad y los datos de la empresa. Escribir ahí
 * (llave, soporte, datos de la cuenta, plan) sigue siendo solo del dueño.
 */
const CUENTA_LECTURA_INVITADO = ['seguridad:ver']

/**
 * ¿Este rol puede ejecutar esta acción dentro de una empresa?
 * Para el Invitado manda su lista individual: `permisoInvitado` es la clave
 * que exige la ruta, o una lista de claves de las que basta una. Sin ella,
 * se usa la equivalencia de la acción general.
 */
export function puede(rol, accion, empresa = null, permisoInvitado = null, usuario = null) {
  if (rol === 'invitado') {
    // 'panel:ver' = la carga base del panel: basta cualquier vista.
    const pedidas = permisoInvitado == null ? null : [].concat(permisoInvitado).flatMap((k) => (k === 'panel:ver' ? VISTAS_INVITADO : [k]))
    if (pedidas?.some((k) => PERMISOS_SOLO_PROPIETARIO.includes(k))) return false
    if (!ROLES.admin.acciones.includes(accion)) {
      // Fuera de lo del Administrador solo cabe leer la seguridad.
      if (!(accion === 'cuenta' && pedidas?.length && pedidas.every((k) => CUENTA_LECTURA_INVITADO.includes(k)))) return false
    }
    const tiene = permisosInvitado(usuario ?? empresa)
    if (pedidas) return pedidas.some((k) => tiene.includes(k))
    return (ACCION_A_INVITADO[accion] ?? []).some((k) => tiene.includes(k))
  }
  return Boolean(ROLES[rol]?.acciones.includes(accion))
}

/** ¿Es el administrador de la plataforma? */
export const esSuperadmin = (usuario) => usuario?.rol === 'superadmin'

/** ¿Es un rol que se puede dar a alguien de la empresa? */
export const esRolDeEmpresa = (rol) => rol === 'empresa' || rol === 'admin' || rol === 'consulta' || rol === 'invitado'

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
