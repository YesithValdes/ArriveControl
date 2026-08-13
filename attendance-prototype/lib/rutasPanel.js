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
  anomalias: 'anomalias',
  empleados: 'empleados',
  horarios: 'horarios',
  reportes: 'reportes',
  historial: 'historial',
  ajustes: 'ajustes',
  'cfg-empresa': 'ajustes/empresa',
  'cfg-usuarios': 'ajustes/usuarios',
  'cfg-sedes': 'ajustes/sedes',
  'cfg-dispositivos': 'ajustes/dispositivos',
  'cfg-reglamento': 'ajustes/reglamento',
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
