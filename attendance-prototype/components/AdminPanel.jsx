'use client';
/**
 * components/AdminPanel.jsx
 * Panel del administrador: app de una sola pantalla con sub-pantallas
 * (Dashboard, Anomalías, Equipo, Historial, Ajustes) y navegación inferior.
 * Solo las listas hacen scroll; el marco y la barra quedan fijos.
 *
 * Datos reales: journeyService (eventos/correcciones) + rosterService (personas).
 */
import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
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
  listPeople, removePerson, updatePerson, expectedDailyHours, jornadaDelDia,
  getLaborConfig, saveLaborConfig, getHorasValorizadas, getEventosRango, marcarHorasPagadas,
  getSedes, addSede, updateSede, removeSede,
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
import { signOut } from '../lib/auth-client';

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
const fmtTs = (iso) =>
  new Date(iso).toLocaleDateString('es-CO', { day: 'numeric', month: 'short' }) + ', ' + fmt12(iso);

/** Estado de pago de una fila, en palabras. */
const ETIQUETA_PAGO = { pagado: 'Pagado', parcial: 'Parcial', pendiente: 'Pendiente', na: '—' };

// Pesos colombianos, sin centavos: el peso no los usa y en un reporte de
// nómina los decimales solo restan confianza.
const fmtCOP = (n) =>
  n == null ? '—' : n.toLocaleString('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 });

// Horas con un decimal y coma (7.5 → "7,5 h"). En la valorización se prefiere
// esto al hh:mm:ss del resto del panel: al lado de un valor en pesos, lo que
// se quiere leer es "3,5 h × factor", no un cronómetro.
const fmtHoras = (n) => `${(Math.round(n * 10) / 10).toLocaleString('es-CO')} h`;

/** Suma horas de pares entrada→salida; una entrada abierta cuenta hasta ahora (máx. 12 h). */
function pairedHours(events, nowMs) {
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
    const span = nowMs - new Date(openIn.ts).getTime();
    if (span < NIGHT_WINDOW_MS) total += span / 3600000;
  }
  return total;
}

/** Iniciales para el avatar de la sesión: "Ana María Ruiz" → "AR". */
const iniciales = (texto) =>
  texto.split(/[\s@.]+/).filter(Boolean).slice(0, 2).map((p) => p[0]).join('').toUpperCase();

const ROL_ETIQUETA = { empresa: 'Empresa', superadmin: 'Superadministrador' };

// Pestañas que se pueden abrir directamente por URL (?tab=…). Se valida contra
// esta lista para que un valor inventado no deje el panel en blanco.
const TABS_VALIDAS = ['dashboard', 'anomalias', 'equipo', 'empleados', 'reportes', 'historial', 'ajustes', 'cfg-simulador', 'cfg-empresa'];

export default function AdminPanel({ sesion = null, permisos = {} }) {
  // Permite enlazar desde fuera a una pestaña concreta —p. ej. un correo que
  // nómina apunta a /admin?tab=equipo para abrir la tabla de asistencia.
  const searchParams = useSearchParams();
  const tabPedida = searchParams.get('tab');
  const [tab, setTab] = useState(TABS_VALIDAS.includes(tabPedida) ? tabPedida : 'dashboard');
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
  const [newSede, setNewSede] = useState({ name: '', lat: '', lon: '', radius: '50' });
  const [editSede, setEditSede] = useState(null); // { original, name, lat, lon, radius }
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

  /**
   * Abre la ficha de un empleado. Vive a nivel de componente (y no dentro de
   * la pestaña Empleados, como antes) porque desde Reportes se hace clic en
   * el nombre para llegar a los datos de esa persona.
   */
  const openEdit = (p) => setEditEmp({
    id: p.id, name: p.name, cedula: p.cedula || '', sede: p.sede || '',
    expectedEntry: p.expectedEntry || '',
    expectedExit: p.expectedExit || '',
    breakMinutes: p.breakMinutes == null ? '' : String(p.breakMinutes),
    jornadaSemanal: p.jornadaSemanal ? [...p.jornadaSemanal] : null,
    // '' = sin salario registrado, que es un estado válido.
    salarioMensual: p.salarioMensual == null ? '' : String(p.salarioMensual),
  });

  /**
   * Desde Reportes: lleva a la ficha de la persona de esa fila.
   * Un empleado dado de baja ya no está en el roster; en ese caso se avisa en
   * vez de abrir un cajón vacío que no guardaría nada.
   */
  const irAFichaEmpleado = (cedula) => {
    const persona = listPeople().find((p) => p.cedula === cedula);
    if (!persona) { showToast('Ese empleado ya no está activo.'); return; }
    setTab('empleados');
    openEdit(persona);
  };
  const [toast, setToast] = useState(null);

  // Tabla de asistencia: búsqueda + filtro por estado + paginación.
  const PAGE_SIZE = 25;
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all'); // all|present|absent|anomaly
  const [page, setPage] = useState(0);
  const [empSearch, setEmpSearch] = useState(''); // búsqueda de la tabla Empleados

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

  const data = useMemo(() => {
    const events = listJourneyEvents().sort((a, b) => a.ts.localeCompare(b.ts));
    const nowMs = Date.now();

    // Personas: roster ∪ personas vistas en eventos (con sede y horario).
    const byId = new Map();
    for (const p of listPeople()) byId.set(p.id, { id: p.id, name: p.name, sede: p.sede || '', expectedEntry: p.expectedEntry || '', expectedExit: p.expectedExit || '', breakMinutes: p.breakMinutes ?? null });
    for (const e of events) if (!byId.has(e.personId)) byId.set(e.personId, { id: e.personId, name: e.personName, sede: e.sede || '', expectedEntry: '', expectedExit: '', breakMinutes: null });
    const people = [...byId.values()].sort((a, b) => a.name.localeCompare(b.name));

    const perPerson = new Map(people.map((p) => [p.id, events.filter((e) => e.personId === p.id)]));
    const weekAgo = nowMs - 7 * 24 * 3600000;

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
          if (!closed && nowMs - new Date(e.ts).getTime() > NIGHT_WINDOW_MS) {
            anomalies.push({ kind: 'missing-exit', person: p, event: e });
          }
        }
        if (e.flag === 'late-entry') anomalies.push({ kind: 'late-entry', person: p, event: e });
        if (e.flag === 'early-exit') anomalies.push({ kind: 'early-exit', person: p, event: e });
      }

      const corrected = mine.some((e) => e.correctedBy && dayKey(e.ts) === todayKey());

      // Puntualidad: primera entrada vs horario esperado (+ gracia configurable).
      let onTime = null;
      if (firstIn && /^\d{2}:\d{2}$/.test(p.expectedEntry)) {
        const [h, m] = p.expectedEntry.split(':').map(Number);
        const d = new Date(firstIn.ts);
        onTime = d.getHours() * 60 + d.getMinutes() <= h * 60 + m + cfg.graceMinutes;
      }

      return {
        person: p,
        sede: p.sede || '',
        firstIn,
        lastOut,
        onTime,
        hoursToday: firstIn ? pairedHours(today, nowMs) : null,
        weekHours: pairedHours(mine.filter((e) => new Date(e.ts).getTime() >= weekAgo), nowMs),
        present: !!firstIn && today[today.length - 1]?.type === 'in',
        corrected,
      };
    });

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
    return { rows, anomalies, audit, sedeStats, sinSede };
  }, [tick, cfg]);

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
        hours: pairedHours(r.events, nowMs),
        lateCount: r.events.filter((e) => e.flag === 'late-entry').length,
        horasPorTipo: Object.fromEntries(CODIGOS_HORA.map((c) => [c, 0])),
        extras: 0,
        valor: 0,
        sinSalario: false,
        conExtras: false,
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
          referencias: [], refsSinPagar: [],
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
      else f.valor += t.valor;
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
    try { await signOut(); } catch { /* la redirección igual lleva al login */ }
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

  // Eventos del RANGO abierto en el drawer, agrupados por día (desc: el más
  // reciente arriba) con sus horas — la vista panorámica.
  const drawerEvents = useMemo(() => {
    if (!drawer) return [];
    return listJourneyEvents()
      .filter((e) => e.personId === drawer.personId && dayKey(e.ts) >= drawer.desde && dayKey(e.ts) <= drawer.hasta)
      .sort((a, b) => a.ts.localeCompare(b.ts));
  }, [drawer, tick]);

  const drawerDias = useMemo(() => {
    const map = new Map();
    for (const e of drawerEvents) {
      const d = dayKey(e.ts);
      if (!map.has(d)) map.set(d, []);
      map.get(d).push(e);
    }
    return [...map.entries()]
      .map(([fecha, evs]) => ({ fecha, evs, horas: pairedHours(evs, Date.now()) }))
      .sort((a, b) => b.fecha.localeCompare(a.fecha));
  }, [drawerEvents]);

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
  const attRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    let rs = view.rows;
    if (q) rs = rs.filter((r) => r.person.name.toLowerCase().includes(q) || r.person.id.toLowerCase().includes(q));
    if (statusFilter === 'present') rs = rs.filter((r) => r.present);
    if (statusFilter === 'absent') rs = rs.filter((r) => !r.firstIn);
    if (statusFilter === 'anomaly') rs = rs.filter((r) => data.anomalies.some((a) => a.person.id === r.person.id));
    return rs;
  }, [view, search, statusFilter, data]);
  // Roster completo sin filtro de sede (para conteos por sede).
  const allPeople = useMemo(() => listPeople(), [tick]);

  // Tabla de empleados: roster filtrado por búsqueda.
  const empRows = useMemo(() => {
    const q = empSearch.trim().toLowerCase();
    if (!q) return roster;
    return roster.filter((p) => p.name.toLowerCase().includes(q) || (p.cedula || '').includes(q));
  }, [roster, empSearch]);

  const pageCount = Math.max(1, Math.ceil(attRows.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount - 1);
  const pageRows = attRows.slice(safePage * PAGE_SIZE, (safePage + 1) * PAGE_SIZE);

  const tabs = [
    { id: 'dashboard', icon: 'dashboard', label: 'Dashboard' },
    { id: 'anomalias', icon: 'alert', label: 'Anomalías', badge: data.anomalies.length },
    { id: 'equipo', icon: 'clock', label: 'Asistencia' },
    { id: 'empleados', icon: 'user', label: 'Empleados' },
    { id: 'reportes', icon: 'file', label: 'Reportes' },
    { id: 'historial', icon: 'history', label: 'Historial' },
    { id: 'ajustes', icon: 'settings', label: 'Ajustes' },
  ];

  const chip = (cls, text) => <span className={`chip ${cls}`}>{text}</span>;
  const statusChip = (r) => {
    if (data.anomalies.some((a) => a.kind === 'missing-exit' && a.person.id === r.person.id))
      return chip('crit', 'Salida faltante');
    if (data.anomalies.some((a) => a.kind === 'late-entry' && a.person.id === r.person.id))
      return chip('warn', 'Entrada tardía');
    if (r.corrected) return chip('neutral', 'Corregido');
    if (r.present) return chip('good', 'Presente');
    if (r.firstIn && r.lastOut) return chip('good', 'Jornada completa');
    return chip('crit', 'Sin marcación');
  };

  // Novedades por empleado (como en la demo de nómina): extra semanal,
  // dominical/festivo trabajado hoy, y correcciones manuales del día.
  const hoyDominical = new Date().getDay() === 0 || (cfg.holidays || []).includes(todayKey());
  const novChips = (r) => {
    const novs = [];
    const extra = Math.max(0, r.weekHours - cfg.weeklyHours);
    if (extra > 0.05) novs.push(<span className="nov ex" key="ex">Extra {fmtH(extra)}</span>);
    if (hoyDominical && r.firstIn) novs.push(<span className="nov dom" key="dom">Dominical</span>);
    if (r.corrected) novs.push(<span className="nov man" key="man">Corrección ✎</span>);
    if (novs.length === 0) return <span className="nov none">—</span>;
    return novs;
  };

  const maxWeek = Math.max(40, ...view.rows.map((r) => r.weekHours));

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

      <header className="app-header">
        <button className="menu-btn" onClick={() => setNavOpen(true)} aria-label="Abrir menú">
          <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
            <line x1="3" y1="6" x2="21" y2="6" /><line x1="3" y1="12" x2="21" y2="12" /><line x1="3" y1="18" x2="21" y2="18" />
          </svg>
        </button>
        <div className="head-titles">
          <span className="head-tab">{tabs.find((t) => t.id === tab)?.label || 'Ajustes'}</span>
          <span className="date-note">
            {new Date().toLocaleDateString('es-CO', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
            {sedeFilter !== 'all' ? ` · ${sedeFilter}` : ''}
          </span>
        </div>
        {data.anomalies.length > 0 && (
          <button className="head-badge" title="Anomalías pendientes" onClick={() => setTab('anomalias')}>
            {data.anomalies.length}
          </button>
        )}
      </header>

      <div className="screen">
        {tab === 'dashboard' && (
          <>
            {/* Empresa recién nacida: en vez de un tablero en ceros, los tres
                pasos que la dejan funcionando, en orden y con su enlace. */}
            {allPeople.length === 0 && (
              <section className="card onboarding">
                <h2>Para empezar</h2>
                <ol className="pasos">
                  <li className={sedes.length > 0 ? 'hecho' : ''}>
                    <span className="paso-num">{sedes.length > 0 ? '✓' : '1'}</span>
                    <span className="paso-txt">
                      <b>Crea tu primera sede</b>
                      <small>Dónde queda y su radio GPS.</small>
                    </span>
                    {sedes.length === 0 && (
                      <button className="btn primary" onClick={() => setTab('cfg-sedes')}>Crear sede</button>
                    )}
                  </li>
                  <li className={sedes.length === 0 ? 'bloqueado' : ''}>
                    <span className="paso-num">2</span>
                    <span className="paso-txt">
                      <b>Registra a tu gente</b>
                      <small>Con una foto por persona.</small>
                    </span>
                    {sedes.length > 0 && (
                      <Link className="btn primary" href="/admin/registro">Registrar</Link>
                    )}
                  </li>
                  <li className="bloqueado">
                    <span className="paso-num">3</span>
                    <span className="paso-txt">
                      <b>Activa el kiosco</b>
                      <small>Abre esta página en la tablet donde van a marcar.</small>
                    </span>
                  </li>
                </ol>
              </section>
            )}
            <div className="tiles">
              <div className="tile">
                <div className="label">Presentes ahora</div>
                <div className="value">{view.present}</div>
                <div className="sub">de {view.rows.length} empleados</div>
              </div>
              <div className="tile">
                <div className="label">Ausentes hoy</div>
                <div className="value">{view.absent}</div>
                <div className="sub">sin marcación aún</div>
              </div>
              <div className="tile">
                <div className="label">Puntualidad</div>
                <div className="value">{view.punctuality == null ? '—' : `${view.punctuality}%`}</div>
                <div className="sub">+{cfg.graceMinutes} min de gracia</div>
              </div>
              <div className="tile alerta">
                <div className="label">Anomalías</div>
                <div className="value">{view.anomalies.length}</div>
                <div className="sub">requieren revisión</div>
              </div>
            </div>

            {sedeFilter === 'all' && (
              <section className="card">
                <h2>Comparativa por sedes</h2>
                <div className="sede-table" role="table">
                  <div className="sede-row head" role="row">
                    <span>Sede</span><span>Presentes</span><span>Ausentes</span><span>Horas hoy</span><span>Anomalías</span>
                  </div>
                  {data.sedeStats.map((s) => (
                    <div className="sede-row" role="row" key={s.name}>
                      <span className="sede-name">{s.name}</span>
                      <span>{s.present}/{s.total}</span>
                      <span className={s.absent > 0 ? 'warn-num' : ''}>{s.absent}</span>
                      <span>{fmtH(s.hours)}</span>
                      <span className={s.anomalies > 0 ? 'crit-num' : ''}>{s.anomalies}</span>
                    </div>
                  ))}
                </div>
                {data.sinSede > 0 && (
                  <p className="axis-note">{data.sinSede} sin sede asignada.</p>
                )}
              </section>
            )}

            <section className="card grow">
              <h2>Horas acumuladas — últimos 7 días</h2>
              <div className="scrollable">
                <div className="chart">
                  {view.rows.length === 0 && <p className="empty">No hay personas {sedeFilter === 'all' ? 'registradas' : `en ${sedeFilter}`}.</p>}
                  {[...view.rows].sort((a, b) => b.weekHours - a.weekHours).map((r) => {
                    const extra = Math.max(0, r.weekHours - cfg.weeklyHours);
                    return (
                      <div className="hrow" key={r.person.id} title={`${r.person.name}: ${fmtH(r.weekHours)}${extra > 0 ? ` (${fmtH(extra)} extra)` : ''}`}>
                        <span className="name">{r.person.name}</span>
                        <span className="track">
                          <span className={`fill${extra > 0 ? ' over' : ''}`} style={{ width: `${(r.weekHours / maxWeek) * 100}%` }} />
                          {/* línea de la jornada legal semanal */}
                          <span className="limit" style={{ left: `${Math.min(100, (cfg.weeklyHours / maxWeek) * 100)}%` }} />
                        </span>
                        <span className="val">
                          {fmtH(r.weekHours)}
                          {extra > 0 && <em className="extra">+{fmtH(extra)} extra</em>}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
              <p className="axis-note">La línea marca las {cfg.weeklyHours} h legales; lo que exceda es extra.</p>
            </section>
          </>
        )}

        {tab === 'anomalias' && (
          <section className="card grow">
            <h2>Anomalías por resolver <span className="muted-count">{view.anomalies.length}</span></h2>
            <p className="hint">Toca una fila para corregirla.</p>
            <div className="scrollable">
              {view.anomalies.length === 0 && <p className="empty">Sin anomalías pendientes.</p>}
              {view.anomalies.length > 0 && (() => {
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
                return (
                  <>
                    <div className="att-tablewrap">
                      <table className="att-table">
                        <thead>
                          <tr><th>Empleado</th><th>Tipo</th><th>Día</th><th>Detalle</th></tr>
                        </thead>
                        <tbody>
                          {view.anomalies.map((a, i) => (
                            <tr key={a.event.id + i} onClick={() => openFix(a)} tabIndex={0}
                              onKeyDown={(e) => e.key === 'Enter' && openFix(a)}>
                              <td className="att-name">{a.person.name}</td>
                              <td>{aChip(a)}</td>
                              <td>{aDay(a)}</td>
                              <td className="att-sede">{aDesc(a)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    <AccList
                      items={view.anomalies.map((a, i) => ({
                        id: a.event.id + i,
                        title: a.person.name,
                        right: aChip(a),
                        fields: [['Día', aDay(a)], ['Detalle', aDesc(a)]],
                        actions: <button className="btn primary block" onClick={() => openFix(a)}>Corregir</button>,
                      }))}
                    />
                  </>
                );
              })()}
            </div>
          </section>
        )}

        {tab === 'equipo' && (
          <section className="card grow">
            <h2>Asistencia de hoy <span className="muted-count">{attRows.length}</span></h2>
            <p className="hint">Toca una fila para ver sus marcaciones.</p>
            <div className="att-controls">
              <input
                className="att-search" type="search" placeholder="Buscar por nombre o código…"
                value={search} onChange={(e) => { setSearch(e.target.value); setPage(0); }}
              />
              {[['all', 'Todos'], ['present', 'Presentes'], ['absent', 'Ausentes'], ['anomaly', 'Con anomalía']].map(([id, lbl]) => (
                <button
                  key={id} className="fchip" aria-pressed={statusFilter === id}
                  onClick={() => { setStatusFilter(id); setPage(0); }}
                >
                  {lbl}
                </button>
              ))}
            </div>
            <div className="scrollable">
              {attRows.length === 0 && <p className="empty">Sin resultados{search ? ` para «${search}»` : ''}.</p>}
              {attRows.length > 0 && (
                <>
                  <div className="att-tablewrap">
                    <table className="att-table">
                      <thead>
                        <tr><th>Empleado</th><th>Sede</th><th>Entrada</th><th>Salida</th><th className="num">Horas</th><th>Estado</th><th>Novedades</th></tr>
                      </thead>
                      <tbody>
                        {pageRows.map((r) => (
                          <tr key={r.person.id} onClick={() => openDrawer(r.person.id, r.person.name)} tabIndex={0}
                            onKeyDown={(e) => e.key === 'Enter' && openDrawer(r.person.id, r.person.name)}>
                            <td className="att-name">{r.person.name}</td>
                            <td className="att-sede">{r.sede || '—'}</td>
                            <td>{fmt12(r.firstIn?.ts)}</td>
                            <td>{fmt12(r.lastOut?.ts)}</td>
                            <td className="num">{fmtH(r.hoursToday)}</td>
                            <td>{statusChip(r)}</td>
                            <td><span className="novs">{novChips(r)}</span></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <AccList
                    items={pageRows.map((r) => ({
                      id: r.person.id,
                      title: r.person.name,
                      right: statusChip(r),
                      fields: [
                        ['Sede', r.sede || '—'],
                        ['Entrada', fmt12(r.firstIn?.ts)],
                        ['Salida', fmt12(r.lastOut?.ts)],
                        ['Horas', fmtH(r.hoursToday)],
                        ['Novedades', <span className="novs" key="n">{novChips(r)}</span>],
                      ],
                      actions: (
                        <button className="btn primary block" onClick={() => openDrawer(r.person.id, r.person.name)}>
                          Ver marcaciones
                        </button>
                      ),
                    }))}
                  />
                </>
              )}
            </div>
            {pageCount > 1 && (
              <div className="pager">
                <button className="btn" disabled={safePage === 0} onClick={() => setPage(safePage - 1)}>Anterior</button>
                <span>Página {safePage + 1} de {pageCount}</span>
                <button className="btn" disabled={safePage >= pageCount - 1} onClick={() => setPage(safePage + 1)}>Siguiente</button>
              </div>
            )}
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
            {sesion?.limiteEmpleados != null && allPeople.length >= sesion.limiteEmpleados && (
              <p className="hint" style={{ color: 'var(--crit-text)' }}>
                Llegaste al tope del plan gratuito. Para registrar más, pasa al plan de pago.
              </p>
            )}
            <p className="hint">Quiénes pueden marcar en el kiosco.</p>
            <div className="att-controls">
              <input
                className="att-search" type="search" placeholder="Buscar por nombre o cédula…"
                value={empSearch} onChange={(e) => setEmpSearch(e.target.value)}
              />
              <Link className="btn primary" href="/admin/registro">Registrar empleado</Link>
            </div>
            <div className="scrollable">
              {empRows.length === 0 && <p className="empty">Sin resultados{empSearch ? ` para «${empSearch}»` : ''}.</p>}
              {empRows.length > 0 && (() => {
                const horario = (p) => (p.expectedEntry && p.expectedExit ? `${p.expectedEntry} – ${p.expectedExit}` : 'horario libre');
                const jornada = (p) => {
                  const exp = expectedDailyHours(p);
                  return exp == null ? '—' : `${fmtH(exp)}${p.breakMinutes ? ` (−${p.breakMinutes}m)` : ''}`;
                };
                return (
                  <>
                    <div className="att-tablewrap">
                      <table className="att-table">
                        <thead>
                          <tr><th>Empleado</th><th>Cédula</th><th>Sede</th><th>Horario</th><th>Jornada</th></tr>
                        </thead>
                        <tbody>
                          {empRows.map((p) => (
                            <tr key={p.id} onClick={() => openEdit(p)} tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && openEdit(p)}>
                              <td className="att-name">{p.name}</td>
                              <td>{p.cedula ? `C.C. ${p.cedula}` : '—'}</td>
                              <td className="att-sede">{p.sede || '—'}</td>
                              <td>{p.expectedEntry && p.expectedExit ? `${p.expectedEntry} – ${p.expectedExit}` : <span className="libre">horario libre</span>}</td>
                              <td>{expectedDailyHours(p) == null ? <span className="libre">—</span> : jornada(p)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    <AccList
                      items={empRows.map((p) => ({
                        id: p.id,
                        title: p.name,
                        right: <span className="acc-note">{p.sede || 'sin sede'}</span>,
                        fields: [
                          ['Cédula', p.cedula ? `C.C. ${p.cedula}` : '—'],
                          ['Horario', horario(p)],
                          ['Jornada', jornada(p)],
                        ],
                        actions: <button className="btn primary block" onClick={() => openEdit(p)}>Editar</button>,
                      }))}
                    />
                  </>
                );
              })()}
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
              {repDatos.estado === 'cargando' && <p className="empty">Calculando el período…</p>}
              {repDatos.estado === 'error' && (
                <p className="empty">⚠ No se pudo cargar el reporte: {repDatos.error}</p>
              )}
              {repDatos.estado === 'listo' && report.length === 0 && (
                <p className="empty">Sin marcaciones en este período{sedeFilter !== 'all' ? ` para ${sedeFilter}` : ''}.</p>
              )}

              {report.length > 0 && (
                <>
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
                      {TIPOS_HORA.map((t) => <span key={t.codigo} title={t.nombre}>{t.codigo}</span>)}
                      <span>Total</span>
                      <span className="val-money">Valor</span>
                      {repColsAsistencia && (
                        <>
                          <span>Sede</span><span>Días</span><span>Horas</span><span>Tardías</span>
                        </>
                      )}
                      {permisos.liquidar && <span className="col-pago">Pagado</span>}
                    </div>
                    {report.map((r) => (
                      <div className="rep-row" role="row" key={r.cedula}>
                        <button
                          className="rep-name rep-link"
                          onClick={() => irAFichaEmpleado(r.cedula)}
                          title={`Abrir la ficha de ${r.name}`}
                        >
                          {r.name}
                        </button>
                        {TIPOS_HORA.map((t) => (
                          <span key={t.codigo} className={r.horasPorTipo[t.codigo] > 0 ? 'warn-num' : 'muted-cell'}>
                            {r.horasPorTipo[t.codigo] > 0 ? fmtHoras(r.horasPorTipo[t.codigo]) : '—'}
                          </span>
                        ))}
                        <span>{r.extras > 0 ? fmtHoras(r.extras) : '—'}</span>
                        <span className="val-money">
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
                          <button className="btn primary block" onClick={() => irAFichaEmpleado(r.cedula)}>
                            Abrir ficha del empleado
                          </button>
                        </>
                      ),
                    }))}
                  />

                  <p className="cfg-note">
                    {TIPOS_HORA.map((t) => `${t.codigo} = ${t.nombre.toLowerCase()}`).join(' · ')}.
                    Los porcentajes se ajustan en <b>Ajustes → Valorización de horas extra</b>.
                  </p>
                  {permisos.liquidar && (
                    <p className="cfg-note">
                      «Pagado» es una anotación de que esas horas ya se liquidaron en nómina —
                      ArriveControl no paga. Si después se corrige una marcación ya pagada, ese
                      tramo vuelve a quedar pendiente y la fila se muestra como parcial.
                    </p>
                  )}
                </>
              )}
            </div>
          </section>
        )}

        {tab === 'historial' && (
          <section className="card grow">
            <h2>Historial de ajustes</h2>
            <p className="hint">Quién cambió qué y cuándo.</p>
            <div className="scrollable">
              {data.audit.length === 0 && <p className="empty">Sin correcciones.</p>}
              {data.audit.map((e) => (
                <div className="log-item" key={e.id}>
                  <time>{fmtTs(e.ts)}</time>
                  <span className="action">
                    <b>{e.correctedBy}</b> {e.flag === 'manual' ? 'agregó' : 'corrigió'} {e.type === 'in' ? 'entrada' : 'salida'} {fmt12(e.ts)} para <b>{e.personName}</b>.
                  </span>
                </div>
              ))}
            </div>
          </section>
        )}

        {tab === 'ajustes' && (
          <section className="card grow">
            <h2>Ajustes</h2>
            <div className="scrollable">
              <button className="tool" onClick={() => setTab('cfg-reglamento')}>
                <span className="icon"><Icon name="file" size={19} /></span>
                <span><b>Reglamento laboral</b><br /><small>{cfg.weeklyHours ?? '—'} h/sem · {(cfg.holidays ?? []).length} festivos</small></span>
              </button>
              <button className="tool" onClick={() => setTab('cfg-nomina')}>
                <span className="icon"><Icon name="clock" size={19} /></span>
                <span><b>Valorización</b><br /><small>Cuánto vale cada hora extra</small></span>
              </button>
              <button className="tool" onClick={() => setTab('cfg-simulador')}>
                <span className="icon"><Icon name="file" size={19} /></span>
                <span><b>Simulador</b><br /><small>Probar el cálculo de horas extra</small></span>
              </button>
              <button className="tool" onClick={() => setTab('cfg-sedes')}>
                <span className="icon"><Icon name="pin" size={19} /></span>
                <span><b>Sedes</b><br /><small>{sedes.length} registradas</small></span>
              </button>
              <button className="tool" onClick={() => { setTab('cfg-dispositivos'); cargarDispositivos(); }}>
                <span className="icon"><Icon name="monitor" size={19} /></span>
                <span><b>Dispositivos</b><br /><small>Tablets del kiosco</small></span>
              </button>
              {permisos.usuarios && (
                <button className="tool" onClick={() => { setTab('cfg-usuarios'); cargarUsuarios(); }}>
                  <span className="icon"><Icon name="users" size={19} /></span>
                  <span><b>Acceso al panel</b><br /><small>Quién puede entrar</small></span>
                </button>
              )}
              {permisos.config && (
                <button className="tool" onClick={() => { setTab('cfg-empresa'); cargarMiEmpresa(); }}>
                  <span className="icon"><Icon name="database" size={19} /></span>
                  <span><b>Mi empresa</b><br /><small>Nombre, clave de API y plan</small></span>
                </button>
              )}
              <Link className="tool" href="/">
                <span className="icon"><Icon name="monitor" size={19} /></span>
                <span><b>Ir al kiosco</b><br /><small>Pantalla de marcación</small></span>
              </Link>
              <Link className="tool" href="/gps">
                <span className="icon"><Icon name="pin" size={19} /></span>
                <span><b>Diagnóstico GPS</b><br /><small>Precisión y distancia a cada sede</small></span>
              </Link>
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
                      {miEmpresa.plan === 'gratis' ? 'Gratis' : 'De pago'}
                      {miEmpresa.plan === 'pago' && miEmpresa.estado !== 'activa' && (
                        <small style={{ color: 'var(--crit-text)' }}>Suscripción {miEmpresa.estado}: el panel está en solo lectura.</small>
                      )}
                    </label>
                    <div className="cfg-input">
                      {miEmpresa.limiteEmpleados == null
                        ? `${miEmpresa.empleados} empleados`
                        : <b>{miEmpresa.empleados} de {miEmpresa.limiteEmpleados} empleados</b>}
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
            <button className="btn back-btn" onClick={() => setTab('ajustes')}>‹ Ajustes</button>
            <h2>Dispositivos del kiosco <span className="muted-count">{dispositivos.length}</span></h2>
            <p className="hint">Revoca el aparato que se pierda: deja de marcar al instante.</p>
            {dispError && <p className="empty">⚠ {dispError}</p>}
            <div className="scrollable">
              {dispositivos.length === 0 && !dispError && <p className="empty">Sin dispositivos. Actívalos desde el kiosco.</p>}
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
                            {d.activo && (
                              <button className="btn small danger-btn" onClick={() => revocarDispositivo(d)}>Revocar</button>
                            )}
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
            <button className="btn back-btn" onClick={() => setTab('ajustes')}>‹ Ajustes</button>
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
          <span className="logo" aria-hidden="true">AC</span>
          <span className="side-brand">
            ARRIVE<b>CONTROL</b>
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
          <button key={t.id} aria-pressed={tab === t.id} onClick={() => { setTab(t.id); setNavOpen(false); }} title={t.label}>
            <span className="icon"><Icon name={t.icon} /></span>
            <span className="lbl">{t.label}</span>
            {t.badge ? <span className="badge">{t.badge}</span> : null}
          </button>
        ))}

        {/* Quién entró: al fondo del menú, sobre Cerrar sesión. Cerrado muestra
            solo el nombre; abierto, correo, rol y alcance de sede. */}
        {sesion && (
          <div className={`sesion-box${sesionAbierta ? ' abierta' : ''}`}>
            <button
              className="sesion-btn"
              aria-expanded={sesionAbierta}
              onClick={() => setSesionAbierta((v) => !v)}
              title={sesion.email}
            >
              {/* Con Google llega su foto; sin ella (cuenta local de dev, o si
                  el navegador no pudo cargarla) quedan las iniciales. */}
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
              <span className="lbl sesion-nombre">{sesion.nombre || sesion.email}</span>
              <span className="lbl sesion-chev"><Icon name="chevronRight" size={13} /></span>
            </button>
            {sesionAbierta && (
              <div className="sesion-detalle">
                <span>{sesion.email}</span>
                {/* La empresa, no el rol: con un solo rol dentro de la empresa,
                    «Empresa» no le diría nada a nadie. */}
                <span>{sesion.empresa ?? ROL_ETIQUETA[sesion.rol] ?? sesion.rol}</span>
                {/* Cerrar sesión vive AQUÍ: es una acción de la cuenta, y
                    escondida evita el clic accidental en el menú. */}
                <button className="lock-btn" onClick={cerrarSesion} title="Cerrar sesión">
                  <span className="icon"><Icon name="lock" size={14} /></span>
                  <span className="lbl">Cerrar sesión</span>
                </button>
              </div>
            )}
          </div>
        )}

        <div className="side-foot">v0.1 · prototipo</div>
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
              <span className="drawer-hours">{fmtH(pairedHours(drawerEvents, Date.now()))}</span>
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
                                {fmtH(d.horas)}{exceso > 0.05 ? ` (+${fmtH(exceso)})` : ''}
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
                              {d.evs.map((e) => (
                                <div key={e.id}>
                                  <div className="tl-row">
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
                                  {/* El formulario de edición, JUSTO bajo la marcación editada */}
                                  {evForm?.mode === 'edit' && evForm.eventId === e.id && formularioEv}
                                </div>
                              ))}

                              {/* Alta manual: el formulario aparece bajo el botón, dentro del día */}
                              {evForm?.mode === 'add' && evForm.fecha === d.fecha
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

                    {/* Alta en un día que no aparece en el rango (sin marcaciones) */}
                    {evForm && evForm.mode === 'add' && !drawerDias.some((d) => d.fecha === evForm.fecha && openDia === d.fecha)
                      ? (!drawerDias.some((d) => d.fecha === evForm.fecha) ? formularioEv : null)
                      : null}
                    {!evForm && (
                      <button className="btn block" onClick={() => setEvForm({ mode: 'add', conFecha: true, fecha: drawer.hasta, type: 'in', time: '08:00', reason: '' })}>
                        Agregar en otro día
                      </button>
                    )}
                  </>
                );
              })()}
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
                <input id="n-lat" type="number" step="0.000001" placeholder="1.212981" value={newSede.lat} onChange={(e) => setNewSede({ ...newSede, lat: e.target.value })} />
              </div>
              <div className="field">
                <label htmlFor="n-lon">Longitud</label>
                <input id="n-lon" type="number" step="0.000001" placeholder="-77.280157" value={newSede.lon} onChange={(e) => setNewSede({ ...newSede, lon: e.target.value })} />
              </div>
              <div className="field">
                <label htmlFor="n-radio">Radio GPS (metros)</label>
                <input id="n-radio" type="number" min="10" max="1000" value={newSede.radius} onChange={(e) => setNewSede({ ...newSede, radius: e.target.value })} />
              </div>
              <div className="dialog-actions">
                <button className="btn" onClick={() => setNewSedeOpen(false)}>Cancelar</button>
                <button
                  className="btn primary"
                  disabled={!newSede.name.trim() || newSede.lat === '' || newSede.lon === ''}
                  onClick={async () => {
                    const r = await addSede({ name: newSede.name, lat: Number(newSede.lat), lon: Number(newSede.lon), radius: Number(newSede.radius) || 50 });
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
              <input id="s-lat" type="number" step="0.000001" value={editSede.lat} onChange={(e) => setEditSede({ ...editSede, lat: e.target.value })} />
            </div>
            <div className="field">
              <label htmlFor="s-lon">Longitud</label>
              <input id="s-lon" type="number" step="0.000001" value={editSede.lon} onChange={(e) => setEditSede({ ...editSede, lon: e.target.value })} />
            </div>
            <div className="field">
              <label htmlFor="s-radio">Radio GPS (metros)</label>
              <input id="s-radio" type="number" min="10" max="1000" value={editSede.radius} onChange={(e) => setEditSede({ ...editSede, radius: e.target.value })} />
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
      {editEmp && (
        <div className="overlay right" onClick={(e) => e.target === e.currentTarget && setEditEmp(null)}>
          <aside className="drawer" role="dialog" aria-modal="true" aria-label={`Editar empleado ${editEmp.name}`}>
            <div className="drawer-head">
              <div>
                <h3>Editar empleado</h3>
                <span className="drawer-id">{editEmp.id}</span>
              </div>
              <button className="btn" onClick={() => setEditEmp(null)}>Cerrar</button>
            </div>
            <div className="drawer-body">
            <p className="hint">Para cambiar el rostro, elimina y registra de nuevo.</p>
            <div className="field">
              <label htmlFor="e-nombre">Nombre completo</label>
              <input id="e-nombre" type="text" value={editEmp.name} onChange={(e) => setEditEmp({ ...editEmp, name: e.target.value })} />
            </div>
            <div className="field">
              <label htmlFor="e-cedula">Cédula</label>
              <input id="e-cedula" type="text" inputMode="numeric" value={editEmp.cedula} onChange={(e) => setEditEmp({ ...editEmp, cedula: e.target.value.replace(/\D/g, '') })} />
            </div>
            <div className="field">
              <label htmlFor="e-sede">Sede asignada</label>
              <select id="e-sede" value={editEmp.sede} onChange={(e) => setEditEmp({ ...editEmp, sede: e.target.value })}>
                <option value="">Sin sede</option>
                {sedes.map((o) => <option key={o.name} value={o.name}>{o.name}</option>)}
              </select>
            </div>
            <div className="field">
              <label>Horario esperado <span className="libre">opcional</span></label>
              <div className="hours-row">
                <label className="sub-field">Entrada
                  <input type="time" value={editEmp.expectedEntry} onChange={(e) => setEditEmp({ ...editEmp, expectedEntry: e.target.value })} />
                </label>
                <label className="sub-field">Salida
                  <input type="time" value={editEmp.expectedExit} onChange={(e) => setEditEmp({ ...editEmp, expectedExit: e.target.value })} />
                </label>
                <label className="sub-field">Almuerzo
                  <input type="number" min="0" max="240" step="15" value={editEmp.breakMinutes} onChange={(e) => setEditEmp({ ...editEmp, breakMinutes: e.target.value })} />
                </label>
              </div>
              <small className="hint">
                {editEmp.expectedEntry && editEmp.expectedExit ? (
                  <><strong>{fmtH(expectedDailyHours({ ...editEmp, breakMinutes: editEmp.breakMinutes === '' ? null : Number(editEmp.breakMinutes) }))}</strong> al día.</>
                ) : (
                  <>Sin horario fijo: no hay alertas de puntualidad.</>
                )}
              </small>
            </div>
            <div className="field">
              <label htmlFor="e-salario">Salario mensual <span className="libre">opcional</span></label>
              <input
                id="e-salario" type="number" min="0" step="1000" inputMode="numeric"
                placeholder="Sin registrar"
                value={editEmp.salarioMensual}
                onChange={(e) => setEditEmp({ ...editEmp, salarioMensual: e.target.value })}
              />
              <small className="hint">
                {Number(editEmp.salarioMensual) > 0 ? (
                  <>
                    Hora ordinaria:{' '}
                    <strong>{fmtCOP(Math.round(Number(editEmp.salarioMensual) / (cfg.divisorHorasMes || DIVISOR_210)))}</strong>
                    {' '}· Extra diurna:{' '}
                    <strong>{fmtCOP(Math.round((Number(editEmp.salarioMensual) / (cfg.divisorHorasMes || DIVISOR_210)) * (cfg.factores?.HED ?? 1.25)))}</strong>
                  </>
                ) : (
                  <>Sin salario, sus horas se cuentan pero no se valorizan.</>
                )}
              </small>
            </div>
            <div className="field">
              <label>
                <input
                  type="checkbox"
                  checked={editEmp.jornadaSemanal != null}
                  onChange={(e) => setEditEmp({
                    ...editEmp,
                    // Al activar: arranca en la estándar (7 h L–S) para ajustar.
                    jornadaSemanal: e.target.checked ? [7, 7, 7, 7, 7, 7] : null,
                  })}
                />{' '}
                Jornada especial (distribuida)
              </label>
              <small className="hint">
                Para acuerdos distintos al estándar de {fmtH((cfg.weeklyHours ?? 42) / 6)}/día.
              </small>
              {editEmp.jornadaSemanal != null && (() => {
                const DIAS = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
                const total = editEmp.jornadaSemanal.reduce((s, h) => s + (Number(h) || 0), 0);
                const tope = cfg.weeklyHours ?? 42;
                return (
                  <>
                    <div className="hours-row" style={{ flexWrap: 'wrap' }}>
                      {DIAS.map((dia, i) => (
                        <label className="sub-field" key={dia}>{dia}
                          <input
                            type="number" min="0" max="12" step="0.5" style={{ width: '4.2em' }}
                            value={editEmp.jornadaSemanal[i]}
                            onChange={(e) => {
                              const j = [...editEmp.jornadaSemanal];
                              j[i] = e.target.value === '' ? 0 : Math.min(12, Math.max(0, Number(e.target.value)));
                              setEditEmp({ ...editEmp, jornadaSemanal: j });
                            }}
                          />
                        </label>
                      ))}
                    </div>
                    <small className="hint" style={total > tope ? { color: 'var(--danger, #c0392b)', fontWeight: 600 } : undefined}>
                      Total: {fmtH(total)} / {fmtH(tope)}{' '}
                      {total > tope ? '⚠ supera la jornada legal' : total < tope ? '' : '✓'}
                    </small>
                  </>
                );
              })()}
            </div>
            <div className="dialog-actions">
              <button className="btn" onClick={() => setEditEmp(null)}>Cancelar</button>
              <button
                className="btn primary"
                disabled={!editEmp.name.trim()}
                onClick={async () => {
                  const r = await updatePerson(editEmp.id, {
                    name: editEmp.name,
                    cedula: editEmp.cedula,
                    sede: editEmp.sede,
                    expectedEntry: editEmp.expectedEntry,
                    expectedExit: editEmp.expectedExit,
                    breakMinutes: editEmp.breakMinutes === '' ? null : Number(editEmp.breakMinutes),
                    jornadaSemanal: editEmp.jornadaSemanal == null ? null : editEmp.jornadaSemanal.map((h) => Number(h) || 0),
                    // Vacío o 0 = sin salario registrado, no un sueldo de cero.
                    salarioMensual: Number(editEmp.salarioMensual) > 0 ? Number(editEmp.salarioMensual) : null,
                  });
                  if (r.error) { showToast(r.error); return; }
                  setEditEmp(null);
                  refresh();
                  showToast(`${r.name} actualizado`);
                }}
              >
                Guardar cambios
              </button>
            </div>

            <div className="danger-zone">
              <button
                className="btn danger-btn block"
                onClick={async () => {
                  if (confirm(`¿Eliminar a ${editEmp.name}? Ya no podrá marcar asistencia.`)) {
                    try {
                      await removePerson(editEmp.id);
                      setEditEmp(null);
                      refresh();
                      showToast(`${editEmp.name} eliminado`);
                    } catch (e) {
                      showToast(`No se pudo eliminar: ${e.message}`);
                    }
                  }
                }}
              >
                Eliminar empleado
              </button>
            </div>
            </div>
          </aside>
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

/* Barra superior: hamburguesa (móvil) + título de la sección + globo */
.app-header { display: flex; align-items: center; gap: 12px; flex: 0 0 auto; }
.menu-btn {
  flex: 0 0 auto; width: 38px; height: 38px; border-radius: 9px;
  border: 1px solid var(--grid); background: var(--surface); color: var(--ink-2);
  display: flex; align-items: center; justify-content: center; cursor: pointer;
}
.menu-btn:active { background: var(--accent-soft); }
.head-titles { display: flex; flex-direction: column; min-width: 0; }
.head-tab { font-family: var(--f-display); font-size: 15px; font-weight: 700; }
.app-header .date-note { color: var(--muted); font-size: 11.5px; font-family: var(--f-data); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.head-badge {
  margin-left: auto; flex: 0 0 auto; min-width: 22px; height: 22px; border-radius: 11px;
  border: 0; background: var(--accent); color: #fff; font: inherit; font-size: 11.5px;
  font-weight: 700; display: flex; align-items: center; justify-content: center;
  padding: 0 7px; cursor: pointer;
}

.screen { flex: 1 1 auto; min-height: 0; display: flex; flex-direction: column; gap: 10px; }
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
.cfg-group { border: 1px solid var(--border); border-radius: 12px; padding: 12px 14px; margin-bottom: 12px; background: var(--page); }
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
.cfg-note code { background: var(--accent-soft); padding: 1px 5px; border-radius: 4px; }
.cfg-time { width: 106px !important; } /* un <input type="time"> no cabe en los 64px de .cfg-input */
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
.btn.primary { background: var(--accent); border-color: var(--accent); color: var(--accent-ink); font-weight: 600; box-shadow: var(--elev-1); }
.btn.primary:hover { background: var(--accent-2); border-color: var(--accent-2); color: var(--accent-ink); }
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

.tool { display: flex; gap: 12px; align-items: center; width: 100%; text-align: left; padding: 12px; margin-bottom: 8px; border: 1px solid var(--border); border-radius: 10px; background: var(--page); color: var(--ink); text-decoration: none; font: inherit; cursor: pointer; }
.tool:hover { background: var(--accent-soft); }
.tool .icon { font-size: 22px; }
.tool small { color: var(--muted); }
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
.api-key { font-family: var(--f-data); font-size: 13px; background: var(--page); border: 1px solid var(--grid); border-radius: 8px; padding: 8px 10px; letter-spacing: .04em; overflow-wrap: anywhere; }

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
.tl-type { font-weight: 700; font-size: 12px; }
.tl-type.in { color: var(--good-text); }
.tl-type.out { color: var(--warn-text); }
.tl-time { font-variant-numeric: tabular-nums; font-weight: 600; }
.tl-flag { color: var(--muted); font-size: 11.5px; }
.tl-actions { display: flex; gap: 6px; }
.btn.small { font-size: 12px; padding: 4px 10px; }
.ev-form { border: 1px solid var(--grid); border-radius: 8px; padding: 12px; background: var(--page); display: flex; flex-direction: column; gap: 10px; margin-top: 6px; }
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
  .app-header { grid-column: 2; grid-row: 1; padding: 16px 24px; background: var(--surface); border-bottom: 1px solid var(--grid); }
  .app-header .brand { display: none; } /* la marca ya vive en el menú lateral */
  .app-header .date-note { margin-left: auto; font-size: 13.5px; }

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
  .screen { grid-column: 2; grid-row: 2; padding: 22px 26px; gap: 18px; background: var(--page); }
  .admin-root { background: var(--page); }
  .card { border: 1px solid var(--grid); border-radius: 8px; padding: 18px 20px; background: var(--surface); box-shadow: var(--elev-1); }
  .tiles { gap: 14px; }
  .tile { border: 1px solid var(--grid); border-radius: 8px; background: var(--surface); box-shadow: var(--elev-1); }
  .tool, .emp-card { border: 1px solid var(--grid); border-radius: 8px; background: var(--surface); box-shadow: var(--elev-1); }
  .tool:hover { background: var(--accent-soft); }
  .emp-card:hover { box-shadow: var(--elev-2); }

  /* sidebar y encabezado separados por línea divisoria sobria */
  .tabbar { background: var(--surface); border-right: 1px solid var(--grid); box-shadow: none; }
  .app-header { border-bottom: 1px solid var(--grid); box-shadow: none; position: relative; z-index: 2; }
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
`;
