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
  getLaborConfig, saveLaborConfig,
  getSedes, addSede, updateSede, removeSede,
} from '../services/panelStore.js';
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

// Pestañas que se pueden abrir directamente por URL (?tab=…). Se valida contra
// esta lista para que un valor inventado no deje el panel en blanco.
const TABS_VALIDAS = ['dashboard', 'anomalias', 'equipo', 'empleados', 'reportes', 'historial', 'ajustes'];

export default function AdminPanel() {
  // Permite enlazar desde fuera a una pestaña concreta —p. ej. el gestor de
  // nómina apunta a /admin?tab=equipo para abrir la tabla de asistencia.
  const searchParams = useSearchParams();
  const tabPedida = searchParams.get('tab');
  const [tab, setTab] = useState(TABS_VALIDAS.includes(tabPedida) ? tabPedida : 'dashboard');
  const [collapsed, setCollapsed] = useState(false); // menú lateral escondido (solo PC)
  const [navOpen, setNavOpen] = useState(false); // menú off-canvas abierto (solo móvil)
  const [sedeFilter, setSedeFilter] = useState('all'); // 'all' | nombre de sede
  const [tick, setTick] = useState(0); // fuerza relectura de localStorage

  // El acceso lo protege la SESIÓN del gestor (app/admin/page.jsx redirige a
  // /login si no la hay). Aquí ya no existe el PIN de prototipo.
  useEffect(() => {
    setCfg(getLaborConfig()); // hidratar config
  }, []);

  // Reportes: rango de fechas (por defecto, el mes en curso).
  const monthStart = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`; };
  const [repFrom, setRepFrom] = useState(monthStart());
  const [repTo, setRepTo] = useState(todayKey());

  // Reglamento laboral (jornada legal semanal + gracia de puntualidad).
  const [cfg, setCfg] = useState(getLaborConfig);
  const updateCfg = (partial) => {
    setCfg(saveLaborConfig(partial));
    showToast('Reglamento actualizado');
  };

  // Sedes editables (fuente: sedesService; se relee con cada refresh).
  const [sedes, setSedes] = useState([]);
  useEffect(() => { setSedes(getSedes()); }, [tick]);
  const [newSede, setNewSede] = useState({ name: '', lat: '', lon: '', radius: '50' });
  const [editSede, setEditSede] = useState(null); // { original, name, lat, lon, radius }
  const [newSedeOpen, setNewSedeOpen] = useState(false); // drawer de "Nueva sede"

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
    if (!confirm(`¿Revocar "${d.nombre}"? Ese aparato no podrá marcar más hasta activarse de nuevo.`)) return;
    const r = await fetch(`/api/dispositivos/${d.id}`, { method: 'DELETE' });
    const j = await r.json().catch(() => null);
    if (!r.ok || !j?.ok) { showToast(`No se pudo revocar: ${j?.error ?? r.status}`); return; }
    showToast(`"${d.nombre}" revocado`);
    cargarDispositivos();
  };

  // Edición de empleado (CRUD): diálogo con datos no biométricos.
  const [editEmp, setEditEmp] = useState(null); // { id, name, cedula, sede, expectedEntry }
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

  // Reporte por rango de fechas: días trabajados y horas por empleado.
  const report = useMemo(() => {
    if (!repFrom || !repTo) return [];
    const events = listJourneyEvents()
      .filter((e) => { const d = dayKey(e.ts); return d >= repFrom && d <= repTo; })
      .sort((a, b) => a.ts.localeCompare(b.ts));
    const nowMs = Date.now();
    const byPerson = new Map();
    for (const e of events) {
      if (!byPerson.has(e.personId)) byPerson.set(e.personId, { name: e.personName, sede: e.sede || '', events: [] });
      byPerson.get(e.personId).events.push(e);
    }
    const rosterById = new Map(listPeople().map((p) => [p.id, p]));

    // Semana calendario (lunes) de un evento — para liquidar extras por semana.
    const weekOf = (iso) => {
      const d = new Date(iso);
      d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
      return dayKey(d.toISOString());
    };

    // ¿La jornada empezó en domingo o festivo? (recargo dominical/festivo)
    const holidaySet = new Set(cfg.holidays);
    const isDomFest = (iso) => new Date(iso).getDay() === 0 || holidaySet.has(dayKey(iso));

    return [...byPerson.entries()]
      .map(([id, r]) => {
        // Horas extra: por cada semana del rango, lo que exceda la jornada legal.
        const byWeek = new Map();
        for (const e of r.events) {
          const w = weekOf(e.ts);
          if (!byWeek.has(w)) byWeek.set(w, []);
          byWeek.get(w).push(e);
        }
        let extras = 0;
        for (const evts of byWeek.values()) {
          extras += Math.max(0, pairedHours(evts, nowMs) - cfg.weeklyHours);
        }

        // Horas trabajadas en domingo/festivo (el par se atribuye al día de la entrada).
        let domFest = 0;
        let openIn = null;
        for (const e of r.events) {
          if (e.type === 'in') openIn = e;
          else if (e.type === 'out' && openIn) {
            if (isDomFest(openIn.ts)) domFest += (new Date(e.ts) - new Date(openIn.ts)) / 3600000;
            openIn = null;
          }
        }
        return {
          id,
          name: r.name,
          cedula: rosterById.get(id)?.cedula || '',
          sede: r.sede || rosterById.get(id)?.sede || '',
          days: new Set(r.events.filter((e) => e.type === 'in').map((e) => dayKey(e.ts))).size,
          hours: pairedHours(r.events, nowMs),
          extras,
          domFest,
          lateCount: r.events.filter((e) => e.flag === 'late-entry').length,
        };
      })
      .filter((r) => sedeFilter === 'all' || r.sede === sedeFilter)
      .sort((a, b) => b.hours - a.hours);
  }, [tick, repFrom, repTo, sedeFilter, cfg]);

  // Exporta el reporte visible a CSV (separador ; — Excel en español).
  const exportCSV = () => {
    const head = ['Empleado', 'Cédula', 'Sede', 'Días trabajados', 'Horas totales', `Horas extra (>${cfg.weeklyHours}h/sem)`, 'Horas dominicales/festivas', 'Entradas tardías'];
    const lines = report.map((r) => [r.name, r.cedula, r.sede, r.days, r.hours.toFixed(2).replace('.', ','), r.extras.toFixed(2).replace('.', ','), r.domFest.toFixed(2).replace('.', ','), r.lateCount]);
    const csv = [head, ...lines]
      .map((row) => row.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(';'))
      .join('\r\n');
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' }); // BOM para tildes en Excel
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `asistencia_${repFrom}_a_${repTo}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
    showToast('Reporte CSV descargado');
  };

  // Ya no se "envían" horas a nómina: quien liquida las pide cuando las
  // necesita (GET /api/horas). Así una corrección se refleja sola, sin
  // reenviar ni dejar copias desactualizadas.

  // Cerrar sesión: la misma sesión del gestor de empleados.
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
    if (confirm(`¿Eliminar la marcación de ${e.type === 'in' ? 'entrada' : 'salida'} de las ${fmt12(e.ts)}? Úsalo solo para marcaciones erróneas.`)) {
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
                <div className="sub">a tiempo (+15 min de gracia)</div>
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
                  <p className="axis-note">{data.sinSede} empleado(s) sin sede asignada — re-regístralos o asígnales sede al migrar a base de datos.</p>
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
              <p className="axis-note">Jornada legal: {cfg.weeklyHours} h semanales — la línea marca el límite; lo que exceda son horas extra</p>
            </section>
          </>
        )}

        {tab === 'anomalias' && (
          <section className="card grow">
            <h2>Anomalías por resolver <span className="muted-count">{view.anomalies.length}</span></h2>
            <p className="hint">Marcaciones que no cierran una jornada normal. Clic en una fila para corregirla; cada corrección queda en el historial.</p>
            <div className="scrollable">
              {view.anomalies.length === 0 && <p className="empty">Sin anomalías pendientes.</p>}
              {view.anomalies.length > 0 && (() => {
                const aChip = (a) =>
                  a.kind === 'missing-exit' ? chip('crit', 'Salida faltante')
                    : a.kind === 'early-exit' ? chip('warn', 'Salida temprana')
                      : chip('warn', 'Entrada tardía');
                const aDesc = (a) =>
                  a.kind === 'missing-exit'
                    ? `Entrada de las ${fmt12(a.event.ts)} sin salida registrada (más de 12 h abierta).`
                    : a.kind === 'early-exit'
                      ? `Salió a las ${fmt12(a.event.ts)}, bastante antes de su hora esperada (${a.person.expectedExit || '—'}).`
                      : `Primera entrada del día a las ${fmt12(a.event.ts)} — posible olvido en la mañana.`;
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
            <p className="hint">Primera entrada, última salida y horas del día. Clic en una fila para ver y corregir sus marcaciones.</p>
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
            <h2>Empleados registrados <span className="muted-count">{empRows.length}</span></h2>
            <p className="hint">Personas que pueden marcar en el kiosco. El registro es por foto, con cédula, sede y horario.</p>
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
                const openEdit = (p) => setEditEmp({
                  id: p.id, name: p.name, cedula: p.cedula || '', sede: p.sede || '',
                  expectedEntry: p.expectedEntry || '',
                  expectedExit: p.expectedExit || '',
                  breakMinutes: p.breakMinutes == null ? '' : String(p.breakMinutes),
                  jornadaSemanal: p.jornadaSemanal ? [...p.jornadaSemanal] : null,
                });
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
            <h2>Reporte por período</h2>
            <p className="hint">Días trabajados y horas por empleado en el rango elegido. Exporta a CSV para nómina.</p>
            <div className="rep-controls">
              <label>Desde <input type="date" value={repFrom} max={repTo} onChange={(e) => setRepFrom(e.target.value)} /></label>
              <label>Hasta <input type="date" value={repTo} min={repFrom} max={todayKey()} onChange={(e) => setRepTo(e.target.value)} /></label>
              <button className="btn primary" onClick={exportCSV} disabled={report.length === 0}>Exportar CSV</button>
            </div>
            <div className="scrollable">
              {report.length === 0 && <p className="empty">Sin marcaciones en este período{sedeFilter !== 'all' ? ` para ${sedeFilter}` : ''}.</p>}
              {report.length > 0 && (
                <>
                  <div className="rep-table" role="table">
                    <div className="rep-row head" role="row">
                      <span>Empleado</span><span>Sede</span><span>Días</span><span>Horas</span><span>Extras</span><span>Dom/Fest</span><span>Tardías</span>
                    </div>
                    {report.map((r) => (
                      <div className="rep-row" role="row" key={r.id}>
                        <span className="rep-name">{r.name}</span>
                        <span>{r.sede || '—'}</span>
                        <span>{r.days}</span>
                        <span>{fmtH(r.hours)}</span>
                        <span className={r.extras > 0 ? 'warn-num' : ''}>{r.extras > 0 ? fmtH(r.extras) : '—'}</span>
                        <span className={r.domFest > 0 ? 'warn-num' : ''}>{r.domFest > 0 ? fmtH(r.domFest) : '—'}</span>
                        <span className={r.lateCount > 0 ? 'warn-num' : ''}>{r.lateCount}</span>
                      </div>
                    ))}
                  </div>
                  <AccList
                    items={report.map((r) => ({
                      id: r.id,
                      title: r.name,
                      right: <span className="acc-note">{fmtH(r.hours)}</span>,
                      fields: [
                        ['Sede', r.sede || '—'],
                        ['Días trabajados', r.days],
                        ['Horas', fmtH(r.hours)],
                        ['Horas extra', r.extras > 0 ? fmtH(r.extras) : '—'],
                        ['Dom/Festivos', r.domFest > 0 ? fmtH(r.domFest) : '—'],
                        ['Entradas tardías', r.lateCount],
                      ],
                    }))}
                  />
                </>
              )}
            </div>
          </section>
        )}

        {tab === 'historial' && (
          <section className="card grow">
            <h2>Historial de ajustes</h2>
            <p className="hint">Registro de auditoría: quién cambió qué y cuándo.</p>
            <div className="scrollable">
              {data.audit.length === 0 && <p className="empty">Aún no hay correcciones registradas.</p>}
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
            <p className="hint">Configuración del sistema. Cada opción se edita en su propia pantalla.</p>
            <div className="scrollable">
              <button className="tool" onClick={() => setTab('cfg-reglamento')}>
                <span className="icon"><Icon name="file" size={19} /></span>
                <span><b>Reglamento laboral</b><br /><small>Jornada legal ({cfg.weeklyHours ?? '—'} h/sem), gracia de puntualidad y festivos ({(cfg.holidays ?? []).length}) — jornada y festivos vienen del gestor RH.</small></span>
              </button>
              <button className="tool" onClick={() => setTab('cfg-sedes')}>
                <span className="icon"><Icon name="pin" size={19} /></span>
                <span><b>Sedes</b><br /><small>{sedes.length} sede(s) registradas — agregar, mover o cambiar el radio GPS.</small></span>
              </button>
              <button className="tool" onClick={() => { setTab('cfg-dispositivos'); cargarDispositivos(); }}>
                <span className="icon"><Icon name="monitor" size={19} /></span>
                <span><b>Dispositivos del kiosco</b><br /><small>Tablets/celulares activados para marcar — revocar el acceso de un aparato perdido.</small></span>
              </button>
              <Link className="tool" href="/">
                <span className="icon"><Icon name="monitor" size={19} /></span>
                <span><b>Ir al kiosco</b><br /><small>Pantalla de marcación facial (1:N).</small></span>
              </Link>
              <Link className="tool" href="/gps">
                <span className="icon"><Icon name="pin" size={19} /></span>
                <span><b>Diagnóstico GPS</b><br /><small>Precisión y distancia a cada sede desde este dispositivo.</small></span>
              </Link>
            </div>
          </section>
        )}

        {/* ── Sub-pantalla: Dispositivos del kiosco ── */}
        {tab === 'cfg-dispositivos' && (
          <section className="card grow">
            <button className="btn back-btn" onClick={() => setTab('ajustes')}>‹ Ajustes</button>
            <h2>Dispositivos del kiosco <span className="muted-count">{dispositivos.length}</span></h2>
            <p className="hint">
              Cada tablet/celular se activa una vez desde la pantalla del kiosco (con tu sesión) y recibe su clave propia.
              Si un aparato se pierde, revócalo aquí: deja de poder marcar al instante, sin afectar a los demás.
            </p>
            {dispError && <p className="empty">⚠ {dispError}</p>}
            <div className="scrollable">
              {dispositivos.length === 0 && !dispError && <p className="empty">Aún no hay dispositivos activados. Abre el kiosco en la tablet y actívala desde allí.</p>}
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
        {tab === 'cfg-reglamento' && (
          <section className="card grow">
            <button className="btn back-btn" onClick={() => setTab('ajustes')}>‹ Ajustes</button>
            <h2>Reglamento laboral</h2>
            <p className="hint">Regula las horas extra y la puntualidad en todo el panel.</p>
            <div className="scrollable">
              <div className="cfg-group">
                <div className="cfg-row">
                  <label>
                    Jornada legal semanal
                    <small>La define el gestor RH según la ley vigente (Ley 2101). Aquí solo se consulta.</small>
                  </label>
                  <div className="cfg-input">
                    <b>{cfg.weeklyHours ?? '—'}</b> h
                  </div>
                </div>
                <div className="cfg-row">
                  <label htmlFor="cfg-grace">
                    Gracia de puntualidad
                    <small>Minutos después de la hora esperada sin contar como entrada tardía.</small>
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
                  Calendario oficial de festivos de Colombia, tomado del gestor RH (fuente única).
                  {cfg.gestorUrl && (
                    <>
                      {' '}Para agregar o quitar un festivo decretado,{' '}
                      <a href={cfg.gestorUrl} target="_blank" rel="noreferrer">edítalo en el gestor ↗</a>.
                    </>
                  )}
                </p>
                {cfg.gestorError && (
                  <p className="cfg-note">⚠ No se pudo consultar el gestor: {cfg.gestorError}</p>
                )}
                <div className="holiday-list">
                  {(cfg.holidays ?? []).map((d) => (
                    <span className="holiday-chip" key={d}>
                      {new Date(d + 'T12:00:00').toLocaleDateString('es-CO', { day: 'numeric', month: 'short', year: '2-digit' })}
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
            <p className="hint">Cada sede tiene sus coordenadas y su propio radio GPS. El kiosco y el fichaje las usan de inmediato. Clic en una fila para editarla.</p>
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

        <button className="lock-btn" onClick={cerrarSesion} title="Cerrar la sesión del gestor">
          <span className="icon"><Icon name="lock" /></span>
          <span className="lbl">Cerrar sesión</span>
        </button>

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
              <span className="drawer-hours">{fmtH(pairedHours(drawerEvents, Date.now()))} en el rango</span>
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
                    <label className="ev-form-reason">Motivo del ajuste
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
                                    Agregar marcación a este día
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
              <p className="hint">Consigue lat/lon en Google Maps: clic derecho sobre el punto → copiar coordenadas. Verifica luego con el Diagnóstico GPS.</p>
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
            <p className="hint">Si cambias el nombre, los empleados asignados se actualizan automáticamente.</p>
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
                  if (!confirm(`¿Eliminar la sede "${editSede.original}"? Los empleados asignados a ella quedarán sin sede.`)) return;
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
            <p className="hint">El rostro no se edita aquí: para cambiarlo, elimina y vuelve a registrar con foto nueva.</p>
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
                  <>Jornada esperada: <strong>{fmtH(expectedDailyHours({ ...editEmp, breakMinutes: editEmp.breakMinutes === '' ? null : Number(editEmp.breakMinutes) }))}</strong> al día.
                  Salir más tarde cuenta como horas extra, no como incidencia.</>
                ) : (
                  <>Sin horario fijo: no se generan alertas de puntualidad. Las horas se calculan
                  igual sumando cada entrada y salida marcada.</>
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
                Solo para acuerdos distintos al estándar de {fmtH((cfg.weeklyHours ?? 42) / 6)}/día
                (p. ej. 7.5 h L–V y el sábado corto). La hora extra del día empieza
                donde termina la jornada pactada de ese día.
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
                      Total semanal: {fmtH(total)} / {fmtH(tope)}{' '}
                      {total > tope
                        ? '⚠ supera la jornada legal: cada semana generaría horas extra por diseño.'
                        : total < tope ? '(por debajo de la legal: válido).' : '✓'}
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
.rep-row { display: grid; grid-template-columns: 1.5fr 0.9fr 0.5fr 0.8fr 0.8fr 0.8fr 0.6fr; gap: 6px; padding: 8px 0; border-top: 1px solid var(--grid); align-items: center; }

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
.tools-title { font-size: 13.5px; font-weight: 650; margin: 14px 0 8px; }

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
  .tabbar .lock-btn { flex-direction: row; justify-content: flex-start; gap: 10px; width: 100%; font-size: 12px; padding: 10px 14px; margin-top: auto; text-transform: none; letter-spacing: normal; }
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
