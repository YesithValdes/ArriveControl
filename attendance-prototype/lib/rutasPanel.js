/**
 * lib/rutasPanel.js — Qué dirección le corresponde a cada pantalla del panel.
 *
 * El panel es UN componente con catorce pantallas. Antes vivían todas en
 * `/admin` y la actual era solo estado de React: al recargar se perdía y
 * volvías al dashboard, el botón «atrás» no hacía nada, y no se podía mandar
 * un enlace a una pantalla concreta.
 *
 * Aquí está la tabla que las conecta, en un solo sitio para que la dirección y
 * la pantalla no se puedan desincronizar.
 *
 * Las `cfg-` cuelgan de `/admin/ajustes/` porque es donde están de verdad —y
 * así el prefijo técnico no se asoma a la barra de direcciones.
 */

/** Pantalla → segmentos de la URL (sin `/admin`). El dashboard no lleva. */
export const RUTAS_PANEL = {
  dashboard: '',
  // La asistencia vive en el dashboard Y como sección propia del menú.
  asistencia: 'asistencia',
  anomalias: 'anomalias',
  empleados: 'empleados',
  horarios: 'horarios',
  reportes: 'reportes',
  historial: 'historial',
  ajustes: 'ajustes',
  'cfg-empresa': 'ajustes/empresa',
  // El plan tiene pantalla propia: es a donde llega quien vuelve de pagar.
  'cfg-plan': 'ajustes/plan',
  'cfg-usuarios': 'ajustes/usuarios',
  'cfg-seguridad': 'ajustes/seguridad',
  'cfg-sedes': 'ajustes/sedes',
  equipos: 'equipos',
  'cfg-dispositivos': 'ajustes/dispositivos',
  'cfg-reglamento': 'ajustes/reglamento',
  // Correo y/o API del resumen de cada noche (antes, dentro del reglamento).
  'cfg-resumen': 'ajustes/resumen-diario',
  // «valorizacion» y no «nomina»: la pantalla decide cuánto vale una hora
  // extra, no liquida nómina.
  'cfg-nomina': 'ajustes/valorizacion',
  'cfg-simulador': 'ajustes/simulador',
  // Diagnóstico GPS dentro del panel (antes solo existía la página /gps).
  'cfg-gps': 'ajustes/gps',
}

/** Dirección completa de una pantalla: `cfg-sedes` → `/admin/ajustes/sedes`. */
export const rutaDe = (tab) => {
  const cola = RUTAS_PANEL[tab]
  return cola ? `/admin/${cola}` : '/admin'
}

// Tabla inversa, construida una vez.
const POR_RUTA = Object.fromEntries(
  Object.entries(RUTAS_PANEL).map(([tab, cola]) => [cola, tab]),
)

/**
 * Pantalla que corresponde a unos segmentos de URL.
 *
 * Una dirección inventada cae en el dashboard en vez de dejar el panel en
 * blanco: es una pantalla de trabajo y siempre tiene que mostrar algo.
 *
 * @param {string[]|undefined} segmentos  lo que da el comodín `[[...seccion]]`
 */
export const tabDeSegmentos = (segmentos) =>
  POR_RUTA[(segmentos ?? []).join('/')] ?? 'dashboard'

/** Igual, pero a partir de un `location.pathname` (para el botón «atrás»). */
export const tabDeRuta = (pathname) =>
  tabDeSegmentos(String(pathname ?? '').replace(/^\/admin\/?/, '').split('/').filter(Boolean))

/** Vistas que un Invitado puede tener apagadas (modulo:accion). */
const VISTA_INVITADO = {
  dashboard: 'asistencia:ver',
  asistencia: 'asistencia:historial',
  historial: 'asistencia:historial',
  anomalias: 'asistencia:anomalias',
  reportes: 'asistencia:reportes',
}

/** Misma autorización para el menú, la URL directa y el historial del navegador. */
export function puedeAbrirSeccion(tab, permisos = {}) {
  // Invitado: su lista fina manda sobre las vistas. Los demás roles no tienen lista.
  if (Array.isArray(permisos.lista) && VISTA_INVITADO[tab] && !permisos.lista.includes(VISTA_INVITADO[tab])) return false
  if (['dashboard', 'asistencia', 'anomalias', 'reportes', 'historial'].includes(tab)) return true
  if (tab === 'empleados') return permisos.empleados === true
  if (['cfg-empresa', 'cfg-plan'].includes(tab)) return permisos.cuenta === true
  if (tab === 'cfg-usuarios') return permisos.usuarios === true
  if (tab === 'cfg-seguridad') return permisos.seguridad === true
  // Áreas: el Invitado según su lista; los demás roles, con permiso de configuración.
  if (tab === 'equipos') return Array.isArray(permisos.lista) ? permisos.lista.includes('equipos:ver') : permisos.config === true
  if (tab === 'ajustes') return Boolean(permisos.config || permisos.usuarios || permisos.cuenta || permisos.seguridad)
  if (['horarios', 'cfg-sedes', 'cfg-dispositivos', 'cfg-reglamento', 'cfg-resumen', 'cfg-nomina', 'cfg-simulador', 'cfg-gps'].includes(tab)) return permisos.config === true
  return false
}

export const seccionPermitida = (tab, permisos) => puedeAbrirSeccion(tab, permisos) ? tab : 'dashboard'
