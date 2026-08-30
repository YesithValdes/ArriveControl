'use client';
/**
 * components/AdminPanel.jsx
 * Panel del administrador: app de una sola pantalla con sub-pantallas
 * (Dashboard, Anomalías, Equipo, Historial, Ajustes) y navegación inferior.
 * Solo las listas hacen scroll; el marco y la barra quedan fijos.
 *
 * Datos reales: journeyService (eventos/correcciones) + rosterService (personas).
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
// Todos los datos vienen de POSTGRES vía API (services/panelStore.js), con
// las mismas formas que los services locales que reemplaza.
import {
  syncPanel,
  listJourneyEvents,
  addManualEvent,
  updateEventTime,
  updateEventType,
  deleteEvent,
  NIGHT_WINDOW_MS,
  listPeople, listArchivados, removePerson, updatePerson, expectedDailyHours, jornadaDelDia,
  listarRostros, agregarRostro, quitarRostro,
  franjaEsperada, finJornadaMs, horasFranja, horasSemanaDias, resumenDias, DIAS_CORTOS, ORDEN_SEMANA,
  getLaborConfig, saveLaborConfig, getHorasValorizadas, getEventosRango, marcarHorasPagadas,
  getSedes, addSede, updateSede, removeSede,
  getHorarios, addHorario, updateHorario, removeHorario,
} from '../services/panelStore.js';
// valorizarRegistro es LA MISMA función que usa el servidor para poner el
// valor en pesos (lib/nomina.js). El simulador de Ajustes la llama directo:
// si probara con una fórmula escrita aparte, no estaría probando nada.
import { TIPOS_HORA, CODIGOS_HORA, valorizarRegistro } from '../lib/tiposHora.js';
// calcularRegistros es el motor de CLASIFICACIÓN (marcaciones → qué horas son
// extra y de qué código). El simulador lo llama tal cual, sin base de datos:
// entra una lista de marcas, sale la lista de tramos.
import { calcularRegistros } from '../lib/calculoHoras.js';
import { vigenciasDeHorasSemana } from '../lib/jornada.js';
import { rutaDe, tabDeRuta } from '../lib/rutasPanel.js';
import { signOut } from '../lib/auth-client';
// Diagnóstico GPS embebido en Ajustes (la página /gps sigue existiendo).
import GpsDebug from './GpsDebug.jsx';
// Formulario de alta de empleados: el mismo de /admin/registro, embebido en
// un cajón para registrar sin salir de la pestaña.
import { RegistroEmpleadoForm } from './EmployeeRegister.jsx';

/** Iconos de línea (estilo Lucide, inline SVG): heredan el color del texto. */
function Icon({ name, size = 17 }) {
  const paths = {
    dashboard: <><rect x="3" y="3" width="7" height="9" rx="1" /><rect x="14" y="3" width="7" height="5" rx="1" /><rect x="14" y="12" width="7" height="9" rx="1" /><rect x="3" y="16" width="7" height="5" rx="1" /></>,
    alert: <><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" /><line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" /></>,
    clock: <><circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" /></>,
    user: <><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" /></>,
    file: <><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /></>,
    history: <><path d="M3 3v5h5" /><path d="M3.05 13A9 9 0 1 0 6 5.3L3 8" /><path d="M12 7v5l4 2" /></>,
    settings: <><line x1="4" y1="21" x2="4" y2="14" /><line x1="4" y1="10" x2="4" y2="3" /><line x1="12" y1="21" x2="12" y2="12" /><line x1="12" y1="8" x2="12" y2="3" /><line x1="20" y1="21" x2="20" y2="16" /><line x1="20" y1="12" x2="20" y2="3" /><line x1="1" y1="14" x2="7" y2="14" /><line x1="9" y1="8" x2="15" y2="8" /><line x1="17" y1="16" x2="23" y2="16" /></>,
    lock: <><rect x="3" y="11" width="18" height="11" rx="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" /></>,
    monitor: <><rect x="2" y="3" width="20" height="14" rx="2" /><line x1="8" y1="21" x2="16" y2="21" /><line x1="12" y1="17" x2="12" y2="21" /></>,
    pin: <><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" /><circle cx="12" cy="10" r="3" /></>,
    database: <><ellipse cx="12" cy="5" rx="9" ry="3" /><path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3" /><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5" /></>,
    trash: <><polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /></>,
    download: <><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" /></>,
    users: <><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M23 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" /></>,
    chevronLeft: <polyline points="15 18 9 12 15 6" />,
    chevronRight: <polyline points="9 18 15 12 9 6" />,
    check: <polyline points="20 6 9 17 4 12" />,
  };
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {paths[name]}
    </svg>
  );
}

/**
 * Lista en acordeón para móvil: reemplaza a las tablas (que en pantallas
 * angostas obligarían a scroll horizontal). Cabecera = lo esencial;
 * al expandir se ven los demás campos y las acciones.
 */
function AccList({ items }) {
  const [openId, setOpenId] = useState(null);
  return (
    <div className="acc">
      {items.map((it) => {
        const open = openId === it.id;
        return (
          <div className={`acc-item${open ? ' open' : ''}`} key={it.id}>
            <button className="acc-head" aria-expanded={open} onClick={() => setOpenId(open ? null : it.id)}>
              <span className="acc-title">{it.title}</span>
              {it.right}
              <span className="acc-chev"><Icon name="chevronRight" size={14} /></span>
            </button>
            {open && (
              <div className="acc-body">
                {it.fields.map(([label, value]) => (
                  <div className="acc-field" key={label}><b>{label}</b><span>{value}</span></div>
                ))}
                {it.actions && <div className="acc-actions">{it.actions}</div>}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// Mapa de días L–V con la franja de oficina, punto de partida al crear.
const diasLunesAViernes = () => Object.fromEntries(
  [1, 2, 3, 4, 5].map((d) => [String(d), { entrada: '08:00', salida: '17:00', almuerzoMin: 60 }]),
);

/**
 * Solo los NOMBRES de los días laborables, agrupando consecutivos:
 * "Lun–Vie · Sáb". (resumenDias incluye además las franjas.)
 */
const nombresDias = (dias) => {
  const grupos = [];
  for (const d of ORDEN_SEMANA) {
    if (!dias?.[String(d)]) { grupos.push(null); continue; }
    const prev = grupos[grupos.length - 1];
    if (prev) prev.push(d);
    else grupos.push([d]);
  }
  return grupos
    .filter(Boolean)
    .map((g) => (g.length > 1 ? `${DIAS_CORTOS[g[0]]}–${DIAS_CORTOS[g[g.length - 1]]}` : DIAS_CORTOS[g[0]]))
    .join(' · ');
};

/** Franjas distintas del horario, en orden de la semana: "08:00 – 17:00 · 08:00 – 12:00". */
const franjasDe = (dias) => [...new Set(
  ORDEN_SEMANA.map((d) => dias?.[String(d)]).filter(Boolean).map((f) => `${f.entrada} – ${f.salida}`),
)].join(' · ');

/** Almuerzo del horario: minutos únicos, o el rango si varía por día. */
const almuerzoDe = (dias) => {
  const mins = [...new Set(Object.values(dias ?? {}).map((f) => Number(f.almuerzoMin) || 0))];
  if (mins.length === 0) return '—';
  if (mins.length === 1) return mins[0] ? `${mins[0]} min` : '—';
  return `${Math.min(...mins)}–${Math.max(...mins)} min`;
};

/**
 * Editor de jornada POR DÍAS: una fila por día (lunes→domingo), cada una
 * activable con su propia franja y almuerzo. Lo usan el formulario de
 * horarios y la ficha del empleado, para que editar "qué días y a qué horas"
 * se vea igual en los dos sitios.
 */
function EditorDias({ dias, onChange }) {
  const toggle = (d) => {
    const k = String(d);
    const next = { ...dias };
    if (next[k]) {
      delete next[k];
    } else {
      // Al activar un día arranca con la franja de otro día ya definido: lo
      // normal es que la semana comparta horas y solo cambien excepciones.
      const modelo = ORDEN_SEMANA.map((x) => next[String(x)]).find(Boolean);
      next[k] = modelo ? { ...modelo } : { entrada: '08:00', salida: '17:00', almuerzoMin: 60 };
    }
    onChange(next);
  };
  const set = (d, campo, v) => {
    const k = String(d);
    onChange({ ...dias, [k]: { ...dias[k], [campo]: v } });
  };
  return (
    <div className="hd-editor">
      {ORDEN_SEMANA.map((d) => {
        const f = dias[String(d)];
        return (
          <div className={`hd-dia${f ? '' : ' hd-off'}`} key={d}>
            <label className="hd-nombre">
              <input type="checkbox" checked={!!f} onChange={() => toggle(d)} />
              {DIAS_CORTOS[d]}
            </label>
            {f ? (
              <>
                <input className="num" type="time" value={f.entrada} onChange={(e) => set(d, 'entrada', e.target.value)} aria-label={`Entrada del ${DIAS_CORTOS[d]}`} />
                <span className="hd-sep">–</span>
                <input className="num" type="time" value={f.salida} onChange={(e) => set(d, 'salida', e.target.value)} aria-label={`Salida del ${DIAS_CORTOS[d]}`} />
                <span className="hd-almuerzo">
                  <input
                    className="num" type="number" min="0" max="240" step="15" value={f.almuerzoMin}
                    onChange={(e) => set(d, 'almuerzoMin', e.target.value === '' ? 0 : Math.min(240, Math.max(0, Number(e.target.value))))}
                    aria-label={`Almuerzo del ${DIAS_CORTOS[d]} en minutos`}
                  />
                  <span>min</span>
                </span>
              </>
            ) : (
              <span className="hd-libre">día libre</span>
            )}
          </div>
        );
      })}
    </div>
  );
}

/**
 * Signo de pregunta con explicación al pasar el mouse (o al enfocarlo).
 * `abajo`: el globo se abre hacia abajo — para los que viven pegados al borde
 * superior de un contenedor con scroll, donde hacia arriba quedan recortados.
 */
function Q({ texto, abajo = false }) {
  return (
    <span className="q-ico" tabIndex={0}>
      ?
      <span className={`q-tip${abajo ? ' abajo' : ''}`}>{texto}</span>
    </span>
  );
}

/** Logo «C-dial» (el de public/icon.svg), en el color del texto. */
function MarcaCDial({ size = 20 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden="true">
      <g stroke="currentColor" strokeLinecap="round" fill="none">
        <path d="M 51 17.5 A 24 24 0 1 0 51 46.5" strokeWidth="7.5" />
        <line x1="32" y1="10" x2="32" y2="15" strokeWidth="3.4" />
        <line x1="10" y1="32" x2="15" y2="32" strokeWidth="3.4" />
        <line x1="32" y1="49" x2="32" y2="54" strokeWidth="3.4" />
        <circle cx="32" cy="32" r="3" fill="currentColor" stroke="none" />
        <line x1="32" y1="32" x2="41" y2="23" strokeWidth="4.4" />
      </g>
    </svg>
  );
}

/** Interruptor tipo switch (verde = activo). Detiene el clic de la fila. */
function Toggle({ on, disabled, onClick, label }) {
  return (
    <button
      type="button"
      className={`sw${on ? ' on' : ''}`}
      disabled={disabled}
      aria-pressed={on}
      aria-label={label}
      title={label}
      onClick={(e) => { e.stopPropagation(); onClick(); }}
    >
      <span />
    </button>
  );
}

// Día calendario en BOGOTÁ (UTC-5 fijo). Nunca cortar el ISO crudo: una
// marcación de las 22:00 Bogotá ya es "mañana" en UTC y caería en el día
// equivocado del acordeón.
const dayKey = (iso) => new Date(new Date(iso).getTime() - 5 * 3600000).toISOString().slice(0, 10);
const todayKey = () => dayKey(new Date().toISOString());

// Hora del día en formato hh:mm:ss (24 h). Conserva el nombre fmt12 para no
// tocar todos los puntos de uso.
const fmt12 = (iso) => {
  if (!iso) return '—';
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`;
};
// Duración en hh:mm:ss (antes "7,5 h"): 7.5 → "07:30:00".
const fmtH = (n) => {
  if (n == null) return '—';
  const total = Math.round(n * 3600);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
};
// Horas compactas hh:mm (sin segundos), para la tabla de asistencia.
const fmtHM = (n) => {
  if (n == null) return '—';
  const total = Math.round(n * 60);
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
};
// Hora del día corta "7:02" (sin segundos ni cero inicial).
const horaCorta = (iso) => {
  const d = new Date(iso);
  return `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`;
};

const fmtTs = (iso) =>
  new Date(iso).toLocaleDateString('es-CO', { day: 'numeric', month: 'short' }) + ', ' + fmt12(iso);

/** Estado de pago de una fila, en palabras. */
const ETIQUETA_PAGO = { pagado: 'Pagado', parcial: 'Parcial', pendiente: 'Pendiente', na: '—' };

// Pesos colombianos, sin centavos: el peso no los usa y en un reporte de
// nómina los decimales solo restan confianza.
const fmtCOP = (n) =>
  n == null ? '—' : n.toLocaleString('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 });

// Horas decimales con coma (1.6456 → "1,65 h"). En la valorización se
// prefiere esto al hh:mm:ss del resto del panel: al lado de pesos se lee
// "1,65 h × factor". DOS decimales: con uno, 1:38:44 aparecía como "1,7 h"
// y el reporte no cuadraba con el cronómetro de asistencia.
const fmtHoras = (n) => `${(Math.round(n * 100) / 100).toLocaleString('es-CO')} h`;

/** Suma horas de pares entrada→salida; una entrada abierta cuenta hasta ahora (máx. 12 h). */
/**
 * Horas trabajadas sumando parejas entrada→salida.
 *
 * La entrada que queda ABIERTA se trata según el día:
 *  · día en curso → se cuenta lo corrido hasta ahora (indicador en vivo de
 *    quién está trabajando);
 *  · día ya terminado → se cierra en la hora en que terminaba su jornada,
 *    igual que hace el servidor en lib/calculoHoras.js. Sin `person` no hay
 *    horario que aplicar y ese tramo no suma — como antes.
 *
 * Sin esto, un día pasado sin salida mostraba CERO horas trabajadas aquí
 * mientras Reportes ya contaba las del cierre: el mismo día con dos cifras.
 */
function pairedHours(events, nowMs, person = null) {
  let total = 0;
  let openIn = null;
  for (const e of events) {
    if (e.type === 'in') openIn = e;
    else if (e.type === 'out' && openIn) {
      total += (new Date(e.ts) - new Date(openIn.ts)) / 3600000;
      openIn = null;
    }
  }
  if (openIn) {
    const inicio = new Date(openIn.ts).getTime();
    const diaEntrada = dayKey(openIn.ts);
    if (diaEntrada >= dayKey(new Date(nowMs).toISOString())) {
      const span = nowMs - inicio;
      if (span < NIGHT_WINDOW_MS) total += span / 3600000;
    } else {
      // Día terminado: cierra con el horario. Si entró DESPUÉS de su hora de
      // salida, `fin` queda antes que la entrada y no suma nada — que es la
      // regla: quien llega pasada su jornada no abre un día nuevo.
      const fin = finJornadaMs(person, diaEntrada);
      if (fin != null && fin > inicio) total += (fin - inicio) / 3600000;
    }
  }
  return total;
}

/**
 * Transición FLIP para listas que se REORDENAN en vivo (asistencia): mide
 * dónde estaba cada hijo antes del render y lo desliza desde ahí hasta su
 * posición nueva, en vez de teletransportarlo. Los hijos se identifican con
 * data-flip-id. Respeta prefers-reduced-motion.
 */
function useFlip(ref, deps) {
  const previas = useRef(new Map());
  useLayoutEffect(() => {
    const cont = ref.current;
    if (!cont) { previas.current = new Map(); return; }
    const reducido = typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;
    const nuevas = new Map();
    for (const el of cont.children) {
      const id = el.dataset?.flipId;
      if (!id) continue;
      const top = el.getBoundingClientRect().top;
      nuevas.set(id, top);
      const antes = previas.current.get(id);
      if (!reducido && antes != null && Math.abs(antes - top) > 1 && el.animate) {
        el.animate(
          [{ transform: `translateY(${antes - top}px)` }, { transform: 'none' }],
          { duration: 380, easing: 'cubic-bezier(.22,.9,.35,1)' },
        );
      }
    }
    previas.current = nuevas;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}

/** Iniciales para el avatar de la sesión: "Ana María Ruiz" → "AR". */
const iniciales = (texto) =>
  texto.split(/[\s@.]+/).filter(Boolean).slice(0, 2).map((p) => p[0]).join('').toUpperCase();

/**
 * Un nombre y un apellido, para las listas donde el nombre completo estorba.
 * En Colombia la cédula trae «Nombre1 Nombre2 Apellido1 Apellido2», así que
 * con cuatro palabras se toman la primera y la TERCERA («Yeraldin Camuez»);
 * con tres, las dos primeras («Edwin Espinoza»). Se capitaliza porque los
 * nombres llegan como los tecleó quien registró, a veces en minúscula.
 */
const nombreCorto = (texto) => {
  const p = String(texto ?? '').trim().split(/\s+/).filter(Boolean);
  const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
  if (p.length === 0) return '';
  if (p.length <= 2) return p.map(cap).join(' ');
  return [p[0], p[p.length >= 4 ? 2 : 1]].map(cap).join(' ');
};

const ROL_ETIQUETA = { empresa: 'Empresa', superadmin: 'Superadministrador' };

export default function AdminPanel({ sesion = null, permisos = {}, seccionInicial = 'dashboard' }) {
  // Cada pantalla tiene su propia dirección (/admin/empleados,
  // /admin/ajustes/sedes…). La inicial la resuelve el servidor desde la ruta;
  // aquí solo hay que mantenerlas sincronizadas.
  const [tab, setTabEstado] = useState(seccionInicial);

  /**
   * Cambia de pantalla Y de dirección. Sustituye al `setTab` de antes, así que
   * los sitios que ya lo llamaban no cambian.
   *
   * Usa `history.pushState` y no el enrutador de Next a propósito: navegar de
   * verdad volvería a ejecutar el componente de servidor en CADA clic de
   * pestaña —comprobación de sesión incluida— y el panel se recargaría entero.
   * Next reconoce este cambio de historia, así que la dirección queda bien y
   * el botón «atrás» funciona.
   */
  // Pila de pantallas visitadas DENTRO del panel: alimenta la flecha de
  // regresar de la barra. No usa history.back() a propósito — ese botón
  // podría sacar a la persona del panel (login, otra página); esta flecha
  // solo deshace la última navegación interna.
  const pilaTabs = useRef([]);

  const setTab = useCallback((t) => {
    setTabEstado((actual) => {
      if (actual !== t) pilaTabs.current.push(actual);
      return t;
    });
    if (typeof window !== 'undefined') window.history.pushState(null, '', rutaDe(t));
  }, []);

  /** Flecha «regresar»: vuelve a la última pantalla que la persona visitó. */
  const volverAtras = useCallback(() => {
    const previa = pilaTabs.current.pop();
    if (!previa) return;
    setTabEstado(previa);
    if (typeof window !== 'undefined') window.history.pushState(null, '', rutaDe(previa));
  }, []);

  // Botón «atrás» y «adelante»: la dirección cambia sin pasar por `setTab`,
  // así que hay que volver a leerla.
  useEffect(() => {
    const alVolver = () => setTabEstado(tabDeRuta(window.location.pathname));
    window.addEventListener('popstate', alVolver);
    return () => window.removeEventListener('popstate', alVolver);
  }, []);
  const [collapsed, setCollapsed] = useState(false); // menú lateral escondido (solo PC)
  const [navOpen, setNavOpen] = useState(false); // menú off-canvas abierto (solo móvil)
  const [sesionAbierta, setSesionAbierta] = useState(false); // detalle de quién entró
  const [sedeFilter, setSedeFilter] = useState('all'); // 'all' | nombre de sede
  const [tick, setTick] = useState(0); // fuerza relectura de localStorage

  // El acceso lo protege la SESIÓN (app/admin/page.jsx redirige a
  // /login si no la hay). Aquí ya no existe el PIN de prototipo.
  useEffect(() => {
    setCfg(getLaborConfig()); // hidratar config
  }, []);

  // Reportes: rango de fechas (por defecto, el mes en curso).
  const monthStart = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`; };
  const [repFrom, setRepFrom] = useState(monthStart());
  const [repTo, setRepTo] = useState(todayKey());
  // Columnas de asistencia (sede, días, horas, tardías): apagadas por defecto.
  // La tabla es sobre horas extra y dinero; lo demás solo se muestra a quien
  // lo pida, y en el CSV va siempre.
  const [repColsAsistencia, setRepColsAsistencia] = useState(false);

  // Reglamento laboral (jornada legal semanal + gracia de puntualidad).
  const [cfg, setCfg] = useState(getLaborConfig);
  // Claves que pertenecen a la pantalla de valorización, para que el aviso
  // diga lo que la persona acaba de tocar y no siempre "Reglamento".
  const CLAVES_VALORIZACION = ['factores', 'divisorHorasMes', 'nocturnoInicio', 'nocturnoFin'];
  const updateCfg = (partial) => {
    setCfg(saveLaborConfig(partial));
    const esValorizacion = Object.keys(partial).some((k) => CLAVES_VALORIZACION.includes(k));
    showToast(esValorizacion ? 'Valorización actualizada' : 'Reglamento actualizado');
  };

  // Sedes editables (fuente: sedesService; se relee con cada refresh).
  const [sedes, setSedes] = useState([]);
  useEffect(() => { setSedes(getSedes()); }, [tick]);

  // Horarios (plantillas de jornada) + su formulario de crear/editar.
  const [horarios, setHorarios] = useState([]);
  useEffect(() => { setHorarios(getHorarios()); }, [tick]);
  const [horForm, setHorForm] = useState(null); // {id?, nombre, dias: {"0".."6": {entrada, salida, almuerzoMin}}}
  const [newSede, setNewSede] = useState({ name: '', lat: '', lon: '', radius: '50' });
  const [editSede, setEditSede] = useState(null); // { original, name, lat, lon, radius }

  /**
   * PEGAR en los campos de coordenadas. Los inputs siguen siendo numéricos
   * para teclear, pero el pegado se intercepta ANTES de que el navegador lo
   * mutile (un input number descarta en silencio lo que no parsea — así se
   * comía el punto y quedaban longitudes gigantes «inválidas»):
   * - Par completo de Google Maps («1.221088, -77.281136») en cualquiera de
   *   los dos campos → se reparte solo entre latitud y longitud.
   * - Un solo valor → se limpia (coma decimal → punto) y va a su campo.
   */
  // La rueda del mouse sobre un input numérico enfocado cambia el valor sin
  // querer; soltar el foco al rodar lo evita sin tocar el scroll de la página.
  const soltarRueda = (e) => e.currentTarget.blur();

  const pegarCoord = (e, campo, obj, set) => {
    const texto = (e.clipboardData?.getData('text') || '').trim();
    e.preventDefault();
    const par = texto.match(/^(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)$/);
    if (par) set({ ...obj, lat: par[1], lon: par[2] });
    else set({ ...obj, [campo]: texto.replace(',', '.').replace(/[^0-9.\-]/g, '') });
  };
  const [newSedeOpen, setNewSedeOpen] = useState(false); // drawer de "Nueva sede"
  const [newHoliday, setNewHoliday] = useState('');
  // Borradores de la pantalla de valorización: lo tecleado se guarda al salir
  // del campo, no en cada pulsación (escribir "215" pasa por "2" y "21").
  const [pctDraft, setPctDraft] = useState(null); // { HED: '125', … }
  // Divisor del valor hora: jornada semanal × 5, derivado — ya no se edita.
  const DIVISOR_210 = (cfg.weeklyHours ?? 42) * 5;

  // Simulador de horas extra (Ajustes): salario de prueba + horas por código.
  const [simSalario, setSimSalario] = useState('1500000');
  const [simHoras, setSimHoras] = useState(() => Object.fromEntries(CODIGOS_HORA.map((c) => [c, ''])));
  // Simulador de turno: fecha + entrada + salida → códigos que emite el motor.
  const [simTurno, setSimTurno] = useState({ fecha: todayKey(), entrada: '08:00', salida: '20:00', jornada: '' });

  // Quién tiene acceso a esta empresa. Con Google no se crean cuentas: se
  // invita un correo, y la cuenta nace cuando esa persona entra.
  const [usuarios, setUsuarios] = useState([]);
  const [invitaciones, setInvitaciones] = useState([]);
  const [usrError, setUsrError] = useState(null);
  const [nuevoUsr, setNuevoUsr] = useState(null); // { email }
  const cargarUsuarios = () => {
    fetch('/api/usuarios')
      .then((r) => r.json())
      .then((d) => {
        if (d.ok) { setUsuarios(d.usuarios); setInvitaciones(d.invitaciones ?? []); setUsrError(null); }
        else setUsrError(d.error);
      })
      .catch((e) => setUsrError(e.message));
  };
  // El sistema NO manda correos (todavía): la invitación autoriza el ingreso,
  // y el aviso lo lleva el dueño por el canal que use con esa persona. Por eso
  // tras invitar se ofrece el mensaje listo para copiar y pegar.
  const [invitacionCreada, setInvitacionCreada] = useState(null); // { email }
  const textoInvitacion = (email) =>
    `Te invitaron al panel de asistencia de ${sesion?.empresa ?? 'la empresa'}. ` +
    `Entra con tu cuenta de Google (${email}) aquí: ${window.location.origin}/login`;
  const copiarInvitacion = async (email) => {
    try {
      await navigator.clipboard.writeText(textoInvitacion(email));
      showToast('Invitación copiada — pégala en WhatsApp o correo');
    } catch {
      showToast('No se pudo copiar. Copia el enlace a mano.');
    }
  };
  const invitar = async () => {
    const r = await fetch('/api/usuarios', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: nuevoUsr.email }),
    });
    const d = await r.json().catch(() => null);
    if (!r.ok || !d?.ok) { showToast(d?.error ?? `Error ${r.status}`); return; }
    setInvitacionCreada({ email: d.invitacion.email });
    setNuevoUsr(null);
    cargarUsuarios();
  };
  const actualizarUsuario = async (u, cambios) => {
    const r = await fetch(`/api/usuarios/${u.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ activo: u.activo, ...cambios }),
    });
    const d = await r.json().catch(() => null);
    if (!r.ok || !d?.ok) { showToast(d?.error ?? `Error ${r.status}`); return; }
    cargarUsuarios();
  };
  const revocarInvitacion = async (inv) => {
    if (!confirm(`¿Revocar la invitación de ${inv.email}?`)) return;
    const r = await fetch(`/api/usuarios/${inv.id}`, { method: 'DELETE' });
    const d = await r.json().catch(() => null);
    if (!r.ok || !d?.ok) { showToast(d?.error ?? `Error ${r.status}`); return; }
    showToast('Invitación revocada');
    cargarUsuarios();
  };

  // Mi empresa: nombre, NIT, clave de API y uso del plan.
  const [miEmpresa, setMiEmpresa] = useState(null);
  const [empDraft, setEmpDraft] = useState(null); // { nombre, nit } en edición
  const [apiKeyVisible, setApiKeyVisible] = useState(false);
  const cargarMiEmpresa = () => {
    fetch('/api/empresa')
      .then((r) => r.json())
      .then((d) => { if (d.ok) setMiEmpresa(d.empresa); else showToast(d.error); })
      .catch((e) => showToast(e.message));
  };
  const guardarMiEmpresa = async () => {
    const r = await fetch('/api/empresa', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nombre: empDraft.nombre, nit: empDraft.nit }),
    });
    const d = await r.json().catch(() => null);
    if (!r.ok || !d?.ok) { showToast(d?.error ?? `Error ${r.status}`); return; }
    setEmpDraft(null);
    showToast('Empresa actualizada');
    cargarMiEmpresa();
  };
  const regenerarApiKey = async () => {
    if (!confirm('¿Regenerar la clave? La integración de nómina que use la actual dejará de funcionar hasta poner la nueva.')) return;
    const r = await fetch('/api/empresa', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ regenerarApiKey: true }),
    });
    const d = await r.json().catch(() => null);
    if (!r.ok || !d?.ok) { showToast(d?.error ?? `Error ${r.status}`); return; }
    setApiKeyVisible(true);
    showToast('Clave regenerada');
    cargarMiEmpresa();
  };

  // Dispositivos del kiosco activados (para listar y revocar).
  const [dispositivos, setDispositivos] = useState([]);
  const [dispError, setDispError] = useState(null);
  const cargarDispositivos = () => {
    fetch('/api/dispositivos')
      .then((r) => r.json())
      .then((d) => { if (d.ok) { setDispositivos(d.dispositivos); setDispError(null); } else setDispError(d.error); })
      .catch((e) => setDispError(e.message));
  };
  // Vinculación por código: el aparato se registra tecleando un código en vez
  // de iniciar sesión. Es el único camino en la app de Android, donde Google
  // no permite autenticarse dentro de la ventana de la app.
  const [vinculando, setVinculando] = useState(null);   // { nombre, sedeId }
  const [codigoVinc, setCodigoVinc] = useState(null);   // { codigoLegible, expira_en }
  const generarCodigoVinculacion = async () => {
    const r = await fetch('/api/dispositivos/vincular', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nombre: vinculando.nombre.trim(), sede_id: vinculando.sedeId }),
    });
    const d = await r.json().catch(() => null);
    if (!r.ok || !d?.ok) { showToast(d?.error ?? `Error ${r.status}`); return; }
    setCodigoVinc(d);
    setVinculando(null);
  };

  /**
   * Reconectar: código para el MISMO dispositivo (se borraron los datos de la
   * app, se cambió la tablet…). Al canjearlo recibe clave nueva y vuelve
   * activo, sin crear un aparato duplicado.
   */
  const reconectarDispositivo = async (d) => {
    const r = await fetch('/api/dispositivos/vincular', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ dispositivo_id: d.id }),
    });
    const j = await r.json().catch(() => null);
    if (!r.ok || !j?.ok) { showToast(j?.error ?? `Error ${r.status}`); return; }
    setCodigoVinc({ ...j, reconectando: d.nombre });
  };

  const revocarDispositivo = async (d) => {
    if (!confirm(`¿Revocar "${d.nombre}"? Dejará de marcar.`)) return;
    const r = await fetch(`/api/dispositivos/${d.id}`, { method: 'DELETE' });
    const j = await r.json().catch(() => null);
    if (!r.ok || !j?.ok) { showToast(`No se pudo revocar: ${j?.error ?? r.status}`); return; }
    showToast(`"${d.nombre}" revocado`);
    cargarDispositivos();
  };

  // Edición de empleado (CRUD): diálogo con datos no biométricos.
  const [editEmp, setEditEmp] = useState(null); // { id, name, cedula, sede, expectedEntry }

  // ── Rostros del empleado abierto en la ficha ────────────────────────
  // Agregar una foto no debe obligar a registrar de nuevo a la persona.
  // ── Contratar el plan ────────────────────────────────────────────────
  // El servidor arma y FIRMA la configuración del checkout (el monto va
  // firmado para que nadie lo cambie por el camino); aquí solo se abre la
  // pasarela de Bold con esos datos.
  const [pagando, setPagando] = useState(false);
  // El catálogo resuelto para ESTA empresa: qué planes hay, cuál le queda
  // corto según su gente y si todavía le toca el precio de entrada. Lo decide
  // el servidor; aquí solo se pinta.
  const [catalogo, setCatalogo] = useState(null);
  const [mesesPlan, setMesesPlan] = useState(1);
  // Se pide al ABRIR la pantalla, no con cada `tick`: el catálogo cambia una
  // vez al mes, y colgarlo del reloj del panel lo hacía pedirse cada diez
  // segundos indefinidamente.
  useEffect(() => {
    if (tab !== 'cfg-plan') return;
    let vigente = true;
    fetch('/api/pago/planes')
      .then((r) => r.json())
      .then((d) => { if (vigente && d?.ok) setCatalogo(d); })
      .catch(() => { /* sin catálogo no se ofrecen botones */ });
    return () => { vigente = false; };
  }, [tab]);

  /**
   * Carga la librería de Bold una sola vez, bajo demanda: son unos kilobytes
   * que no tienen por qué pesar en cada visita al panel de quien ya pagó.
   */
  const cargarBold = () => new Promise((resolver, rechazar) => {
    if (window.BoldCheckout) { resolver(); return; }
    const yaEsta = document.querySelector('script[data-bold-lib]');
    if (yaEsta) {
      yaEsta.addEventListener('load', () => resolver());
      yaEsta.addEventListener('error', () => rechazar(new Error('no se pudo cargar la pasarela')));
      return;
    }
    const s = document.createElement('script');
    s.src = 'https://checkout.bold.co/library/boldPaymentButton.js';
    s.async = true;
    s.dataset.boldLib = '1';
    s.onload = () => resolver();
    s.onerror = () => rechazar(new Error('no se pudo cargar la pasarela'));
    document.head.appendChild(s);
  });

  const irAPagar = async (planId, meses = 1) => {
    setPagando(true);
    try {
      const r = await fetch('/api/pago/iniciar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ plan: planId, meses }),
      });
      const d = await r.json().catch(() => null);
      if (!r.ok || !d?.ok) { showToast(d?.error || 'No se pudo iniciar el pago.'); return; }
      await cargarBold();
      if (!window.BoldCheckout) throw new Error('la pasarela no quedó disponible');
      // `d.checkout` viene tal cual lo espera Bold, con la firma ya calculada
      // en el servidor: aquí no se arma ni se altera ningún dato del cobro.
      new window.BoldCheckout(d.checkout).open();
    } catch (e) {
      showToast(`No se pudo abrir el pago: ${e.message}`);
    } finally {
      setPagando(false);
    }
  };

  const [rostros, setRostros] = useState([]);
  const [rostroOcupado, setRostroOcupado] = useState(false);
  const rostroFileRef = useRef(null);
  const faceapiFichaRef = useRef(null);

  useEffect(() => {
    if (!editEmp?.id) { setRostros([]); return; }
    let vigente = true;
    listarRostros(editEmp.id).then((r) => { if (vigente) setRostros(r); }).catch(() => {});
    return () => { vigente = false; };
  }, [editEmp?.id]);

  /**
   * Suma fotos al empleado abierto. El modelo facial se carga bajo demanda
   * (la primera vez tarda unos segundos): el panel no lo necesita hasta que
   * alguien decide agregar un rostro.
   */
  const agregarFotos = async (empleadoId, ev) => {
    const files = [...(ev.target.files ?? [])];
    ev.target.value = '';
    if (files.length === 0) return;
    setRostroOcupado(true);
    try {
      if (!faceapiFichaRef.current) {
        const faceapi = await import('@vladmandic/face-api');
        try { await faceapi.tf.ready(); } catch { await faceapi.tf.setBackend('cpu'); await faceapi.tf.ready(); }
        await Promise.all([
          faceapi.nets.tinyFaceDetector.loadFromUri('/models'),
          faceapi.nets.faceLandmark68Net.loadFromUri('/models'),
          faceapi.nets.faceRecognitionNet.loadFromUri('/models'),
        ]);
        faceapiFichaRef.current = faceapi;
      }
      const faceapi = faceapiFichaRef.current;
      let sumadas = 0;
      for (const file of files) {
        const img = await faceapi.bufferToImage(file);
        // Mismos reintentos que el registro: con un solo pase a 416 px se
        // rechazaban fotos buenas (una vertical de celular queda aplastada al
        // redimensionar y la cara no alcanza el umbral de confianza).
        let det = null;
        for (const o of [{ inputSize: 416, scoreThreshold: 0.5 }, { inputSize: 608, scoreThreshold: 0.4 }, { inputSize: 800, scoreThreshold: 0.3 }]) {
          det = await faceapi.detectSingleFace(img, new faceapi.TinyFaceDetectorOptions(o)).withFaceLandmarks().withFaceDescriptor();
          if (det) break;
        }
        if (!det) { showToast(`En ${file.name} no se encontró una cara. Usa una foto frontal y con buena luz.`); continue; }
        const lado = Math.round(Math.min(det.detection.box.width, det.detection.box.height));
        if (lado < 90) {
          showToast(`En ${file.name} la cara tiene ${lado} px y hacen falta 90: acércate o usa una foto de más resolución.`); continue;
        }
        const res = await agregarRostro(empleadoId, Array.from(det.descriptor));
        if (res.error) { showToast(res.error); continue; }
        sumadas += 1;
      }
      if (sumadas > 0) {
        setRostros(await listarRostros(empleadoId));
        refresh();
        showToast(sumadas === 1 ? 'Rostro agregado' : `${sumadas} rostros agregados`);
      }
    } catch (e) {
      showToast(`No se pudo procesar la foto: ${e?.message || e}`);
    } finally {
      setRostroOcupado(false);
    }
  };

  /**
   * Abre la ficha de un empleado. Vive a nivel de componente (y no dentro de
   * la pestaña Empleados, como antes) porque desde Reportes se hace clic en
   * el nombre para llegar a los datos de esa persona.
   */
  const openEdit = (p) => setEditEmp({
    id: p.id, name: p.name, cedula: p.cedula || '', correo: p.correo || '', sede: p.sede || '',
    validarSede: p.validarSede === true,
    validarUbicacion: p.validarUbicacion === true,
    expectedEntry: p.expectedEntry || '',
    expectedExit: p.expectedExit || '',
    breakMinutes: p.breakMinutes == null ? '' : String(p.breakMinutes),
    // Jornada POR DÍAS (copia del horario asignado); null = franja uniforme.
    jornadaDias: p.jornadaDias ? JSON.parse(JSON.stringify(p.jornadaDias)) : null,
    jornadaSemanal: p.jornadaSemanal ? [...p.jornadaSemanal] : null,
    // '' = sin salario registrado, que es un estado válido.
    salarioMensual: p.salarioMensual == null ? '' : String(p.salarioMensual),
    // Solo para mostrar: la ficha dice si esta persona puede marcar en el
    // kiosco. El rostro no se edita desde aquí.
    tieneRostro: Boolean(p.tieneRostro),
  });

  /**
   * Desde Reportes: lleva a la ficha de la persona de esa fila.
   * Un empleado dado de baja ya no está en el roster; en ese caso se avisa en
   * vez de abrir un cajón vacío que no guardaría nada.
   */
  const [toast, setToast] = useState(null);

  // Tabla de asistencia: búsqueda + filtro por estado + paginación.
  // 5 por página: la tarjeta de asistencia del dashboard cabe sin scroll.
  const PAGE_SIZE = 5;
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all'); // all|present|absent|anomaly
  const [page, setPage] = useState(0);
  const [empSearch, setEmpSearch] = useState(''); // búsqueda de la tabla Empleados
  const [empPage, setEmpPage] = useState(0); // paginación de la tabla Empleados
  // Vista de ARCHIVADOS: alterna la tabla (activos ↔ archivados) desde un
  // botón junto a «Registrar empleado», cada lista con su propia página.
  const [verArchivados, setVerArchivados] = useState(false);
  const [archPage, setArchPage] = useState(0);
  // Cajón de registro de empleado (pestaña Empleados, sin cambiar de página).
  const [regAbierto, setRegAbierto] = useState(false);
  // Guía "¿Cómo empezar?" (los 3 pasos que antes ocupaban el dashboard).
  const [guiaAbierta, setGuiaAbierta] = useState(false);
  // Historial de ajustes: filtro por rango de fechas + paginación.
  const [histFiltro, setHistFiltro] = useState({ desde: '', hasta: '' });
  const [histPage, setHistPage] = useState(0);
  // Bandeja de anomalías (PC): filtro por tipo, caso expandido y su formulario
  // de corrección en el sitio.
  const [anomFiltro, setAnomFiltro] = useState('all');
  const [anomAbierta, setAnomAbierta] = useState(null);
  const [anomPage, setAnomPage] = useState(0);
  const [anomForm, setAnomForm] = useState({ time: '17:00', reason: '' });
  // Período de la gráfica de horas y de costos: la QUINCENA en curso (1–15 o
  // 16–fin, como se liquida la nómina) o el mes calendario hasta hoy.
  const [rangoModo, setRangoModo] = useState('quincena');
  // Costos del período: tramos valorizados por el servidor (misma fuente que Reportes).
  const [costos, setCostos] = useState({ estado: 'cargando', tramos: [] });
  // Filtros por columna de la tabla Empleados: cada encabezado lleva su
  // embudo, que abre el selector correspondiente.
  const [empFiltros, setEmpFiltros] = useState({ sede: 'all', horario: 'all', config: 'all' });
  const [filtroAbierto, setFiltroAbierto] = useState(null); // 'sede' | 'horario' | 'config'

  // Envío de horas con recargo a la plataforma de nómina (RH).

  // Drawer de detalle: línea de tiempo de marcaciones de una persona en un día.
  const [drawer, setDrawer] = useState(null); // { personId, personName, desde, hasta }
  const [evForm, setEvForm] = useState(null); // { mode:'add'|'edit', eventId?, fecha, type, time, reason }
  const [openDia, setOpenDia] = useState(null); // día expandido dentro del drawer
  // refresh = re-sincronizar desde Postgres y re-renderizar.
  const refresh = () => {
    syncPanel()
      .then(() => { setCfg(getLaborConfig()); setTick((t) => t + 1); })
      .catch((e) => console.error('No se pudo sincronizar el panel:', e.message));
  };

  useEffect(() => {
    refresh(); // carga inicial desde la API
    // Casi en vivo: sondeo corto + refresco inmediato al volver a la pestaña,
    // para que las marcaciones del kiosco (u otro admin) aparezcan enseguida.
    const id = setInterval(refresh, 10000);
    const alVolver = () => { if (document.visibilityState === 'visible') refresh(); };
    document.addEventListener('visibilitychange', alVolver);
    window.addEventListener('focus', alVolver);
    return () => {
      clearInterval(id);
      document.removeEventListener('visibilitychange', alVolver);
      window.removeEventListener('focus', alVolver);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // La guía marca "✓ Vincula el dispositivo" con la lista real: se carga al
  // abrirla (normalmente solo se carga al entrar a la pestaña Dispositivos).
  useEffect(() => {
    if (guiaAbierta) cargarDispositivos();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [guiaAbierta]);

  // Aviso de BIENVENIDA: tras la primera sincronización, si la empresa está
  // recién nacida (sin empleados ni horarios), la guía se abre sola. Solo una
  // vez por navegador: quien ya trabaja no quiere volver a verla.
  useEffect(() => {
    if (tick < 1) return;
    try {
      if (localStorage.getItem('cr_bienvenida')) return;
      if (listPeople().length === 0 && getHorarios().length === 0) setGuiaAbierta(true);
      localStorage.setItem('cr_bienvenida', '1');
    } catch { /* sin localStorage no hay bienvenida, y no pasa nada */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tick]);

  const data = useMemo(() => {
    const events = listJourneyEvents().sort((a, b) => a.ts.localeCompare(b.ts));
    const nowMs = Date.now();

    // Personas: roster ∪ personas vistas en eventos (con sede y horario).
    const byId = new Map();
    for (const p of listPeople()) byId.set(p.id, { id: p.id, name: p.name, cedula: p.cedula || '', sede: p.sede || '', expectedEntry: p.expectedEntry || '', expectedExit: p.expectedExit || '', breakMinutes: p.breakMinutes ?? null, jornadaDias: p.jornadaDias ?? null });
    for (const e of events) if (!byId.has(e.personId)) byId.set(e.personId, { id: e.personId, name: e.personName, sede: e.sede || '', expectedEntry: '', expectedExit: '', breakMinutes: null, jornadaDias: null });
    const people = [...byId.values()].sort((a, b) => a.name.localeCompare(b.name));

    const perPerson = new Map(people.map((p) => [p.id, events.filter((e) => e.personId === p.id)]));
    const weekAgo = nowMs - 7 * 24 * 3600000;
    // Período calendario (quincena en curso o mes) para la gráfica. weekHours
    // se conserva aparte: las novedades de "extra" comparan contra la semana.
    const hoyD = new Date();
    const rangoAgo = (rangoModo === 'quincena' && hoyD.getDate() > 15
      ? new Date(hoyD.getFullYear(), hoyD.getMonth(), 16)
      : new Date(hoyD.getFullYear(), hoyD.getMonth(), 1)).getTime();

    const anomalies = [];
    const rows = people.map((p) => {
      const mine = perPerson.get(p.id);
      const today = mine.filter((e) => dayKey(e.ts) === todayKey());
      const firstIn = today.find((e) => e.type === 'in') || null;
      const lastOut = [...today].reverse().find((e) => e.type === 'out') || null;

      // Anomalías vigentes de esta persona (últimos 7 días).
      for (let i = 0; i < mine.length; i++) {
        const e = mine[i];
        if (new Date(e.ts).getTime() < weekAgo) continue;
        if (e.type === 'in') {
          const next = mine[i + 1];
          const closed = next && next.type === 'out';
          if (!closed) {
            // Salida faltante: con FRANJA del día, la entrada abierta se marca
            // 3 h después de la salida esperada (quedarse un rato más es hora
            // extra normal, no incidencia). Sin franja, respaldo de 12 h desde
            // la entrada — que era la única regla antes y llegaba tardísimo.
            const entradaMs = new Date(e.ts).getTime();
            let topeMs = entradaMs + NIGHT_WINDOW_MS;
            const franja = franjaEsperada(p, dayKey(e.ts));
            if (franja) {
              const [sh, sm] = franja.salida.split(':').map(Number);
              const sal = new Date(e.ts);
              sal.setHours(sh, sm, 0, 0);
              if (sal.getTime() <= entradaMs) sal.setDate(sal.getDate() + 1); // turno que cruza medianoche
              topeMs = Math.min(topeMs, sal.getTime() + 3 * 3600000);
            }
            if (nowMs > topeMs) anomalies.push({ kind: 'missing-exit', person: p, event: e });
          }
        }
        if (e.flag === 'late-entry') anomalies.push({ kind: 'late-entry', person: p, event: e });
        if (e.flag === 'early-exit') anomalies.push({ kind: 'early-exit', person: p, event: e });
      }

      const corrected = mine.some((e) => e.correctedBy && dayKey(e.ts) === todayKey());

      // Puntualidad: primera entrada vs la franja esperada de HOY (la jornada
      // puede variar por día de la semana) + gracia configurable.
      let onTime = null;
      const franjaHoy = firstIn ? franjaEsperada(p, todayKey()) : null;
      if (firstIn && franjaHoy) {
        const [h, m] = franjaHoy.entrada.split(':').map(Number);
        const d = new Date(firstIn.ts);
        onTime = d.getHours() * 60 + d.getMinutes() <= h * 60 + m + cfg.graceMinutes;
      }

      return {
        person: p,
        sede: p.sede || '',
        firstIn,
        lastOut,
        onTime,
        hoursToday: firstIn ? pairedHours(today, nowMs, p) : null,
        weekHours: pairedHours(mine.filter((e) => new Date(e.ts).getTime() >= weekAgo), nowMs, p),
        rangoHours: pairedHours(mine.filter((e) => new Date(e.ts).getTime() >= rangoAgo), nowMs, p),
        present: !!firstIn && today[today.length - 1]?.type === 'in',
        corrected,
        // Desde DÓNDE marcó por última vez hoy. La columna se llama «Sede /
        // Ubicación» y hasta ahora solo cumplía la mitad: quien no tiene sede
        // —justo el caso donde importa el GPS— salía con un guion.
        lugar: [...today].reverse().find((e) => e.lat != null && e.lon != null) || null,
        // La ÚLTIMA marcación del día, sea entrada o salida. Antes la tabla
        // mostraba la primera entrada, así que quien salía a almorzar y volvía
        // seguía anunciando la hora de la mañana.
        ultimoEv: today[today.length - 1] || null,
      };
    });

    // La bandeja se lee de lo MÁS RECIENTE a lo más viejo (antes quedaba
    // agrupada por persona, en orden alfabético).
    anomalies.sort((a, b) => b.event.ts.localeCompare(a.event.ts));

    // Comparativa por sede (siempre sobre TODAS las filas, sin filtro).
    const sedeNames = getSedes().map((o) => o.name);
    const sedeStats = sedeNames.map((name) => {
      const rs = rows.filter((r) => r.sede === name);
      return {
        name,
        total: rs.length,
        present: rs.filter((r) => r.present).length,
        absent: rs.filter((r) => !r.firstIn).length,
        hours: rs.reduce((s, r) => s + (r.hoursToday ?? 0), 0),
        anomalies: anomalies.filter((a) => (a.person.sede || '') === name).length,
      };
    });
    const sinSede = rows.filter((r) => !r.sede).length;

    const audit = listJourneyEvents().filter((e) => e.correctedBy);
    return { rows, anomalies, audit, sedeStats, sinSede, rangoInicioMs: rangoAgo };
  }, [tick, cfg, rangoModo]);

  // Vista filtrada por sede: alimenta tarjetas, listas y anomalías.
  const view = useMemo(() => {
    const rows = sedeFilter === 'all' ? data.rows : data.rows.filter((r) => r.sede === sedeFilter);
    const anomalies = sedeFilter === 'all' ? data.anomalies : data.anomalies.filter((a) => (a.person.sede || '') === sedeFilter);
    const marked = rows.filter((r) => r.onTime !== null);
    return {
      rows,
      anomalies,
      present: rows.filter((r) => r.present).length,
      absent: rows.filter((r) => !r.firstIn).length,
      punctuality: marked.length ? Math.round((marked.filter((r) => r.onTime).length / marked.length) * 100) : null,
      totalHoursToday: rows.reduce((s, r) => s + (r.hoursToday ?? 0), 0),
    };
  }, [data, sedeFilter]);

  // Roster completo para la pestaña Empleados (con cédula, sede, horario).
  const roster = useMemo(() => {
    const all = listPeople();
    return (sedeFilter === 'all' ? all : all.filter((p) => (p.sede || '') === sedeFilter))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [tick, sedeFilter]);

  // ── Reporte por período: UNA sola tabla ─────────────────────────────
  //
  // Antes había dos, y se contradecían: una calculaba las horas extra en el
  // navegador contra el tope SEMANAL, la otra las pedía al servidor, que las
  // calcula contra la jornada de CADA DÍA. Para el mismo empleado daban
  // números distintos en la misma pantalla.
  //
  // Ahora cada columna tiene un solo dueño:
  //   · Asistencia (días, horas, tardías) → las marcaciones del rango.
  //   · Extras y valor                    → el motor del servidor, y nada más.
  // El cálculo semanal de extras y la columna Dom/Fest se eliminaron: eran
  // una segunda opinión, peor informada, sobre lo que el motor ya responde.
  const [repDatos, setRepDatos] = useState({ estado: 'inicial', eventos: [], tramos: [], error: null });
  useEffect(() => {
    if (tab !== 'reportes' || !repFrom || !repTo) return;
    let vigente = true;
    setRepDatos((d) => ({ ...d, estado: 'cargando', error: null }));
    // Las marcaciones se piden por el RANGO ELEGIDO, no se filtran de la copia
    // en memoria: esa solo tiene 60 días y un reporte de un mes viejo salía
    // con cero días trabajados al lado de horas extra reales.
    Promise.all([getEventosRango(repFrom, repTo), getHorasValorizadas(repFrom, repTo)])
      .then(([eventos, tramos]) => { if (vigente) setRepDatos({ estado: 'listo', eventos, tramos, error: null }); })
      .catch((e) => { if (vigente) setRepDatos({ estado: 'error', eventos: [], tramos: [], error: e.message }); });
    // Si el rango cambia antes de que llegue la respuesta, la vieja se ignora:
    // sin esto una consulta lenta puede pisar el resultado de la nueva.
    return () => { vigente = false; };
  }, [tab, repFrom, repTo, tick]);

  const report = useMemo(() => {
    const nowMs = Date.now();
    const rosterById = new Map(listPeople().map((p) => [p.id, p]));
    const porCedula = new Map(listPeople().map((p) => [p.cedula, p]));

    // 1) Asistencia: quién vino, cuánto estuvo y cuántas veces llegó tarde.
    const filas = new Map(); // clave: cédula (es la que cruza con el motor)
    const porPersona = new Map();
    for (const e of [...repDatos.eventos].sort((a, b) => a.ts.localeCompare(b.ts))) {
      if (!porPersona.has(e.personId)) porPersona.set(e.personId, { name: e.personName, sede: e.sede || '', events: [] });
      porPersona.get(e.personId).events.push(e);
    }
    for (const [id, r] of porPersona) {
      const persona = rosterById.get(id);
      const cedula = persona?.cedula || `id:${id}`;
      filas.set(cedula, {
        id, cedula,
        name: r.name,
        sede: r.sede || persona?.sede || '',
        days: new Set(r.events.filter((e) => e.type === 'in').map((e) => dayKey(e.ts))).size,
        hours: pairedHours(r.events, nowMs, persona),
        lateCount: r.events.filter((e) => e.flag === 'late-entry').length,
        horasPorTipo: Object.fromEntries(CODIGOS_HORA.map((c) => [c, 0])),
        extras: 0,
        valor: 0,
        sinSalario: false,
        conExtras: false,
        desglose: [],          // fórmula exacta de cada tramo, para el tooltip
        referencias: [],       // tramos de esta fila, para marcarlos pagados
        refsSinPagar: [],
      });
    }

    // 2) Extras del motor, encima. Quien tenga extras pero ya no esté en el
    //    roster (baja con historial) igual aparece: la plata no se oculta.
    for (const t of repDatos.tramos) {
      if (!filas.has(t.documento)) {
        const persona = porCedula.get(t.documento);
        filas.set(t.documento, {
          id: persona?.id ?? t.documento,
          cedula: t.documento,
          name: persona?.name ?? `C.C. ${t.documento}`,
          sede: persona?.sede ?? '',
          days: 0, hours: 0, lateCount: 0,
          horasPorTipo: Object.fromEntries(CODIGOS_HORA.map((c) => [c, 0])),
          extras: 0, valor: 0, sinSalario: false, conExtras: false,
          desglose: [], referencias: [], refsSinPagar: [],
        });
      }
      const f = filas.get(t.documento);
      f.horasPorTipo[t.tipoHora] = (f.horasPorTipo[t.tipoHora] ?? 0) + t.horas;
      f.extras += t.horas;
      f.conExtras = true;
      f.referencias.push(t.referenciaExterna);
      if (!t.pagado) f.refsSinPagar.push(t.referenciaExterna);
      // `valor: null` = el servidor no pudo valorizar porque falta el salario.
      // Se marca la fila en vez de sumar cero, que se leería como "no generó".
      if (t.valor == null) f.sinSalario = true;
      else {
        f.valor += t.valor;
        // Fórmula EXACTA del tramo, visible en el tooltip de la columna
        // Valor: el sistema calcula sin redondear y solo aproxima al final.
        f.desglose.push(`${t.fecha} ${t.tipoHora}: ${t.horas} h × $${Number(t.valorHora).toLocaleString('es-CO', { maximumFractionDigits: 2 })} × ${t.factor} = $${Number(t.valor).toLocaleString('es-CO', { maximumFractionDigits: 2 })}`);
      }
    }

    // Estado de pago de la FILA, a partir de sus tramos. `parcial` aparece
    // cuando se pagó una parte, o cuando se corrigió una marcación después de
    // pagar: ese tramo se recalcula con otra referencia y vuelve a estar
    // pendiente. Es el aviso de que algo cambió después de liquidar.
    for (const f of filas.values()) {
      f.pago = !f.conExtras ? 'na'
        : f.refsSinPagar.length === 0 ? 'pagado'
          : f.refsSinPagar.length === f.referencias.length ? 'pendiente' : 'parcial';
    }

    return [...filas.values()]
      .filter((r) => sedeFilter === 'all' || r.sede === sedeFilter)
      .sort((a, b) => b.valor - a.valor || b.extras - a.extras || b.hours - a.hours);
  }, [repDatos, sedeFilter, tick]);

  /**
   * Marca o desmarca los tramos de una fila. Se actualiza el estado local al
   * volver, sin re-pedir todo el período: el cálculo del servidor no cambió,
   * solo la anotación de pago.
   */
  const alternarPago = async (fila) => {
    const pagar = fila.pago !== 'pagado'; // 'parcial' completa lo que falte
    const refs = pagar ? fila.refsSinPagar : fila.referencias;
    if (refs.length === 0) return;
    try {
      await marcarHorasPagadas(refs, pagar);
      const afectadas = new Set(refs);
      setRepDatos((d) => ({
        ...d,
        tramos: d.tramos.map((t) => (afectadas.has(t.referenciaExterna) ? { ...t, pagado: pagar } : t)),
      }));
      showToast(pagar ? `${fila.name}: ${refs.length} tramo(s) marcados como pagados` : `${fila.name}: marca de pago retirada`);
    } catch (e) {
      showToast(`No se pudo guardar: ${e.message}`);
    }
  };

  const totalValorizado = useMemo(() => report.reduce((s, r) => s + r.valor, 0), [report]);

  /** Estado de pago explicado, para el tooltip y el acordeón. */
  const etiquetaPago = (r) => {
    if (r.pago === 'pagado') return `Pagado · ${r.referencias.length} tramo(s)`;
    if (r.pago === 'parcial') {
      return `Parcial · ${r.referencias.length - r.refsSinPagar.length} de ${r.referencias.length} tramos pagados. `
        + 'Un tramo puede volver a pendiente si se corrigió su marcación después de pagar.';
    }
    return `Pendiente · ${r.referencias.length} tramo(s) sin marcar`;
  };

  /**
   * Valor generado por tipo de hora, para el CSV. La tabla solo muestra el
   * total; aquí se reparte con el mismo factor que usó el servidor, para que
   * las columnas por código sumen exactamente el total.
   */
  const valorPorTipo = (r, codigo) => {
    if (r.sinSalario || !r.horasPorTipo[codigo]) return 0;
    const tramos = repDatos.tramos.filter((t) => t.documento === r.cedula && t.tipoHora === codigo);
    return tramos.reduce((s, t) => s + (t.valor ?? 0), 0);
  };

  // Exporta TODO a CSV (separador ; — Excel en español): las cuatro categorías
  // con horas y valor, más la asistencia completa, esté o no visible en la
  // tabla. La tabla es para leer de un vistazo; el CSV es para trabajar.
  const exportCSV = () => {
    const head = [
      'Empleado', 'Cédula', 'Sede',
      ...TIPOS_HORA.flatMap((t) => [`${t.codigo} (h)`, `${t.codigo} (COP)`]),
      'Total horas extra', 'Valor total (COP)', 'Estado de pago',
      'Días trabajados', 'Horas trabajadas', 'Entradas tardías',
    ];
    const num = (n) => (Math.round(n * 100) / 100).toFixed(2).replace('.', ',');
    const ESTADO = { pagado: 'Pagado', parcial: 'Parcial', pendiente: 'Pendiente', na: '' };
    const lines = report.map((r) => [
      r.name, r.cedula, r.sede,
      ...TIPOS_HORA.flatMap((t) => [num(r.horasPorTipo[t.codigo] ?? 0), valorPorTipo(r, t.codigo)]),
      num(r.extras),
      r.sinSalario ? 'sin salario' : r.valor,
      ESTADO[r.pago],
      r.days, num(r.hours), r.lateCount,
    ]);
    const csv = [head, ...lines]
      .map((row) => row.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(';'))
      .join('\r\n');
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' }); // BOM para tildes en Excel
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `reporte_${repFrom}_a_${repTo}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
    showToast('Reporte CSV descargado');
  };

  // Ya no se "envían" horas a nómina: quien liquida las pide cuando las
  // necesita (GET /api/horas). Así una corrección se refleja sola, sin
  // reenviar ni dejar copias desactualizadas.

  // Cerrar sesión.
  const cerrarSesion = async () => {
    try {
      await signOut();
    } catch (e) {
      // NO se ignora: si la sesión no muere, mandar a /login solo aparenta
      // haber salido. La persona entra con otra cuenta, el servidor sigue
      // viéndola como la anterior, y la única salida acaba siendo borrar las
      // cookies a mano. Mejor decirlo y quedarse donde está.
      showToast(`No se pudo cerrar la sesión: ${e?.message || 'inténtalo de nuevo'}`);
      return;
    }
    window.location.href = '/login';
  };

  const showToast = (msg) => {
    setToast(msg);
    setTimeout(() => setToast(null), 2600);
  };

  // Abre el drawer de detalle de una persona en un día concreto.
  // Rango por defecto: los últimos 7 días — perspectiva amplia de la semana.
  const openDrawer = (personId, personName, day = null) => {
    setEvForm(null);
    setOpenDia(day);
    const hasta = day ?? todayKey();
    const desde = day ?? dayKey(new Date(Date.now() - 6 * 24 * 3600000).toISOString());
    setDrawer({ personId, personName, desde, hasta });
  };

  /**
   * Desde Reportes: abre la ASISTENCIA de esa persona (sus marcaciones) sobre
   * el mismo período del reporte — lo que se quiere ver al hacer clic en un
   * nombre es de dónde salieron esas horas, no su ficha de datos.
   */
  const irAAsistenciaEmpleado = (cedula) => {
    const persona = listPeople().find((p) => p.cedula === cedula);
    if (!persona) { showToast('Ese empleado ya no está activo.'); return; }
    setEvForm(null);
    setOpenDia(null);
    setDrawer({ personId: persona.id, personName: persona.name, desde: repFrom, hasta: repTo });
  };

  // Anomalías: abren el drawer en el día del evento, con el formulario
  // preconfigurado según el tipo de anomalía.
  const openFix = (a) => {
    const dia = dayKey(a.event.ts);
    openDrawer(a.person.id, a.person.name, dia);
    if (a.kind === 'missing-exit') {
      setEvForm({ mode: 'add', fecha: dia, type: 'out', time: '17:00', reason: '' });
    } else {
      const d = new Date(a.event.ts);
      setEvForm({ mode: 'edit', eventId: a.event.id, fecha: dia, type: 'in', time: `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`, reason: '' });
    }
  };

  // Bandeja: expande un caso con el formulario precargado (salida esperada
  // para salidas faltantes; la hora del evento para el resto).
  const abrirCaso = (a, key) => {
    if (anomAbierta === key) { setAnomAbierta(null); return; }
    const d = new Date(a.event.ts);
    setAnomForm({
      time: a.kind === 'missing-exit'
        ? (a.person.expectedExit || '17:00')
        : `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`,
      reason: '',
    });
    setAnomAbierta(key);
  };

  // Corrección en el sitio: las MISMAS operaciones que el drawer (agregar la
  // salida faltante o mover la hora del evento), con motivo obligatorio.
  const guardarAnomalia = async (a) => {
    if (!anomForm.reason.trim()) { showToast('Escribe el motivo del ajuste.'); return; }
    const dia = dayKey(a.event.ts);
    const iso = new Date(`${dia}T${anomForm.time}:00-05:00`).toISOString();
    try {
      if (a.kind === 'missing-exit') {
        await addManualEvent(a.person.id, a.person.name, 'out', iso, anomForm.reason);
      } else {
        await updateEventTime(a.event.id, iso, anomForm.reason);
      }
      setAnomAbierta(null);
      refresh();
      showToast(`Ajuste guardado para ${a.person.name}`);
    } catch (e) {
      showToast(`No se pudo guardar: ${e.message}`);
    }
  };

  // Eventos del RANGO abierto en el drawer, agrupados por día (desc: el más
  // reciente arriba) con sus horas — la vista panorámica.
  const drawerEvents = useMemo(() => {
    if (!drawer) return [];
    return listJourneyEvents()
      .filter((e) => e.personId === drawer.personId && dayKey(e.ts) >= drawer.desde && dayKey(e.ts) <= drawer.hasta)
      .sort((a, b) => a.ts.localeCompare(b.ts));
  }, [drawer, tick]);

  // La persona del drawer: hace falta su HORARIO para cerrar un día que se
  // quedó sin marcación de salida, igual que en el resto del panel.
  const drawerPersona = useMemo(
    () => (drawer ? listPeople().find((p) => p.id === drawer.personId) ?? null : null),
    [drawer, tick],
  );

  const drawerDias = useMemo(() => {
    const map = new Map();
    for (const e of drawerEvents) {
      const d = dayKey(e.ts);
      if (!map.has(d)) map.set(d, []);
      map.get(d).push(e);
    }
    return [...map.entries()]
      .map(([fecha, evs]) => ({ fecha, evs, horas: pairedHours(evs, Date.now(), drawerPersona) }))
      .sort((a, b) => b.fecha.localeCompare(a.fecha));
  }, [drawerEvents, drawerPersona]);

  const saveEvForm = async () => {
    if (!evForm?.time || !evForm.reason.trim()) return;
    const fecha = evForm.fecha || drawer.hasta;
    // Offset Bogotá EXPLÍCITO: la marcación queda en el día/hora que el admin
    // ve en pantalla, sin depender de la zona horaria del equipo.
    const iso = new Date(`${fecha}T${evForm.time}:00-05:00`).toISOString();
    try {
      if (evForm.mode === 'edit') {
        await updateEventTime(evForm.eventId, iso, evForm.reason);
        const original = drawerEvents.find((e) => e.id === evForm.eventId);
        if (original && original.type !== evForm.type) await updateEventType(evForm.eventId, evForm.type, evForm.reason);
      } else {
        await addManualEvent(drawer.personId, drawer.personName, evForm.type, iso, evForm.reason);
      }
      setEvForm(null);
      refresh();
      showToast(`Ajuste guardado para ${drawer.personName}`);
    } catch (e) {
      showToast(`No se pudo guardar: ${e.message}`);
    }
  };

  const removeEv = async (e) => {
    if (confirm(`¿Eliminar la ${e.type === 'in' ? 'entrada' : 'salida'} de las ${fmt12(e.ts)}?`)) {
      try {
        await deleteEvent(e.id);
        refresh();
        showToast('Marcación eliminada');
      } catch (err) {
        showToast(`No se pudo eliminar: ${err.message}`);
      }
    }
  };

  // Tabla de asistencia: filas tras búsqueda + filtro de estado, paginadas.
  // Día que muestra la tabla de asistencia. Por defecto HOY; se puede elegir
  // cualquier día pasado.
  const [diaAsistencia, setDiaAsistencia] = useState(todayKey());
  const esHoy = diaAsistencia === todayKey();
  // Reordenamiento suave de la tabla de asistencia (quien marca sube arriba).
  const attFlipRef = useRef(null);

  const attRows = useMemo(() => {
    // Hoy sale de view.rows (en vivo). Otro día se reconstruye con los
    // eventos de ESE día; nadie está "trabajando ahora" en un día pasado.
    let base;
    if (esHoy) {
      base = view.rows;
    } else {
      const delDia = listJourneyEvents()
        .filter((e) => dayKey(e.ts) === diaAsistencia)
        .sort((a, b) => a.ts.localeCompare(b.ts));
      const finDia = new Date(`${diaAsistencia}T23:59:59-05:00`).getTime();
      base = view.rows.map((r) => {
        const mine = delDia.filter((e) => e.personId === r.person.id);
        const firstIn = mine.find((e) => e.type === 'in') || null;
        const lastOut = [...mine].reverse().find((e) => e.type === 'out') || null;
        return { ...r, firstIn, lastOut, present: false, hoursToday: firstIn ? pairedHours(mine, finDia, r.person) : null };
      });
    }
    const q = search.trim().toLowerCase();
    let rs = base;
    if (q) rs = rs.filter((r) => r.person.name.toLowerCase().includes(q) || r.person.id.toLowerCase().includes(q));
    if (statusFilter === 'present') rs = rs.filter((r) => (esHoy ? r.present : !!r.firstIn));
    if (statusFilter === 'absent') rs = rs.filter((r) => !r.firstIn);

    // Orden: la ÚLTIMA marcación del día primero (lo que acaba de pasar se ve
    // arriba, sin buscar); quien no ha marcado ese día va al final, por nombre.
    const ultimaTs = new Map();
    for (const e of listJourneyEvents()) {
      if (dayKey(e.ts) !== diaAsistencia) continue;
      const prev = ultimaTs.get(e.personId);
      if (!prev || e.ts > prev) ultimaTs.set(e.personId, e.ts);
    }
    return [...rs].sort((a, b) => {
      const ta = ultimaTs.get(a.person.id) ?? '';
      const tb = ultimaTs.get(b.person.id) ?? '';
      if (ta !== tb) return tb.localeCompare(ta);
      return a.person.name.localeCompare(b.person.name);
    });
  }, [view, search, statusFilter, diaAsistencia, esHoy, tick]);

  // Tramos valorizados de un día pasado. OJO: se pide la SEMANA completa del
  // día, no el día suelto — la clasificación de extras necesita el contexto
  // semanal (jornada pactada, vigencias); un día aislado sale sin extras.
  const [tramosDia, setTramosDia] = useState({ dia: null, tramos: [] });
  useEffect(() => {
    if (tab !== 'dashboard' || esHoy) return;
    let vigente = true;
    const d = new Date(`${diaAsistencia}T12:00:00-05:00`);
    const lunes = new Date(d);
    lunes.setDate(d.getDate() - ((d.getDay() + 6) % 7));
    const domingo = new Date(lunes);
    domingo.setDate(lunes.getDate() + 6);
    const hasta = dayKey(domingo.toISOString()) < todayKey() ? dayKey(domingo.toISOString()) : todayKey();
    getHorasValorizadas(dayKey(lunes.toISOString()), hasta)
      .then((tramos) => { if (vigente) setTramosDia({ dia: diaAsistencia, tramos }); })
      .catch(() => { if (vigente) setTramosDia({ dia: diaAsistencia, tramos: [] }); });
    return () => { vigente = false; };
  }, [tab, diaAsistencia, esHoy]);

  // Extras del día elegido por cédula (tipos HE*), con su valor en pesos,
  // desde los tramos valorizados del servidor (mismas reglas que Costos).
  const extrasHoy = useMemo(() => {
    const fuente = (esHoy ? costos.tramos : (tramosDia.dia === diaAsistencia ? tramosDia.tramos : []))
      .filter((t) => t.fecha === diaAsistencia);
    const m = new Map();
    for (const t of fuente) {
      if (!String(t.tipoHora || '').startsWith('HE')) continue;
      const e = m.get(t.documento) ?? { horas: 0, valor: 0, sinSalario: false };
      e.horas += t.horas ?? 0;
      if (t.valor == null) e.sinSalario = true; else e.valor += t.valor;
      m.set(t.documento, e);
    }
    return m;
  }, [costos, tramosDia, diaAsistencia, esHoy]);
  // Roster completo sin filtro de sede (para conteos por sede).
  const allPeople = useMemo(() => listPeople(), [tick]);

  // Qué le falta configurar a un empleado. Un faltante aquí es un reporte
  // roto después (sin sede no compara, sin salario no valoriza).
  const faltantesDe = (p) => {
    const f = [];
    // La sede ya NO cuenta como faltante: es opcional por diseño.
    if (!p.tieneRostro) f.push('rostro');
    if (!(p.jornadaDias || (p.expectedEntry && p.expectedExit))) f.push('horario');
    if (p.salarioMensual == null) f.push('salario');
    if (!p.cedula) f.push('cédula');
    return f;
  };

  // Cambia un flag de ubicación desde la tabla, sin abrir la ficha.
  const alternarFlag = async (p, campo) => {
    try {
      await updatePerson(p.id, { [campo]: !p[campo] });
      refresh();
    } catch (e) {
      showToast(`No se pudo actualizar: ${e.message}`);
    }
  };

  // Última marcación por persona (cualquier tipo), para la tabla Empleados.
  const ultimaMarca = useMemo(() => {
    const m = new Map();
    for (const e of listJourneyEvents()) {
      const prev = m.get(e.personId);
      if (!prev || e.ts > prev) m.set(e.personId, e.ts);
    }
    return m;
  }, [tick]);
  const fmtUltima = (iso) => {
    if (!iso) return 'nunca';
    const dias = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
    const hhmm = fmt12(iso).slice(0, 5);
    if (dayKey(iso) === todayKey()) return `hoy, ${hhmm}`;
    if (dias <= 1) return `ayer, ${hhmm}`;
    if (dias < 30) return `hace ${dias} días`;
    return new Date(iso).toLocaleDateString('es-CO', { day: 'numeric', month: 'short' });
  };

  // Tabla de empleados: búsqueda + filtros por columna.
  const empRows = useMemo(() => {
    const q = empSearch.trim().toLowerCase();
    return roster.filter((p) => {
      if (q && !(p.name.toLowerCase().includes(q) || (p.cedula || '').includes(q))) return false;
      if (empFiltros.sede !== 'all' && (p.sede || '') !== empFiltros.sede) return false;
      const conHorario = !!(p.jornadaDias || (p.expectedEntry && p.expectedExit));
      if (empFiltros.horario === 'con' && !conHorario) return false;
      if (empFiltros.horario === 'libre' && conHorario) return false;
      const completa = faltantesDe(p).length === 0;
      if (empFiltros.config === 'completa' && !completa) return false;
      if (empFiltros.config === 'incompleta' && completa) return false;
      return true;
    });
  }, [roster, empSearch, empFiltros]);

  // En el dashboard la tarjeta comparte pantalla (5 filas); en la sección
  // Asistencia va sola y a lo alto, así que caben más (9).
  const tamPagina = tab === 'asistencia' ? 9 : PAGE_SIZE;
  const pageCount = Math.max(1, Math.ceil(attRows.length / tamPagina));
  const safePage = Math.min(page, pageCount - 1);
  const pageRows = attRows.slice(safePage * tamPagina, (safePage + 1) * tamPagina);
  // Desliza las filas a su nueva posición cuando el orden cambia (FLIP).
  useFlip(attFlipRef, [pageRows]);

  // Día anterior/siguiente con flechas: moverse entre días cercanos sin
  // abrir el calendario. El «siguiente» nunca pasa de hoy.
  const cambiarDia = (delta) => {
    const d = new Date(`${diaAsistencia}T12:00:00-05:00`);
    d.setDate(d.getDate() + delta);
    const nueva = d.toISOString().slice(0, 10);
    if (nueva > todayKey()) return;
    setDiaAsistencia(nueva);
    setPage(0);
  };

  const tabs = [
    { id: 'dashboard', icon: 'dashboard', label: 'Dashboard' },
    // La asistencia vive en el dashboard Y como sección propia: la tarjeta
    // es la misma (tarjetaAsistencia), solo cambia dónde se muestra.
    { id: 'asistencia', icon: 'users', label: 'Asistencia' },
    { id: 'anomalias', icon: 'alert', label: 'Anomalías', badge: data.anomalies.length },
    { id: 'empleados', icon: 'user', label: 'Empleados' },
    { id: 'horarios', icon: 'clock', label: 'Horarios' },
    // Infraestructura al PRIMER nivel: sedes y dispositivos se usan lo
    // suficiente como para no esconderlos dentro de Ajustes.
    { id: 'cfg-sedes', icon: 'pin', label: 'Sedes' },
    { id: 'cfg-dispositivos', icon: 'monitor', label: 'Dispositivos', alAbrir: cargarDispositivos },
    { id: 'reportes', icon: 'file', label: 'Reportes' },
    { id: 'historial', icon: 'history', label: 'Historial' },
    { id: 'ajustes', icon: 'settings', label: 'Ajustes', alClic: () => abrirAjustes() },
  ];

  // Pantallas que muestran el submenú de Ajustes al lado (sedes y
  // dispositivos ya no: son pestañas del menú principal).
  const enAjustes = tab === 'ajustes'
    || (tab.startsWith('cfg-') && tab !== 'cfg-sedes' && tab !== 'cfg-dispositivos');

  // Presionar Ajustes abre de una la PRIMERA opción del submenú (Mi empresa,
  // o la primera disponible según permisos) — en PC el submenú queda al lado,
  // así que no hace falta una pantalla intermedia. En móvil sí: la lista es
  // la única forma de navegar los ajustes.
  const abrirAjustes = () => {
    if (typeof window !== 'undefined' && window.innerWidth >= 900) {
      if (permisos.config) { setTab('cfg-empresa'); cargarMiEmpresa(); return; }
      if (permisos.usuarios) { setTab('cfg-usuarios'); cargarUsuarios(); return; }
      setTab('cfg-reglamento');
      return;
    }
    setTab('ajustes');
  };

  // En PC, la vista general 'ajustes' no se queda: siempre cae a la primera
  // opción (Mi empresa) para que quede PRESIONADA por defecto — también al
  // entrar por URL directa o al volver con la flecha de regresar. Se hace con
  // REEMPLAZO (sin apilar 'ajustes' en el historial interno): si se apilara,
  // la flecha de regresar caería en 'ajustes' → redirección → 'ajustes'… y
  // nunca saldría de ahí.
  useEffect(() => {
    if (tab !== 'ajustes' || typeof window === 'undefined' || window.innerWidth < 900) return;
    const primera = permisos.config ? 'cfg-empresa' : permisos.usuarios ? 'cfg-usuarios' : 'cfg-reglamento';
    if (primera === 'cfg-empresa') cargarMiEmpresa();
    if (primera === 'cfg-usuarios') cargarUsuarios();
    setTabEstado(primera);
    window.history.replaceState(null, '', rutaDe(primera));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  const chip = (cls, text) => <span className={`chip ${cls}`}>{text}</span>;

  // Etiqueta legible del período ("1–15 de agosto" / "agosto").
  const etiquetaPeriodo = (() => {
    const ini = new Date(data.rangoInicioMs);
    const mes = ini.toLocaleDateString('es-CO', { month: 'long' });
    if (rangoModo === 'mes') return mes;
    return ini.getDate() === 1 ? `1–15 de ${mes}` : `16 al fin de ${mes}`;
  })();
  const maxRango = Math.max(1, ...view.rows.map((r) => r.rangoHours));

  // Resumen de costos del dashboard: pide al servidor los tramos valorizados
  // del período elegido (la misma fuente que Reportes, no un cálculo aparte).
  useEffect(() => {
    if (tab !== 'dashboard') return;
    let vigente = true;
    setCostos((c) => ({ ...c, estado: 'cargando' }));
    const desde = dayKey(new Date(data.rangoInicioMs + 12 * 3600000).toISOString());
    getHorasValorizadas(desde, todayKey())
      .then((tramos) => { if (vigente) setCostos({ estado: 'listo', tramos }); })
      .catch(() => { if (vigente) setCostos({ estado: 'error', tramos: [] }); });
    return () => { vigente = false; };
  }, [tab, data.rangoInicioMs, tick]);

  // Agregados del resumen: total en pesos, horas extra y top de tipos.
  const resumenCostos = useMemo(() => {
    const t = costos.tramos;
    const valor = t.reduce((s, x) => s + (x.valor ?? 0), 0);
    const horas = t.reduce((s, x) => s + (x.horas ?? 0), 0);
    const sinSalario = new Set(t.filter((x) => x.valor == null).map((x) => x.documento)).size;
    const porTipo = new Map();
    for (const x of t) porTipo.set(x.tipoHora, (porTipo.get(x.tipoHora) ?? 0) + (x.valor ?? 0));
    const tipos = [...porTipo.entries()].filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1])
      .map(([codigo, v]) => ({ codigo, nombre: TIPOS_HORA.find((tp) => tp.codigo === codigo)?.nombre ?? codigo, valor: v }));
    return { valor, horas, sinSalario, tipos };
  }, [costos]);

  // Tonos de azul para la dona de costos (del más oscuro al más claro,
  // asignados por peso de cada categoría).
  const AZULES_DONA = ['#3a5570', '#557d9e', '#6e96b8', '#9dbbd2', '#cfdde9', '#8b99ad'];

  // Horas EXTRA reales por cédula en el período (tipos HE*), tomadas de los
  // tramos valorizados del servidor: la barra pinta en oscuro exactamente lo
  // que nómina clasificó como extra, no un umbral prorrateado.
  const extrasPorCedula = useMemo(() => {
    const m = new Map();
    for (const t of costos.tramos) {
      if (!String(t.tipoHora || '').startsWith('HE')) continue;
      m.set(t.documento, (m.get(t.documento) ?? 0) + (t.horas ?? 0));
    }
    return m;
  }, [costos]);

  // Selector de sede (arriba del menú lateral): filtro GLOBAL — aplica a
  // todas las vistas del panel a la vez.
  const sedeChips = (
    <div className="side-sede">
      <label className="side-sede-lbl" htmlFor="sede-select">Sede</label>
      <select
        id="sede-select"
        className="sede-select"
        value={sedeFilter}
        onChange={(e) => setSedeFilter(e.target.value)}
      >
        <option value="all">Todas las sedes</option>
        {sedes.map((o) => (
          <option key={o.name} value={o.name}>{o.name}</option>
        ))}
      </select>
    </div>
  );

  return (
    <div className={`admin-root${collapsed ? ' nav-collapsed' : ''}${navOpen ? ' nav-open' : ''}`}>
      <style>{CSS}</style>

      {/* Suscripción vencida: el backend ya bloquea las escrituras (402); esto
          explica POR QUÉ, antes de que la persona choque con el error. */}
      {sesion?.plan === 'pago' && sesion?.estadoSuscripcion !== 'activa' && (
        <div className="banner-vencida" role="alert">
          Suscripción {sesion.estadoSuscripcion}: puedes consultar y exportar, pero no modificar.
        </div>
      )}

      {/* Sin suscripción no se puede registrar ni marcar, así que hay que
          decirlo arriba de todo — pero dejando claro que los datos siguen
          ahí y se pueden exportar. */}
      {/* En prueba: se dice cuánto queda y se ofrece suscribirse, sin
          estorbar el trabajo. Es el aviso permanente del modelo. */}
      {sesion?.planEstado?.enPrueba && (
        <div className={`banner-prueba${sesion.planEstado.diasPrueba <= 1 ? ' urge' : ''}`}>
          <span>
            {sesion.planEstado.diasPrueba === 1
              ? <>Tu prueba termina <b>hoy</b>.</>
              : <>Tu prueba termina en <b>{sesion.planEstado.diasPrueba} días</b>.</>}
            {' '}Suscríbete desde US$1 al mes para no quedarte sin registrar asistencia.
          </span>
          <button className="btn small" onClick={() => setTab('cfg-plan')}>Suscribirse</button>
        </div>
      )}
      {/* Sin acceso: el kiosco está detenido, así que se dice sin rodeos —
          aclarando que los datos siguen ahí. */}
      {sesion?.planEstado && !sesion.planEstado.acceso && (
        <div className="banner-prueba urge">
          <span>
            {sesion.planEstado.pruebaVencida
              ? <>Tu prueba terminó y el kiosco dejó de registrar marcaciones.</>
              : <>Tu suscripción venció: el kiosco no registra marcaciones.</>}
            {' '}Tus datos siguen intactos y puedes consultarlos y exportarlos.
          </span>
          <button className="btn small" onClick={() => setTab('cfg-plan')}>Ver planes</button>
        </div>
      )}
      {/* Los últimos días de una suscripción pagada, sin alarmar antes. */}
      {sesion?.planEstado?.pagada && sesion.planEstado.diasRestantes <= 7 && (
        <div className="banner-prueba urge">
          <span>
            {sesion.planEstado.diasRestantes === 1
              ? <>Tu suscripción vence <b>hoy</b>.</>
              : <>Tu suscripción vence en <b>{sesion.planEstado.diasRestantes} días</b>.</>}
            {' '}Renuévala para que el kiosco siga registrando.
          </span>
          <button className="btn small" onClick={() => setTab('cfg-plan')}>Renovar</button>
        </div>
      )}

      <header className="app-header">
        {/* Regresar a la ÚLTIMA pantalla visitada dentro del panel (como la
            flecha de la Configuración de Windows). Aparece solo cuando hay
            a dónde volver, y nunca saca del panel. */}
        {pilaTabs.current.length > 0 && (
          <button className="head-back" onClick={volverAtras} aria-label="Regresar a la pantalla anterior" title="Regresar">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <line x1="19" y1="12" x2="5" y2="12" /><polyline points="12 19 5 12 12 5" />
            </svg>
          </button>
        )}
        <button className="menu-btn" onClick={() => setNavOpen(true)} aria-label="Abrir menú">
          <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
            <line x1="3" y1="6" x2="21" y2="6" /><line x1="3" y1="12" x2="21" y2="12" /><line x1="3" y1="18" x2="21" y2="18" />
          </svg>
        </button>
        {/* Marca en móvil: en PC vive en el menú lateral. */}
        <span className="head-logo" aria-hidden="true"><MarcaCDial size={20} /></span>
        {/* El nombre COMPLETO del sistema manda en la barra (en el menú
            lateral se truncaba); la pestaña y la fecha van de subtítulo. */}
        <div className="head-titles">
          <span className="head-tab">Control Registro</span>
          <span className="date-note">
            {tabs.find((t) => t.id === tab)?.label || 'Ajustes'}
            {' · '}
            {new Date().toLocaleDateString('es-CO', { weekday: 'long', day: 'numeric', month: 'long' })}
            {sedeFilter !== 'all' ? ` · ${sedeFilter}` : ''}
          </span>
        </div>
        <div className="head-right">
          {/* Guía de arranque: antes era una tarjeta fija del dashboard;
              ahora vive aquí, bajo demanda. */}
          <button className="head-guia" onClick={() => setGuiaAbierta(true)}>¿Cómo empezar?</button>
          {data.anomalies.length > 0 && (
            <button className="head-badge" title="Anomalías pendientes" onClick={() => setTab('anomalias')}>
              {data.anomalies.length}
            </button>
          )}
          {/* Filtro global de sede, visible en PC; en móvil sigue en el menú. */}
          <select
            className="sede-select head-sede"
            aria-label="Sede"
            value={sedeFilter}
            onChange={(e) => setSedeFilter(e.target.value)}
          >
            <option value="all">Todas las sedes</option>
            {sedes.map((o) => (
              <option key={o.name} value={o.name}>{o.name}</option>
            ))}
          </select>
          {/* Sesión: avatar + nombre con menú desplegable (correo, empresa,
              cerrar sesión). Antes vivía escondido al fondo del menú lateral. */}
          {sesion && (
            <div className="head-user">
              <button
                className="head-user-btn"
                aria-expanded={sesionAbierta}
                onClick={() => setSesionAbierta((v) => !v)}
                title={sesion.email}
              >
                {sesion.foto ? (
                  <img
                    className="sesion-avatar"
                    src={sesion.foto}
                    alt=""
                    referrerPolicy="no-referrer"
                    onError={(e) => { e.currentTarget.style.display = 'none'; e.currentTarget.nextElementSibling.style.display = 'flex'; }}
                  />
                ) : null}
                <span className="sesion-avatar" style={sesion.foto ? { display: 'none' } : undefined}>
                  {iniciales(sesion.nombre || sesion.email)}
                </span>
                <span className="head-user-nombre">{sesion.nombre || sesion.email}</span>
              </button>
              {sesionAbierta && (
                <div className="head-user-menu">
                  <b>{sesion.nombre || sesion.email}</b>
                  <span>{sesion.email}</span>
                  <span>{sesion.empresa ?? ROL_ETIQUETA[sesion.rol] ?? sesion.rol}</span>
                  <button className="lock-btn" onClick={cerrarSesion} title="Cerrar sesión">
                    <span className="icon"><Icon name="lock" size={14} /></span>
                    <span className="lbl">Cerrar sesión</span>
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </header>

      <div className={`screen${enAjustes ? ' con-submenu' : ''}`}>
        {/* Submenú de Ajustes (solo PC): como la Configuración de Windows —
            las opciones a la izquierda y el contenido al lado, sin cambiar
            de pantalla. En móvil se mantiene lista → subpantalla con volver. */}
        {enAjustes && (
          <aside className="cfg-menu" aria-label="Opciones de ajustes">
            {(permisos.usuarios || permisos.config) && <h4>Cuenta y acceso</h4>}
            {permisos.config && (
              <button className={`cfg-item${tab === 'cfg-plan' ? ' on' : ''}`} onClick={() => setTab('cfg-plan')}>
                <Icon name="file" size={16} /> Plan
                {/* El punto avisa sin gritar cuando hay algo que atender. */}
                {sesion?.planEstado && !sesion.planEstado.pagada && <span className="cfg-punto" />}
              </button>
            )}
            {permisos.config && (
              <button className={`cfg-item${tab === 'cfg-empresa' ? ' on' : ''}`} onClick={() => { setTab('cfg-empresa'); cargarMiEmpresa(); }}>
                <Icon name="database" size={16} /> Mi empresa
              </button>
            )}
            {permisos.usuarios && (
              <button className={`cfg-item${tab === 'cfg-usuarios' ? ' on' : ''}`} onClick={() => { setTab('cfg-usuarios'); cargarUsuarios(); }}>
                <Icon name="users" size={16} /> Acceso al panel
              </button>
            )}
            <h4>Reglas de la empresa</h4>
            <button className={`cfg-item${tab === 'cfg-reglamento' ? ' on' : ''}`} onClick={() => setTab('cfg-reglamento')}>
              <Icon name="file" size={16} /> Reglamento laboral
            </button>
            <button className={`cfg-item${tab === 'cfg-nomina' ? ' on' : ''}`} onClick={() => setTab('cfg-nomina')}>
              <Icon name="clock" size={16} /> Valorización
            </button>
            <button className={`cfg-item${tab === 'cfg-simulador' ? ' on' : ''}`} onClick={() => setTab('cfg-simulador')}>
              <Icon name="file" size={16} /> Simulador
            </button>
            <h4>Herramientas</h4>
            <Link className="cfg-item" href="/"><Icon name="monitor" size={16} /> Ir al kiosco</Link>
            <button className={`cfg-item${tab === 'cfg-gps' ? ' on' : ''}`} onClick={() => setTab('cfg-gps')}>
              <Icon name="pin" size={16} /> Diagnóstico GPS
            </button>
          </aside>
        )}

        {/* La MISMA tarjeta de asistencia sirve al dashboard y a la sección
            propia «Asistencia» del menú: solo cambia qué la acompaña. */}
        {(tab === 'dashboard' || tab === 'asistencia') && (
          <>
            <div className={`dash-grid${tab === 'asistencia' ? ' solo-asistencia' : ''}`}>
              <section className="card asistencia-card">
                <h2>
                  {esHoy ? 'Asistencia de hoy' : `Asistencia — ${new Date(`${diaAsistencia}T12:00:00-05:00`).toLocaleDateString('es-CO', { weekday: 'long', day: 'numeric', month: 'long' })}`}
                  {' '}<span className="muted-count">{attRows.length}</span>
                </h2>
                <p className="hint">Toca una fila para ver sus marcaciones.</p>
                <div className="att-controls">
                  <input
                    className="att-search mini" type="search" placeholder="Buscar…"
                    value={search} onChange={(e) => { setSearch(e.target.value); setPage(0); }}
                  />
                  <div className="dia-nav" role="group" aria-label="Cambiar de día">
                    <button className="btn dia-flecha" title="Día anterior" onClick={() => cambiarDia(-1)}>‹</button>
                    <input
                      className="att-fecha" type="date" aria-label="Día"
                      value={diaAsistencia} max={todayKey()}
                      onChange={(e) => { setDiaAsistencia(e.target.value || todayKey()); setPage(0); }}
                    />
                    <button className="btn dia-flecha" title="Día siguiente" disabled={esHoy} onClick={() => cambiarDia(1)}>›</button>
                  </div>
                  {[['all', 'Todos'], ['present', esHoy ? 'Trabajando' : 'Asistieron'], ['absent', 'Ausentes']].map(([id, lbl]) => (
                    <button
                      key={id} className="fchip" aria-pressed={statusFilter === id}
                      onClick={() => { setStatusFilter(id); setPage(0); }}
                    >
                      {lbl}
                    </button>
                  ))}
                </div>
                <div className="scrollable">
                  {attRows.length === 0 && (
                    <p className="empty">Sin resultados{search ? ` para «${search}»` : ''}.</p>
                  )}
                  {attRows.length > 0 && (() => {
                    // Última marcación en corto; el punto de al lado del nombre
                    // ya dice el estado (verde marcó hoy, rojo ausente).
                    // La hora de la ÚLTIMA marcación, entrada o salida.
                    const ultima = (r) => {
                      if (!r.ultimoEv) return esHoy ? 'sin marcación hoy' : 'sin marcación';
                      return `${r.ultimoEv.type === 'in' ? 'entró' : 'salió'} ${horaCorta(r.ultimoEv.ts)}`;
                    };
                    const jornadaPrevista = (r) => {
                      const f = franjaEsperada(r.person, diaAsistencia);
                      return f ? `${f.entrada} – ${f.salida}` : 'libre';
                    };
                    // El verde significa UNA sola cosa: trabajando ahora mismo.
                    // Quien ya salió (hoy o un día pasado) va en rojo, y la
                    // letra pequeña dice por qué: "salió 16:02" o "sin marcación".
                    const estadoPunto = (r) => (r.present ? 'on' : 'off');
                    // Nombre corto en la lista; el completo, en el title.
                    const celdaEmpleado = (r) => (
                      <span className="emp-cell" title={r.person.name}>
                        <span className="av av-tabla">{iniciales(nombreCorto(r.person.name))}</span>
                        <span>
                          <span className="att-name">
                            {nombreCorto(r.person.name)}
                            <span className={`punto-estado ${estadoPunto(r)}`} title={estadoPunto(r) === 'on' ? 'Trabajando' : 'No está trabajando'} />
                          </span>
                          <span className="emp-cedula">{ultima(r)}</span>
                        </span>
                      </span>
                    );
                    const celdaExtras = (r) => {
                      const e = extrasHoy.get(r.person.cedula);
                      if (!e || e.horas <= 0) return <span className="libre">—</span>;
                      if (e.sinSalario) return <span className="libre">sin salario</span>;
                      return <span className="saldo pos">{fmtCOP(e.valor)}</span>;
                    };
                    // Novedad: ¿esta persona tiene alguna anomalía DEL DÍA que
                    // se está viendo? Se señala resaltando la FILA con un lavado
                    // suave (sin columna aparte); el detalle va en el tooltip.
                    const NOMBRE_NOVEDAD = { 'missing-exit': 'Salida faltante', 'late-entry': 'Entrada tardía', 'early-exit': 'Salida temprana' };
                    const novedadDe = (r) => {
                      const novs = data.anomalies.filter((a) => a.person.id === r.person.id && dayKey(a.event.ts) === diaAsistencia);
                      if (novs.length === 0) return null;
                      return [...new Set(novs.map((n) => NOMBRE_NOVEDAD[n.kind] ?? n.kind))].join(' · ');
                    };
                    return (
                    <>
                      <div className="att-tablewrap">
                        <table className="att-table">
                          <thead>
                            <tr><th>Empleado</th><th>Jornada prevista</th><th className="num">Trabajado</th><th className="num">Extras (COP)</th><th>Sede / Ubicación</th></tr>
                          </thead>
                          <tbody ref={attFlipRef}>
                            {pageRows.map((r) => {
                              const e = extrasHoy.get(r.person.cedula);
                              const novedad = novedadDe(r);
                              return (
                                <tr
                                  key={r.person.id} data-flip-id={r.person.id}
                                  className={novedad ? 'con-novedad' : undefined}
                                  title={novedad ? `Novedad: ${novedad}` : undefined}
                                  onClick={() => openDrawer(r.person.id, r.person.name, esHoy ? null : diaAsistencia)} tabIndex={0}
                                  onKeyDown={(ev) => ev.key === 'Enter' && openDrawer(r.person.id, r.person.name, esHoy ? null : diaAsistencia)}>
                                  <td>{celdaEmpleado(r)}</td>
                                  <td>{jornadaPrevista(r) === 'libre' ? <span className="libre">libre</span> : jornadaPrevista(r)}</td>
                                  <td className="num">
                                    {fmtH(r.hoursToday)}
                                    {e && e.horas > 0 && <span className="extra-h">+{fmtHM(e.horas)} extra</span>}
                                  </td>
                                  <td className="num">{celdaExtras(r)}</td>
                                  <td className="att-sede">
                                    {r.sede || (r.lugar ? '' : '—')}
                                    {r.lugar && (
                                      <a
                                        className="att-lugar"
                                        href={`https://www.google.com/maps?q=${r.lugar.lat},${r.lugar.lon}`}
                                        target="_blank" rel="noreferrer"
                                        title={`Marcó desde aquí · ${horaCorta(r.lugar.ts)}`}
                                        onClick={(ev) => ev.stopPropagation()}
                                      >
                                        <Icon name="pin" size={11} />
                                        {r.lugar.direccion || `${Number(r.lugar.lat).toFixed(4)}, ${Number(r.lugar.lon).toFixed(4)}`}
                                      </a>
                                    )}
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                      <AccList
                        items={pageRows.map((r) => {
                          const e = extrasHoy.get(r.person.cedula);
                          return {
                            id: r.person.id,
                            title: nombreCorto(r.person.name),
                            right: <span className={`punto-estado ${r.present ? 'on' : 'off'}`} />,
                            fields: [
                              ['Última marcación', ultima(r)],
                              ['Jornada prevista', jornadaPrevista(r)],
                              ['Trabajado', `${fmtH(r.hoursToday)}${e && e.horas > 0 ? ` (+${fmtHM(e.horas)} extra)` : ''}`],
                              ['Extras (COP)', celdaExtras(r)],
                              ...(novedadDe(r) ? [['Novedad', novedadDe(r)]] : []),
                              ['Sede', r.sede || '—'],
                              ...(r.lugar ? [['Marcó desde', (
                                <a key="l" className="att-lugar" target="_blank" rel="noreferrer"
                                  href={`https://www.google.com/maps?q=${r.lugar.lat},${r.lugar.lon}`}>
                                  <Icon name="pin" size={11} />
                                  {r.lugar.direccion || `${Number(r.lugar.lat).toFixed(4)}, ${Number(r.lugar.lon).toFixed(4)}`}
                                </a>
                              )]] : []),
                            ],
                            actions: (
                              <button className="btn primary block" onClick={() => openDrawer(r.person.id, r.person.name, esHoy ? null : diaAsistencia)}>
                                Ver marcaciones
                              </button>
                            ),
                          };
                        })}
                      />
                    </>
                    );
                  })()}
                </div>
                {pageCount > 1 && (
                  <div className="pager">
                    <button className="btn" disabled={safePage === 0} onClick={() => setPage(safePage - 1)}>Anterior</button>
                    <span>Página {safePage + 1} de {pageCount}</span>
                    <button className="btn" disabled={safePage >= pageCount - 1} onClick={() => setPage(safePage + 1)}>Siguiente</button>
                  </div>
                )}
              </section>

              {tab === 'dashboard' && (<>
              {/* Columna lateral: indicadores de un vistazo */}
              <div className="dash-lado">
              {/* Equipo ahora mismo: proporción de estados + avatares. */}
              <section className="card">
                <h2>Equipo ahora mismo</h2>
                {(() => {
                  const grupos = [
                    { id: 'trabajando', label: 'Trabajando', color: 'var(--good-text)', rows: view.rows.filter((r) => r.present) },
                    { id: 'fin', label: 'Fin de jornada', color: 'var(--muted)', rows: view.rows.filter((r) => !r.present && r.firstIn) },
                    { id: 'sin', label: 'Sin marcación', color: 'var(--crit-text)', rows: view.rows.filter((r) => !r.firstIn) },
                  ];
                  const total = view.rows.length || 1;
                  return (
                    <>
                      <div className="prop-bar" aria-hidden="true">
                        {grupos.filter((g) => g.rows.length > 0).map((g) => (
                          <span key={g.id} style={{ flex: g.rows.length, background: g.color }} />
                        ))}
                      </div>
                      <div className="est-grupos">
                        {grupos.map((g) => (
                          <div className="est-linea" key={g.id}>
                            <span className="est-punto" style={{ background: g.color }} />
                            {g.label} · <strong>{g.rows.length}</strong>
                            <span className="est-pct">({Math.round((g.rows.length / total) * 100)}%)</span>
                            <span className="avs">
                              {g.rows.slice(0, 4).map((r) => (
                                <span className="av" key={r.person.id} title={r.person.name}>{iniciales(r.person.name)}</span>
                              ))}
                              {g.rows.length > 4 && <span className="av av-mas">+{g.rows.length - 4}</span>}
                            </span>
                          </div>
                        ))}
                      </div>
                    </>
                  );
                })()}
              </section>

              <section className="card">
                <h2>Anomalías por resolver</h2>
                <button className={`cifrota${view.anomalies.length > 0 ? ' alerta' : ''}`} onClick={() => setTab('anomalias')} title="Abrir anomalías">
                  {view.anomalies.length}
                </button>
                <div className="anom-desglose">
                  {view.anomalies.length === 0 && <span>Nada pendiente.</span>}
                  {['missing-exit', 'late-entry', 'early-exit'].map((k) => {
                    const n = view.anomalies.filter((a) => a.kind === k).length;
                    if (!n) return null;
                    const txt = k === 'missing-exit' ? 'sin registrar salida' : k === 'late-entry' ? 'con entrada tardía' : 'con salida temprana';
                    return <span key={k}>{n} {txt}</span>;
                  })}
                </div>
              </section>

              {sedeFilter === 'all' && (
                <section className="card">
                  <h2>Sedes — hoy</h2>
                  <div className="est-grupos">
                    {data.sedeStats.map((s) => (
                      <div className="hbarra" key={s.name} title={`${s.name}: ${s.present} presentes de ${s.total}`}>
                        <span className="hbarra-nombre">{s.name}</span>
                        <span className="hbarra-pista">
                          <span className="hbarra-valor" style={{ width: `${s.total ? (s.present / s.total) * 100 : 0}%` }} />
                        </span>
                        <span className="hbarra-cifra">{s.present} / {s.total}</span>
                      </div>
                    ))}
                  </div>
                  {data.sinSede > 0 && (
                    <p className="axis-note">{data.sinSede} sin sede asignada.</p>
                  )}
                </section>
              )}
              </div>

              {/* En PC estas dos van en la PRIMERA fila (orden vía CSS). */}
              <section className="card grow horas-card">
                <div className="card-head">
                  <h2>Horas acumuladas — {etiquetaPeriodo}</h2>
                  <div className="rango-sel" role="group" aria-label="Período">
                    {[['quincena', 'Quincena'], ['mes', 'Mes']].map(([id, lbl]) => (
                      <button key={id} className="fchip" aria-pressed={rangoModo === id} onClick={() => setRangoModo(id)}>
                        {lbl}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="scrollable">
                  <div className="chart">
                    {view.rows.length === 0 && <p className="empty">No hay personas {sedeFilter === 'all' ? 'registradas' : `en ${sedeFilter}`}.</p>}
                    {[...view.rows].sort((a, b) => b.rangoHours - a.rangoHours).map((r) => {
                      const extra = Math.min(r.rangoHours, extrasPorCedula.get(r.person.cedula) ?? 0);
                      const base = r.rangoHours - extra;
                      return (
                        <div className="hrow compacta" key={r.person.id} title={`${r.person.name}: ${fmtH(r.rangoHours)}${extra > 0 ? ` (${fmtH(extra)} extra)` : ''}`}>
                          <span className="name">{r.person.name}</span>
                          <span className="track">
                            <span className="fill" style={{ width: `${(base / maxRango) * 100}%` }} />
                            {/* lo que traspasa las horas legales, en azul oscuro */}
                            {extra > 0 && (
                              <span className="fill-extra" style={{ left: `${(base / maxRango) * 100}%`, width: `${(extra / maxRango) * 100}%` }} />
                            )}
                          </span>
                          <span className="val">
                            {fmtH(r.rangoHours)}
                            {extra > 0 && <em className="extra">+{fmtH(extra)}</em>}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>
                <p className="axis-note">
                  El tramo azul oscuro son las horas extra del período, según las reglas de nómina.
                </p>
              </section>

              {/* Resumen de costos del período: lo que las horas con recargo del
                  rango valen en pesos, valorizadas por el servidor. */}
              <section className="card costos-card">
                <h2>Costos — {etiquetaPeriodo}</h2>
                {costos.estado === 'error' && <p className="empty">No se pudo cargar la valorización.</p>}
                {costos.estado !== 'error' && (
                  <>
                    {(() => {
                      // Dona en tonos de azul: cada categoría de hora extra es
                      // un tramo del conic-gradient, por peso.
                      let acum = 0;
                      const paradas = resumenCostos.tipos.map((t, i) => {
                        const desde = (acum / resumenCostos.valor) * 360;
                        acum += t.valor;
                        const hasta = (acum / resumenCostos.valor) * 360;
                        return `${AZULES_DONA[i % AZULES_DONA.length]} ${desde}deg ${hasta}deg`;
                      }).join(', ');
                      return (
                        <div className="costo-viz">
                          {resumenCostos.tipos.length > 0 && (
                            <div className="dona" style={{ background: `conic-gradient(${paradas})` }} aria-hidden="true">
                              <span />
                            </div>
                          )}
                          <div>
                            <div className="costo-total">
                              {costos.estado === 'cargando' ? '…' : fmtCOP(resumenCostos.valor)}
                            </div>
                            <p className="costo-sub">
                              {fmtHoras(resumenCostos.horas)} con recargo en el período
                            </p>
                            {resumenCostos.tipos.length > 0 && (
                              <div className="costo-tipos">
                                {resumenCostos.tipos.map((t, i) => (
                                  <div className="costo-tipo" key={t.codigo} title={t.nombre}>
                                    <span className="costo-dot" style={{ background: AZULES_DONA[i % AZULES_DONA.length] }} />
                                    <span className="costo-cod">{t.codigo}</span>
                                    <span className="costo-val">{fmtCOP(t.valor)}</span>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    })()}
                    <button className="costo-link" onClick={() => setTab('reportes')}>Ver reporte completo →</button>
                  </>
                )}
              </section>
              </>)}
            </div>
          </>
        )}

        {tab === 'anomalias' && (
          <section className="card grow">
            <h2>Anomalías por resolver <span className="muted-count">{view.anomalies.length}</span></h2>
            <p className="hint">Corrígelas aquí mismo; lo resuelto sale de la bandeja.</p>
            {/* Filtro por tipo (aplica a la bandeja de PC y a la lista móvil) */}
            <div className="att-controls">
              {[['all', 'Todas'], ['missing-exit', 'Salida faltante'], ['late-entry', 'Entrada tardía'], ['early-exit', 'Salida temprana']].map(([id, lbl]) => (
                <button key={id} className="fchip" aria-pressed={anomFiltro === id} onClick={() => { setAnomFiltro(id); setAnomAbierta(null); setAnomPage(0); }}>
                  {lbl}
                  {id !== 'all' && <span className="fchip-n">{view.anomalies.filter((a) => a.kind === id).length}</span>}
                </button>
              ))}
            </div>
            <div className="scrollable">
              {(() => {
                const casos = anomFiltro === 'all' ? view.anomalies : view.anomalies.filter((a) => a.kind === anomFiltro);
                // Paginación sobre lo filtrado; corregir un caso puede achicar
                // la lista, así que la página vigente se recorta sola.
                const ANOM_PAGE = 9;
                const anomPages = Math.max(1, Math.ceil(casos.length / ANOM_PAGE));
                const anomSafe = Math.min(anomPage, anomPages - 1);
                const casosPagina = casos.slice(anomSafe * ANOM_PAGE, (anomSafe + 1) * ANOM_PAGE);
                const aChip = (a) =>
                  a.kind === 'missing-exit' ? chip('crit', 'Salida faltante')
                    : a.kind === 'early-exit' ? chip('warn', 'Salida temprana')
                      : chip('warn', 'Entrada tardía');
                const aDesc = (a) =>
                  a.kind === 'missing-exit'
                    ? `Entró ${fmt12(a.event.ts)}, sin salida.`
                    : a.kind === 'early-exit'
                      ? `Salió ${fmt12(a.event.ts)}, esperada ${a.person.expectedExit || '—'}.`
                      : `Entró ${fmt12(a.event.ts)}.`;
                const aDay = (a) => new Date(a.event.ts).toLocaleDateString('es-CO', { weekday: 'short', day: 'numeric', month: 'short' });
                if (view.anomalies.length === 0) return <p className="empty">🎉 Bandeja en cero. Sin anomalías pendientes.</p>;
                if (casos.length === 0) return <p className="empty">Sin anomalías de este tipo.</p>;
                return (
                  <>
                    {/* Bandeja de casos expandibles con corrección en el sitio
                        (única lista: en móvil la cabecera se compacta a foto,
                        nombre y novedad; el detalle aparece al expandir). */}
                    <div className="att-tablewrap bandeja">
                      {casosPagina.map((a) => {
                        const key = a.event.id + a.kind;
                        const abierta = anomAbierta === key;
                        return (
                          <div className={`caso${abierta ? ' abierto' : ''}`} key={key}>
                            <button className="caso-cab" aria-expanded={abierta} onClick={() => abrirCaso(a, key)}>
                              <span className="av av-tabla">{iniciales(a.person.name)}</span>
                              <span className="caso-nom">
                                <b>{a.person.name}</b>
                                <small>{aDay(a)}{a.person.sede ? ` · ${a.person.sede}` : ''}</small>
                              </span>
                              {aChip(a)}
                              <span className="caso-chev"><Icon name="chevronRight" size={13} /></span>
                            </button>
                            {abierta && (
                              <div className="caso-panel">
                                <p className="caso-det">{aDay(a)}{a.person.sede ? ` · ${a.person.sede}` : ''} — {aDesc(a)}</p>
                                <div className="caso-fix">
                                  <label>
                                    {a.kind === 'missing-exit' ? 'Salida' : 'Hora correcta'}
                                    <input
                                      type="time" value={anomForm.time}
                                      onChange={(e) => setAnomForm({ ...anomForm, time: e.target.value })}
                                    />
                                  </label>
                                  <input
                                    className="caso-motivo" type="text" placeholder="Motivo del ajuste (obligatorio)"
                                    value={anomForm.reason}
                                    onChange={(e) => setAnomForm({ ...anomForm, reason: e.target.value })}
                                  />
                                  <button className="btn primary" onClick={() => guardarAnomalia(a)}>Guardar</button>
                                  <button className="btn" onClick={() => openFix(a)}>Ver día completo</button>
                                </div>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                    {anomPages > 1 && (
                      <div className="pager">
                        <button className="btn" disabled={anomSafe === 0} onClick={() => { setAnomPage(anomSafe - 1); setAnomAbierta(null); }}>Anterior</button>
                        <span>Página {anomSafe + 1} de {anomPages}</span>
                        <button className="btn" disabled={anomSafe >= anomPages - 1} onClick={() => { setAnomPage(anomSafe + 1); setAnomAbierta(null); }}>Siguiente</button>
                      </div>
                    )}
                  </>
                );
              })()}
            </div>
          </section>
        )}

        {tab === 'empleados' && (
          <section className="card grow">
            <h2>
              Empleados registrados{' '}
              <span className="muted-count">
                {/* Con tope, el uso del plan se ve ANTES de chocar con él. */}
                {sesion?.limiteEmpleados != null ? `${allPeople.length} de ${sesion.limiteEmpleados}` : empRows.length}
              </span>
            </h2>
            {/* Sin suscripción no se puede dar de alta a nadie. Se dice aquí,
                antes de que llene el formulario y choque con el error. */}
            {sesion?.planEstado && !sesion.planEstado.vigente && (
              <p className="hint" style={{ color: 'var(--crit-text)' }}>
                {sesion.planEstado.nunca
                  ? 'Para registrar empleados necesitas un plan activo.'
                  : 'Tu suscripción venció: no puedes registrar empleados nuevos hasta renovarla.'}
                {' '}
                <button className="btn small" style={{ marginLeft: 6 }} onClick={() => setTab('cfg-empresa')}>Ver planes</button>
              </p>
            )}
            {sesion?.limiteEmpleados != null && allPeople.length >= sesion.limiteEmpleados && (
              <p className="hint" style={{ color: 'var(--crit-text)' }}>
                Llegaste al tope acordado de {sesion.limiteEmpleados} empleados. Escríbenos para ampliarlo.
              </p>
            )}
            <p className="hint">Quiénes pueden marcar en el kiosco. Toca una fila para editar.</p>
            <div className="att-controls">
              <input
                className="att-search mini" type="search" placeholder="Buscar…"
                value={empSearch} onChange={(e) => { setEmpSearch(e.target.value); setEmpPage(0); }}
              />
              <button className="btn primary" onClick={() => setRegAbierto(true)}>Registrar empleado</button>
              {/* Con la vista abierta el botón se queda aunque la lista quede
                  en cero (al reactivar al último hay que poder volver). */}
              {(listArchivados().length > 0 || verArchivados) && (
                <button
                  className="btn"
                  aria-pressed={verArchivados}
                  title="Desactivados; su historial se conserva y no ocupan cupo"
                  onClick={() => { setVerArchivados(!verArchivados); setArchPage(0); }}
                >
                  {verArchivados ? '‹ Volver a activos' : `Archivados (${listArchivados().length})`}
                </button>
              )}
            </div>
            <div className="scrollable">
              {!verArchivados && (() => {
                const horario = (p) => (p.jornadaDias
                  ? resumenDias(p.jornadaDias)
                  : p.expectedEntry && p.expectedExit ? `${p.expectedEntry} – ${p.expectedExit}` : 'horario libre');
                const configChips = (p) => {
                  const f = faltantesDe(p);
                  if (f.length === 0) return <span className="chip good">Completa</span>;
                  return f.map((x) => (
                    <span className={`chip ${x === 'sede' ? 'crit' : 'warn'}`} key={x}>Sin {x}</span>
                  ));
                };
                // Paginación: 9 por página, con la página vigente recortada si
                // el filtro o la búsqueda achican la lista.
                const EMP_PAGE = 9;
                const empPages = Math.max(1, Math.ceil(empRows.length / EMP_PAGE));
                const empSafe = Math.min(empPage, empPages - 1);
                const empPagina = empRows.slice(empSafe * EMP_PAGE, (empSafe + 1) * EMP_PAGE);
                return (
                  <>
                    <div className="att-tablewrap">
                      <table className="att-table">
                        <thead>
                          {/* Filtros DENTRO de la fila de títulos: un embudo por
                              columna que abre su selector; azul cuando filtra. */}
                          <tr>
                            <th>Empleado</th>
                            {[
                              ['sede', 'Sede', [['all', 'Todas'], ...sedes.map((o) => [o.name, o.name])]],
                              ['horario', 'Horario', [['all', 'Todos'], ['con', 'Con horario'], ['libre', 'Horario libre']]],
                              ['config', 'Configuración', [['all', 'Todas'], ['completa', 'Completa'], ['incompleta', 'Incompleta']]],
                            ].map(([campo, titulo, opciones]) => (
                              <th className="th-filtro" key={campo}>
                                {titulo}
                                <button
                                  className={`filtro-ico${empFiltros[campo] !== 'all' ? ' on' : ''}`}
                                  aria-label={`Filtrar por ${titulo.toLowerCase()}`}
                                  aria-expanded={filtroAbierto === campo}
                                  onClick={() => setFiltroAbierto(filtroAbierto === campo ? null : campo)}
                                >
                                  <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                                    <path d="M3 5h18l-7 8v5l-4 2v-7L3 5z" />
                                  </svg>
                                </button>
                                {filtroAbierto === campo && (
                                  <div className="filtro-pop">
                                    <select
                                      autoFocus size={opciones.length}
                                      value={empFiltros[campo]}
                                      onChange={(e) => { setEmpFiltros({ ...empFiltros, [campo]: e.target.value }); setFiltroAbierto(null); setEmpPage(0); }}
                                    >
                                      {opciones.map(([v, txt]) => <option key={v} value={v}>{txt}</option>)}
                                    </select>
                                  </div>
                                )}
                              </th>
                            ))}
                            <th title="Con sede: si está activo, solo puede marcar dentro de su sede">Limitar</th>
                            <th title="Sin sede: si está activo, se registra el GPS de cada marcación">Validar</th>
                            <th>Última marcación</th>
                          </tr>
                        </thead>
                        <tbody>
                          {empRows.length === 0 && (
                            <tr className="static"><td colSpan={7} className="empty">Sin resultados{empSearch ? ` para «${empSearch}»` : ''}.</td></tr>
                          )}
                          {empPagina.map((p) => (
                            <tr key={p.id} onClick={() => openEdit(p)} tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && openEdit(p)}>
                              <td>
                                <span className="emp-cell">
                                  <span className="av av-tabla">{iniciales(p.name)}</span>
                                  <span>
                                    <span className="att-name">{p.name}</span>
                                    <span className="emp-cedula">{p.cedula || 'sin cédula'}</span>
                                  </span>
                                </span>
                              </td>
                              <td className="att-sede">{p.sede || '—'}</td>
                              <td>{p.jornadaDias || (p.expectedEntry && p.expectedExit) ? horario(p) : <span className="libre">horario libre</span>}</td>
                              <td><span className="novs">{configChips(p)}</span></td>
                              {/* Limitar solo aplica CON sede; Validar solo SIN sede. */}
                              <td>
                                <Toggle
                                  on={p.validarSede}
                                  label={p.sede ? '¿Limitar a su sede?' : 'Sin sede no tiene efecto'}
                                  onClick={() => alternarFlag(p, 'validarSede')}
                                />
                              </td>
                              <td>
                                <Toggle
                                  on={p.validarUbicacion}
                                  label="¿Registrar GPS al marcar?"
                                  onClick={() => alternarFlag(p, 'validarUbicacion')}
                                />
                              </td>
                              <td className="att-sede">{fmtUltima(ultimaMarca.get(p.id))}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    <AccList
                      items={empPagina.map((p) => ({
                        id: p.id,
                        title: p.name,
                        right: <span className="acc-note">{p.sede || 'sin sede'}</span>,
                        fields: [
                          ['Cédula', p.cedula || 'sin cédula'],
                          ['Horario', horario(p)],
                          ['Configuración', <span className="novs" key="c">{configChips(p)}</span>],
                          ['Limitar ubicación', <Toggle key="l" on={p.validarSede} label="Limitar a su sede" onClick={() => alternarFlag(p, 'validarSede')} />],
                          ['Validar ubicación', <Toggle key="v" on={p.validarUbicacion} label="Registrar GPS al marcar" onClick={() => alternarFlag(p, 'validarUbicacion')} />],
                          ['Última marcación', fmtUltima(ultimaMarca.get(p.id))],
                        ],
                        actions: <button className="btn primary block" onClick={() => openEdit(p)}>Editar</button>,
                      }))}
                    />
                    {empPages > 1 && (
                      <div className="pager">
                        <button className="btn" disabled={empSafe === 0} onClick={() => setEmpPage(empSafe - 1)}>Anterior</button>
                        <span>Página {empSafe + 1} de {empPages}</span>
                        <button className="btn" disabled={empSafe >= empPages - 1} onClick={() => setEmpPage(empSafe + 1)}>Siguiente</button>
                      </div>
                    )}
                  </>
                );
              })()}

              {/* ARCHIVADOS: desactivados con historial intacto. No ocupan
                  cupo; reactivar vuelve a ocuparlo (el servidor lo verifica).
                  Misma paginación de 9 que la lista de activos. */}
              {verArchivados && (() => {
                const archivados = listArchivados();
                const ARCH_PAGE = 9;
                const archPages = Math.max(1, Math.ceil(archivados.length / ARCH_PAGE));
                const archSafe = Math.min(archPage, archPages - 1);
                const archPagina = archivados.slice(archSafe * ARCH_PAGE, (archSafe + 1) * ARCH_PAGE);
                return (
                  <>
                    <p className="hint">Desactivados: no pueden marcar ni ocupan cupo, y su historial se conserva.</p>
                    {archivados.length === 0 && <p className="empty">No hay empleados archivados.</p>}
                    {archPagina.map((p) => (
                      <div key={p.id} className="arch-fila">
                        <span className="emp-cell">
                          <span className="av av-tabla">{iniciales(p.name)}</span>
                          <span>
                            <span className="att-name">{p.name}</span>
                            <span className="emp-cedula">{p.cedula || 'sin cédula'}</span>
                          </span>
                        </span>
                        <button
                          className="btn small"
                          onClick={async () => {
                            try {
                              const r = await updatePerson(p.id, { activo: true });
                              refresh();
                              showToast(`${r.name} reactivado`);
                            } catch (e) {
                              showToast(e.message);
                            }
                          }}
                        >
                          Reactivar
                        </button>
                      </div>
                    ))}
                    {archPages > 1 && (
                      <div className="pager">
                        <button className="btn" disabled={archSafe === 0} onClick={() => setArchPage(archSafe - 1)}>Anterior</button>
                        <span>Página {archSafe + 1} de {archPages}</span>
                        <button className="btn" disabled={archSafe >= archPages - 1} onClick={() => setArchPage(archSafe + 1)}>Siguiente</button>
                      </div>
                    )}
                  </>
                );
              })()}
            </div>
          </section>
        )}

        {tab === 'horarios' && (
          <section className="card grow">
            <h2>Horarios <span className="muted-count">{horarios.length}</span></h2>
            <p className="hint">
              Plantillas de jornada por cargo o turno, personalizadas POR DÍA: cada día
              puede tener su propia franja (o quedar libre). Al registrar o editar un
              empleado se le asigna una, y su semana queda copiada en su ficha.
            </p>
            <div className="att-controls">
              <button
                className="btn primary"
                onClick={() => setHorForm({ nombre: '', dias: diasLunesAViernes() })}
              >
                Crear horario
              </button>
            </div>

            <div className="scrollable">
              {horarios.length === 0 && !horForm && (
                <p className="empty">Aún no hay horarios. Crea el primero: por ejemplo «Administrativo, Lun–Vie 08:00 – 17:00».</p>
              )}
              {horarios.length > 0 && (
                <>
                  <div className="att-tablewrap">
                    <table className="att-table">
                      <thead>
                        <tr>
                          <th>Nombre</th>
                          <th>Días</th>
                          <th>Franja</th>
                          <th>Almuerzo</th>
                          <th className="num">Horas/semana</th>
                        </tr>
                      </thead>
                      <tbody>
                        {/* Fila presionable, como Empleados: abre el cajón de
                            edición; eliminar vive dentro del cajón. */}
                        {horarios.map((h) => (
                          <tr
                            key={h.id} tabIndex={0}
                            onClick={() => setHorForm({ id: h.id, nombre: h.nombre, dias: JSON.parse(JSON.stringify(h.dias)) })}
                            onKeyDown={(e) => e.key === 'Enter' && setHorForm({ id: h.id, nombre: h.nombre, dias: JSON.parse(JSON.stringify(h.dias)) })}
                          >
                            <td className="att-name">{h.nombre}</td>
                            <td>{nombresDias(h.dias)}</td>
                            <td className="att-sede">{franjasDe(h.dias)}</td>
                            <td className="att-sede">{almuerzoDe(h.dias)}</td>
                            <td className="num">{fmtHM(horasSemanaDias(h.dias))}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <AccList
                    items={horarios.map((h) => ({
                      id: h.id,
                      title: h.nombre,
                      right: <span className="acc-note">{fmtHM(horasSemanaDias(h.dias))}/sem</span>,
                      fields: [
                        ['Días', resumenDias(h.dias)],
                        ['Almuerzo', almuerzoDe(h.dias)],
                        ['Horas por semana', fmtHM(horasSemanaDias(h.dias))],
                      ],
                      // Editar (y eliminar, dentro del cajón), como en Empleados.
                      actions: (
                        <button className="btn primary block" onClick={() => setHorForm({ id: h.id, nombre: h.nombre, dias: JSON.parse(JSON.stringify(h.dias)) })}>
                          Editar
                        </button>
                      ),
                    }))}
                  />
                </>
              )}
            </div>
          </section>
        )}

        {tab === 'reportes' && (
          <section className="card grow">
            <h2>Horas extra por período</h2>
            <p className="hint">
              Lo calcula el servidor con las mismas reglas que consume nómina. Clic en un nombre
              para abrir su ficha; el CSV incluye la asistencia completa y el valor por categoría.
            </p>
            <div className="rep-controls">
              <label>Desde <input type="date" value={repFrom} max={repTo} onChange={(e) => setRepFrom(e.target.value)} /></label>
              <label>Hasta <input type="date" value={repTo} min={repFrom} max={todayKey()} onChange={(e) => setRepTo(e.target.value)} /></label>
              <button
                className="btn solo-pc"
                onClick={() => setRepColsAsistencia(!repColsAsistencia)}
                aria-pressed={repColsAsistencia}
              >
                {repColsAsistencia ? '− Columnas de asistencia' : '＋ Columnas de asistencia'}
              </button>
              <button className="btn primary" onClick={exportCSV} disabled={report.length === 0}>Exportar CSV</button>
            </div>
            <div className="scrollable">
              {/* «Calculando…» solo cuando NO hay nada que mostrar: si ya hay
                  tabla, se deja quieta (apenas atenuada) mientras se refresca —
                  el aviso arriba empujaba todo y distorsionaba la pantalla. */}
              {repDatos.estado === 'cargando' && report.length === 0 && <p className="empty">Calculando el período…</p>}
              {repDatos.estado === 'error' && (
                <p className="empty">⚠ No se pudo cargar el reporte: {repDatos.error}</p>
              )}
              {repDatos.estado === 'listo' && report.length === 0 && (
                <p className="empty">Sin marcaciones en este período{sedeFilter !== 'all' ? ` para ${sedeFilter}` : ''}.</p>
              )}

              {report.length > 0 && (
                <div style={repDatos.estado === 'cargando' ? { opacity: 0.55, pointerEvents: 'none' } : undefined}>
                  {totalValorizado > 0 && (
                    <div className="val-total">
                      <span className="label">Horas extra del período</span>
                      <span className="value">{fmtCOP(totalValorizado)}</span>
                    </div>
                  )}

                  <div
                    className={`rep-table${repColsAsistencia ? ' con-asistencia' : ''}${permisos.liquidar ? ' con-pago' : ''}`}
                    role="table"
                  >
                    <div className="rep-row head" role="row">
                      <span>Empleado</span>
                      {/* La explicación de cada sigla vive en su «?», no en un
                          párrafo kilométrico al pie que nadie leía. */}
                      {TIPOS_HORA.map((t) => (
                        <span key={t.codigo}>
                          {t.codigo} <Q abajo texto={`${t.nombre}. Su porcentaje se ajusta en Ajustes → Valorización de horas extra.`} />
                        </span>
                      ))}
                      <span>Total</span>
                      <span className="val-money">Valor</span>
                      {repColsAsistencia && (
                        <>
                          <span>Sede</span><span>Días</span><span>Horas</span><span>Tardías</span>
                        </>
                      )}
                      {permisos.liquidar && (
                        <span className="col-pago">
                          Pagado <Q abajo texto="Anotación de que esas horas ya se liquidaron en nómina — Control Registro no paga. Si después se corrige una marcación ya pagada, ese tramo vuelve a quedar pendiente y la fila se muestra como parcial." />
                        </span>
                      )}
                    </div>
                    {report.map((r) => (
                      <div className="rep-row" role="row" key={r.cedula}>
                        <button
                          className="rep-name rep-link"
                          onClick={() => irAAsistenciaEmpleado(r.cedula)}
                          title={`Ver la asistencia de ${r.name} en este período`}
                        >
                          {r.name}
                        </button>
                        {TIPOS_HORA.map((t) => (
                          <span key={t.codigo} className={r.horasPorTipo[t.codigo] > 0 ? 'warn-num' : 'muted-cell'}>
                            {r.horasPorTipo[t.codigo] > 0 ? fmtHoras(r.horasPorTipo[t.codigo]) : '—'}
                          </span>
                        ))}
                        <span>{r.extras > 0 ? fmtHoras(r.extras) : '—'}</span>
                        <span className="val-money" title={r.desglose?.length ? r.desglose.join('\n') : undefined}>
                          {!r.conExtras
                            ? <span className="muted-cell">—</span>
                            : r.sinSalario
                              ? <span className="sin-salario" title="Registra el salario del empleado para ver su valor">sin salario</span>
                              : fmtCOP(r.valor)}
                        </span>
                        {repColsAsistencia && (
                          <>
                            <span>{r.sede || '—'}</span>
                            <span>{r.days}</span>
                            <span>{fmtHoras(r.hours)}</span>
                            <span className={r.lateCount > 0 ? 'warn-num' : ''}>{r.lateCount}</span>
                          </>
                        )}
                        {permisos.liquidar && (
                          <span className="col-pago">
                            {r.conExtras ? (
                              <label className={`pago-check est-${r.pago}`} title={etiquetaPago(r)}>
                                <input
                                  type="checkbox"
                                  checked={r.pago === 'pagado'}
                                  // 'parcial' se pinta indeterminado: ni pagado
                                  // ni pendiente, y al hacer clic completa lo
                                  // que falte en vez de desmarcar lo ya pagado.
                                  ref={(el) => { if (el) el.indeterminate = r.pago === 'parcial'; }}
                                  onChange={() => alternarPago(r)}
                                />
                                <span className="pago-txt">{ETIQUETA_PAGO[r.pago]}</span>
                              </label>
                            ) : <span className="muted-cell">—</span>}
                          </span>
                        )}
                      </div>
                    ))}
                  </div>

                  <AccList
                    items={report.map((r) => ({
                      id: r.cedula,
                      title: r.name,
                      right: (
                        <span className="acc-note">
                          {!r.conExtras ? '—' : r.sinSalario ? 'sin salario' : fmtCOP(r.valor)}
                        </span>
                      ),
                      fields: [
                        ...TIPOS_HORA.map((t) => [
                          `${t.codigo} — ${t.nombre}`,
                          r.horasPorTipo[t.codigo] > 0 ? fmtHoras(r.horasPorTipo[t.codigo]) : '—',
                        ]),
                        ['Total horas extra', r.extras > 0 ? fmtHoras(r.extras) : '—'],
                        ['Valor generado', !r.conExtras ? '—' : r.sinSalario ? 'sin salario registrado' : fmtCOP(r.valor)],
                        ...(r.conExtras ? [['Estado de pago', etiquetaPago(r)]] : []),
                        ['Sede', r.sede || '—'],
                        ['Días trabajados', r.days],
                        ['Horas trabajadas', fmtHoras(r.hours)],
                        ['Entradas tardías', r.lateCount],
                      ],
                      actions: (
                        <>
                          {permisos.liquidar && r.conExtras && (
                            <button className="btn block" onClick={() => alternarPago(r)}>
                              {r.pago === 'pagado' ? 'Quitar marca de pagado' : 'Marcar como pagadas'}
                            </button>
                          )}
                          <button className="btn primary block" onClick={() => irAAsistenciaEmpleado(r.cedula)}>
                            Ver su asistencia del período
                          </button>
                        </>
                      ),
                    }))}
                  />

                </div>
              )}
            </div>
          </section>
        )}

        {tab === 'historial' && (() => {
          // Filtro por día (Bogotá) y paginación sobre el resultado filtrado.
          const HIST_PAGE = 15;
          const filtrados = data.audit.filter((e) => {
            const dia = dayKey(e.ts);
            if (histFiltro.desde && dia < histFiltro.desde) return false;
            if (histFiltro.hasta && dia > histFiltro.hasta) return false;
            return true;
          });
          const histPages = Math.max(1, Math.ceil(filtrados.length / HIST_PAGE));
          const histSafe = Math.min(histPage, histPages - 1);
          const pagina = filtrados.slice(histSafe * HIST_PAGE, (histSafe + 1) * HIST_PAGE);
          const hayFiltro = histFiltro.desde || histFiltro.hasta;
          return (
          <section className="card grow">
            <h2>Historial de ajustes <span className="muted-count">{filtrados.length}</span></h2>
            <p className="hint">Quién cambió qué y cuándo.</p>
            <div className="att-controls">
              <label className="hist-fecha">Desde{' '}
                <input
                  className="att-fecha" type="date" value={histFiltro.desde} max={histFiltro.hasta || todayKey()}
                  onChange={(e) => { setHistFiltro({ ...histFiltro, desde: e.target.value }); setHistPage(0); }}
                />
              </label>
              <label className="hist-fecha">Hasta{' '}
                <input
                  className="att-fecha" type="date" value={histFiltro.hasta} min={histFiltro.desde || undefined} max={todayKey()}
                  onChange={(e) => { setHistFiltro({ ...histFiltro, hasta: e.target.value }); setHistPage(0); }}
                />
              </label>
              {hayFiltro && (
                <button className="btn" onClick={() => { setHistFiltro({ desde: '', hasta: '' }); setHistPage(0); }}>
                  Quitar filtro
                </button>
              )}
            </div>
            <div className="scrollable">
              {filtrados.length === 0 && (
                <p className="empty">{hayFiltro ? 'Sin correcciones en ese rango de fechas.' : 'Sin correcciones.'}</p>
              )}
              {pagina.map((e) => (
                <div className="log-item" key={e.id}>
                  <time>{fmtTs(e.ts)}</time>
                  <span className="action">
                    <b>{e.correctedBy}</b> {e.flag === 'manual' ? 'agregó' : 'corrigió'} {e.type === 'in' ? 'entrada' : 'salida'} {fmt12(e.ts)} para <b>{e.personName}</b>.
                  </span>
                </div>
              ))}
              {histPages > 1 && (
                <div className="pager">
                  <button className="btn" disabled={histSafe === 0} onClick={() => setHistPage(histSafe - 1)}>Anterior</button>
                  <span>Página {histSafe + 1} de {histPages}</span>
                  <button className="btn" disabled={histSafe >= histPages - 1} onClick={() => setHistPage(histSafe + 1)}>Siguiente</button>
                </div>
              )}
            </div>
          </section>
          );
        })()}

        {/* Ajustes: SIN tarjetas ni bordes — filas de icono + nombre sobre el
            fondo de la página, separadas por una línea fina; la estructura la
            dan los títulos de grupo. */}
        {tab === 'ajustes' && (
          <section className="card grow ajustes-plano">
            <h2>Ajustes</h2>
            <div className="scrollable">
              {(permisos.usuarios || permisos.config) && (
                <div className="tools-grupo">
                  <h3>Cuenta y acceso</h3>
                  {permisos.config && (
                    <button className="tool" onClick={() => { setTab('cfg-empresa'); cargarMiEmpresa(); }}>
                      <span className="icon"><Icon name="database" size={19} /></span>
                      <span className="tool-txt"><b>Mi empresa</b><small>Nombre, clave de API y plan</small></span>
                      <span className="tool-chev"><Icon name="chevronRight" size={14} /></span>
                    </button>
                  )}
                  {permisos.usuarios && (
                    <button className="tool" onClick={() => { setTab('cfg-usuarios'); cargarUsuarios(); }}>
                      <span className="icon"><Icon name="users" size={19} /></span>
                      <span className="tool-txt"><b>Acceso al panel</b><small>Quién puede entrar</small></span>
                      <span className="tool-chev"><Icon name="chevronRight" size={14} /></span>
                    </button>
                  )}
                </div>
              )}

              <div className="tools-grupo">
                <h3>Reglas de la empresa</h3>
                <button className="tool" onClick={() => setTab('cfg-reglamento')}>
                  <span className="icon"><Icon name="file" size={19} /></span>
                  <span className="tool-txt"><b>Reglamento laboral</b><small>{cfg.weeklyHours ?? '—'} h/sem · {(cfg.holidays ?? []).length} festivos</small></span>
                  <span className="tool-chev"><Icon name="chevronRight" size={14} /></span>
                </button>
                <button className="tool" onClick={() => setTab('cfg-nomina')}>
                  <span className="icon"><Icon name="clock" size={19} /></span>
                  <span className="tool-txt"><b>Valorización</b><small>Cuánto vale cada hora extra</small></span>
                  <span className="tool-chev"><Icon name="chevronRight" size={14} /></span>
                </button>
                <button className="tool" onClick={() => setTab('cfg-simulador')}>
                  <span className="icon"><Icon name="file" size={19} /></span>
                  <span className="tool-txt"><b>Simulador</b><small>Probar el cálculo de horas extra</small></span>
                  <span className="tool-chev"><Icon name="chevronRight" size={14} /></span>
                </button>
              </div>

              <div className="tools-grupo">
                <h3>Herramientas</h3>
                <Link className="tool" href="/">
                  <span className="icon"><Icon name="monitor" size={19} /></span>
                  <span className="tool-txt"><b>Ir al kiosco</b><small>Pantalla de marcación</small></span>
                  <span className="tool-chev"><Icon name="chevronRight" size={14} /></span>
                </Link>
                <button className="tool" onClick={() => setTab('cfg-gps')}>
                  <span className="icon"><Icon name="pin" size={19} /></span>
                  <span className="tool-txt"><b>Diagnóstico GPS</b><small>Precisión y distancia a cada sede</small></span>
                  <span className="tool-chev"><Icon name="chevronRight" size={14} /></span>
                </button>
              </div>
            </div>
          </section>
        )}

        {/* ── Sub-pantalla: Usuarios y roles ── */}
        {tab === 'cfg-usuarios' && (
          <section className="card grow">
            <button className="btn back-btn" onClick={() => setTab('ajustes')}>‹ Ajustes</button>
            <h2>Acceso al panel <span className="muted-count">{usuarios.length}</span></h2>
            <p className="hint">Todos entran con Google y pueden lo mismo.</p>

            {usrError && <p className="empty">⚠ {usrError}</p>}
            <div className="att-controls">
              {!nuevoUsr && (
                <button className="btn primary" onClick={() => setNuevoUsr({ email: '' })}>
                  Invitar
                </button>
              )}
            </div>

            {nuevoUsr && (
              <div className="ev-form">
                <h4>Invitar a alguien</h4>
                <label className="ev-form-reason">Correo de Google
                  <input
                    type="email" value={nuevoUsr.email} autoFocus placeholder="persona@empresa.com"
                    onChange={(e) => setNuevoUsr({ email: e.target.value })}
                  />
                </label>
                <small className="hint">Entra sola la primera vez que inicie sesión.</small>
                <div className="dialog-actions">
                  <button className="btn" onClick={() => setNuevoUsr(null)}>Cancelar</button>
                  <button className="btn primary" disabled={!nuevoUsr.email.includes('@')} onClick={invitar}>
                    Invitar
                  </button>
                </div>
              </div>
            )}

            {/* El sistema no manda correos: el aviso lo lleva el dueño. Tras
                invitar queda el mensaje listo para copiar y pegar. */}
            {invitacionCreada && (
              <div className="inv-aviso" role="status">
                <span>
                  <b>{invitacionCreada.email}</b> ya puede entrar.
                  Avísale tú — el sistema no le envía correo:
                </span>
                <span className="inv-acciones">
                  <button className="btn small primary" onClick={() => copiarInvitacion(invitacionCreada.email)}>
                    Copiar invitación
                  </button>
                  <button className="btn small" onClick={() => setInvitacionCreada(null)}>Listo</button>
                </span>
              </div>
            )}

            <div className="scrollable">
              {usuarios.length === 0 && !usrError && <p className="empty">Aún no hay nadie.</p>}
              {usuarios.length > 0 && (
                <div className="att-tablewrap">
                  <table className="att-table">
                    <thead>
                      <tr><th>Persona</th><th>Estado</th><th>Último acceso</th><th></th></tr>
                    </thead>
                    <tbody>
                      {usuarios.map((u) => (
                        <tr key={u.id}>
                          <td className="att-name">
                            {u.nombre}
                            <br /><small style={{ color: 'var(--muted)' }}>{u.email}{u.email === sesion?.email ? ' · tú' : ''}</small>
                          </td>
                          <td>{u.activo ? '🟢 activo' : '⛔ inactivo'}</td>
                          <td>{u.ultimoAcceso ? fmtTs(u.ultimoAcceso) : 'nunca'}</td>
                          <td>
                            {u.email !== sesion?.email && (
                              <button className={`btn small${u.activo ? ' danger-btn' : ''}`}
                                onClick={() => actualizarUsuario(u, { activo: !u.activo })}>
                                {u.activo ? 'Desactivar' : 'Activar'}
                              </button>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {/* Invitados que todavía no han entrado: para quien administra son
                  gente con acceso concedido, así que van en la misma pantalla. */}
              {invitaciones.length > 0 && (
                <>
                  <h3 style={{ marginTop: 14 }}>Invitaciones pendientes</h3>
                  <div className="att-tablewrap">
                    <table className="att-table">
                      <thead>
                        <tr><th>Correo</th><th>Vence</th><th></th></tr>
                      </thead>
                      <tbody>
                        {invitaciones.map((i) => (
                          <tr key={i.id}>
                            <td className="att-name">{i.email}</td>
                            <td>{fmtTs(i.expiraEn)}</td>
                            <td style={{ whiteSpace: 'nowrap' }}>
                              <button className="btn small" onClick={() => copiarInvitacion(i.email)}>
                                Copiar
                              </button>{' '}
                              <button className="btn small danger-btn" onClick={() => revocarInvitacion(i)}>
                                Revocar
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              )}
            </div>
          </section>
        )}

        {/* ── Sub-pantalla: Mi empresa ── */}
        {/* ── Plan y suscripción ─────────────────────────────────────── */}
        {tab === 'cfg-plan' && (
          <section className="card grow">
            <button className="btn back-btn" onClick={() => setTab('ajustes')}>‹ Ajustes</button>
            <h2>Plan</h2>

            {/* Lo primero es en qué situación está: se paga distinto según
                si está probando, al día o vencida. */}
            {sesion?.planEstado?.enPrueba && (
              <div className="plan-estado prueba">
                <div>
                  <b>
                    {sesion.planEstado.diasPrueba === 1
                      ? 'Tu prueba termina hoy'
                      : `Tu prueba termina en ${sesion.planEstado.diasPrueba} días`}
                  </b>
                  <small>Después de eso el kiosco deja de registrar marcaciones. Suscríbete para seguir.</small>
                </div>
              </div>
            )}
            {sesion?.planEstado?.pagada && (
              <div className="plan-estado activa">
                <div>
                  <b>Suscripción activa · plan {catalogo?.planes?.find((p) => p.id === sesion.planEstado.planId)?.nombre ?? sesion.planEstado.planId ?? ''}</b>
                  <small>
                    Vence el {new Date(sesion.planEstado.venceEn).toLocaleDateString('es-CO', { day: 'numeric', month: 'long', year: 'numeric' })}
                    {' '}({sesion.planEstado.diasRestantes} día{sesion.planEstado.diasRestantes === 1 ? '' : 's'}). Puedes renovar cuando quieras: los días que te quedan se suman.
                  </small>
                </div>
              </div>
            )}
            {sesion?.planEstado && !sesion.planEstado.acceso && (
              <div className="plan-estado vencida">
                <div>
                  <b>{sesion.planEstado.pruebaVencida ? 'Tu prueba terminó' : 'Tu suscripción venció'}</b>
                  <small>El kiosco no registra marcaciones. Tus datos siguen intactos: puedes consultarlos y exportarlos.</small>
                </div>
              </div>
            )}

            {catalogo === null && <p className="empty">Cargando planes…</p>}
            {catalogo?.disponible === false && (
              <p className="empty">Los pagos en línea todavía no están habilitados. Escríbenos y activamos tu plan.</p>
            )}

            {catalogo?.disponible && (
              <>
                {catalogo.conEntrada && (
                  <p className="hint">
                    <b>Precio de entrada:</b> US${catalogo.precioEntrada} al mes durante los primeros{' '}
                    {catalogo.maxMesesEntrada} meses, en el plan que elijas. Es por una sola vez.
                  </p>
                )}
                <p className="hint">
                  Tienes <b>{catalogo.empleados} empleado{catalogo.empleados === 1 ? '' : 's'}</b> registrado{catalogo.empleados === 1 ? '' : 's'}.
                  Elige el plan que los cubra.
                </p>

                {/* Cuántos meses adelantar. Con el precio de entrada, cada mes
                    cuesta lo mismo sin importar el plan. */}
                {catalogo.conEntrada && (
                  <div className="meses-sel" role="group" aria-label="Meses">
                    {Array.from({ length: catalogo.maxMesesEntrada }, (_, i) => i + 1).map((m) => (
                      <button
                        key={m}
                        className="fchip"
                        aria-pressed={mesesPlan === m}
                        onClick={() => setMesesPlan(m)}
                      >
                        {m} mes{m === 1 ? '' : 'es'} · US${catalogo.precioEntrada * m}
                      </button>
                    ))}
                  </div>
                )}

                <div className="planes-lista">
                  {catalogo.planes.map((p) => {
                    const meses = catalogo.conEntrada ? mesesPlan : 1
                    const total = catalogo.conEntrada ? catalogo.precioEntrada * meses : p.precio
                    return (
                      <div key={p.id} className={`plan-tarjeta${p.sugerido ? ' sugerido' : ''}${!p.alcanza ? ' corto' : ''}`}>
                        {p.sugerido && <span className="plan-etiqueta">Para tu tamaño</span>}
                        <h3>{p.nombre}</h3>
                        <span className="plan-para">{p.para}</span>
                        <div className="plan-precio">
                          {catalogo.conEntrada && <s>US${p.precio}</s>}
                          <b>US${catalogo.conEntrada ? catalogo.precioEntrada : p.precio}</b>
                          <em>/mes</em>
                        </div>
                        <span className="plan-tope">
                          Hasta {p.empleados} empleados
                        </span>
                        <button
                          className={`btn ${p.sugerido ? 'primary' : ''} block`}
                          disabled={pagando || !p.alcanza}
                          onClick={() => irAPagar(p.id, meses)}
                          title={!p.alcanza ? `Tienes ${catalogo.empleados} empleados y este plan cubre ${p.empleados}` : undefined}
                        >
                          {!p.alcanza ? 'No alcanza' : pagando ? 'Abriendo…' : `Pagar US$${total}`}
                        </button>
                      </div>
                    )
                  })}
                </div>

                <p className="cfg-note" style={{ marginTop: 14 }}>
                  {catalogo.conEntrada
                    ? `Después de los meses de entrada, la renovación cuesta el precio normal del plan.`
                    : 'Se cobra por mes. Sin permanencia: renuevas cuando quieras.'}
                  {' '}Se paga en dólares con tarjeta. ¿Más de {catalogo.contactoDesde} empleados?{' '}
                  <b>Escríbenos</b> y armamos un plan.
                </p>
                {sesion?.pagoDePrueba && (
                  <p className="cfg-note" style={{ color: 'var(--warn-text)' }}>
                    ⚠️ Pagos en <b>modo de pruebas</b>: no se cobra dinero real, pero el plan se
                    activa igual y habrá que revertirlo a mano.
                  </p>
                )}
              </>
            )}
          </section>
        )}

        {tab === 'cfg-empresa' && (
          <section className="card grow">
            <button className="btn back-btn" onClick={() => setTab('ajustes')}>‹ Ajustes</button>
            <h2>Mi empresa</h2>
            {!miEmpresa && <p className="empty">Cargando…</p>}
            {miEmpresa && (
              <div className="scrollable">
                <div className="cfg-group">
                  <h3>Identidad</h3>
                  {!empDraft ? (
                    <>
                      <div className="cfg-row">
                        <label>Nombre</label>
                        <div className="cfg-input"><b>{miEmpresa.nombre}</b></div>
                      </div>
                      <div className="cfg-row">
                        <label>NIT</label>
                        <div className="cfg-input">{miEmpresa.nit || '—'}</div>
                      </div>
                      <div className="att-controls">
                        <button className="btn" onClick={() => setEmpDraft({ nombre: miEmpresa.nombre, nit: miEmpresa.nit })}>
                          Editar
                        </button>
                      </div>
                    </>
                  ) : (
                    <div className="ev-form">
                      <div className="ev-form-row">
                        <label>Nombre
                          <input type="text" value={empDraft.nombre} onChange={(e) => setEmpDraft({ ...empDraft, nombre: e.target.value })} />
                        </label>
                        <label>NIT
                          <input type="text" value={empDraft.nit} placeholder="opcional" onChange={(e) => setEmpDraft({ ...empDraft, nit: e.target.value })} />
                        </label>
                      </div>
                      <div className="dialog-actions">
                        <button className="btn" onClick={() => setEmpDraft(null)}>Cancelar</button>
                        <button className="btn primary" disabled={empDraft.nombre.trim().length < 2} onClick={guardarMiEmpresa}>Guardar</button>
                      </div>
                    </div>
                  )}
                </div>

                <div className="cfg-group">
                  <h3>Plan</h3>
                  <div className="cfg-row">
                    <label>
                      {sesion?.planEstado?.pagada ? 'Suscripción activa'
                        : sesion?.planEstado?.enPrueba ? 'En prueba' : 'Sin suscripción'}
                      {sesion?.planEstado?.pagada && sesion.planEstado.venceEn && (
                        <small>
                          Vence el {new Date(sesion.planEstado.venceEn).toLocaleDateString('es-CO', { day: 'numeric', month: 'long', year: 'numeric' })}
                        </small>
                      )}
                      {sesion?.planEstado?.enPrueba && (
                        <small>Te quedan {sesion.planEstado.diasPrueba} día{sesion.planEstado.diasPrueba === 1 ? '' : 's'} de prueba.</small>
                      )}
                      {!sesion?.planEstado?.acceso && (
                        <small style={{ color: 'var(--crit-text)' }}>El kiosco no puede registrar marcaciones.</small>
                      )}
                    </label>
                    <div className="cfg-input">
                      {/* El detalle y el pago viven en su propia pantalla. */}
                      <button className="btn small" onClick={() => setTab('cfg-plan')}>Ver planes</button>
                    </div>
                  </div>
                </div>

                <div className="cfg-group">
                  <h3>Clave de API</h3>
                  <p className="cfg-note" style={{ marginTop: 0 }}>
                    Con ella el sistema de nómina consulta <code>GET /api/horas</code> (encabezado <code>X-API-Key</code>).
                  </p>
                  <div className="api-key-row">
                    <code className="api-key">{apiKeyVisible ? miEmpresa.apiKey : '••••••••••••••••••••'}</code>
                    <button className="btn small" onClick={() => setApiKeyVisible((v) => !v)}>
                      {apiKeyVisible ? 'Ocultar' : 'Ver'}
                    </button>
                    <button
                      className="btn small"
                      onClick={async () => {
                        try { await navigator.clipboard.writeText(miEmpresa.apiKey); showToast('Clave copiada'); }
                        catch { showToast('No se pudo copiar.'); }
                      }}
                    >
                      Copiar
                    </button>
                    <button className="btn small danger-btn" onClick={regenerarApiKey}>Regenerar</button>
                  </div>
                </div>

                <div className="cfg-group">
                  <h3>Mis datos</h3>
                  <p className="cfg-note" style={{ marginTop: 0 }}>
                    Descarga todo en un JSON. Los rostros no van: son datos biométricos.
                  </p>
                  <div className="att-controls">
                    <a className="btn" href="/api/empresa/exportar" download>Exportar datos</a>
                  </div>
                </div>
              </div>
            )}
          </section>
        )}

        {/* ── Sub-pantalla: Dispositivos del kiosco ── */}
        {tab === 'cfg-dispositivos' && (
          <section className="card grow">
            <h2>Dispositivos del kiosco <span className="muted-count">{dispositivos.length}</span></h2>
            <p className="hint">
              Cada aparato tiene su propia clave: revoca el que se pierda y los demás siguen
              trabajando.
            </p>
            {dispError && <p className="empty">⚠ {dispError}</p>}

            <div className="att-controls">
              <button className="btn primary" onClick={() => { setVinculando({ nombre: '', sedeId: '' }); setCodigoVinc(null); }}>
                Vincular un aparato
              </button>
            </div>

            {/* Vinculación en un CAJÓN lateral, como registrar o editar. El
                código es el camino para la app de Android, donde no se puede
                iniciar sesión (Google lo bloquea dentro de una app). */}
            {(vinculando || codigoVinc) && (
              <div
                className="overlay right"
                onClick={(e) => {
                  if (e.target !== e.currentTarget) return;
                  setVinculando(null);
                  if (codigoVinc) { setCodigoVinc(null); cargarDispositivos(); }
                }}
              >
                <aside className="drawer" role="dialog" aria-modal="true" aria-label="Vincular un aparato">
                  <div className="drawer-head">
                    <div><h3>{codigoVinc?.reconectando ? `Reconectar «${codigoVinc.reconectando}»` : 'Vincular un aparato'}</h3></div>
                    <button
                      className="btn"
                      onClick={() => { setVinculando(null); if (codigoVinc) { setCodigoVinc(null); cargarDispositivos(); } }}
                    >
                      Cerrar
                    </button>
                  </div>
                  <div className="drawer-body">
                    {codigoVinc ? (
                      <div className="codigo-vinc">
                        <div className="codigo-num">{codigoVinc.codigoLegible}</div>
                        <p className="cfg-note">
                          Escríbelo en el aparato, en la pantalla del kiosco. Vale una sola vez y
                          vence {new Date(codigoVinc.expira_en).toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' })}.
                          {codigoVinc.reconectando && ' Al usarlo, la clave anterior de este aparato deja de servir.'}
                        </p>
                        <button className="btn primary block" onClick={() => { setCodigoVinc(null); cargarDispositivos(); }}>
                          Listo
                        </button>
                      </div>
                    ) : (
                      <>
                        <div className="field">
                          <label htmlFor="v-nombre">Nombre del aparato</label>
                          <input
                            id="v-nombre" type="text" autoFocus placeholder="Celular recepción"
                            value={vinculando.nombre}
                            onChange={(e) => setVinculando({ ...vinculando, nombre: e.target.value })}
                          />
                        </div>
                        <div className="field">
                          <label htmlFor="v-tipo">
                            Tipo de dispositivo
                            <Q texto={vinculando.sedeId
                              ? 'Kiosco fijo: sus marcaciones quedan atribuidas a esa sede, y ahí marcan los empleados con sede exigida.'
                              : 'Móvil: sin sede; las marcaciones no quedan atadas a un local.'} />
                          </label>
                          <select id="v-tipo" value={vinculando.sedeId} onChange={(e) => setVinculando({ ...vinculando, sedeId: e.target.value })}>
                            <option value="">Móvil — registra desde cualquier lugar</option>
                            {sedes.map((s) => <option key={s.id} value={s.id}>Kiosco fijo en {s.name}</option>)}
                          </select>
                        </div>
                        <button
                          className="btn primary block"
                          disabled={!vinculando.nombre.trim()}
                          onClick={generarCodigoVinculacion}
                        >
                          Generar código
                        </button>
                      </>
                    )}
                  </div>
                </aside>
              </div>
            )}

            <div className="scrollable">
              {dispositivos.length === 0 && !dispError && !vinculando && (
                <p className="empty">Sin dispositivos. Usa «Vincular un aparato» para registrar el primero.</p>
              )}
              {dispositivos.length > 0 && (
                <div className="att-tablewrap">
                  <table className="att-table">
                    <thead>
                      <tr><th>Dispositivo</th><th>Sede</th><th>Estado</th><th>Último uso</th><th>Activado por</th><th></th></tr>
                    </thead>
                    <tbody>
                      {dispositivos.map((d) => (
                        <tr key={d.id}>
                          <td className="att-name">{d.nombre}</td>
                          <td>{d.sede_nombre ?? '—'}</td>
                          <td>{d.activo ? '🟢 activo' : '⛔ revocado'}</td>
                          <td>{d.ultimo_uso ? fmtTs(d.ultimo_uso) : 'nunca'}</td>
                          <td>{d.activado_por ?? '—'}</td>
                          <td>
                            <span className="tl-actions">
                              {/* Reconectar sirve activo o revocado: mismo aparato,
                                  clave nueva (p. ej. se borraron los datos de la app). */}
                              <button className="btn small" onClick={() => reconectarDispositivo(d)}>Reconectar</button>
                              {d.activo && (
                                <button className="btn small danger-btn" onClick={() => revocarDispositivo(d)}>Revocar</button>
                              )}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </section>
        )}

        {/* ── Sub-pantalla: Reglamento laboral ── */}
        {/* ── Sub-pantalla: Valorización de horas extra ── */}
        {tab === 'cfg-nomina' && (
          <section className="card grow">
            <button className="btn back-btn" onClick={() => setTab('ajustes')}>‹ Ajustes</button>
            <h2>Valorización de horas extra</h2>
            <p className="hint">Los cambios se aplican de inmediato.</p>
            <div className="scrollable">
              <div className="cfg-group">
                <h3>Porcentaje por tipo de hora</h3>
                <p className="cfg-note" style={{ marginTop: 0, marginBottom: 10 }}>
                  Porcentaje <b>total</b>, no el recargo: 125&nbsp;% ya incluye la hora.
                </p>
                {TIPOS_HORA.map((t) => {
                  const factor = cfg.factores?.[t.codigo] ?? t.factor;
                  const mostrado = pctDraft?.[t.codigo] ?? String(Math.round(factor * 100));
                  return (
                    <div className="cfg-row" key={t.codigo}>
                      <label htmlFor={`pct-${t.codigo}`}>
                        {t.nombre}
                        <small><code>{t.codigo}</code> — {t.nocturna ? 'franja nocturna' : 'franja diurna'}
                          {t.dominical ? ', domingo o festivo' : ', día hábil'}</small>
                      </label>
                      <div className="cfg-input">
                        <input
                          id={`pct-${t.codigo}`} type="number" min="100" max="1000" step="5"
                          value={mostrado}
                          onChange={(e) => setPctDraft({ ...(pctDraft ?? {}), [t.codigo]: e.target.value })}
                          // Se guarda al SALIR del campo, no en cada tecla: al
                          // escribir "215" el navegador pasa por "2" y "21",
                          // que se habrían guardado como factores absurdos.
                          onBlur={() => {
                            const pct = Number(pctDraft?.[t.codigo]);
                            setPctDraft(null);
                            if (!Number.isFinite(pct) || pct < 100 || pct > 1000) {
                              showToast('El porcentaje debe estar entre 100 y 1000.');
                              return;
                            }
                            const nuevo = Math.round(pct) / 100;
                            if (nuevo === factor) return;
                            updateCfg({ factores: { ...(cfg.factores ?? {}), [t.codigo]: nuevo } });
                          }}
                        /> %
                      </div>
                    </div>
                  );
                })}
                <p className="cfg-note">
                  {TIPOS_HORA.map((t) => `${t.codigo} ×${(cfg.factores?.[t.codigo] ?? t.factor).toLocaleString('es-CO')}`).join(' · ')}
                </p>
              </div>

              <div className="cfg-group">
                <h3>Valor de la hora ordinaria</h3>
                {/* El divisor ya no se edita aquí: se deriva de la jornada
                    reglamentaria (semana × 5). Un solo número que administrar. */}
                <div className="cfg-row">
                  <label>
                    Horas al mes
                    <small>Jornada semanal × 5. Se cambia en Reglamento laboral.</small>
                  </label>
                  <div className="cfg-input">
                    <b>{cfg.weeklyHours ?? 42} × 5 = {(cfg.weeklyHours ?? 42) * 5} h</b>
                  </div>
                </div>
                <p className="cfg-note">
                  Ejemplo con $1.500.000: hora ordinaria{' '}
                  <b>{fmtCOP(Math.round(1500000 / (cfg.divisorHorasMes || DIVISOR_210)))}</b>, extra diurna{' '}
                  <b>{fmtCOP(Math.round((1500000 / (cfg.divisorHorasMes || DIVISOR_210)) * (cfg.factores?.HED ?? 1.25)))}</b>.
                </p>
              </div>

              <div className="cfg-group">
                <h3>Franja nocturna</h3>
                <p className="cfg-note" style={{ marginTop: 0, marginBottom: 10 }}>
                  La extra dentro de la franja se paga como nocturna. Por ley, 21:00–06:00.
                </p>
                <div className="cfg-row">
                  <label htmlFor="cfg-noc-ini">Empieza</label>
                  <div className="cfg-input">
                    <input
                      id="cfg-noc-ini" type="time" className="cfg-time"
                      value={cfg.nocturnoInicio ?? '21:00'}
                      onChange={(e) => e.target.value && updateCfg({ nocturnoInicio: e.target.value })}
                    />
                  </div>
                </div>
                <div className="cfg-row">
                  <label htmlFor="cfg-noc-fin">Termina</label>
                  <div className="cfg-input">
                    <input
                      id="cfg-noc-fin" type="time" className="cfg-time"
                      value={cfg.nocturnoFin ?? '06:00'}
                      onChange={(e) => e.target.value && updateCfg({ nocturnoFin: e.target.value })}
                    />
                  </div>
                </div>
                <p className="cfg-note">
                  Un turno que cruce la franja se parte solo: 20:00–23:00 → 1 h diurna + 2 h nocturnas.
                </p>
              </div>
            </div>
          </section>
        )}

        {/* ── Sub-pantalla: Simulador de horas extra ──
            Verifica el cálculo de valor SIN tocar la base: se escriben horas
            por código y se valorizan con `valorizarRegistro`, la misma función
            del servidor, leyendo los factores y el divisor configurados. */}
        {/* Diagnóstico GPS dentro del panel: coordenadas, precisión y
            distancia a cada sede en vivo, sin salir a /gps. */}
        {tab === 'cfg-gps' && (
          <section className="card grow">
            <h2>Diagnóstico GPS</h2>
            <p className="hint">
              Coordenadas crudas, precisión y distancia a cada sede en vivo. Ábrelo desde el
              dispositivo con dudas: sirve para saber si una «distancia errónea» es culpa del GPS.
            </p>
            <div className="scrollable">
              <GpsDebug />
            </div>
          </section>
        )}

        {tab === 'cfg-simulador' && (() => {
          const salario = Number(simSalario) > 0 ? Number(simSalario) : null;
          const divisor = cfg.divisorHorasMes || DIVISOR_210;
          const factores = cfg.factores ?? {};
          const lineas = TIPOS_HORA.map((t) => {
            const horas = Number(simHoras[t.codigo]);
            const validas = Number.isFinite(horas) && horas > 0 ? horas : 0;
            return {
              tipo: t,
              horas: validas,
              ...valorizarRegistro({ tipoHora: t.codigo, horas: validas }, { salarioMensual: salario, factores, divisor }),
            };
          });
          const conHoras = lineas.filter((l) => l.horas > 0);
          const totalHoras = conHoras.reduce((s, l) => s + l.horas, 0);
          const totalValor = conHoras.reduce((s, l) => s + (l.valor ?? 0), 0);
          const valorHora = lineas[0].valorHora;

          // ── Simulación de turno (clasificación) ──
          // Se arma la MISMA estructura que nomina.js entrega al motor, con una
          // sola persona y un par entrada→salida.
          const aMin = (hhmm) => {
            const [h, m] = String(hhmm).split(':').map(Number);
            return Number.isFinite(h) && Number.isFinite(m) ? h * 60 + m : null;
          };
          const minEntrada = aMin(simTurno.entrada);
          const minSalida = aMin(simTurno.salida);
          // Salida <= entrada significa que el turno cruza medianoche.
          const cruzaMedianoche = minEntrada != null && minSalida != null && minSalida <= minEntrada;
          const duracion = minEntrada == null || minSalida == null
            ? 0
            : ((minSalida - minEntrada + (cruzaMedianoche ? 1440 : 0)) / 60);

          const fechaBase = new Date(`${simTurno.fecha}T12:00:00`);
          const dow = fechaBase.getDay();
          const festivos = new Set(cfg.holidays ?? []);
          const esFestivo = festivos.has(simTurno.fecha);
          const diaSimulado = {
            etiqueta: `${fechaBase.toLocaleDateString('es-CO', { weekday: 'long' })}${dow === 0 ? ' · dominical' : esFestivo ? ' · festivo' : ''}`,
          };

          // Offset Bogotá explícito: el epoch no debe depender de la zona del PC.
          const epochDe = (fecha, minutos, diaExtra = 0) => {
            const d = new Date(`${fecha}T00:00:00-05:00`);
            return d.getTime() / 1000 + (minutos + diaExtra * 1440) * 60;
          };

          let tramosTurno = [];
          if (duracion > 0) {
            const jornadaPactada = Number(simTurno.jornada) > 0 ? Number(simTurno.jornada) : null;
            const porEmpleado = new Map([['SIM', {
              cedula: 'SIM', nombre: 'Simulación', sede: '',
              jornadaSemanal: jornadaPactada == null ? null : Array(6).fill(jornadaPactada),
              marcas: [
                { tipo: 'entrada', fecha: simTurno.fecha, minutos: minEntrada, epoch: epochDe(simTurno.fecha, minEntrada), dow },
                { tipo: 'salida', fecha: simTurno.fecha, minutos: minSalida, epoch: epochDe(simTurno.fecha, minSalida, cruzaMedianoche ? 1 : 0), dow },
              ],
            }]]);
            const nocturnoCfg = {
              inicio: aMin(cfg.nocturnoInicio ?? '21:00') ?? 21 * 60,
              fin: aMin(cfg.nocturnoFin ?? '06:00') ?? 6 * 60,
            };
            tramosTurno = calcularRegistros(porEmpleado, {
              festivos,
              vigencias: vigenciasDeHorasSemana(cfg.weeklyHours ?? 42),
              nocturno: nocturnoCfg,
            }).map((r) => valorizarRegistro(r, { salarioMensual: salario, factores, divisor }));
          }
          const turnoSim = { duracion, cruzaMedianoche, tramos: tramosTurno };

          return (
            <section className="card grow">
              <button className="btn back-btn" onClick={() => setTab('ajustes')}>‹ Ajustes</button>
              <h2>Simulador de horas extra</h2>
              <p className="hint">Prueba el cálculo sin tocar datos reales.</p>
              <div className="scrollable">
                <div className="cfg-group">
                  <div className="cfg-row">
                    <label htmlFor="sim-salario">
                      Salario mensual
                      <small>{valorHora == null ? 'Escribe un salario para ver valores.' : `Hora ordinaria: ${fmtCOP(valorHora)} (÷ ${divisor} h)`}</small>
                    </label>
                    <div className="cfg-input">
                      <input
                        id="sim-salario" type="number" min="0" step="1000" inputMode="numeric"
                        value={simSalario} onChange={(e) => setSimSalario(e.target.value)}
                      />
                    </div>
                  </div>
                </div>

                <div className="cfg-group">
                  <h3>Horas por categoría</h3>
                  {lineas.map((l) => (
                    <div className="cfg-row" key={l.tipo.codigo}>
                      <label htmlFor={`sim-${l.tipo.codigo}`}>
                        {l.tipo.nombre}
                        <small><code>{l.tipo.codigo}</code> · ×{(factores[l.tipo.codigo] ?? l.tipo.factor).toLocaleString('es-CO')}</small>
                      </label>
                      <div className="cfg-input">
                        <input
                          id={`sim-${l.tipo.codigo}`} type="number" min="0" max="500" step="0.5" inputMode="decimal"
                          placeholder="0"
                          value={simHoras[l.tipo.codigo]}
                          onChange={(e) => setSimHoras({ ...simHoras, [l.tipo.codigo]: e.target.value })}
                        /> h
                      </div>
                    </div>
                  ))}
                  <div className="att-controls">
                    <button
                      className="btn"
                      onClick={() => setSimHoras(Object.fromEntries(CODIGOS_HORA.map((c) => [c, ''])))}
                    >
                      Limpiar
                    </button>
                  </div>
                </div>

                {conHoras.length > 0 && (
                  <div className="cfg-group">
                    <h3>Resultado</h3>
                    <div className="sim-table" role="table">
                      <div className="sim-row head" role="row">
                        <span>Código</span><span>Horas</span><span>Factor</span><span>Valor hora</span><span className="val-money">Valor</span>
                      </div>
                      {conHoras.map((l) => (
                        <div className="sim-row" role="row" key={l.tipo.codigo}>
                          <span><code>{l.tipo.codigo}</code></span>
                          <span>{fmtHoras(l.horas)}</span>
                          <span>×{l.factor?.toLocaleString('es-CO') ?? '—'}</span>
                          <span>{l.valorHora == null ? '—' : fmtCOP(Math.round(l.valorHora * l.factor))}</span>
                          <span className="val-money">{l.valor == null ? 'sin salario' : fmtCOP(l.valor)}</span>
                        </div>
                      ))}
                      <div className="sim-row total" role="row">
                        <span>Total</span>
                        <span>{fmtHoras(totalHoras)}</span>
                        <span />
                        <span />
                        <span className="val-money">{salario == null ? 'sin salario' : fmtCOP(totalValor)}</span>
                      </div>
                    </div>
                    <p className="cfg-note">
                      Cada línea es hora ordinaria × factor × horas, redondeado al peso.
                    </p>
                  </div>
                )}

                {/* ── Parte 2: CLASIFICACIÓN ──
                    Aquí no se dice qué código es: se escribe un turno y el
                    motor decide, igual que con una marcación real. */}
                <div className="cfg-group">
                  <h3>Turno → categorías</h3>
                  <p className="cfg-note" style={{ marginTop: 0, marginBottom: 10 }}>
                    Escribe un turno y mira en qué códigos lo parte el sistema.
                  </p>
                  <div className="cfg-row">
                    <label htmlFor="sim-fecha">
                      Día
                      <small>{diaSimulado.etiqueta}</small>
                    </label>
                    <div className="cfg-input">
                      <input id="sim-fecha" type="date" className="cfg-time" value={simTurno.fecha}
                        onChange={(e) => e.target.value && setSimTurno({ ...simTurno, fecha: e.target.value })} />
                    </div>
                  </div>
                  <div className="cfg-row">
                    <label htmlFor="sim-entrada">Entrada</label>
                    <div className="cfg-input">
                      <input id="sim-entrada" type="time" className="cfg-time" value={simTurno.entrada}
                        onChange={(e) => e.target.value && setSimTurno({ ...simTurno, entrada: e.target.value })} />
                    </div>
                  </div>
                  <div className="cfg-row">
                    <label htmlFor="sim-salida">
                      Salida
                      <small>{turnoSim.cruzaMedianoche ? 'Cruza medianoche: termina al día siguiente.' : `Turno de ${fmtHoras(turnoSim.duracion)}`}</small>
                    </label>
                    <div className="cfg-input">
                      <input id="sim-salida" type="time" className="cfg-time" value={simTurno.salida}
                        onChange={(e) => e.target.value && setSimTurno({ ...simTurno, salida: e.target.value })} />
                    </div>
                  </div>
                  <div className="cfg-row">
                    <label htmlFor="sim-jornada">
                      Jornada pactada del día
                      <small>Vacío = la legal ({fmtHoras((cfg.weeklyHours ?? 42) / 6)}).</small>
                    </label>
                    <div className="cfg-input">
                      <input id="sim-jornada" type="number" min="0" max="12" step="0.5" placeholder="—"
                        value={simTurno.jornada}
                        onChange={(e) => setSimTurno({ ...simTurno, jornada: e.target.value })} /> h
                    </div>
                  </div>

                  {turnoSim.tramos.length === 0 ? (
                    <p className="cfg-note">
                      {turnoSim.duracion <= 0
                        ? 'Turno vacío.'
                        : `Sin horas extra: ${fmtHoras(turnoSim.duracion)} no superan la jornada del día.`}
                    </p>
                  ) : (
                    <>
                      <div className="sim-table" role="table">
                        <div className="sim-row head" role="row">
                          <span>Código</span><span>Desde</span><span>Hasta</span><span>Horas</span><span className="val-money">Valor</span>
                        </div>
                        {turnoSim.tramos.map((t) => (
                          <div className="sim-row" role="row" key={t.referenciaExterna}>
                            <span><code>{t.tipoHora}</code></span>
                            <span>{t.horaInicio}</span>
                            <span>{t.horaFin}</span>
                            <span>{fmtHoras(t.horas)}</span>
                            <span className="val-money">{t.valor == null ? '—' : fmtCOP(t.valor)}</span>
                          </div>
                        ))}
                        <div className="sim-row total" role="row">
                          <span>Total</span><span /><span />
                          <span>{fmtHoras(turnoSim.tramos.reduce((s, t) => s + t.horas, 0))}</span>
                          <span className="val-money">
                            {turnoSim.tramos.some((t) => t.valor == null)
                              ? 'sin salario'
                              : fmtCOP(turnoSim.tramos.reduce((s, t) => s + t.valor, 0))}
                          </span>
                        </div>
                      </div>
                      <p className="cfg-note">
                        Franja nocturna {cfg.nocturnoInicio ?? '21:00'}–{cfg.nocturnoFin ?? '06:00'}.
                        Los tramos de menos de 0,5 h se descartan.
                      </p>
                    </>
                  )}
                </div>
              </div>
            </section>
          );
        })()}

        {tab === 'cfg-reglamento' && (
          <section className="card grow">
            <button className="btn back-btn" onClick={() => setTab('ajustes')}>‹ Ajustes</button>
            <h2>Reglamento laboral</h2>
            <p className="hint">Horas extra y puntualidad.</p>
            <div className="scrollable">
              <div className="cfg-group">
                <div className="cfg-row">
                  <label htmlFor="cfg-week">
                    Jornada legal semanal
                    <small>En Colombia, 42 h (Ley 2101).</small>
                  </label>
                  <div className="cfg-input">
                    <input
                      id="cfg-week" type="number" min="1" max="84" value={cfg.weeklyHours ?? 42}
                      onChange={(e) => { const v = Number(e.target.value); if (v > 0) updateCfg({ weeklyHours: v }); }}
                    /> h
                  </div>
                </div>
                <div className="cfg-row">
                  <label htmlFor="cfg-grace">
                    Gracia de puntualidad
                    <small>Minutos de tolerancia antes de contar tardanza.</small>
                  </label>
                  <div className="cfg-input">
                    <input
                      id="cfg-grace" type="number" min="0" max="120" value={cfg.graceMinutes}
                      onChange={(e) => { const v = Number(e.target.value); if (v >= 0) updateCfg({ graceMinutes: v }); }}
                    /> min
                  </div>
                </div>
              </div>

              <div className="cfg-group">
                <h3>Días festivos y dominicales</h3>
                <p className="cfg-note">
                  Los festivos oficiales de Colombia (Ley 51 de 1983, con traslado al lunes) se
                  calculan solos. Agrega aquí únicamente los decretados aparte o los días que tu
                  empresa trate como festivos.
                </p>
                <div className="holiday-add">
                  <input type="date" value={newHoliday} onChange={(e) => setNewHoliday(e.target.value)} aria-label="Nuevo festivo" />
                  <button
                    className="btn primary"
                    disabled={!newHoliday || (cfg.holidays ?? []).includes(newHoliday)}
                    onClick={() => { updateCfg({ holidays: [...(cfg.holidays ?? []), newHoliday].sort() }); setNewHoliday(''); }}
                  >
                    ＋ Agregar
                  </button>
                </div>
                <div className="holiday-list">
                  {(cfg.holidays ?? []).map((d) => (
                    <span className="holiday-chip" key={d}>
                      {new Date(d + 'T12:00:00').toLocaleDateString('es-CO', { day: 'numeric', month: 'short', year: '2-digit' })}
                      <button aria-label={`Quitar festivo ${d}`}
                        onClick={() => updateCfg({ holidays: (cfg.holidays ?? []).filter((x) => x !== d) })}>✕</button>
                    </span>
                  ))}
                </div>
              </div>
            </div>
          </section>
        )}

        {/* ── Sub-pantalla: CRUD de sedes ── */}
        {tab === 'cfg-sedes' && (
          <section className="card grow">
            <h2>Sedes <span className="muted-count">{sedes.length}</span></h2>
            <p className="hint">Toca una sede para editarla.</p>
            <div className="att-controls">
              <button className="btn primary" onClick={() => setNewSedeOpen(true)}>Nueva sede</button>
            </div>
            <div className="scrollable">
              {(() => {
                const openEdit = (o) => setEditSede({ original: o.name, name: o.name, lat: String(o.lat), lon: String(o.lon), radius: String(o.radius) });
                return (
                  <>
                    <div className="att-tablewrap">
                      <table className="att-table">
                        <thead>
                          <tr><th>Sede</th><th>Latitud</th><th>Longitud</th><th>Radio</th><th>Empleados</th></tr>
                        </thead>
                        <tbody>
                          {sedes.map((o) => (
                            <tr key={o.name} onClick={() => openEdit(o)} tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && openEdit(o)}>
                              <td className="att-name">{o.name}</td>
                              <td>{o.lat.toFixed(6)}</td>
                              <td>{o.lon.toFixed(6)}</td>
                              <td>{o.radius} m</td>
                              <td className="att-sede">{allPeople.filter((p) => p.sede === o.name).length}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    <AccList
                      items={sedes.map((o) => ({
                        id: o.name,
                        title: o.name,
                        right: <span className="acc-note">{allPeople.filter((p) => p.sede === o.name).length} empleados</span>,
                        fields: [
                          ['Latitud', o.lat.toFixed(6)],
                          ['Longitud', o.lon.toFixed(6)],
                          ['Radio GPS', `${o.radius} m`],
                        ],
                        actions: <button className="btn primary block" onClick={() => openEdit(o)}>Editar</button>,
                      }))}
                    />
                  </>
                );
              })()}

            </div>
          </section>
        )}
      </div>

      {navOpen && <div className="nav-scrim" onClick={() => setNavOpen(false)} />}
      <nav className="tabbar" aria-label="Navegación del panel">
        {/* Cabecera del menú lateral (solo PC): logo + nombre + botón esconder */}
        <div className="side-top">
          <span className="logo" aria-hidden="true"><MarcaCDial size={22} /></span>
          <span className="side-brand">
            CONTROL<b>REGISTRO</b>
            <small>Panel de administración</small>
          </span>
          <button
            className="collapse-btn"
            onClick={() => setCollapsed((c) => !c)}
            aria-label={collapsed ? 'Mostrar menú' : 'Esconder menú'}
            title={collapsed ? 'Mostrar menú' : 'Esconder menú'}
          >
            <Icon name={collapsed ? 'chevronRight' : 'chevronLeft'} size={15} />
          </button>
        </div>

        {/* Filtro global de sede (arriba del menú): aplica a todas las vistas */}
        {sedeChips}

        {tabs.map((t) => (
          <button
            key={t.id}
            aria-pressed={tab === t.id || (t.id === 'ajustes' && enAjustes)}
            onClick={() => { if (t.alClic) t.alClic(); else setTab(t.id); setNavOpen(false); t.alAbrir?.(); }}
            title={t.label}
          >
            <span className="icon"><Icon name={t.icon} /></span>
            <span className="lbl">{t.label}</span>
            {t.badge ? <span className="badge">{t.badge}</span> : null}
          </button>
        ))}

        {/* La sesión (avatar, correo, cerrar sesión) vive ahora en la barra
            superior; el menú queda solo para navegar. */}

      </nav>

      {/* Drawer de detalle: marcaciones de una persona en un día, editables */}
      {drawer && (
        <div className="overlay right" onClick={(e) => e.target === e.currentTarget && setDrawer(null)}>
          <aside className="drawer" role="dialog" aria-modal="true" aria-label={`Marcaciones de ${drawer.personName}`}>
            <div className="drawer-head">
              <div>
                <h3>{drawer.personName}</h3>
                <span className="drawer-id">{drawer.personId}</span>
              </div>
              <button className="btn" onClick={() => setDrawer(null)}>Cerrar</button>
            </div>

            {/* Rango de días + total del rango */}
            <div className="drawer-day">
              <input
                type="date" value={drawer.desde} max={drawer.hasta} aria-label="Desde"
                onChange={(e) => { setDrawer({ ...drawer, desde: e.target.value }); setEvForm(null); }}
              />
              <span className="range-sep">–</span>
              <input
                type="date" value={drawer.hasta} min={drawer.desde} max={todayKey()} aria-label="Hasta"
                onChange={(e) => { setDrawer({ ...drawer, hasta: e.target.value }); setEvForm(null); }}
              />
              <span className="drawer-hours">{fmtH(pairedHours(drawerEvents, Date.now(), drawerPersona))}</span>
            </div>

            <div className="drawer-body">
              {drawerDias.length === 0 && <p className="empty">Sin marcaciones en este rango.</p>}

              {/* El formulario de ajuste se renderiza EN CONTEXTO: bajo la
                  marcación que se edita, o al final del día donde se agrega. */}
              {(() => {
                const formularioEv = evForm && (
                  <div className="ev-form">
                    <h4>{evForm.mode === 'edit' ? 'Editar marcación' : 'Nueva marcación'}</h4>
                    <div className="ev-form-row">
                      {/* El campo Día solo aparece al agregar "en otro día" (botón
                          de abajo); dentro del acordeón el día ya está implícito. */}
                      {evForm.conFecha && (
                        <label>Día
                          <input type="date" value={evForm.fecha} max={todayKey()} onChange={(e) => setEvForm({ ...evForm, fecha: e.target.value })} />
                        </label>
                      )}
                      <label>Tipo
                        <select value={evForm.type} onChange={(e) => setEvForm({ ...evForm, type: e.target.value })}>
                          <option value="in">Entrada</option>
                          <option value="out">Salida</option>
                        </select>
                      </label>
                      <label>Hora
                        <input type="time" value={evForm.time} onChange={(e) => setEvForm({ ...evForm, time: e.target.value })} />
                      </label>
                    </div>
                    <label className="ev-form-reason">Motivo
                      <input
                        type="text" placeholder="Ej.: olvidó marcar la salida" value={evForm.reason}
                        onChange={(e) => setEvForm({ ...evForm, reason: e.target.value })}
                        autoFocus
                      />
                    </label>
                    <div className="dialog-actions">
                      <button className="btn" onClick={() => setEvForm(null)}>Cancelar</button>
                      <button className="btn primary" disabled={!evForm.reason.trim()} onClick={saveEvForm}>Guardar</button>
                    </div>
                  </div>
                );
                const persona = listPeople().find((p) => p.id === drawer.personId);
                const hh = (ts) => fmt12(ts).replace(/ [ap]\. m\./, '');

                return (
                  <>
                    {drawerDias.map((d) => {
                      const abierto = openDia === d.fecha;
                      // (+X) = exceso sobre la jornada del día — la MISMA regla
                      // con que nómina liquida la extra, no el horario esperado.
                      const exceso = Math.max(0, d.horas - jornadaDelDia(persona, d.fecha));
                      // Bloques como CHIPS (envuelven a varias líneas: soporta
                      // cualquier número de pares sin superponerse).
                      const bloques = [];
                      for (let i = 0; i < d.evs.length; i++) {
                        if (d.evs[i].type === 'in' && d.evs[i + 1]?.type === 'out') {
                          bloques.push({ txt: `${hh(d.evs[i].ts)}–${hh(d.evs[i + 1].ts)}` });
                          i++;
                        } else {
                          bloques.push({ txt: `${d.evs[i].type === 'in' ? 'E' : 'S'} ${hh(d.evs[i].ts)}`, warn: true });
                        }
                      }
                      return (
                        <div className={`dia${abierto ? ' abierto' : ''}`} key={d.fecha}>
                          <button className="dia-row" aria-expanded={abierto} onClick={() => { setOpenDia(abierto ? null : d.fecha); setEvForm(null); }}>
                            <span className="dia-top">
                              <span className="dia-fecha">
                                {new Date(`${d.fecha}T12:00:00`).toLocaleDateString('es-CO', { weekday: 'short', day: 'numeric', month: 'short' })}
                              </span>
                              <span className={`dia-horas${exceso > 0.05 ? ' extra' : ''}`}>
                                {fmtH(d.horas)}
                                {exceso > 0.05 && <em className="dia-exceso"> (+{fmtH(exceso)})</em>}
                              </span>
                              <span className="dia-chev">›</span>
                            </span>
                            <span className="dia-bloques">
                              {bloques.length === 0 && <span className="bloque">—</span>}
                              {bloques.map((b, i) => (
                                <span key={i} className={`bloque${b.warn ? ' warn' : ''}`}>{b.txt}{b.warn ? ' ⚠' : ''}</span>
                              ))}
                            </span>
                          </button>

                          {abierto && (
                            <div className="dia-detalle">
                              {d.evs.map((e, i) => {
                                // Mismo criterio que los bloques ⚠ de arriba y que el
                                // resaltado de Asistencia: marcación con bandera
                                // (tardía / salida temprana) o entrada sin su salida.
                                const novedad = e.flag === 'late-entry' || e.flag === 'early-exit'
                                  || (e.type === 'in' && d.evs[i + 1]?.type !== 'out');
                                return (
                                <div key={e.id}>
                                  <div className={`tl-row${novedad ? ' con-novedad' : ''}`}>
                                    <span className={`tl-type ${e.type}`}>{e.type === 'in' ? 'Entrada' : 'Salida'}</span>
                                    <span className="tl-time">{fmt12(e.ts)}</span>
                                    <span className="tl-flag">
                                      {e.flag === 'manual' ? 'manual' : e.flag === 'corrected' ? 'corregida' : e.flag === 'late-entry' ? 'tardía' : 'kiosco'}
                                    </span>
                                    <span className="tl-actions">
                                      <button
                                        className="btn small"
                                        onClick={() => {
                                          const dt = new Date(new Date(e.ts).getTime() - 5 * 3600000); // hora Bogotá
                                          setEvForm({ mode: 'edit', eventId: e.id, fecha: d.fecha, type: e.type, time: `${String(dt.getUTCHours()).padStart(2, '0')}:${String(dt.getUTCMinutes()).padStart(2, '0')}`, reason: '' });
                                        }}
                                      >
                                        Editar
                                      </button>
                                      <button className="btn small danger-btn" onClick={() => removeEv(e)}>Eliminar</button>
                                    </span>
                                  </div>
                                  {/* Desde dónde se marcó. Solo aparece si el
                                      empleado tiene «validar ubicación»: sin
                                      eso el kiosco no guarda el punto. */}
                                  {e.lat != null && e.lon != null && (
                                    <a
                                      className="tl-lugar"
                                      href={`https://www.google.com/maps?q=${e.lat},${e.lon}`}
                                      target="_blank" rel="noreferrer"
                                      title="Abrir en Google Maps"
                                    >
                                      <Icon name="pin" size={12} />
                                      {e.direccion || `${Number(e.lat).toFixed(5)}, ${Number(e.lon).toFixed(5)}`}
                                      {e.precision != null && <em>±{Math.round(e.precision)} m</em>}
                                    </a>
                                  )}
                                  {/* El formulario de edición, JUSTO bajo la marcación editada */}
                                  {evForm?.mode === 'edit' && evForm.eventId === e.id && formularioEv}
                                  {/* (el alta con fecha libre —conFecha— se pinta abajo, no aquí) */}
                                </div>
                                );
                              })}

                              {/* Alta manual: el formulario aparece bajo el botón, dentro del día */}
                              {evForm?.mode === 'add' && !evForm.conFecha && evForm.fecha === d.fecha
                                ? formularioEv
                                : (
                                  <button className="btn small block" onClick={() => setEvForm({ mode: 'add', fecha: d.fecha, type: d.evs.length % 2 === 0 ? 'in' : 'out', time: '08:00', reason: '' })}>
                                    Agregar marcación
                                  </button>
                                )}
                            </div>
                          )}
                        </div>
                      );
                    })}

    {/* Alta con fecha libre: el formulario vive AQUÍ abajo siempre que
                        se abrió desde este botón — antes, si la fecha elegida ya
                        tenía un día en la lista, solo se pintaba dentro de su
                        acordeón (cerrado) y parecía que el botón no hacía nada. */}
                    {evForm?.mode === 'add' && evForm.conFecha ? formularioEv : null}
                    {!evForm && (
                      <button className="btn block" onClick={() => setEvForm({ mode: 'add', conFecha: true, fecha: drawer.hasta, type: 'in', time: '08:00', reason: '' })}>
                        Agregar marcación en otro día
                      </button>
                    )}
                  </>
                );
              })()}
            </div>
          </aside>
        </div>
      )}

      {/* Drawer de crear/editar horario: mismo cajón lateral que el resto
          (registrar empleado, sedes), en vez de un formulario en el sitio. */}
      {horForm && (
        <div className="overlay right" onClick={(e) => e.target === e.currentTarget && setHorForm(null)}>
          <aside className="drawer" role="dialog" aria-modal="true" aria-label={horForm.id ? `Editar horario ${horForm.nombre}` : 'Crear horario'}>
            <div className="drawer-head">
              <div>
                <h3>{horForm.id ? 'Editar horario' : 'Crear horario'}</h3>
                <span className="drawer-id">Cada día con su franja, o libre</span>
              </div>
              <button className="btn" onClick={() => setHorForm(null)}>Cerrar</button>
            </div>
            <div className="drawer-body">
              <div className="field">
                <label htmlFor="h-nombre">Nombre</label>
                <input
                  id="h-nombre" type="text" placeholder="Ej.: Administrativo, Turno tarde"
                  value={horForm.nombre} onChange={(e) => setHorForm({ ...horForm, nombre: e.target.value })}
                />
              </div>
              <EditorDias dias={horForm.dias} onChange={(dias) => setHorForm({ ...horForm, dias })} />
              <div className="hd-resumen">
                <span>Horas por semana</span>
                <b>{fmtHM(horasSemanaDias(horForm.dias))}</b>
              </div>
              <div className="dialog-actions">
                <button className="btn" onClick={() => setHorForm(null)}>Cancelar</button>
                <button
                  className="btn primary"
                  disabled={!horForm.nombre.trim() || Object.keys(horForm.dias).length === 0}
                  onClick={async () => {
                    const datos = { nombre: horForm.nombre.trim(), dias: horForm.dias };
                    const r = horForm.id ? await updateHorario(horForm.id, datos) : await addHorario(datos);
                    if (r.error) { showToast(r.error); return; }
                    setHorForm(null);
                    refresh();
                    showToast(horForm.id ? 'Horario actualizado' : `Horario «${datos.nombre}» creado`);
                  }}
                >
                  {horForm.id ? 'Guardar cambios' : 'Crear horario'}
                </button>
              </div>

              {horForm.id && (
                <div className="danger-zone">
                  <button
                    className="btn danger-btn block"
                    onClick={async () => {
                      if (!confirm(`¿Eliminar el horario «${horForm.nombre}»? Los empleados que lo tenían conservan su jornada.`)) return;
                      const r = await removeHorario(horForm.id);
                      if (r.error) { showToast(r.error); return; }
                      setHorForm(null);
                      refresh();
                      showToast('Horario eliminado');
                    }}
                  >
                    Eliminar horario
                  </button>
                </div>
              )}
            </div>
          </aside>
        </div>
      )}

      {/* Drawer de nueva sede */}
      {newSedeOpen && (
        <div className="overlay right" onClick={(e) => e.target === e.currentTarget && setNewSedeOpen(false)}>
          <aside className="drawer" role="dialog" aria-modal="true" aria-label="Nueva sede">
            <div className="drawer-head">
              <div>
                <h3>Nueva sede</h3>
                <span className="drawer-id">Coordenadas y radio GPS</span>
              </div>
              <button className="btn" onClick={() => setNewSedeOpen(false)}>Cerrar</button>
            </div>
            <div className="drawer-body">
              <p className="hint">En Google Maps: clic derecho sobre el punto → copiar coordenadas.</p>
              <div className="field">
                <label htmlFor="n-nombre">Nombre</label>
                <input id="n-nombre" type="text" placeholder="Ej.: Bodega Norte" value={newSede.name} onChange={(e) => setNewSede({ ...newSede, name: e.target.value })} />
              </div>
              <div className="field">
                <label htmlFor="n-lat">Latitud</label>
                <input id="n-lat" type="number" step="0.000001" placeholder="1.212981" value={newSede.lat}
                  onChange={(e) => setNewSede({ ...newSede, lat: e.target.value })}
                  onPaste={(e) => pegarCoord(e, 'lat', newSede, setNewSede)} onWheel={soltarRueda} />
              </div>
              <div className="field">
                <label htmlFor="n-lon">Longitud</label>
                <input id="n-lon" type="number" step="0.000001" placeholder="-77.280157" value={newSede.lon}
                  onChange={(e) => setNewSede({ ...newSede, lon: e.target.value })}
                  onPaste={(e) => pegarCoord(e, 'lon', newSede, setNewSede)} onWheel={soltarRueda} />
              </div>
              <div className="field">
                <label htmlFor="n-radio">Radio GPS (metros)</label>
                <input id="n-radio" type="number" min="10" max="1000" value={newSede.radius} onChange={(e) => setNewSede({ ...newSede, radius: e.target.value })} onWheel={soltarRueda} />
              </div>
              <div className="dialog-actions">
                <button className="btn" onClick={() => setNewSedeOpen(false)}>Cancelar</button>
                <button
                  className="btn primary"
                  disabled={!newSede.name.trim() || newSede.lat === '' || newSede.lon === ''}
                  onClick={async () => {
                    const lat = Number(newSede.lat);
                    const lon = Number(newSede.lon);
                    if (!Number.isFinite(lat) || Math.abs(lat) > 90 || !Number.isFinite(lon) || Math.abs(lon) > 180) {
                      showToast('Coordenadas inválidas: latitud entre -90 y 90, longitud entre -180 y 180. Copia el par completo desde Google Maps y pégalo en cualquiera de los dos campos.');
                      return;
                    }
                    const r = await addSede({ name: newSede.name, lat, lon, radius: Number(newSede.radius) || 50 });
                    if (r.error) { showToast(r.error); return; }
                    setNewSede({ name: '', lat: '', lon: '', radius: '50' });
                    setNewSedeOpen(false);
                    refresh();
                    showToast(`Sede "${r.name}" creada`);
                  }}
                >
                  Guardar sede
                </button>
              </div>
            </div>
          </aside>
        </div>
      )}

      {/* Diálogo de edición de sede (incluye renombrar, propagando al roster) */}
      {editSede && (
        <div className="overlay right" onClick={(e) => e.target === e.currentTarget && setEditSede(null)}>
          <aside className="drawer" role="dialog" aria-modal="true" aria-label={`Editar sede ${editSede.original}`}>
            <div className="drawer-head">
              <div>
                <h3>Editar sede</h3>
                <span className="drawer-id">{editSede.original}</span>
              </div>
              <button className="btn" onClick={() => setEditSede(null)}>Cerrar</button>
            </div>
            <div className="drawer-body">
            <p className="hint">Al renombrar, los empleados se actualizan solos.</p>
            <div className="field">
              <label htmlFor="s-nombre">Nombre</label>
              <input id="s-nombre" type="text" value={editSede.name} onChange={(e) => setEditSede({ ...editSede, name: e.target.value })} />
            </div>
            <div className="field">
              <label htmlFor="s-lat">Latitud</label>
              <input id="s-lat" type="number" step="0.000001" value={editSede.lat}
                onChange={(e) => setEditSede({ ...editSede, lat: e.target.value })}
                onPaste={(e) => pegarCoord(e, 'lat', editSede, setEditSede)} onWheel={soltarRueda} />
            </div>
            <div className="field">
              <label htmlFor="s-lon">Longitud</label>
              <input id="s-lon" type="number" step="0.000001" value={editSede.lon}
                onChange={(e) => setEditSede({ ...editSede, lon: e.target.value })}
                onPaste={(e) => pegarCoord(e, 'lon', editSede, setEditSede)} onWheel={soltarRueda} />
            </div>
            <div className="field">
              <label htmlFor="s-radio">Radio GPS (metros)</label>
              <input id="s-radio" type="number" min="10" max="1000" value={editSede.radius} onChange={(e) => setEditSede({ ...editSede, radius: e.target.value })} onWheel={soltarRueda} />
            </div>
            <div className="dialog-actions">
              <button className="btn" onClick={() => setEditSede(null)}>Cancelar</button>
              <button
                className="btn primary"
                disabled={!editSede.name.trim() || editSede.lat === '' || editSede.lon === ''}
                onClick={async () => {
                  const name = editSede.name.trim();
                  const lat = Number(editSede.lat);
                  const lon = Number(editSede.lon);
                  const radius = Number(editSede.radius) || 50;
                  if (!Number.isFinite(lat) || Math.abs(lat) > 90 || !Number.isFinite(lon) || Math.abs(lon) > 180) {
                    showToast('Coordenadas inválidas'); return;
                  }
                  if (name !== editSede.original && sedes.some((s) => s.name.toLowerCase() === name.toLowerCase())) {
                    showToast(`Ya existe una sede llamada "${name}"`); return;
                  }
                  const r = await updateSede(editSede.original, { name, lat, lon, radius });
                  if (r.error) { showToast(r.error); return; }
                  // Renombrado: los empleados referencian la sede por ID en la
                  // base de datos, así que no hay nada que propagar; solo se
                  // actualiza el filtro activo si apuntaba al nombre viejo.
                  if (name !== editSede.original && sedeFilter === editSede.original) setSedeFilter(name);
                  setEditSede(null);
                  refresh();
                  showToast('Sede actualizada');
                }}
              >
                Guardar cambios
              </button>
            </div>

            <div className="danger-zone">
              <button
                className="btn danger-btn block"
                onClick={async () => {
                  if (!confirm(`¿Eliminar "${editSede.original}"? Sus empleados quedarán sin sede.`)) return;
                  const r = await removeSede(editSede.original);
                  if (r.error) { showToast(r.error); return; }
                  if (sedeFilter === editSede.original) setSedeFilter('all');
                  setEditSede(null);
                  refresh();
                  showToast(`Sede "${editSede.original}" eliminada`);
                }}
              >
                Eliminar sede
              </button>
            </div>
            </div>
          </aside>
        </div>
      )}

      {/* Diálogo de edición de empleado (CRUD: actualizar datos no biométricos) */}
      {editEmp && (() => {
        // Todo lo DERIVADO se calcula una vez aquí: son consecuencias de lo que
        // se está escribiendo, y por eso se muestran como cifras al lado del
        // campo y no como una frase suelta debajo.
        const salario = Number(String(editEmp.salarioMensual).replace(/\D/g, '')) || 0;
        const divisor = cfg.divisorHorasMes || DIVISOR_210;
        const valorHora = salario > 0 ? salario / divisor : null;
        const iniciales = editEmp.name.trim().split(/\s+/).slice(0, 2).map((p) => p[0] ?? '').join('').toUpperCase();

        return (
        <div className="overlay right" onClick={(e) => e.target === e.currentTarget && setEditEmp(null)}>
          <aside className="drawer ficha" role="dialog" aria-modal="true" aria-label={`Editar empleado ${editEmp.name}`}>

            {/* Cabecera: el nombre y cómo se identifica a alguien al hablar
                (cédula y sede). El id interno no ocupa el mejor sitio. */}
            <div className="ficha-head">
              <span className="ficha-avatar" aria-hidden="true">{iniciales || '—'}</span>
              <div className="ficha-quien">
                <h3>{editEmp.name.trim() || 'Empleado'}</h3>
                <span className="ficha-sub">
                  {editEmp.cedula ? `C.C. ${Number(editEmp.cedula).toLocaleString('es-CO')}` : 'sin cédula'}
                  {editEmp.sede ? ` · ${editEmp.sede}` : ''}
                </span>
              </div>
              <button className="btn" onClick={() => setEditEmp(null)}>Cerrar</button>
            </div>

            <div className="drawer-body ficha-body">

              <section className="ficha-sec">
                <div className="ficha-fila dos">
                  <div className="field">
                    <label htmlFor="e-nombre">Nombre completo</label>
                    <input id="e-nombre" type="text" value={editEmp.name}
                      onChange={(e) => setEditEmp({ ...editEmp, name: e.target.value })} />
                  </div>
                  <div className="field">
                    <label htmlFor="e-cedula">Cédula</label>
                    <input id="e-cedula" className="num" type="text" inputMode="numeric" value={editEmp.cedula}
                      onChange={(e) => setEditEmp({ ...editEmp, cedula: e.target.value.replace(/\D/g, '') })} />
                  </div>
                </div>
                {/* Fila propia: el correo es más largo que nombre/cédula y en
                    media columna se cortaba. */}
                <div className="ficha-fila">
                  <div className="field">
                    <label htmlFor="e-correo">Correo</label>
                    <input id="e-correo" type="email" placeholder="ana@correo.com" value={editEmp.correo}
                      onChange={(e) => setEditEmp({ ...editEmp, correo: e.target.value })} />
                    <small className="field-hint">Recibirá el comprobante de cada entrada y salida. Vacío = no se envía.</small>
                  </div>
                </div>
                {/* El rostro es un ESTADO, no una instrucción suelta: lo primero
                    que se quiere saber es si esta persona puede marcar. Y las
                    fotos se agregan AQUÍ: pedir otra vez cédula, horario y
                    correo solo para sumar una foto no tenía sentido. */}
                <div className="ficha-estado">
                  <span className={`ficha-punto${rostros.length > 0 ? '' : ' apagado'}`} />
                  <span>
                    <b>
                      {rostros.length === 0 ? 'Sin rostro'
                        : rostros.length === 1 ? '1 rostro registrado'
                          : `${rostros.length} rostros registrados`}
                    </b>
                  </span>
                  <Q texto={rostros.length === 0
                    ? 'No podrá marcar en el kiosco hasta que se le registre un rostro.'
                    : 'Al marcar se compara contra el más parecido de sus rostros. Con varias fotos (distinta luz, con y sin gafas) lo reconoce mejor y es más difícil confundirlo con otra persona.'} />
                  <input ref={rostroFileRef} type="file" accept="image/*" multiple hidden
                    onChange={(e) => agregarFotos(editEmp.id, e)} />
                  <button className="btn small" disabled={rostroOcupado} onClick={() => rostroFileRef.current?.click()}>
                    {rostroOcupado ? 'Analizando…' : '＋ Agregar foto'}
                  </button>
                </div>
                {rostros.length > 0 && (
                  <div className="ficha-rostros">
                    {rostros.map((r, i) => (
                      <span className="ficha-rostro" key={r.id}>
                        Rostro {i + 1}
                        <em>{new Date(r.creado_en).toLocaleDateString('es-CO', { day: 'numeric', month: 'short' })}</em>
                        {rostros.length > 1 && (
                          <button title="Quitar este rostro" onClick={async () => {
                            const res = await quitarRostro(editEmp.id, r.id);
                            if (res.error) { showToast(res.error); return; }
                            setRostros(await listarRostros(editEmp.id));
                            showToast('Rostro quitado');
                          }}>×</button>
                        )}
                      </span>
                    ))}
                  </div>
                )}
                {rostros.length === 1 && (
                  <small className="field-hint">
                    Con una sola foto el kiosco puede confundirlo con otra persona. Agrega dos más,
                    tomadas con distinta luz y la cara grande en el encuadre.
                  </small>
                )}
              </section>

              <section className="ficha-sec">
                <div className="ficha-fila dos">
                  <div className="field">
                    <label htmlFor="e-sede">Sede asignada</label>
                    <select
                      id="e-sede" value={editEmp.sede}
                      onChange={(e) => setEditEmp({ ...editEmp, sede: e.target.value })}
                    >
                      <option value="">Sin sede</option>
                      {sedes.map((o) => <option key={o.name} value={o.name}>{o.name}</option>)}
                    </select>
                    <label className="consent">
                      <input
                        type="checkbox" checked={editEmp.validarSede}
                        onChange={(e) => setEditEmp({ ...editEmp, validarSede: e.target.checked })}
                      />{' '}
                      ¿Limitar ubicación?
                      <Q texto="Solo puede marcar dentro del radio de su sede asignada (el GPS comprueba el rango, sin guardar el punto). Sin sede no tiene efecto." />
                    </label>
                    <label className="consent">
                      <input
                        type="checkbox" checked={editEmp.validarUbicacion}
                        onChange={(e) => setEditEmp({ ...editEmp, validarUbicacion: e.target.checked })}
                      />{' '}
                      ¿Validar ubicación?
                      <Q texto="Guarda el punto GPS exacto (y su dirección) de cada marcación, para saber desde dónde marcó. Aplica con o sin sede." />
                    </label>
                  </div>
                  {horarios.length > 0 && (
                    <div className="field">
                      <label htmlFor="e-horario">Horario</label>
                      <select
                        id="e-horario" value=""
                        onChange={(e) => {
                          const h = horarios.find((x) => x.id === e.target.value);
                          // Asignar copia el mapa POR DÍAS completo a la ficha;
                          // desde ahí es editable como una variación personal.
                          if (h) setEditEmp({ ...editEmp, jornadaDias: JSON.parse(JSON.stringify(h.dias)) });
                        }}
                      >
                        <option value="">Asignar un horario…</option>
                        {horarios.map((h) => (
                          <option key={h.id} value={h.id}>{h.nombre} ({resumenDias(h.dias)})</option>
                        ))}
                      </select>
                    </div>
                  )}
                </div>

                {/* La jornada SIEMPRE sale de una plantilla de la pestaña
                    Horarios: aquí solo se elige, no se edita por días. */}
                {editEmp.jornadaDias ? (
                  <div className="hd-resumen">
                    <span>{resumenDias(editEmp.jornadaDias)}</span>
                    <b>{fmtHM(horasSemanaDias(editEmp.jornadaDias))} / semana</b>
                  </div>
                ) : (
                  <p className="hint">
                    Sin horario asignado
                    <Q texto="Elige una plantilla en «Asignar un horario…». Los horarios se crean y editan en su pestaña; la jornada del empleado siempre sale de una plantilla." />
                  </p>
                )}
              </section>

              <section className="ficha-sec">
                {/* Se escribe con separadores de miles: seis ceros seguidos se
                    cuentan con el dedo. Al guardar se limpian los puntos. */}
                <div className="field con-prefijo">
                  <label htmlFor="e-salario">
                    Salario mensual <span className="libre">opcional</span>
                    <Q texto="Sirve para valorizar sus horas extra en pesos. Sin salario, las horas se cuentan pero no se valorizan." />
                  </label>
                  <input
                    id="e-salario" className="num" type="text" inputMode="numeric"
                    placeholder="Sin registrar"
                    value={salario > 0 ? salario.toLocaleString('es-CO') : ''}
                    onChange={(e) => setEditEmp({ ...editEmp, salarioMensual: e.target.value.replace(/\D/g, '') })}
                  />
                  <span className="prefijo">$</span>
                </div>
                {valorHora ? (
                  <div className="derivado">
                    <div><span className="k">Hora ordinaria</span><span className="v">{fmtCOP(Math.round(valorHora))}</span></div>
                    {TIPOS_HORA.filter((t) => !t.dominical).map((t) => (
                      <div key={t.codigo}>
                        <span className="k">{t.nocturna ? 'Extra nocturna' : 'Extra diurna'}</span>
                        <span className="v">{fmtCOP(Math.round(valorHora * (cfg.factores?.[t.codigo] ?? t.factor)))}</span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="hint">Sin salario, sus horas se cuentan pero no se valorizan.</p>
                )}
              </section>

            </div>

            {/* Pie fijo: antes Guardar quedaba al final de un formulario que no
                cabe en pantalla. Eliminar va al lado, en gris, sin competir. */}
            <div className="ficha-pie">
              <button
                className="btn primary"
                disabled={!editEmp.name.trim()}
                onClick={async () => {
                  const r = await updatePerson(editEmp.id, {
                    name: editEmp.name,
                    cedula: editEmp.cedula,
                    correo: editEmp.correo.trim().toLowerCase() || null,
                    sede: editEmp.sede,
                    validarSede: editEmp.validarSede,
                    validarUbicacion: editEmp.validarUbicacion,
                    expectedEntry: editEmp.expectedEntry,
                    expectedExit: editEmp.expectedExit,
                    breakMinutes: editEmp.breakMinutes === '' ? null : Number(editEmp.breakMinutes),
                    jornadaDias: editEmp.jornadaDias,
                    jornadaSemanal: editEmp.jornadaSemanal == null ? null : editEmp.jornadaSemanal.map((h) => Number(h) || 0),
                    // Vacío o 0 = sin salario registrado, no un sueldo de cero.
                    salarioMensual: salario > 0 ? salario : null,
                  });
                  if (r.error) { showToast(r.error); return; }
                  setEditEmp(null);
                  refresh();
                  showToast(`${r.name} actualizado`);
                }}
              >
                Guardar cambios
              </button>
              <button
                className="btn ficha-eliminar"
                onClick={async () => {
                  if (confirm(`¿Desactivar a ${editEmp.name}? No podrá marcar asistencia, pero sus datos y su historial se conservan y podrás reactivarlo desde «Archivados». Deja de ocupar cupo del plan.`)) {
                    try {
                      await removePerson(editEmp.id);
                      setEditEmp(null);
                      refresh();
                      showToast(`${editEmp.name} desactivado (queda en Archivados)`);
                    } catch (e) {
                      showToast(`No se pudo desactivar: ${e.message}`);
                    }
                  }
                }}
              >
                Desactivar
              </button>
            </div>
          </aside>
        </div>
        );
      })()}

      {/* Cajón de registro de empleado: el formulario de /admin/registro,
          sin salir de la pestaña. */}
      {regAbierto && (
        <div className="overlay right" onClick={(e) => e.target === e.currentTarget && setRegAbierto(false)}>
          <aside className="drawer reg-drawer" role="dialog" aria-modal="true" aria-label="Registrar empleado">
            <div className="drawer-head">
              <div><h3>Registrar empleado</h3></div>
              <button className="btn" onClick={() => setRegAbierto(false)}>Cerrar</button>
            </div>
            <div className="reg-drawer-scroll">
              <RegistroEmpleadoForm
                alRegistrar={(name) => { refresh(); showToast(`${name} registrado correctamente`); }}
                irAHorarios={() => { setRegAbierto(false); setTab('horarios'); }}
              />
            </div>
          </aside>
        </div>
      )}

      {/* Guía "¿Cómo empezar?": los pasos que dejan la empresa funcionando. */}
      {guiaAbierta && (
        <div className="overlay" onClick={(e) => e.target === e.currentTarget && setGuiaAbierta(false)}>
          <div className="dialog" role="dialog" aria-modal="true" aria-label="Cómo empezar">
            <h3>¡Bienvenido a Control Registro!</h3>
            <p className="hint">Cuatro pasos y tu empresa queda marcando asistencia.</p>
            <ol className="pasos">
              <li className={horarios.length > 0 ? 'hecho' : ''}>
                <span className="paso-num">{horarios.length > 0 ? '✓' : '1'}</span>
                <span className="paso-txt">
                  <b>Crea los horarios</b>
                  <small>Las plantillas de jornada por cargo o turno. Se asignan al registrar a cada persona.</small>
                </span>
                {horarios.length === 0 && (
                  <button className="btn primary" onClick={() => { setGuiaAbierta(false); setTab('horarios'); }}>Crear horario</button>
                )}
              </li>
              <li className={sedes.length > 0 ? 'hecho' : ''}>
                <span className="paso-num">{sedes.length > 0 ? '✓' : '2'}</span>
                <span className="paso-txt">
                  <b>Crea tu primera sede <span className="libre">opcional</span></b>
                  <small>Dónde queda y su radio GPS. Sin sede, tu gente marca desde cualquier lugar.</small>
                </span>
                {sedes.length === 0 && (
                  <button className="btn primary" onClick={() => { setGuiaAbierta(false); setTab('cfg-sedes'); }}>Crear sede</button>
                )}
              </li>
              <li className={allPeople.length > 0 ? 'hecho' : horarios.length === 0 ? 'bloqueado' : ''}>
                <span className="paso-num">{allPeople.length > 0 ? '✓' : '3'}</span>
                <span className="paso-txt">
                  <b>Registra a tu gente</b>
                  <small>Con una foto por persona y su horario asignado.</small>
                </span>
                {allPeople.length === 0 && horarios.length > 0 && (
                  <button className="btn primary" onClick={() => { setGuiaAbierta(false); setTab('empleados'); setRegAbierto(true); }}>Registrar</button>
                )}
              </li>
              <li className={dispositivos.length > 0 ? 'hecho' : allPeople.length === 0 ? 'bloqueado' : ''}>
                <span className="paso-num">{dispositivos.length > 0 ? '✓' : '4'}</span>
                <span className="paso-txt">
                  <b>Vincula el dispositivo de marcación</b>
                  <small>Tablet fija en una sede, o un celular que registra desde cualquier lugar.</small>
                </span>
                {dispositivos.length === 0 && allPeople.length > 0 && (
                  <button className="btn primary" onClick={() => { setGuiaAbierta(false); setTab('cfg-dispositivos'); cargarDispositivos(); }}>Vincular</button>
                )}
              </li>
            </ol>
            <div className="dialog-actions">
              <button className="btn" onClick={() => setGuiaAbierta(false)}>Cerrar</button>
            </div>
          </div>
        </div>
      )}

      {toast && <div className="toast show" role="status">{toast}</div>}
    </div>
  );
}

const CSS = `
/* Tokens (color, tipografía, elevación) viven en app/globals.css — el sistema
   de diseño es único para toda la app. Aquí solo el layout del panel. */
.admin-root {
  font-family: var(--f-body);
  font-weight: 300;
  color: var(--ink);
  background: var(--page);
  height: 100dvh; max-width: 560px; margin: 0 auto;
  display: flex; flex-direction: column; gap: 10px;
  padding: 14px 12px 10px; box-sizing: border-box;
}
.admin-root * { box-sizing: border-box; margin: 0; }
.admin-root b, .admin-root .emp-name, .admin-root .who { font-weight: 600; }

/* Barra superior: azul de marca (var(--btn-primary), el mismo del login y la PWA).
   Móvil: hamburguesa + logo + título. PC: título + sede + sesión. */
.app-header {
  display: flex; align-items: center; gap: 10px; flex: 0 0 auto;
  background: var(--btn-primary); color: #fff; border-radius: 12px; padding: 8px 12px;
}
.menu-btn {
  flex: 0 0 auto; width: 38px; height: 38px; border-radius: 9px;
  border: 1px solid rgba(255,255,255,.25); background: transparent; color: #fff;
  display: flex; align-items: center; justify-content: center; cursor: pointer;
}
.menu-btn:active { background: rgba(255,255,255,.12); }
/* Flecha de regresar (historial interno del panel), sobre la barra acero. */
.head-back {
  flex: 0 0 auto; width: 38px; height: 38px; border-radius: 50%;
  border: 0; background: transparent; color: #fff;
  display: flex; align-items: center; justify-content: center; cursor: pointer;
}
.head-back:hover { background: rgba(255,255,255,.12); }
.head-back:active { background: rgba(255,255,255,.2); }
.head-logo {
  flex: 0 0 auto; width: 34px; height: 34px; border-radius: 9px;
  background: rgba(255,255,255,.14); color: #fff;
  display: flex; align-items: center; justify-content: center;
  font-family: var(--f-display); font-weight: 800; font-size: 13px; letter-spacing: .04em;
}
/* El título puede ENCOGERSE con elipsis: sin esto su texto se pintaba por
   encima del botón de la guía en pantallas angostas. */
.head-titles { display: flex; flex-direction: column; min-width: 0; overflow: hidden; flex: 1 1 auto; }
.head-tab { font-family: var(--f-display); font-size: 15px; font-weight: 700; color: #fff; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.app-header .date-note { color: rgba(255,255,255,.65); font-size: 11.5px; font-family: var(--f-data); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.head-right { margin-left: auto; display: flex; align-items: center; gap: 10px; position: relative; }
/* Botón de la guía en la barra: píldora translúcida sobre el azul. */
.head-guia {
  flex: 0 0 auto; font: inherit; font-size: 12.5px; font-weight: 700;
  padding: 6px 13px; border-radius: 999px;
  border: 1px solid rgba(255,255,255,.3); background: transparent; color: #fff;
  cursor: pointer; white-space: nowrap;
}
.head-guia:hover { background: rgba(255,255,255,.12); }
.head-badge {
  flex: 0 0 auto; min-width: 22px; height: 22px; border-radius: 11px;
  border: 0; background: var(--crit); color: #fff; font: inherit; font-size: 11.5px;
  font-weight: 700; display: flex; align-items: center; justify-content: center;
  padding: 0 7px; cursor: pointer;
}
/* Selector de sede dentro de la barra: solo en PC (en móvil sigue en el menú). */
.head-sede { display: none; }
.head-user { position: relative; }
.head-user-btn {
  display: flex; align-items: center; gap: 8px;
  background: transparent; border: 0; color: #fff; cursor: pointer;
  font: inherit; padding: 3px; border-radius: 999px;
}
.head-user-btn:hover, .head-user-btn[aria-expanded="true"] { background: rgba(255,255,255,.12); }
.head-user-nombre { display: none; max-width: 170px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 600; font-size: 13px; padding-right: 6px; }
.head-user-menu {
  position: absolute; top: calc(100% + 10px); right: 0; z-index: 40;
  min-width: 230px; padding: 12px 14px;
  background: var(--surface); color: var(--ink);
  border: 1px solid var(--border); border-radius: 12px; box-shadow: var(--elev-1);
  display: flex; flex-direction: column; gap: 4px; font-size: 13px;
}
.head-user-menu b { font-weight: 600; }
.head-user-menu > span { color: var(--muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.head-user-menu .lock-btn { margin-top: 8px; padding: 7px 10px; font-size: 12px; gap: 7px; width: auto; }

.screen { flex: 1 1 auto; min-height: 0; display: flex; flex-direction: column; gap: 10px; }

/* ── Submenú de Ajustes (estilo Configuración de Windows) ──
   En móvil no existe: se navega lista → subpantalla con «‹ Ajustes». */
.cfg-menu { display: none; }
@media (min-width: 900px) {
  .screen.con-submenu {
    display: grid; grid-template-columns: 225px minmax(0, 1fr);
    gap: 18px; align-items: stretch;
  }
  .cfg-menu { display: flex; flex-direction: column; gap: 2px; padding: 4px 0; }
  .cfg-menu h4 {
    font-size: 10.5px; letter-spacing: .1em; text-transform: uppercase;
    color: var(--muted); font-weight: 700; margin: 14px 0 4px; padding: 0 12px;
  }
  .cfg-item {
    display: flex; align-items: center; gap: 10px; width: 100%; text-align: left;
    padding: 8px 12px; border: 0; border-radius: 9px; background: transparent;
    font: inherit; font-size: 13px; font-weight: 500; color: var(--ink-2);
    cursor: pointer; text-decoration: none;
  }
  .cfg-item:hover { background: var(--accent-soft); }
  .cfg-item.on { background: var(--accent-soft); color: var(--btn-primary); font-weight: 600; }
  /* Con el submenú a la vista, «‹ Ajustes» sobra. */
  .screen.con-submenu .back-btn { display: none; }
}
.card { background: var(--surface); border: 1px solid var(--border); border-radius: 12px; padding: 14px; box-shadow: var(--elev-1); }
.card.grow { flex: 1 1 auto; min-height: 0; display: flex; flex-direction: column; }
.card h2 { font-family: var(--f-display); font-size: 13.5px; font-weight: 700; letter-spacing: .02em; margin-bottom: 2px; color: var(--ink); }
.card .hint { font-size: 13px; color: var(--muted); margin-bottom: 10px; }
.scrollable { overflow-y: auto; flex: 1 1 auto; min-height: 0; overscroll-behavior: contain; padding-right: 2px; }
.axis-note { font-size: 12px; color: var(--muted); margin-top: 8px; }
.empty { color: var(--muted); font-size: 14px; padding: 8px 0; }

.tiles { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; flex: 0 0 auto; }
.tile { background: var(--surface); border: 1px solid var(--border); border-radius: 12px; padding: 10px 12px; box-shadow: var(--elev-1); }
.tile .label { font-family: var(--f-display); font-size: 10px; letter-spacing: .08em; text-transform: uppercase; color: var(--muted); font-weight: 600; }
.tile .value { font-family: var(--f-data); font-size: 24px; font-weight: 700; line-height: 1.2; color: var(--ink); }
.tile .sub { font-size: 12.5px; color: var(--ink-2); }

/* ── Fila de resumen del dashboard (diseño de la maqueta) ── */
.fila-resumen { display: grid; grid-template-columns: 1fr; gap: 12px; flex: 0 0 auto; }
.prop-bar { display: flex; height: 10px; border-radius: 5px; overflow: hidden; gap: 2px; background: var(--page); margin-bottom: 10px; }
.prop-bar span { display: block; }
.est-grupos { display: flex; flex-direction: column; gap: 7px; }
.est-linea { display: flex; align-items: center; gap: 7px; font-size: 13.5px; flex-wrap: wrap; }
.est-punto { width: 10px; height: 10px; border-radius: 3px; flex: none; }
.est-linea strong { font-family: var(--f-data); font-variant-numeric: tabular-nums; }
.est-pct { font-size: 12px; color: var(--muted); }
.avs { display: flex; margin-left: 10px; }
.av {
  width: 28px; height: 28px; border-radius: 50%;
  background: var(--accent-soft); color: var(--accent);
  display: inline-grid; place-items: center;
  font-size: 10.5px; font-weight: 700; font-family: var(--f-data);
  border: 2px solid var(--surface); margin-left: -7px;
}
.av:first-child { margin-left: 0; }
.av-mas { background: var(--page); color: var(--ink-2); }
.cifrota {
  font-family: var(--f-data); font-size: 30px; font-weight: 800; line-height: 1.1;
  font-variant-numeric: tabular-nums; color: var(--ink);
  background: none; border: none; padding: 0; text-align: left; cursor: pointer;
}
.cifrota:hover { color: var(--accent); }
.anom-desglose { display: flex; flex-direction: column; gap: 3px; font-size: 13px; color: var(--ink-2); }
.hbarra { display: grid; grid-template-columns: 96px 1fr 56px; align-items: center; gap: 10px; font-size: 12.5px; }
.hbarra-nombre { color: var(--ink-2); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.hbarra-pista { height: 13px; position: relative; background: var(--page); border-radius: 4px; }
.hbarra-valor { position: absolute; inset: 0 auto 0 0; background: var(--accent); border-radius: 4px 3px 3px 4px; min-width: 2px; }
.hbarra-cifra { text-align: right; font-family: var(--f-data); font-variant-numeric: tabular-nums; color: var(--ink-2); }

/* Tabla de asistencia: avatar, sub-hora del chip y saldo en color. */
.emp-cell { display: inline-flex; align-items: center; gap: 8px; }
.av-tabla { width: 30px; height: 30px; border: none; margin: 0; }
.chip-sub { font-size: 11.5px; color: var(--muted); margin-top: 2px; }
.saldo { font-weight: 700; }
.saldo.neg { color: var(--crit-text); }
.saldo.pos { color: var(--good-text); }
/* Legibilidad de la tabla: los datos secundarios suben del gris claro al
   gris medio (siguen siendo secundarios, pero se leen); las horas trabajadas
   toman peso para ser el ancla visual de cada fila. Los "—" quedan tenues
   a propósito: son ausencia de dato. */
.att-table .att-sede { color: #344054; }
.att-table .emp-cedula { color: #344054; font-size: 11.5px; }
.att-table .libre { color: #475467; }
.att-table td.num { font-weight: 600; }
/* El gris de "sin datos" también sube un tono en todas las tablas. */
.att-table td { color: var(--ink); }

/* Punto de estado junto al nombre: verde marcó hoy, rojo ausente. */
.punto-estado { display: inline-block; width: 9px; height: 9px; border-radius: 50%; margin-left: 7px; vertical-align: middle; }
.punto-estado.on { background: #1fa15f; }

/* Novedad del día: la FILA entera lleva un lavado suave (nada de columnas ni
   iconos); al pasar el mouse gana el hover normal y el tooltip da el detalle. */
.att-table tbody tr.con-novedad td { background: color-mix(in srgb, var(--crit-soft) 55%, transparent); }
.punto-estado.off { background: #dc2626; }
/* Horas extra del día, debajo del total trabajado. */
.extra-h { display: block; font-size: 11px; font-weight: 700; color: var(--btn-primary); }
.tile.alerta .value { color: var(--accent); }

.chip { display: inline-flex; align-items: center; gap: 6px; font-family: var(--f-data); font-size: 12px; font-weight: 600; padding: 2px 8px; border-radius: 4px; white-space: nowrap; }
.chip::before { content: ""; width: 6px; height: 6px; border-radius: 50%; background: currentColor; }
.chip.crit { color: var(--crit-text); background: var(--crit-soft); }
.chip.warn { color: var(--warn-text); background: var(--warn-soft); }
.chip.good { color: var(--good-text); background: var(--good-soft); }
.chip.neutral { color: var(--ink-2); background: var(--accent-soft); }
.chip.neutral::before { background: var(--accent); }

/* Filtro global de sede (select en el menú lateral, móvil y PC) */
.side-sede { display: flex; flex-direction: column; align-items: stretch; gap: 4px; padding: 4px 6px 12px; border-bottom: 1px solid var(--grid); margin-bottom: 8px; }
.side-sede-lbl { font-size: 10px; letter-spacing: .08em; text-transform: uppercase; color: var(--muted); font-weight: 600; }
.sede-select { flex: 1; font: inherit; font-size: 13px; font-weight: 600; padding: 8px 10px; border-radius: 10px; border: 1px solid var(--border); background: var(--surface); color: var(--ink); cursor: pointer; }
.sede-select:hover { background: var(--accent-soft); }
.sede-select:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }

.sede-table { display: flex; flex-direction: column; font-size: 13px; font-variant-numeric: tabular-nums; }
.sede-row { display: grid; grid-template-columns: 1.4fr 1fr 0.9fr 1fr 1fr; gap: 6px; padding: 7px 0; border-top: 1px solid var(--grid); align-items: center; }
.sede-row:first-child { border-top: 0; }
.sede-row.head { font-size: 11px; letter-spacing: .05em; text-transform: uppercase; color: var(--muted); }
.sede-row .sede-name { font-weight: 600; }
.warn-num { color: var(--warn-text); font-weight: 700; }
.crit-num { color: var(--crit-text); font-weight: 700; }

/* Empleados / Reportes */
.muted-count { color: var(--muted); font-weight: 400; }
.btn.block { display: block; width: 100%; text-align: center; text-decoration: none; margin-bottom: 10px; box-sizing: border-box; }
.danger-btn { color: var(--crit-text); border-color: var(--crit-soft); }
.danger-btn:hover { background: var(--crit-soft); }
.rep-controls { display: flex; flex-wrap: wrap; align-items: end; gap: 10px; margin-bottom: 10px; }
.rep-controls label { display: flex; flex-direction: column; gap: 3px; font-size: 12px; color: var(--muted); }
.rep-controls input { font: inherit; font-size: 13.5px; padding: 7px 10px; border-radius: 8px; border: 1px solid var(--border); background: var(--page); color: var(--ink); }
.rep-table { display: flex; flex-direction: column; font-size: 13px; font-variant-numeric: tabular-nums; }
/* Empleado · HED · HEN · HEDDF · HENDF · Total · Valor, y dos columnas
   opcionales: las de asistencia (botón) y la de pagado (permiso liquidar).
   Las columnas tienen anchos distintos, así que no sirve auto-fit: se
   declaran las cuatro combinaciones posibles, que son pocas y explícitas. */
.rep-row { display: grid; gap: 6px; padding: 8px 0; border-top: 1px solid var(--grid); align-items: center; }
.rep-table .rep-row                            { grid-template-columns: 1.6fr repeat(5, .62fr) 1fr; }
.rep-table.con-pago .rep-row                   { grid-template-columns: 1.5fr repeat(5, .58fr) .95fr .7fr; }
.rep-table.con-asistencia .rep-row             { grid-template-columns: 1.3fr repeat(5, .5fr) .85fr .8fr .35fr .55fr .45fr; }
.rep-table.con-asistencia.con-pago .rep-row    { grid-template-columns: 1.2fr repeat(5, .46fr) .8fr .75fr .32fr .5fr .42fr .62fr; }
.col-pago { text-align: center; }

/* Sub-pantallas de Ajustes */
.back-btn { align-self: flex-start; margin-bottom: 8px; }
.emp-actions { display: flex; gap: 6px; }
.holiday-add { display: flex; gap: 8px; align-items: center; margin-bottom: 10px; }
.holiday-add input { font: inherit; font-size: 13.5px; padding: 7px 10px; border-radius: 8px; border: 1px solid var(--border); background: var(--surface); color: var(--ink); }
.holiday-list { display: flex; flex-wrap: wrap; gap: 6px; }
.holiday-chip { display: inline-flex; align-items: center; gap: 6px; font-size: 12.5px; padding: 4px 8px 4px 10px; border-radius: 999px; background: var(--accent-soft); color: var(--ink-2); text-transform: capitalize; }
.holiday-chip button { border: 0; background: transparent; color: var(--muted); cursor: pointer; font-size: 12px; padding: 0 2px; }
.holiday-chip button:hover { color: var(--crit-text); }
.sede-card-head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; }
.sede-card-head h3 { margin-bottom: 0; }
.sede-fields { display: grid; grid-template-columns: repeat(auto-fit, minmax(130px, 1fr)); gap: 10px; margin-bottom: 8px; }
.sede-fields label { display: flex; flex-direction: column; gap: 3px; font-size: 12px; color: var(--muted); font-weight: 600; }
.sede-fields input { font: inherit; font-size: 14px; padding: 8px 10px; border-radius: 8px; border: 1px solid var(--border); background: var(--surface); color: var(--ink); font-variant-numeric: tabular-nums; }
.rep-row:first-child { border-top: 0; }
.rep-row.head { font-size: 11px; letter-spacing: .05em; text-transform: uppercase; color: var(--muted); }
.rep-row .rep-name { font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

/* Reglamento laboral (Ajustes) */
.cfg-group { border: 1px solid var(--border); border-radius: 12px; padding: 12px 14px; margin-bottom: 12px; background: var(--surface-blanca); }
.cfg-group h3 { font-size: 13.5px; font-weight: 650; margin-bottom: 10px; }
.cfg-row { display: flex; align-items: center; justify-content: space-between; gap: 14px; padding: 8px 0; border-top: 1px solid var(--grid); }
.cfg-row:first-of-type { border-top: 0; }
.cfg-row label { font-size: 13.5px; font-weight: 600; color: var(--ink); }
.cfg-row label small { display: block; font-weight: 400; font-size: 12px; color: var(--muted); max-width: 320px; }
.cfg-input { display: flex; align-items: center; gap: 6px; font-size: 13px; color: var(--muted); flex-shrink: 0; }
.cfg-input input { width: 64px; font: inherit; font-size: 15px; font-weight: 600; text-align: center; padding: 7px 6px; border-radius: 8px; border: 1px solid var(--border); background: var(--surface); color: var(--ink); }
.cfg-sede { display: flex; justify-content: space-between; align-items: baseline; gap: 10px; padding: 6px 0; border-top: 1px solid var(--grid); font-size: 13.5px; }
.cfg-sede:first-of-type { border-top: 0; }
.cfg-sede small { color: var(--muted); font-variant-numeric: tabular-nums; }
.cfg-note { font-size: 12px; color: var(--muted); margin-top: 8px; }
.cfg-note code { background: var(--grid); padding: 1px 5px; border-radius: 4px; }
.cfg-time { width: 106px !important; } /* un <input type="time"> no cabe en los 64px de .cfg-input */

/* ── Ficha de empleado ──
   Los mismos campos de antes, agrupados por tema y con el espacio libre
   ocupado por lo DERIVADO (valor hora, jornada del día), que antes salía como
   una frase pequeña debajo del campo. */
/* Ningún cajón se desplaza a lo ancho, ni el de editar ni el de registrar.
   La causa era input[type=time]: no se encoge por su cuenta bajo el ancho de
   su contenido, así que tres en una fila desbordaban los 420 px del cajón.
   min-width: 0 los deja encogerse; el overflow-x: hidden es el seguro.
   (Ojo: en este bloque los comentarios NO pueden llevar acentos graves —
   cierran el template literal del CSS y rompen el build.) */
.drawer { overflow-x: hidden; }
.drawer input, .drawer select, .drawer textarea { min-width: 0; max-width: 100%; }
.drawer-body, .reg-drawer-scroll, .ficha-body { overflow-x: hidden; }

.drawer.ficha { display: flex; flex-direction: column; padding: 0; }

.ficha-head {
  display: flex; align-items: center; gap: 12px;
  /* El mismo azul que la cabecera de los demás cajones (.drawer .drawer-head),
     para que registrar y editar se vean como la misma cosa. */
  background: var(--btn-primary); color: #fff; padding: 15px 18px; flex: 0 0 auto;
}
.ficha-avatar {
  width: 40px; height: 40px; border-radius: 50%; flex: 0 0 auto;
  background: rgba(255,255,255,.14); display: grid; place-items: center;
  font-weight: 650; font-size: 14px;
}
.ficha-quien { flex: 1; min-width: 0; }
.ficha-quien h3 { font-size: 16.5px; font-weight: 650; letter-spacing: -.01em; color: #fff; }
.ficha-sub {
  display: block; font-family: var(--f-data); font-size: 11.5px;
  color: rgba(255,255,255,.62); margin-top: 1px;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.ficha-head .btn {
  flex: 0 0 auto; border-color: rgba(255,255,255,.22);
  background: transparent; color: #fff;
}
.ficha-head .btn:hover { background: rgba(255,255,255,.10); }

.ficha-body { flex: 1 1 auto; overflow-y: auto; padding: 0 18px; }
.ficha-sec { padding: 15px 0; border-top: 1px solid var(--grid); }
.ficha-sec:first-child { border-top: 0; }
.ficha-sec > h4 {
  font-size: 10.5px; letter-spacing: .1em; text-transform: uppercase;
  color: var(--muted); font-weight: 650; margin-bottom: 11px;
}
.ficha-fila { display: grid; gap: 10px; margin-bottom: 10px; }
.field-hint { display: block; font-size: 12px; color: var(--muted); margin-top: 5px; line-height: 1.4; }
/* Rostros del empleado: cada foto guardada, con su fecha y su aspa. */
.ficha-rostros { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 10px; }
.ficha-rostro {
  display: inline-flex; align-items: center; gap: 7px; font-size: 12px; font-weight: 600;
  padding: 5px 8px 5px 11px; border-radius: 999px;
  background: var(--accent-soft); color: var(--accent-2); border: 1px solid var(--border);
}
.ficha-rostro em { font-style: normal; font-weight: 400; color: var(--muted); }
.ficha-rostro button {
  border: none; background: transparent; color: var(--muted); cursor: pointer;
  font-size: 15px; line-height: 1; padding: 0 2px;
}
.ficha-rostro button:hover { color: var(--crit-text); }
.ficha-fila:last-child { margin-bottom: 0; }
/* minmax(0): sin él, el ancho mínimo intrínseco de los inputs desborda la
   columna y el cajón los recorta por la derecha. */
.ficha-fila.dos { grid-template-columns: minmax(0, 1.35fr) minmax(0, 1fr); }
.ficha-fila.tres { grid-template-columns: minmax(0, 1fr) minmax(0, 1fr) minmax(0, .8fr); }
.ficha-body .field { margin: 0; min-width: 0; }
/* :not(checkbox): estirar un checkbox a todo el ancho lo saca de su fila. */
.ficha-body .field input:not([type="checkbox"]), .ficha-body .field select { width: 100%; }
.ficha-body .consent {
  display: flex; align-items: center; gap: 8px; margin-top: 8px;
  font-size: 12.5px; font-weight: 600; color: var(--ink-2); cursor: pointer;
}
.ficha-body .consent input { width: 15px; height: 15px; margin: 0; accent-color: var(--accent); flex: 0 0 auto; }
.ficha-body .field input.num { font-family: var(--f-data); }

/* La unidad y el signo van DENTRO del campo: «0» y «3100000» sueltos no dicen
   de qué son. */
.con-sufijo, .con-prefijo { position: relative; }
.con-sufijo input { padding-right: 44px !important; }
.con-sufijo .sufijo {
  position: absolute; right: 11px; bottom: 11px;
  font-family: var(--f-data); font-size: 12px; color: var(--muted); pointer-events: none;
}
.con-prefijo input { padding-left: 26px !important; }
.con-prefijo .prefijo {
  position: absolute; left: 11px; bottom: 10px;
  font-family: var(--f-data); font-size: 14px; color: var(--muted); pointer-events: none;
}

/* Lo derivado no se edita: por eso no parece un campo. */
.derivado {
  display: flex; flex-wrap: wrap; gap: 6px 18px; margin-top: 9px;
  padding: 9px 12px; background: var(--accent-soft); border-radius: var(--r-sm);
}
.derivado > div { display: flex; flex-direction: column; gap: 1px; }
.derivado .k {
  font-size: 10px; letter-spacing: .05em; text-transform: uppercase;
  color: var(--muted); font-weight: 650;
}
.derivado .v {
  font-family: var(--f-data); font-size: 14px; font-weight: 650; color: var(--accent-2);
  font-variant-numeric: tabular-nums;
}

/* El estado del rostro es una LÍNEA de texto, no un campo: sin caja azul. */
.ficha-estado {
  display: flex; align-items: center; gap: 9px; margin-top: 10px;
  font-size: 12.5px; color: var(--ink-2);
}
.ficha-punto { width: 7px; height: 7px; border-radius: 50%; background: var(--accent); flex: 0 0 auto; }
.ficha-punto.apagado { background: var(--muted); }

.ficha-check { display: flex; align-items: flex-start; gap: 9px; cursor: pointer; font-size: 13.5px; }
.ficha-check input { margin: 3px 0 0; accent-color: var(--accent); cursor: pointer; }
.ficha-check small { display: block; color: var(--muted); font-size: 12px; margin-top: 1px; }

/* Seis días en UNA fila: es una semana y se lee de corrido. */
.semana { display: grid; grid-template-columns: repeat(6, 1fr); gap: 6px; margin-top: 12px; }
.semana .dia { display: flex; flex-direction: column; gap: 4px; }
.semana .dia > span {
  font-size: 10px; letter-spacing: .05em; text-transform: uppercase;
  color: var(--muted); font-weight: 650; text-align: center;
}
.semana .dia input {
  font-family: var(--f-data); font-size: 14.5px; font-weight: 600; text-align: center;
  padding: 8px 2px; width: 100%; border-radius: var(--r-sm);
  border: 1px solid var(--border); background: var(--page); color: var(--ink);
}
.semana .dia.libre input { color: var(--muted); }

.ficha-total {
  display: flex; align-items: center; justify-content: space-between; gap: 10px;
  margin-top: 10px; padding: 9px 12px; border-radius: var(--r-sm);
  background: var(--accent-soft); font-size: 12.5px; color: var(--ink-2);
}
.ficha-total b { font-family: var(--f-data); font-size: 14.5px; color: var(--accent-2); }
.ficha-total.excede { background: var(--crit-soft); }
.ficha-total.excede b { color: var(--crit-text); }

/* Pie fijo: Guardar deja de quedar bajo el pliegue. */
.ficha-pie {
  flex: 0 0 auto; display: flex; gap: 10px; padding: 12px 18px;
  border-top: 1px solid var(--border); background: var(--surface);
}
.ficha-pie .primary { flex: 1; }
/* La acción destructiva no grita hasta que se la busca. */
.ficha-eliminar { border-color: transparent; background: transparent; color: var(--muted); }
.ficha-eliminar:hover { background: var(--crit-soft); color: var(--crit-text); }

@media (max-width: 460px) {
  .ficha-fila.dos, .ficha-fila.tres { grid-template-columns: 1fr; }
  .semana { grid-template-columns: repeat(3, 1fr); }
}

/* Código de vinculación: se lee en una pantalla y se teclea en otra, a veces
   con el aparato en la mano y el computador a un metro. Grande y espaciado. */
.codigo-vinc { text-align: center; }
.codigo-num {
  font-family: var(--f-data); font-size: 34px; font-weight: 700;
  letter-spacing: .16em; color: var(--accent-2);
  padding: 6px 0 2px; font-variant-numeric: tabular-nums;
}
.tools-title { font-size: 13.5px; font-weight: 650; margin: 14px 0 8px; }

/* ── Reporte por período (tabla única) ── */
.val-total {
  display: flex; align-items: baseline; justify-content: space-between; gap: 10px;
  background: var(--accent-soft); border-radius: 10px; padding: 10px 12px; margin-bottom: 10px;
}
.val-total .label { font-size: 10px; letter-spacing: .08em; text-transform: uppercase; color: var(--muted); font-weight: 600; }
.val-total .value { font-family: var(--f-data); font-size: 20px; font-weight: 700; color: var(--accent-2); }
.muted-cell { color: var(--muted); }
.val-money { text-align: right; font-weight: 600; }
.sin-salario { color: var(--muted); font-weight: 400; font-style: italic; font-size: 12px; }
/* El nombre es el acceso a la ficha del empleado: se comporta como enlace
   pero es un <button>, para que el teclado y los lectores de pantalla lo
   anuncien como acción y no como navegación a otra página. */
.rep-link {
  border: 0; background: transparent; padding: 0; font: inherit; font-weight: 600;
  color: var(--accent); cursor: pointer; text-align: left;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.rep-link:hover { text-decoration: underline; }

/* Estado de pago. El texto acompaña siempre al check: un cuadrito solo no
   distingue "pendiente" de "no aplica", y aquí se habla de dinero. */
.pago-check { display: inline-flex; align-items: center; gap: 5px; cursor: pointer; }
.pago-check input { margin: 0; cursor: pointer; accent-color: var(--accent); }
.pago-txt { font-size: 11px; font-weight: 600; }
.pago-check.est-pagado .pago-txt { color: var(--good-text); }
.pago-check.est-parcial .pago-txt { color: var(--warn-text); }
.pago-check.est-pendiente .pago-txt { color: var(--muted); font-weight: 400; }

/* Botón que solo tiene sentido con espacio: en móvil la tabla no se ve. */
.solo-pc { display: none; }

/* Horas extra en el gráfico semanal */
.hrow .track { position: relative; }
.hrow .fill.over { background: var(--accent-2); }
.hrow .limit { position: absolute; top: -2px; bottom: -2px; width: 2px; background: var(--crit); opacity: .7; }
.hrow .val .extra { display: block; font-style: normal; font-size: 10.5px; color: var(--warn-text); font-weight: 700; }

/* Botón bloquear del menú */
.lock-btn { border: 0; background: transparent; color: var(--muted); font: inherit; font-size: 12px; font-weight: 600; cursor: pointer; display: flex; align-items: center; gap: 10px; padding: 10px 14px; border-radius: 12px; }
.lock-btn:hover { background: var(--crit-soft); color: var(--crit-text); }

.btn { border: 1px solid var(--grid); background: var(--surface); color: var(--ink-2); font-family: var(--f-data); font-size: 13.5px; font-weight: 600; padding: 7px 14px; border-radius: 6px; cursor: pointer; box-shadow: var(--elev-1); }
.btn:hover { border-color: var(--accent); color: var(--accent); }
.btn:active { box-shadow: var(--press); }
.btn.primary { background: var(--btn-primary); border-color: var(--btn-primary); color: var(--accent-ink); font-weight: 600; box-shadow: var(--elev-1); }
.btn.primary:hover { background: var(--btn-primary-hover); border-color: var(--btn-primary-hover); color: var(--accent-ink); }
.btn.primary:disabled { opacity: .5; cursor: not-allowed; }
.btn:focus-visible, .tabbar button:focus-visible, input:focus-visible, select:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }

.anomaly { display: flex; flex-direction: column; align-items: flex-start; gap: 6px; padding: 12px 0; border-top: 1px solid var(--grid); }
.anomaly:first-child { border-top: 0; }
.anomaly .who { font-weight: 600; }
.anomaly .desc { color: var(--ink-2); font-size: 13.5px; }
.anomaly .btn { width: 100%; }

.emp-card { border: 1px solid var(--border); border-radius: 10px; padding: 10px 12px; margin-bottom: 10px; background: var(--page); display: flex; flex-direction: column; gap: 8px; }
.emp-head { display: flex; justify-content: space-between; align-items: center; gap: 8px; flex-wrap: wrap; }
.emp-name { font-weight: 600; }
.emp-id { font-size: 12px; color: var(--muted); }
.emp-data { display: flex; gap: 14px; flex-wrap: wrap; font-family: var(--f-data); font-size: 13.5px; color: var(--ink-2); font-variant-numeric: tabular-nums; }
.emp-data b { display: block; font-family: var(--f-display); font-size: 9px; letter-spacing: .16em; text-transform: uppercase; color: var(--muted); }

.chart { display: flex; flex-direction: column; gap: 8px; }
.hrow { display: grid; grid-template-columns: 96px 1fr 52px; align-items: center; gap: 10px; font-size: 12.5px; }
.hrow .name { color: var(--ink-2); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.hrow .track { height: 14px; position: relative; background: var(--page); border-radius: 0 4px 4px 0; box-shadow: inset 0 1px 3px rgba(14,26,48,0.10); }
.hrow .fill { position: absolute; inset: 0 auto 0 0; background: var(--accent); border-radius: 0 3px 3px 0; min-width: 2px; }
.hrow .val { text-align: right; font-family: var(--f-data); font-variant-numeric: tabular-nums; color: var(--ink-2); }

.log-item { display: flex; flex-wrap: wrap; gap: 4px 10px; padding: 9px 0; border-top: 1px solid var(--grid); font-size: 13px; }
.log-item:first-child { border-top: 0; }
.log-item time { color: var(--muted); font-family: var(--f-data); font-variant-numeric: tabular-nums; }
.log-item .action { color: var(--ink-2); flex: 1 1 220px; }
.log-item b { color: var(--ink); }

/* Ajustes SIN tarjetas: filas planas sobre el fondo de la página, con una
   línea fina bajo cada opción (la última del grupo no la lleva). */
.card.ajustes-plano { background: transparent; border: 0; box-shadow: none; padding-left: 4px; padding-right: 4px; }
.tools-grupo { margin-bottom: 22px; }
.tools-grupo > h3 {
  font-size: 10.5px; letter-spacing: .1em; text-transform: uppercase;
  color: var(--muted); font-weight: 700; margin: 0 0 4px;
}
.tool {
  display: flex; gap: 14px; align-items: center; width: 100%; text-align: left;
  padding: 13px 4px; margin: 0; border: 0; border-bottom: 1px solid var(--grid);
  border-radius: 0; background: transparent; color: var(--ink);
  text-decoration: none; font: inherit; cursor: pointer;
}
.tools-grupo .tool:last-child { border-bottom: 0; }
.tool:hover { background: var(--accent-soft); }
.tool .icon {
  flex: 0 0 auto; width: 38px; height: 38px; border-radius: 50%;
  display: grid; place-items: center;
  background: var(--accent-soft); color: var(--btn-primary);
}
.tool-txt { flex: 1; min-width: 0; }
.tool-txt b { display: block; font-size: 14px; font-weight: 600; }
.tool-txt small { display: block; margin-top: 1px; }
.tool small { color: var(--muted); }
.tool-chev { flex: 0 0 auto; display: flex; color: var(--muted); }
.tool.danger:hover { background: var(--crit-soft); }

/* Menú lateral: en móvil es off-canvas (se desliza con la hamburguesa);
   en PC es la columna fija de siempre (media query más abajo). */
.nav-scrim { position: fixed; inset: 0; background: rgba(16,24,40,0.42); z-index: 59; }
.tabbar {
  position: fixed; top: 0; bottom: 0; left: 0; width: 280px; z-index: 60;
  display: flex; flex-direction: column; gap: 2px;
  padding: 16px 12px 12px; background: var(--surface);
  border: 0; border-right: 1px solid var(--grid); border-radius: 0;
  box-shadow: var(--elev-2);
  transform: translateX(-105%); transition: transform .24s ease;
}
.admin-root.nav-open .tabbar { transform: translateX(0); }
@media (prefers-reduced-motion: reduce) { .tabbar { transition: none; } }

.tabbar > button, .tabbar .lock-btn {
  position: relative; border: 0; background: transparent; color: var(--ink-2);
  font-family: var(--f-body); font-size: 13.5px; font-weight: 600; cursor: pointer;
  display: flex; flex-direction: row; align-items: center; gap: 12px;
  width: 100%; text-align: left; padding: 11px 12px; border-radius: 9px;
}
.tabbar > button .icon, .tabbar .lock-btn .icon { display: flex; line-height: 1; flex: 0 0 auto; }
.tabbar > button[aria-pressed="true"] { color: var(--accent); background: var(--accent-soft); }
.tabbar .lock-btn { color: var(--muted); margin-top: auto; }
.tabbar .lock-btn:hover { background: var(--crit-soft); color: var(--crit-text); }
.tabbar .badge { position: static; margin-left: auto; min-width: 18px; height: 18px; border-radius: 9px; background: var(--accent); color: #fff; font-size: 10.5px; font-weight: 700; display: flex; align-items: center; justify-content: center; padding: 0 5px; }

/* Cabecera del menú (logo + marca): visible también en móvil */
.side-top { display: flex; align-items: center; gap: 10px; padding: 2px 6px 14px; border-bottom: 1px solid var(--grid); margin-bottom: 6px; }
.side-foot { display: block; padding: 10px 12px 2px; font-size: 10px; color: var(--muted); font-family: var(--f-data); letter-spacing: .08em; text-transform: uppercase; }

/* Onboarding (dashboard sin empleados) */
.onboarding h2 { margin-bottom: 10px; }
.pasos { list-style: none; padding: 0; display: flex; flex-direction: column; gap: 10px; }
.pasos li { display: flex; align-items: center; gap: 12px; padding: 10px 12px; border: 1px solid var(--grid); border-radius: 10px; }
.pasos li.bloqueado { opacity: .5; }
.pasos li.hecho { border-color: var(--good-text); }
.paso-num { flex: 0 0 auto; width: 28px; height: 28px; border-radius: 50%; background: var(--accent-soft); color: var(--accent); font-weight: 700; font-size: 13px; display: flex; align-items: center; justify-content: center; }
.pasos li.hecho .paso-num { background: var(--good-soft, #dcfce7); color: var(--good-text); }
.paso-txt { flex: 1; display: flex; flex-direction: column; gap: 1px; }
.paso-txt small { color: var(--muted); font-size: 12px; }

/* Aviso de invitación creada (con copia manual) */
.inv-aviso { display: flex; align-items: center; justify-content: space-between; gap: 10px; flex-wrap: wrap; padding: 10px 12px; border: 1px solid var(--accent); border-radius: 10px; background: var(--accent-soft); font-size: 13px; margin-bottom: 10px; }
.inv-acciones { display: flex; gap: 6px; }

/* Clave de API (Mi empresa) */
.api-key-row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.api-key { font-family: var(--f-data); font-size: 13px; background: var(--surface-blanca); border: 1px solid var(--grid); border-radius: 8px; padding: 8px 10px; letter-spacing: .04em; overflow-wrap: anywhere; }

/* Aviso de prueba gratuita: informativo, no una alarma — al vencer no se
   pierde nada. Solo en la última semana toma color de aviso. */
.banner-prueba {
  display: flex; align-items: center; justify-content: space-between; gap: 14px; flex-wrap: wrap;
  background: var(--accent-soft); color: var(--ink-2); border: 1px solid var(--border);
  border-radius: 10px; padding: 9px 14px; font-size: 13px; margin-bottom: 10px;
}
.banner-prueba b { color: var(--ink); }
.banner-prueba.urge { background: var(--warn-soft); color: var(--warn-text); border-color: var(--warn-text); }
.banner-prueba.urge b { color: inherit; }

/* ── Pantalla de Plan (Ajustes → Plan) ─────────────────────────────── */
.cfg-punto {
  width: 7px; height: 7px; border-radius: 50%; background: var(--warn-text);
  margin-left: auto; flex: 0 0 auto;
}
.plan-estado {
  display: flex; gap: 12px; align-items: center; margin: 4px 0 18px;
  padding: 14px 16px; border-radius: 12px; border: 1px solid var(--border);
}
.plan-estado b { display: block; font-size: 15px; }
.plan-estado small { display: block; color: var(--muted); font-size: 12.5px; line-height: 1.5; margin-top: 3px; max-width: 62ch; }
.plan-estado.prueba { background: var(--accent-soft); }
.plan-estado.activa { background: var(--good-soft); }
.plan-estado.activa b { color: var(--good-text); }
.plan-estado.vencida { background: var(--crit-soft); }
.plan-estado.vencida b { color: var(--crit-text); }

.meses-sel { display: flex; gap: 8px; flex-wrap: wrap; margin: 14px 0 4px; }

.planes-lista { display: grid; grid-template-columns: repeat(auto-fit, minmax(210px, 1fr)); gap: 14px; margin-top: 16px; }
.plan-tarjeta {
  display: flex; flex-direction: column; gap: 3px; position: relative;
  padding: 20px 18px; border-radius: 14px;
  background: var(--surface-blanca); border: 1px solid var(--border);
}
.plan-tarjeta.sugerido { border-color: var(--accent); border-width: 2px; box-shadow: var(--elev-1); }
.plan-tarjeta.corto { opacity: .6; }
.plan-etiqueta {
  position: absolute; top: -10px; left: 16px; background: var(--accent); color: #fff;
  font-size: 10px; font-weight: 800; letter-spacing: .08em; text-transform: uppercase;
  padding: 3px 9px; border-radius: 999px;
}
.plan-tarjeta h3 { margin: 0; font-size: 17px; font-weight: 800; letter-spacing: -.01em; }
.plan-para { font-size: 12.5px; color: var(--muted); }
.plan-precio { display: flex; align-items: baseline; gap: 6px; margin: 10px 0 2px; }
.plan-precio s { font-size: 15px; color: var(--muted); }
.plan-precio b { font-size: 30px; font-weight: 800; letter-spacing: -.03em; }
.plan-precio em { font-style: normal; font-size: 13px; color: var(--muted); }
.plan-tope { font-size: 12.5px; color: var(--ink-2); margin-bottom: 16px; }
.plan-tarjeta .btn { margin-top: auto; }

/* Banner de suscripción vencida */
.banner-vencida { background: var(--crit-soft); color: var(--crit-text); border: 1px solid var(--crit, #fca5a5); border-radius: 10px; padding: 9px 14px; font-size: 13px; font-weight: 600; }

/* Simulador de horas extra (Ajustes) */
.sim-table { display: flex; flex-direction: column; border: 1px solid var(--grid); border-radius: 8px; overflow: hidden; }
.sim-row { display: grid; grid-template-columns: 1fr .8fr .7fr 1.1fr 1.2fr; gap: 6px; padding: 8px 10px; font-size: 13px; border-top: 1px solid var(--grid); align-items: center; }
.sim-row:first-child { border-top: 0; }
.sim-row.head { background: var(--page); font-size: 11px; font-weight: 700; color: var(--muted); text-transform: uppercase; letter-spacing: .04em; }
.sim-row.total { background: var(--page); font-weight: 700; }
.sim-row .val-money { text-align: right; font-family: var(--f-data); font-variant-numeric: tabular-nums; }
.sim-row code { font-family: var(--f-data); font-size: 12px; }

/* Quién entró (fondo del menú). Toma el margin-top:auto que antes tenía
   .lock-btn, para que el bloque entero quede anclado abajo. */
.sesion-box { margin-top: auto; border-top: 1px solid var(--grid); padding-top: 6px; }
.tabbar .lock-btn { margin-top: 0; }
.sesion-btn {
  display: flex; align-items: center; gap: 10px; width: 100%;
  border: 0; background: transparent; color: var(--ink-2); cursor: pointer;
  font-family: var(--f-body); font-size: 12.5px; font-weight: 600;
  padding: 8px 12px; border-radius: 9px; text-align: left;
}
.sesion-btn:hover { background: var(--accent-soft); }
.sesion-avatar {
  flex: 0 0 auto; width: 26px; height: 26px; border-radius: 50%;
  background: var(--accent-soft); color: var(--accent);
  font-size: 11px; font-weight: 700; letter-spacing: .02em;
  display: flex; align-items: center; justify-content: center;
}
/* La foto de Google usa la misma caja que las iniciales. */
img.sesion-avatar { object-fit: cover; display: block; }
.sesion-nombre { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.sesion-chev { display: flex; color: var(--muted); transition: transform .18s ease; }
.sesion-box.abierta .sesion-chev { transform: rotate(90deg); }
.sesion-detalle {
  display: flex; flex-direction: column; gap: 2px;
  padding: 2px 12px 8px 48px; font-size: 11.5px; color: var(--muted);
}
.sesion-detalle span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.sesion-detalle .lock-btn { margin: 6px 0 0; padding: 7px 10px; font-size: 12px; gap: 7px; width: auto; }
/* Riel colapsado: solo el avatar. Al abrirlo, los datos no caben en 74 px,
   pero sí el botón de cerrar sesión — que es lo que se viene a buscar. */
.nav-collapsed .sesion-btn { justify-content: center; padding: 8px 0; }
.nav-collapsed .sesion-detalle { padding: 4px 2px 6px; align-items: center; }
.nav-collapsed .sesion-detalle span { display: none; }
.nav-collapsed .sesion-detalle .lock-btn { padding: 7px; }
.logo {
  flex: 0 0 auto; width: 34px; height: 34px; border-radius: 8px;
  display: flex; align-items: center; justify-content: center;
  font-family: var(--f-display); font-size: 13px; font-weight: 800; letter-spacing: .04em;
  background: var(--accent); color: var(--accent-ink);
}
.side-brand { font-family: var(--f-display); font-size: 12px; font-weight: 400; letter-spacing: .14em; color: var(--ink); line-height: 1.3; }
.side-brand b { font-weight: 800; color: var(--accent); }
.side-brand small { display: block; font-family: var(--f-body); font-weight: 400; font-size: 10px; letter-spacing: .02em; text-transform: none; color: var(--muted); }
.side-top .collapse-btn { display: none; } /* colapsar solo existe en PC */

.overlay { position: fixed; inset: 0; background: rgba(0,0,0,.4); display: flex; align-items: center; justify-content: center; padding: 16px; z-index: 50; }
.dialog { background: var(--surface); color: var(--ink); border: 1px solid var(--grid); border-radius: 10px; padding: 18px 20px; max-width: 400px; width: 100%; box-shadow: 0 12px 40px rgba(16,24,40,0.18); }
.dialog h3 { font-family: var(--f-display); font-size: 14px; font-weight: 700; color: var(--ink); margin-bottom: 2px; }
.dialog .hint { font-size: 13px; color: var(--muted); margin-bottom: 12px; }
.field { display: flex; flex-direction: column; gap: 4px; margin-bottom: 12px; }
.field label { font-size: 13px; font-weight: 600; color: var(--ink-2); }
.field input, .field select { font-family: var(--f-data); font-size: 14px; padding: 7px 10px; border-radius: 8px; border: 1px solid var(--border); background: var(--page); color: var(--ink); color-scheme: light; }
.libre { color: var(--muted); font-size: 12px; font-weight: 400; font-style: normal; }
.hours-row { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 8px; }
.hours-row .sub-field { display: flex; flex-direction: column; gap: 3px; font-size: 12px; font-weight: 600; color: var(--muted); }
.hours-row .sub-field input { font-family: var(--f-data); font-size: 14px; font-weight: 400; padding: 7px 8px; border-radius: 8px; border: 1px solid var(--border); background: var(--page); color: var(--ink); color-scheme: light; }
.dialog-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 4px; }

.toast { position: fixed; left: 50%; bottom: 20px; transform: translateX(-50%); background: var(--ink); color: #fff; font-family: var(--f-data); font-size: 13.5px; padding: 9px 18px; border-radius: 8px; z-index: 60; box-shadow: var(--elev-2); }

/* Novedades (como en la demo de nómina): extra, dominical, corrección */
.novs { display: inline-flex; flex-wrap: wrap; gap: 4px; }
.nov { font-size: 10.5px; font-weight: 700; padding: 1px 7px; border-radius: 4px; white-space: nowrap; }
.nov.ex { background: var(--accent-soft); color: var(--accent); }
.nov.dom { background: rgba(124,58,237,0.09); color: #7c3aed; }
.nov.man { background: rgba(16,24,40,0.06); color: var(--ink-2); }
.nov.none { color: var(--muted); font-weight: 500; padding-left: 0; }

/* Tabla de asistencia: controles, tabla, paginación */
.att-controls { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; margin-bottom: 10px; }
.att-search { flex: 1 1 180px; font: inherit; font-size: 13.5px; padding: 7px 12px; border-radius: 6px; border: 1px solid var(--grid); background: var(--surface); color: var(--ink); }
.fchip { border: 1px solid var(--grid); background: var(--surface); color: var(--ink-2); font-family: var(--f-data); font-size: 12px; font-weight: 600; padding: 5px 10px; border-radius: 6px; cursor: pointer; }
.fchip[aria-pressed="true"] { background: var(--accent-soft); border-color: var(--accent); color: var(--accent); }
.att-tablewrap { overflow-x: auto; }
.att-table { border-collapse: collapse; width: 100%; min-width: 560px; font-size: 13px; font-variant-numeric: tabular-nums; }
.att-table th { text-align: left; font-size: 11px; letter-spacing: .05em; text-transform: uppercase; color: var(--muted); font-weight: 600; padding: 6px 10px 6px 0; border-bottom: 1px solid var(--grid); }
.att-table td { padding: 9px 10px 9px 0; border-bottom: 1px solid var(--grid); }
.att-table th.num, .att-table td.num { text-align: right; }
.att-table tbody tr { cursor: pointer; }
.att-table tbody tr:hover td { background: var(--accent-soft); }
.att-table tbody tr.static { cursor: default; }
.att-table tbody tr.static:hover td { background: transparent; }
.att-table td .tl-actions { justify-content: flex-end; }

/* Zona de acciones destructivas al pie de los drawers de edición */
.danger-zone { margin-top: auto; padding-top: 16px; border-top: 1px solid var(--grid); }
.danger-zone .btn.block, .btn.danger-btn.block { display: block; width: 100%; text-align: center; }
.att-table .att-name { font-weight: 600; }
.att-table .att-sede { color: var(--muted); }
.pager { display: flex; align-items: center; justify-content: center; gap: 12px; padding-top: 10px; font-size: 12.5px; color: var(--muted); }

/* Sección «Asistencia» sola: la tarjeta ocupa todo el ancho, sin la
   columna lateral del dashboard. */
.dash-grid.solo-asistencia { display: flex; }
.dash-grid.solo-asistencia .asistencia-card { flex: 1; }

/* Flechas de día anterior/siguiente junto al calendario */
.dia-nav { display: flex; align-items: center; gap: 4px; }
.dia-flecha { padding: 6px 11px; font-size: 16px; line-height: 1; }
.dia-flecha:disabled { opacity: 0.4; cursor: default; }

/* Inputs numéricos sin flechas: en coordenadas y demás cifras del panel las
   flechitas no ayudan y la rueda del mouse cambiaba el número sin querer. */
input[type='number']::-webkit-outer-spin-button,
input[type='number']::-webkit-inner-spin-button { -webkit-appearance: none; margin: 0; }
input[type='number'] { -moz-appearance: textfield; appearance: textfield; }

/* Empleados ARCHIVADOS (desactivados, historial intacto) */
.archivados { margin-top: 18px; border-top: 1px solid var(--border); padding-top: 12px; }
.archivados summary { cursor: pointer; font-size: 13px; font-weight: 700; color: var(--ink-2); }
.arch-hint { font-weight: 400; color: var(--muted); font-size: 12px; }
.arch-fila { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 9px 4px; border-bottom: 1px dashed var(--border); opacity: 0.85; }
.arch-fila:last-child { border-bottom: none; }
.hist-fecha { display: flex; align-items: center; gap: 6px; font-size: 12.5px; font-weight: 600; color: var(--ink-2); }

/* Drawer de detalle (marcaciones del día) */
.overlay.right { justify-content: flex-end; padding: 0; }
.drawer { background: var(--surface); color: var(--ink); width: 100%; max-width: 420px; height: 100%; display: flex; flex-direction: column; border-left: 1px solid var(--grid); box-shadow: -8px 0 30px rgba(16,24,40,0.12); }
.drawer-head { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 16px 18px 12px; border-bottom: 1px solid var(--grid); }
.drawer-head h3 { font-family: var(--f-display); font-size: 15px; font-weight: 700; }
.drawer-id { font-size: 12px; color: var(--muted); }
.drawer-day { display: flex; align-items: center; gap: 6px; padding: 12px 18px; border-bottom: 1px solid var(--grid); font-size: 12.5px; color: var(--muted); flex-wrap: wrap; }
.drawer-day input { font: inherit; font-size: 12.5px; padding: 6px 8px; border-radius: 6px; border: 1px solid var(--grid); background: var(--surface); color: var(--ink); }
.range-sep { color: var(--muted); }

/* Vista panorámica por día dentro del drawer: renglones minimalistas.
   Dos líneas por día: (fecha · horas · flecha) y los bloques como chips
   que ENVUELVEN — cualquier número de pares sin superponerse. */
.dia { border-bottom: 1px solid var(--grid); }
.dia-row {
  display: flex; flex-direction: column; gap: 5px; width: 100%;
  border: 0; background: transparent; font: inherit; text-align: left;
  padding: 9px 4px; cursor: pointer; color: var(--ink);
  font-variant-numeric: tabular-nums; border-radius: 6px;
}
.dia-row:hover { background: var(--accent-soft); }
.dia-top { display: flex; align-items: baseline; gap: 8px; }
.dia-fecha { font-size: 12.5px; font-weight: 700; text-transform: capitalize; white-space: nowrap; }
.dia-horas { margin-left: auto; font-size: 12.5px; font-weight: 700; color: var(--ink-2); white-space: nowrap; }
.dia-horas.extra { color: var(--accent); }
.dia-chev { color: var(--muted); font-size: 14px; transition: transform .15s; flex: 0 0 auto; }
.dia.abierto .dia-chev { transform: rotate(90deg); }
@media (prefers-reduced-motion: reduce) { .dia-chev { transition: none; } }
.dia-bloques { display: flex; flex-wrap: wrap; gap: 4px; }
.bloque {
  font-size: 11px; color: var(--ink-2); background: var(--page);
  border: 1px solid var(--grid); border-radius: 4px; padding: 1px 6px;
  white-space: nowrap; font-variant-numeric: tabular-nums;
}
.bloque.warn { color: var(--crit-text); border-color: var(--crit-soft); background: var(--crit-soft); }
.dia-detalle { padding: 2px 2px 10px; }
.dia-detalle .ev-form { margin: 6px 0 10px; }
.btn.small.block { display: block; width: 100%; text-align: center; margin-top: 6px; }
.drawer-hours { margin-left: auto; font-weight: 600; color: var(--ink-2); font-variant-numeric: tabular-nums; }
.drawer-body { flex: 1 1 auto; min-height: 0; overflow-y: auto; padding: 14px 18px; display: flex; flex-direction: column; gap: 8px; }
.tl-row { display: grid; grid-template-columns: 64px 84px 1fr auto; align-items: center; gap: 8px; padding: 8px 0; border-bottom: 1px solid var(--grid); font-size: 13px; }
/* Marcación con novedad: el mismo lavado suave de la tabla de Asistencia. */
.tl-row.con-novedad {
  background: color-mix(in srgb, var(--crit-soft) 55%, transparent);
  border-radius: 8px; padding-left: 8px; padding-right: 8px; margin: 0 -8px;
}
.tl-type { font-weight: 700; font-size: 12px; }
.tl-type.in { color: var(--good-text); }
.tl-type.out { color: var(--warn-text); }
.tl-time { font-variant-numeric: tabular-nums; font-weight: 600; }
.tl-flag { color: var(--muted); font-size: 11.5px; }
/* Desde dónde se marcó: renglón discreto bajo la marcación, con enlace al mapa. */
.tl-lugar {
  display: inline-flex; align-items: center; gap: 5px; margin: -2px 0 8px 64px;
  font-size: 11.5px; color: var(--muted); text-decoration: none; line-height: 1.35;
}
.tl-lugar:hover { color: var(--accent-2); text-decoration: underline; }
.tl-lugar em { font-style: normal; opacity: .7; }
/* Ubicación en la tabla de asistencia: bajo la sede, discreta y enlazable. */
.att-lugar {
  display: inline-flex; align-items: center; gap: 4px; margin-top: 2px;
  font-size: 11px; color: var(--muted); text-decoration: none; line-height: 1.3;
}
.att-sede .att-lugar { display: flex; }
.att-lugar:hover { color: var(--accent-2); text-decoration: underline; }
.tl-actions { display: flex; gap: 6px; }
.btn.small { font-size: 12px; padding: 4px 10px; }
.ev-form { border: 1px solid var(--grid); border-radius: 8px; padding: 12px; background: var(--surface-blanca); display: flex; flex-direction: column; gap: 10px; margin-top: 6px; }
.ev-form h4 { font-size: 13px; font-weight: 700; }
.ev-form label { display: flex; flex-direction: column; gap: 4px; font-size: 12.5px; font-weight: 600; color: var(--ink-2); }
.ev-form-row { display: flex; gap: 10px; }
.ev-form-row label { flex: 1; }
.ev-form input, .ev-form select { font: inherit; font-size: 13.5px; padding: 7px 10px; border-radius: 6px; border: 1px solid var(--grid); background: var(--surface); color: var(--ink); }

/* ─── Acordeón (móvil): reemplaza a las tablas para evitar scroll lateral ─── */
.att-tablewrap { display: none; }
.rep-table { display: none; }
.acc { display: flex; flex-direction: column; gap: 8px; }
.acc-item { background: var(--surface); border: 1px solid var(--grid); border-radius: 10px; box-shadow: var(--elev-1); }
.acc-head {
  display: flex; align-items: center; gap: 10px; width: 100%;
  border: 0; background: transparent; font: inherit; font-weight: 600; font-size: 14px;
  padding: 12px 14px; cursor: pointer; text-align: left; color: var(--ink); border-radius: 10px;
}
.acc-head:active { background: var(--accent-soft); }
.acc-title { flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.acc-note { font-size: 11.5px; color: var(--muted); font-weight: 500; flex: 0 0 auto; }
.acc-chev { color: var(--muted); display: flex; flex: 0 0 auto; transition: transform .18s; }
.acc-item.open .acc-chev { transform: rotate(90deg); }
@media (prefers-reduced-motion: reduce) { .acc-chev { transition: none; } }
.acc-body { border-top: 1px solid var(--grid); padding: 10px 14px 12px; display: flex; flex-direction: column; gap: 7px; }
.acc-field { display: flex; justify-content: space-between; align-items: baseline; gap: 12px; font-size: 13px; }
.acc-field b { color: var(--muted); font-size: 10.5px; letter-spacing: .06em; text-transform: uppercase; font-weight: 600; flex: 0 0 auto; }
.acc-field span { color: var(--ink-2); text-align: right; font-variant-numeric: tabular-nums; }
.acc-actions { margin-top: 4px; }
.acc-actions .btn.block { margin-top: 0; }

/* ─── Móvil (<900px): los drawers laterales se vuelven hojas inferiores ─── */
@media (max-width: 899px) {
  .overlay.right { align-items: flex-end; justify-content: stretch; padding: 0; }
  .drawer {
    width: 100%; max-width: none; height: auto; max-height: 84%;
    border-left: 0; border-top: 1px solid var(--grid);
    border-radius: 18px 18px 0 0;
    box-shadow: 0 -10px 30px rgba(16,24,40,0.20);
    animation: sheet-up .26s ease;
  }
  /* asa de la hoja */
  .drawer::before {
    content: ""; display: block; flex: 0 0 auto;
    width: 40px; height: 4px; border-radius: 2px;
    background: var(--grid); margin: 8px auto 2px;
  }
  @keyframes sheet-up { from { transform: translateY(40px); opacity: .6; } to { transform: none; opacity: 1; } }
  @media (prefers-reduced-motion: reduce) { .drawer { animation: none; } }
}

/* ─── Vista PC (≥900px): barra lateral + contenido ancho ─── */
@media (min-width: 900px) {
  .admin-root {
    max-width: none;
    width: 100%;
    display: grid;
    grid-template-columns: 240px minmax(0, 1fr);
    grid-template-rows: auto minmax(0, 1fr);
    gap: 0;
    padding: 0;
  }
  .app-header { grid-column: 2; grid-row: 1; padding: 12px 24px; background: var(--btn-primary); border-bottom: none; border-radius: 0; }
  .head-logo { display: none; } /* en PC la marca vive en el menú lateral */
  .head-sede {
    display: block; max-width: 210px; font-size: 13px; padding: 7px 10px;
    background: rgba(255,255,255,.10); color: #fff; border-color: rgba(255,255,255,.25);
  }
  .head-sede:hover { background: rgba(255,255,255,.18); }
  .head-sede option { background: var(--surface); color: var(--ink); }
  .head-user-nombre { display: block; }
  .side-sede { display: none; } /* el filtro de sede pasó a la barra */
  .side-foot { margin-top: auto; }
  .app-header .brand { display: none; } /* la marca ya vive en el menú lateral */
  /* El subtítulo (pestaña · fecha) va DEBAJO del nombre, alineado a la
     izquierda — con margin-left:auto quedaba flotando a la derecha. */
  .app-header .date-note { font-size: 12.5px; }

  /* menú lateral: panel completo pegado al borde, unido a la vista por un
     único borde divisorio (sin esquinas redondeadas ni flotación) */
  .tabbar {
    position: static; transform: none; width: auto; z-index: auto;
    grid-column: 1; grid-row: 1 / 3;
    display: flex; flex-direction: column; gap: 4px;
    align-self: stretch; height: 100%;
    padding: 18px 14px 14px;
    border-radius: 0; border: none; border-right: 1px solid var(--grid);
    box-shadow: none;
  }
  .nav-scrim { display: none; }
  .menu-btn { display: none; }
  .head-tab { font-size: 17px; }
  .side-top .collapse-btn { display: flex; }

  /* PC: la fila de resumen del dashboard se abre en tres tarjetas */
  .fila-resumen { grid-template-columns: repeat(3, minmax(0, 1fr)); align-items: start; }
  /* PC: gráfica de horas ancha + costos angosto, lado a lado */
  .fila-horas { grid-template-columns: minmax(0, 2fr) minmax(260px, 1fr); }

  /* PC: tablas visibles, acordeón oculto */
  .att-tablewrap { display: block; }
  .rep-table { display: flex; }
  .solo-pc { display: inline-flex; }
  .acc { display: none; }
  .tabbar > button {
    flex-direction: row; justify-content: flex-start; gap: 10px;
    width: 100%; font-size: 12px; padding: 10px 14px;
  }
  .tabbar > button .icon { font-size: 18px; }
  .tabbar .badge { position: static; margin-left: auto; }

  /* cabecera del menú: logo + nombre + botón esconder */
  .side-top { display: flex; align-items: center; gap: 10px; padding: 4px 6px 14px; border-bottom: 1px solid var(--grid); margin-bottom: 10px; }
  .logo {
    flex: 0 0 auto; width: 34px; height: 34px; border-radius: 8px;
    display: flex; align-items: center; justify-content: center;
    font-family: var(--f-display); font-size: 13px; font-weight: 800; letter-spacing: .04em;
    background: var(--accent); color: var(--accent-ink);
  }
  .side-brand { font-family: var(--f-display); font-size: 12px; font-weight: 400; letter-spacing: .14em; color: var(--ink); line-height: 1.3; }
  .side-brand b { font-weight: 800; color: var(--accent); }
  .side-brand small { display: block; font-family: var(--f-body); font-weight: 400; font-size: 10px; letter-spacing: .02em; text-transform: none; color: var(--muted); }
  .side-top .collapse-btn {
    margin-left: auto; flex: 0 0 auto; width: 26px; height: 26px; border-radius: 8px;
    border: 1px solid var(--border); background: transparent; color: var(--accent);
    font-size: 14px; line-height: 1; cursor: pointer; padding: 0;
    display: flex; align-items: center; justify-content: center;
  }
  .side-top .collapse-btn:hover { background: var(--accent-soft); }
  .side-foot { display: block; padding: 10px 6px 2px; font-size: 10px; color: var(--muted); font-family: var(--f-data); letter-spacing: .08em; text-transform: uppercase; }

  /* PC: bloquear como fila del menú, anclado al fondo sobre el pie */
  /* margin-top:auto lo lleva .sesion-box, que va justo encima. */
  .tabbar .lock-btn { flex-direction: row; justify-content: flex-start; gap: 10px; width: 100%; font-size: 12px; padding: 10px 14px; margin-top: 0; text-transform: none; letter-spacing: normal; }
  .tabbar .lock-btn .icon { font-size: 18px; }

  /* PC: el filtro de sede va ARRIBA del menú, en columna, bajo la cabecera */
  .side-sede { flex-direction: column; align-items: stretch; gap: 4px; padding: 0 6px 12px; margin-bottom: 8px; border-bottom: 1px solid var(--grid); }

  /* estado escondido: riel de iconos */
  .nav-collapsed { grid-template-columns: 74px minmax(0, 1fr); }
  .nav-collapsed .tabbar { padding: 18px 8px 14px; }
  .nav-collapsed .side-top { flex-direction: column; gap: 8px; padding-bottom: 12px; }
  .nav-collapsed .side-brand, .nav-collapsed .lbl, .nav-collapsed .side-foot { display: none; }
  /* riel colapsado: el select se compacta (muestra solo el emoji al cerrar) */
  .nav-collapsed .side-sede { padding: 0 2px 10px; }
  .nav-collapsed .side-sede-lbl { display: none; }
  .nav-collapsed .sede-select { padding: 8px 4px; font-size: 12px; }
  .nav-collapsed .side-top .collapse-btn { margin-left: 0; }
  .nav-collapsed .tabbar > button { justify-content: center; padding: 10px 0; }
  .nav-collapsed .tabbar .badge { position: absolute; top: 2px; right: 4px; margin-left: 0; }

  /* contenido pegado al sidebar, sin marcos: la jerarquía la dan las sombras.
     El lienzo es gris muy suave y las piezas "flotan" en blanco (estilo 3D). */
  /* Contenido compacto: la meta es que el dashboard quepa SIN scroll general
     (el scroll queda de respaldo para pantallas bajas). */
  .screen { grid-column: 2; grid-row: 2; padding: 14px 20px; gap: 12px; background: var(--page); overflow-y: auto; min-height: 0; }
  .admin-root { background: var(--page); }
  .card { border: 1px solid var(--grid); border-radius: 8px; padding: 18px 20px; background: var(--surface); box-shadow: var(--elev-1); }
  .tiles { gap: 14px; }
  .tile { border: 1px solid var(--grid); border-radius: 8px; background: var(--surface); box-shadow: var(--elev-1); }
  .emp-card { border: 1px solid var(--grid); border-radius: 8px; background: var(--surface); box-shadow: var(--elev-1); }
  .emp-card:hover { box-shadow: var(--elev-2); }

  /* sidebar y encabezado separados por línea divisoria sobria */
  .tabbar { background: var(--surface); border-right: 1px solid var(--grid); box-shadow: none; }
  .app-header { box-shadow: none; position: relative; z-index: 2; }
  /* Móvil: la barra es angosta — todo se compacta y el logo CR se oculta
     (la marca completa vive en el menú); sin esto el avatar se salía del
     borde redondeado de la barra. */
  .app-header { gap: 8px; padding: 8px 10px; }
  .head-right { gap: 8px; }
  .head-logo { display: none; }
  .head-guia { font-size: 11px; padding: 5px 9px; }
  /* En móvil el subtítulo (pestaña · fecha) SÍ se muestra: es la única señal
     de en qué pantalla estás ahora que el título es la marca. */
  .app-header .date-note { font-size: 10.5px; }
  .head-user-btn { padding: 2px; }
  .card { padding: 18px 22px; }
  .card h2 { font-size: 16px; }

  .tiles { grid-template-columns: repeat(4, 1fr); gap: 12px; }
  .tile { padding: 14px 16px; }
  .tile .value { font-size: 30px; }

  .hrow { grid-template-columns: 200px 1fr 64px; font-size: 13.5px; }
  .hrow .track { height: 16px; }

  /* anomalías y empleados pasan de tarjeta apilada a fila */
  .anomaly { flex-direction: row; align-items: center; gap: 14px; }
  .anomaly .who { min-width: 170px; }
  .anomaly .desc { flex: 1 1 auto; }
  .anomaly .btn { width: auto; }

  .emp-card { flex-direction: row; align-items: center; gap: 20px; padding: 12px 16px; }
  .emp-head { flex: 1 1 220px; }
  .emp-data { gap: 28px; flex: 0 0 auto; }
  .emp-card .btn { flex: 0 0 auto; margin-left: auto; }

  .log-item { font-size: 13.5px; }
  .log-item time { min-width: 130px; }
}

/* ── Dashboard opción C: asistencia ancha + indicadores al lado + gráficas
   abajo. En móvil todo apila en una columna (asistencia primero). ───── */
.dash-grid { display: grid; grid-template-columns: 1fr; gap: 12px; flex: 0 0 auto; }
.dash-lado { display: flex; flex-direction: column; gap: 12px; min-width: 0; height: 100%; }
/* La última tarjeta del lado crece para que la columna cierre a la misma
   altura que la asistencia de al lado. */
.dash-lado > .card:last-child { flex: 1 1 auto; }
.asistencia-card { min-width: 0; display: flex; flex-direction: column; }
.asistencia-card .scrollable { flex: 1 1 auto; min-height: 0; max-height: 470px; overflow-y: auto; }
/* Las tarjetas de la fila 2 (horas y costos) se estiran a la misma altura. */
.dash-grid .card.grow { min-height: 0; }
.dash-grid .card.grow .scrollable { flex: 1 1 auto; min-height: 0; max-height: 360px; overflow-y: auto; }
@media (min-width: 900px) {
  /* Dos columnas compartidas por ambas filas, con el MISMO ancho por columna.
     Fila 1: horas + costos (compactas). Fila 2: asistencia + indicadores.
     En móvil se conserva el orden del DOM (asistencia primero). */
  .dash-grid { grid-template-columns: minmax(0, 2.2fr) minmax(260px, 1fr); align-items: stretch; }
  .horas-card { order: 1; }
  .costos-card { order: 2; }
  .asistencia-card { order: 3; }
  .dash-lado { order: 4; }
  /* Fila 1 pareja: COSTOS define la altura (su contenido es fijo) y la
     gráfica de horas se estira exactamente a esa misma altura, con scroll
     interno para las barras que no quepan. El selector largo es a propósito:
     le gana a la regla general de .dash-grid. */
  .dash-grid .card.grow.horas-card .scrollable { flex: 1 1 auto; min-height: 0; max-height: 96px; }
  .horas-card { min-height: 0; }
}

/* ── Horas del rango + costos (dashboard) ── */
.fila-horas { display: grid; grid-template-columns: 1fr; gap: 12px; flex: 0 0 auto; }
/* Dentro de la fila, la gráfica mide lo que mida su contenido (hasta un tope
   con scroll propio): el patrón grow/scroll del resto del panel colapsaba a
   cero dentro de la cuadrícula en móvil y la tarjeta salía cortada. */
.fila-horas .card.grow { flex: none; min-height: 0; }
.fila-horas .scrollable { flex: none; max-height: 340px; overflow-y: auto; }
/* Desde tablet las dos tarjetas comparten fila; solo el celular apila. */
@media (min-width: 640px) {
  .fila-horas { grid-template-columns: minmax(0, 3fr) minmax(230px, 2fr); align-items: stretch; }
}
/* Barras minimalistas: finas, sin sombra interna ni línea de límite; el
   exceso sobre las horas legales va en azul oscuro a continuación. */
.hrow.compacta { grid-template-columns: 92px 1fr 66px; font-size: 12px; gap: 8px; }
.hrow.compacta .track { height: 8px; border-radius: 4px; background: var(--page); box-shadow: none; }
.hrow.compacta .fill { border-radius: 4px; background: #6e94e8; min-width: 2px; }
.hrow.compacta .fill-extra { position: absolute; top: 0; bottom: 0; background: var(--btn-primary); border-radius: 0 4px 4px 0; }
.hrow.compacta .val { font-size: 11.5px; }
/* La cifra del exceso hereda el azul oscuro del tramo de la barra. */
.hrow.compacta .val .extra { color: var(--btn-primary); }
/* Dona de costos */
.costo-viz { display: flex; align-items: center; gap: 14px; margin: 2px 0 4px; }
.costo-viz > div:last-child { min-width: 0; }
.dona { width: 88px; height: 88px; border-radius: 50%; position: relative; flex: none; }
.dona span { position: absolute; inset: 21px; background: var(--surface); border-radius: 50%; }
.costo-tipos { margin: 4px 0 0; gap: 3px; }
.costo-tipo { font-size: 11.5px; }
.costo-link {
  border: 0; background: none; padding: 2px 0; font: inherit; font-size: 12.5px;
  font-weight: 700; color: var(--accent); cursor: pointer; text-align: left;
}
.costo-link:hover { text-decoration: underline; }
.costo-dot { width: 9px; height: 9px; border-radius: 3px; flex: none; }
.card-head { display: flex; align-items: center; justify-content: space-between; gap: 10px; flex-wrap: wrap; margin-bottom: 6px; }
.card-head h2 { margin-bottom: 0; }
.rango-sel { display: flex; gap: 6px; }
.costo-total { font-family: var(--f-data); font-size: 22px; font-weight: 800; font-variant-numeric: tabular-nums; color: var(--ink); margin-top: 2px; }
.costo-sub { font-size: 12px; color: var(--muted); margin-bottom: 6px; }
.costo-tipos { display: flex; flex-direction: column; gap: 6px; margin-bottom: 10px; }
.costo-tipo { display: flex; align-items: baseline; gap: 8px; font-size: 12.5px; }
.costo-cod { font-family: var(--f-data); font-size: 10.5px; font-weight: 700; color: var(--accent); background: var(--accent-soft); border-radius: 4px; padding: 1px 6px; flex: none; }
.costo-nom { color: var(--ink-2); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1; }
.costo-val { font-family: var(--f-data); font-variant-numeric: tabular-nums; font-weight: 600; }

/* ── Bandeja de anomalías (PC) ── */
.bandeja { display: flex; flex-direction: column; }
.caso { border-bottom: 1px solid var(--grid); }
.caso:last-child { border-bottom: none; }
.caso-cab {
  display: flex; align-items: center; gap: 10px; width: 100%; text-align: left;
  border: 0; background: transparent; font: inherit; color: var(--ink);
  padding: 9px 6px; border-radius: 8px; cursor: pointer;
}
.caso-cab:hover { background: var(--accent-soft); }
.caso-nom { flex: 1; min-width: 0; }
.caso-nom b { display: block; font-weight: 600; font-size: 13.5px; }
.caso-nom small { color: var(--muted); font-size: 11.5px; }
.caso-chev { display: flex; color: var(--muted); transition: transform .18s ease; }
.caso.abierto .caso-chev { transform: rotate(90deg); }
@media (prefers-reduced-motion: reduce) { .caso-chev { transition: none; } }
.caso-panel { padding: 2px 8px 14px 48px; }
.caso-det { font-size: 13px; color: var(--ink-2); margin-bottom: 10px; }
/* Móvil: ficha compacta — solo foto, nombre y novedad. La fecha y la sede
   no se pierden: aparecen en el detalle al expandir el caso. */
@media (max-width: 899px) {
  .caso-nom small { display: none; }
  .caso-nom b { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .caso-panel { padding-left: 8px; }
}
.caso-fix { display: flex; gap: 8px; align-items: flex-end; flex-wrap: wrap; }
.caso-fix label { display: flex; flex-direction: column; gap: 3px; font-size: 11.5px; font-weight: 600; color: var(--muted); }
.caso-fix input[type="time"] { font-family: var(--f-data); font-size: 13.5px; padding: 6px 8px; border: 1px solid var(--border); border-radius: 7px; background: var(--surface); color: var(--ink); }
.caso-motivo { flex: 1 1 220px; font: inherit; font-size: 13px; padding: 7px 10px; border: 1px solid var(--border); border-radius: 7px; background: var(--surface); color: var(--ink); }
.fchip-n { margin-left: 6px; font-size: 10.5px; font-weight: 700; background: var(--accent-soft); color: var(--accent); border-radius: 8px; padding: 0 5px; }
.fchip[aria-pressed="true"] .fchip-n { background: rgba(255,255,255,.25); color: inherit; }

/* ── Cajón de registro de empleado ── */
/* TODOS los cajones flotantes con el mismo ancho (registro, marcaciones,
   edición, nueva sede): una sola medida para que se sientan el mismo mueble. */
.drawer { max-width: 460px; }
.reg-drawer-scroll { overflow-y: auto; flex: 1 1 auto; min-height: 0; padding: 12px 14px; overscroll-behavior: contain; }
/* Cabecera de TODOS los cajones (registro, marcaciones, ficha) en azul de
   marca, con el nombre en blanco y el botón translúcido. */
.drawer .drawer-head { background: var(--btn-primary); border-bottom: none; }
.drawer .drawer-head h3 { color: #fff; }
.drawer .drawer-head .drawer-id { color: rgba(255,255,255,.6); }
.drawer .drawer-head .btn { background: transparent; border-color: rgba(255,255,255,.3); color: #fff; box-shadow: none; }
.drawer .drawer-head .btn:hover { background: rgba(255,255,255,.12); }

/* ── Pestaña Horarios: formulario en el sitio ── */
.hor-form {
  display: flex; gap: 10px; flex-wrap: wrap; align-items: flex-end;
  border: 1px solid var(--grid); border-radius: 10px; padding: 12px;
  margin-bottom: 10px; background: var(--page);
}
.hor-form .regfield { display: flex; flex-direction: column; gap: 4px; font-size: 12px; font-weight: 600; color: var(--ink-2); min-width: 0; }
.hor-form .regfield:first-child { flex: 1 1 220px; }
.hor-form input { font: inherit; font-size: 13.5px; font-weight: 400; padding: 7px 10px; border: 1px solid var(--border); border-radius: 7px; background: var(--surface); color: var(--ink); min-width: 0; }
.hor-form-acciones { display: flex; gap: 8px; }

/* Editor de jornada POR DÍAS: una fila por día, activable. */
.hd-editor { display: flex; flex-direction: column; gap: 5px; flex: 1 1 100%; }
.hd-dia {
  display: flex; align-items: center; gap: 8px;
  padding: 5px 8px; border: 1px solid var(--grid); border-radius: 8px;
  background: var(--surface);
}
.hd-dia.hd-off { background: var(--page); }
.hd-nombre {
  display: flex; align-items: center; gap: 7px; flex: 0 0 64px;
  font-size: 12.5px; font-weight: 650; color: var(--ink-2); cursor: pointer;
}
.hd-dia.hd-off .hd-nombre { color: var(--muted); }
.hd-nombre input { width: 15px; height: 15px; accent-color: var(--accent); cursor: pointer; flex: 0 0 auto; }
.hd-dia input[type="time"] {
  font: inherit; font-size: 13px; padding: 5px 7px; min-width: 0; flex: 1 1 0;
  border: 1px solid var(--border); border-radius: 6px; background: var(--surface); color: var(--ink);
}
.hd-sep { color: var(--muted); flex: 0 0 auto; }
.hd-almuerzo { display: flex; align-items: center; gap: 5px; margin-left: auto; font-size: 11.5px; color: var(--muted); }
.hd-almuerzo input {
  font: inherit; font-size: 13px; width: 58px; padding: 5px 7px;
  border: 1px solid var(--border); border-radius: 6px; background: var(--surface); color: var(--ink);
}
.hd-libre { font-size: 12.5px; color: var(--muted); font-style: italic; }
.hd-resumen {
  display: flex; align-items: center; gap: 10px; flex: 1 1 100%;
  font-size: 12.5px; color: var(--muted); margin-top: 2px;
}
.hd-resumen b { font-family: var(--f-data); font-size: 13.5px; color: var(--ink); }
.hd-resumen .btn { margin-left: auto; }

/* Pantallas angostas: el almuerzo baja a su propia línea, alineado con las
   horas, para que la fila del día nunca desborde la hoja inferior. */
@media (max-width: 460px) {
  .hd-dia { flex-wrap: wrap; }
  .hd-almuerzo { flex: 1 1 100%; margin-left: 71px; justify-content: flex-start; }
  .hd-almuerzo input { width: 64px; }
}

/* ── Tabla Empleados enriquecida ── */
.att-search.mini { flex: 0 1 220px; min-width: 140px; padding: 7px 10px; font-size: 12.5px; }
.att-fecha {
  font: inherit; font-size: 12.5px; font-weight: 600; padding: 6px 9px;
  border-radius: 8px; border: 1px solid var(--border); background: var(--surface);
  color: var(--ink-2); cursor: pointer;
}
.att-fecha:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
/* Embudo de filtro dentro del encabezado de columna. */
.th-filtro { position: relative; white-space: nowrap; }
.filtro-ico {
  border: 0; background: transparent; color: var(--muted); cursor: pointer;
  padding: 2px 3px; margin-left: 4px; border-radius: 4px; vertical-align: -1px;
}
.filtro-ico:hover { color: var(--accent); background: var(--accent-soft); }
.filtro-ico.on { color: var(--accent); }
.filtro-pop {
  position: absolute; top: calc(100% + 4px); left: 0; z-index: 25;
  background: var(--surface); border: 1px solid var(--border); border-radius: 8px;
  padding: 6px; box-shadow: var(--elev-2, 0 8px 24px rgba(16,24,40,.16));
}
.filtro-pop select {
  font: inherit; font-size: 12.5px; font-weight: 500; border: 0; outline: none;
  background: var(--surface); color: var(--ink); min-width: 150px; cursor: pointer;
}
.filtro-pop option { padding: 4px 6px; border-radius: 5px; }
.emp-cedula { display: block; font-size: 11px; color: var(--muted); font-weight: 400; font-variant-numeric: tabular-nums; }

/* ── Interruptor (switch) de las columnas Limitar/Validar ── */
.sw {
  position: relative; width: 36px; height: 20px; flex: 0 0 auto;
  border: 0; border-radius: 999px; background: #cbd5e1; cursor: pointer;
  padding: 0; transition: background .15s ease; vertical-align: middle;
}
.sw span {
  position: absolute; top: 2px; left: 2px; width: 16px; height: 16px;
  border-radius: 50%; background: #fff; transition: transform .15s ease;
  box-shadow: 0 1px 3px rgba(16,24,40,.25);
}
.sw.on { background: #22c55e; }
.sw.on span { transform: translateX(16px); }
.sw:disabled { opacity: .35; cursor: not-allowed; }
.sw:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
@media (prefers-reduced-motion: reduce) { .sw, .sw span { transition: none; } }

/* ── Signo de pregunta con globo de ayuda (hover o foco). ── */
.q-ico {
  position: relative; display: inline-grid; place-items: center;
  width: 15px; height: 15px; border-radius: 50%; margin-left: 6px;
  background: var(--accent-soft); color: var(--accent);
  font-size: 10.5px; font-weight: 700; cursor: help; vertical-align: middle;
  flex: 0 0 auto;
}
.q-tip {
  display: none; position: absolute; bottom: calc(100% + 8px); left: 50%;
  transform: translateX(-50%); z-index: 60;
  width: 230px; padding: 9px 11px;
  background: var(--btn-primary); color: #fff; border-radius: 8px;
  font-size: 12px; font-weight: 400; line-height: 1.4; text-align: left;
  text-transform: none; letter-spacing: normal;
  box-shadow: 0 8px 24px rgba(16,24,40,.25);
}
.q-tip::after {
  content: ""; position: absolute; top: 100%; left: 50%; margin-left: -6px;
  border: 6px solid transparent; border-top-color: var(--btn-primary);
}
.q-ico:hover .q-tip, .q-ico:focus-visible .q-tip { display: block; }
/* Variante hacia ABAJO: para encabezados pegados al borde superior de un
   contenedor con scroll (hacia arriba el globo quedaba recortado/tapado). */
.q-tip.abajo { bottom: auto; top: calc(100% + 8px); }
.q-tip.abajo::after { top: auto; bottom: 100%; border-top-color: transparent; border-bottom-color: var(--btn-primary); }

/* ── Alertas de anomalías en rojo de verdad. El sistema monocromo define
   --crit como azul marino (#172554): sobre la barra y el menú azules el
   globito era invisible, y el número de la tarjeta no destacaba. ────── */
.head-badge { background: #dc2626; }
.tabbar .badge { background: #dc2626; }
.cifrota.alerta { color: #dc2626; }
.cifrota.alerta:hover { color: #b91c1c; }
.saldo.neg { color: #b3372f; }

/* ── Cajón de marcaciones: colores semánticos (el sistema monocromo pintaba
   entrada/salida/extras con azules casi iguales). Verde = entrada,
   naranja = salida, azul marino = horas extra, amarillo suave = marcación
   con anomalía (huérfana o señalada). ─────────────────────────────── */
.tl-type.in { color: #1fa15f; }
.tl-type.out { color: #d97706; }
/* Total del día en azul claro; SOLO el exceso (+X) en azul marino. */
.dia-horas.extra { color: var(--accent); }
.dia-exceso { font-style: normal; color: var(--btn-primary); }
.bloque.warn { background: #fdf3d3; border-color: #eedfa8; color: #8a6100; }

/* ── Móvil: el panel crece con el contenido y la página entera hace scroll.
   Con height fijo en 100dvh, el fondo azul se pintaba solo en la primera
   pantalla y al bajar aparecía el blanco del body. En PC se conserva la
   altura fija porque el layout de columnas depende de ella. ─────────── */
.admin-root { height: auto; min-height: 100dvh; }
@media (min-width: 900px) {
  .admin-root { height: 100dvh; }
}

/* ── Opción B: lienzo azul suave. Redefinir --page dentro del panel tiñe
   el fondo del contenido (y las pistas de las barras) sin tocar el token
   global que usan las demás pantallas. ────────────────────────────── */
.admin-root { --page: #dfe8f8; }

/* ── Menú lateral azul de marca (va al final: gana sobre las reglas de
   arriba, incluidas las de los media queries) ─────────────────────── */
.tabbar {
  background: var(--btn-primary);
  border-right-color: rgba(255,255,255,.12);
}
.tabbar > button { color: rgba(255,255,255,.72); }
.tabbar > button:hover { background: rgba(255,255,255,.08); }
.tabbar > button[aria-pressed="true"] { color: #fff; background: rgba(255,255,255,.15); }
.tabbar .badge { background: var(--crit); }
.side-top { border-bottom-color: rgba(255,255,255,.12); }
.logo { background: rgba(255,255,255,.14); color: #fff; }
.side-brand { color: #fff; }
.side-brand b { color: #8fb0f7; }
.side-brand small { color: rgba(255,255,255,.55); }
.side-top .collapse-btn { border-color: rgba(255,255,255,.25); color: #fff; }
.side-top .collapse-btn:hover { background: rgba(255,255,255,.12); }
/* La marca cede espacio (se recorta con elipsis) para que el botón de
   esconder no quede aplastado contra el borde del menú. */
.side-brand { flex: 1 1 auto; min-width: 0; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; letter-spacing: .08em; }
.side-top .collapse-btn { flex: 0 0 auto; margin-left: 6px; }
.side-sede { border-bottom-color: rgba(255,255,255,.12); }
.side-sede-lbl { color: rgba(255,255,255,.55); }
.side-sede .sede-select {
  background: rgba(255,255,255,.10); color: #fff; border-color: rgba(255,255,255,.25);
}
.side-sede .sede-select:hover { background: rgba(255,255,255,.18); }
.side-sede .sede-select option { background: var(--surface); color: var(--ink); }
.side-foot { color: rgba(255,255,255,.4); }
`;
