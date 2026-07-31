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
import {
  listJourneyEvents,
  addManualEvent,
  updateEventTime,
  updateEventType,
  deleteEvent,
  _resetJourneys,
  NIGHT_WINDOW_MS,
} from '../services/journeyService.js';
import { listPeople, removePerson, updatePerson } from '../services/rosterService.js';
import { getLaborConfig, saveLaborConfig } from '../services/configService.js';
import { getSedes, addSede, updateSede, removeSede } from '../services/sedesService.js';

const ADMIN_PIN = '1234'; // prototipo — en producción: roles/login en Supabase
import { loadDemoData } from '../services/demoDataService.js';

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

const dayKey = (iso) => iso.slice(0, 10);
const todayKey = () => dayKey(new Date().toISOString());

const fmt12 = (iso) => {
  if (!iso) return '—';
  const d = new Date(iso);
  let h = d.getHours();
  const ap = h >= 12 ? 'p. m.' : 'a. m.';
  h = h % 12 || 12;
  return `${h}:${String(d.getMinutes()).padStart(2, '0')} ${ap}`;
};
const fmtH = (n) => (n == null ? '—' : n.toFixed(1).replace('.', ',') + ' h');
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

export default function AdminPanel() {
  const [tab, setTab] = useState('dashboard');
  const [collapsed, setCollapsed] = useState(false); // menú lateral escondido (solo PC)
  const [sedeFilter, setSedeFilter] = useState('all'); // 'all' | nombre de sede
  const [tick, setTick] = useState(0); // fuerza relectura de localStorage

  // Bloqueo del panel con PIN (persistente durante la sesión de la pestaña).
  const [locked, setLocked] = useState(true);
  const [pinInput, setPinInput] = useState('');
  const [pinError, setPinError] = useState(false);
  useEffect(() => {
    if (sessionStorage.getItem('admin_unlocked') === '1') setLocked(false);
    setCfg(getLaborConfig()); // hidratar config real del dispositivo
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
  const [newHoliday, setNewHoliday] = useState('');

  // Edición de empleado (CRUD): diálogo con datos no biométricos.
  const [editEmp, setEditEmp] = useState(null); // { id, name, cedula, sede, expectedEntry }
  const [toast, setToast] = useState(null);

  // Tabla de asistencia: búsqueda + filtro por estado + paginación.
  const PAGE_SIZE = 25;
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all'); // all|present|absent|anomaly
  const [page, setPage] = useState(0);
  const [empSearch, setEmpSearch] = useState(''); // búsqueda de la tabla Empleados

  // Drawer de detalle: línea de tiempo de marcaciones de una persona en un día.
  const [drawer, setDrawer] = useState(null); // { personId, personName, day }
  const [evForm, setEvForm] = useState(null); // { mode:'add'|'edit', eventId?, type, time, reason }
  const refresh = () => setTick((t) => t + 1);

  useEffect(() => {
    const id = setInterval(refresh, 60000); // horas "en vivo" cada minuto
    return () => clearInterval(id);
  }, []);

  const data = useMemo(() => {
    const events = listJourneyEvents().sort((a, b) => a.ts.localeCompare(b.ts));
    const nowMs = Date.now();

    // Personas: roster ∪ personas vistas en eventos (con sede y horario).
    const byId = new Map();
    for (const p of listPeople()) byId.set(p.id, { id: p.id, name: p.name, sede: p.sede || '', expectedEntry: p.expectedEntry || '' });
    for (const e of events) if (!byId.has(e.personId)) byId.set(e.personId, { id: e.personId, name: e.personName, sede: e.sede || '', expectedEntry: '' });
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

  // Desbloqueo / bloqueo del panel.
  const tryUnlock = () => {
    if (pinInput === ADMIN_PIN) {
      sessionStorage.setItem('admin_unlocked', '1');
      setLocked(false);
      setPinInput('');
      setPinError(false);
    } else {
      setPinInput('');
      setPinError(true);
    }
  };
  const lockPanel = () => {
    sessionStorage.removeItem('admin_unlocked');
    setLocked(true);
  };

  const showToast = (msg) => {
    setToast(msg);
    setTimeout(() => setToast(null), 2600);
  };

  // Abre el drawer de detalle de una persona en un día concreto.
  const openDrawer = (personId, personName, day = todayKey()) => {
    setEvForm(null);
    setDrawer({ personId, personName, day });
  };

  // Anomalías: abren el drawer en el día del evento, con el formulario
  // preconfigurado según el tipo de anomalía.
  const openFix = (a) => {
    openDrawer(a.person.id, a.person.name, dayKey(a.event.ts));
    if (a.kind === 'missing-exit') {
      setEvForm({ mode: 'add', type: 'out', time: '17:00', reason: '' });
    } else {
      const d = new Date(a.event.ts);
      setEvForm({ mode: 'edit', eventId: a.event.id, type: 'in', time: `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`, reason: '' });
    }
  };

  // Eventos del día abierto en el drawer (orden cronológico).
  const drawerEvents = useMemo(() => {
    if (!drawer) return [];
    return listJourneyEvents()
      .filter((e) => e.personId === drawer.personId && dayKey(e.ts) === drawer.day)
      .sort((a, b) => a.ts.localeCompare(b.ts));
  }, [drawer, tick]);

  const saveEvForm = () => {
    if (!evForm?.time || !evForm.reason.trim()) return;
    const iso = new Date(`${drawer.day}T${evForm.time}:00`).toISOString();
    if (evForm.mode === 'edit') {
      updateEventTime(evForm.eventId, iso, 'admin');
      const original = drawerEvents.find((e) => e.id === evForm.eventId);
      if (original && original.type !== evForm.type) updateEventType(evForm.eventId, evForm.type, 'admin');
    } else {
      addManualEvent(drawer.personId, drawer.personName, evForm.type, iso, 'admin');
    }
    setEvForm(null);
    refresh();
    showToast(`Ajuste guardado para ${drawer.personName}`);
  };

  const removeEv = (e) => {
    if (confirm(`¿Eliminar la marcación de ${e.type === 'in' ? 'entrada' : 'salida'} de las ${fmt12(e.ts)}? Úsalo solo para marcaciones erróneas.`)) {
      deleteEvent(e.id);
      refresh();
      showToast('Marcación eliminada');
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

  // ── Pantalla de bloqueo: PIN antes de mostrar cualquier dato ──────────
  if (locked) {
    return (
      <div className="admin-root locked">
        <style>{CSS}</style>
        <div className="pin-gate">
          <div className="pin-card">
            <span className="logo big" aria-hidden="true">AC</span>
            <h1>Panel del administrador</h1>
            <p className="hint">Ingresa el PIN para continuar.</p>
            <input
              type="password"
              inputMode="numeric"
              maxLength={4}
              placeholder="••••"
              value={pinInput}
              autoFocus
              onChange={(e) => { setPinInput(e.target.value.replace(/\D/g, '')); setPinError(false); }}
              onKeyDown={(e) => e.key === 'Enter' && tryUnlock()}
              aria-label="PIN de administrador"
            />
            {pinError && <p className="pin-error">PIN incorrecto. Inténtalo de nuevo.</p>}
            <button className="btn primary" onClick={tryUnlock} disabled={pinInput.length < 4}>Entrar</button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={`admin-root${collapsed ? ' nav-collapsed' : ''}`}>
      <style>{CSS}</style>

      <header className="app-header">
        <div className="brand">ArriveControl</div>
        <span className="date-note">
          {new Date().toLocaleDateString('es-CO', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
        </span>
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
            <h2>Anomalías por resolver</h2>
            <p className="hint">Marcaciones que no cierran una jornada normal. Cada corrección queda en el historial.</p>
            <div className="scrollable">
              {view.anomalies.length === 0 && <p className="empty">Sin anomalías pendientes.</p>}
              {view.anomalies.map((a, i) => (
                <div className="anomaly" key={a.event.id + i}>
                  {a.kind === 'missing-exit' ? chip('crit', 'Salida faltante') : chip('warn', 'Entrada tardía')}
                  <span className="who">{a.person.name}</span>
                  <span className="desc">
                    {a.kind === 'missing-exit'
                      ? `Entrada del ${fmtTs(a.event.ts)} sin salida registrada (más de 12 h abierta).`
                      : `Primera entrada del día a las ${fmt12(a.event.ts)} — posible olvido de marcación en la mañana.`}
                  </span>
                  <button className="btn primary" onClick={() => openFix(a)}>Corregir</button>
                </div>
              ))}
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
                <div className="att-tablewrap">
                  <table className="att-table">
                    <thead>
                      <tr><th>Empleado</th><th>Sede</th><th>Entrada</th><th>Salida</th><th className="num">Horas</th><th>Estado</th></tr>
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
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
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
              {empRows.length > 0 && (
                <div className="att-tablewrap">
                  <table className="att-table">
                    <thead>
                      <tr><th>Empleado</th><th>Cédula</th><th>Sede</th><th>Entrada esperada</th><th>Registro</th><th className="num">Acciones</th></tr>
                    </thead>
                    <tbody>
                      {empRows.map((p) => (
                        <tr key={p.id} className="static">
                          <td className="att-name">{p.name}</td>
                          <td>{p.cedula ? `C.C. ${p.cedula}` : '—'}</td>
                          <td className="att-sede">{p.sede || '—'}</td>
                          <td>{p.expectedEntry || '—'}</td>
                          <td>{new Date(p.createdAt).toLocaleDateString('es-CO', { day: 'numeric', month: 'short', year: 'numeric' })}</td>
                          <td className="num">
                            <span className="tl-actions">
                              <button
                                className="btn small"
                                onClick={() => setEditEmp({ id: p.id, name: p.name, cedula: p.cedula || '', sede: p.sede || '', expectedEntry: p.expectedEntry || '08:00' })}
                              >
                                Editar
                              </button>
                              <button
                                className="btn small danger-btn"
                                onClick={() => {
                                  if (confirm(`¿Eliminar a ${p.name}? Ya no podrá marcar asistencia.`)) {
                                    removePerson(p.id);
                                    refresh();
                                    showToast(`${p.name} eliminado`);
                                  }
                                }}
                              >
                                Eliminar
                              </button>
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
                <span><b>Reglamento laboral</b><br /><small>Jornada legal ({cfg.weeklyHours} h/sem), gracia de puntualidad y festivos ({cfg.holidays.length}).</small></span>
              </button>
              <button className="tool" onClick={() => setTab('cfg-sedes')}>
                <span className="icon"><Icon name="pin" size={19} /></span>
                <span><b>Sedes</b><br /><small>{sedes.length} sede(s) registradas — agregar, mover o cambiar el radio GPS.</small></span>
              </button>
              <Link className="tool" href="/">
                <span className="icon"><Icon name="monitor" size={19} /></span>
                <span><b>Ir al kiosco</b><br /><small>Pantalla de marcación facial (1:N).</small></span>
              </Link>
              <Link className="tool" href="/gps">
                <span className="icon"><Icon name="pin" size={19} /></span>
                <span><b>Diagnóstico GPS</b><br /><small>Precisión y distancia a cada sede desde este dispositivo.</small></span>
              </Link>
              <button
                className="tool"
                onClick={() => {
                  const r = loadDemoData();
                  refresh();
                  showToast(`Datos de prueba cargados: ${r.people} empleados, ${r.events} eventos`);
                }}
              >
                <span className="icon"><Icon name="database" size={19} /></span>
                <span><b>Cargar datos de prueba</b><br /><small>Una semana de jornadas, anomalías y correcciones de ejemplo.</small></span>
              </button>
              <button
                className="tool danger"
                onClick={() => {
                  if (confirm('¿Borrar todos los eventos de jornada de este dispositivo? Esta acción no se puede deshacer.')) {
                    _resetJourneys();
                    refresh();
                    showToast('Eventos de jornada borrados');
                  }
                }}
              >
                <span className="icon"><Icon name="trash" size={19} /></span>
                <span><b>Restablecer datos de jornadas</b><br /><small>Borra los eventos guardados en este dispositivo.</small></span>
              </button>
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
                  <label htmlFor="cfg-week">
                    Jornada legal semanal
                    <small>Colombia: 42 h (Ley 2101 de 2021). Por encima cuentan como horas extra.</small>
                  </label>
                  <div className="cfg-input">
                    <input
                      id="cfg-week" type="number" min="1" max="84" value={cfg.weeklyHours}
                      onChange={(e) => { const v = Number(e.target.value); if (v > 0) updateCfg({ weeklyHours: v }); }}
                    /> h
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
                <p className="cfg-note">Las horas trabajadas en domingo o festivo se desglosan aparte en Reportes (recargo dominical/festivo). Festivos de Colombia 2026 precargados.</p>
                <div className="holiday-add">
                  <input type="date" value={newHoliday} onChange={(e) => setNewHoliday(e.target.value)} aria-label="Nuevo festivo" />
                  <button
                    className="btn primary"
                    disabled={!newHoliday || cfg.holidays.includes(newHoliday)}
                    onClick={() => { updateCfg({ holidays: [...cfg.holidays, newHoliday].sort() }); setNewHoliday(''); }}
                  >
                    ＋ Agregar
                  </button>
                </div>
                <div className="holiday-list">
                  {cfg.holidays.map((d) => (
                    <span className="holiday-chip" key={d}>
                      {new Date(d + 'T12:00:00').toLocaleDateString('es-CO', { day: 'numeric', month: 'short' })}
                      <button aria-label={`Quitar festivo ${d}`} onClick={() => updateCfg({ holidays: cfg.holidays.filter((x) => x !== d) })}>✕</button>
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
            <h2>Sedes</h2>
            <p className="hint">Cada sede tiene sus coordenadas y su propio radio GPS. El kiosco y el fichaje las usan de inmediato.</p>
            <div className="scrollable">
              <div className="att-tablewrap">
                <table className="att-table">
                  <thead>
                    <tr><th>Sede</th><th>Latitud</th><th>Longitud</th><th>Radio</th><th>Empleados</th><th className="num">Acciones</th></tr>
                  </thead>
                  <tbody>
                    {sedes.map((o) => (
                      <tr key={o.name} className="static">
                        <td className="att-name">{o.name}</td>
                        <td>{o.lat.toFixed(6)}</td>
                        <td>{o.lon.toFixed(6)}</td>
                        <td>{o.radius} m</td>
                        <td className="att-sede">{allPeople.filter((p) => p.sede === o.name).length}</td>
                        <td className="num">
                          <span className="tl-actions">
                            <button
                              className="btn small"
                              onClick={() => setEditSede({ original: o.name, name: o.name, lat: String(o.lat), lon: String(o.lon), radius: String(o.radius) })}
                            >
                              Editar
                            </button>
                            <button
                              className="btn small danger-btn"
                              onClick={() => {
                                if (!confirm(`¿Eliminar la sede "${o.name}"? Los empleados asignados a ella quedarán sin sede.`)) return;
                                const r = removeSede(o.name);
                                if (r.error) { showToast(r.error); return; }
                                if (sedeFilter === o.name) setSedeFilter('all');
                                refresh();
                                showToast(`Sede "${o.name}" eliminada`);
                              }}
                            >
                              Eliminar
                            </button>
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="cfg-group">
                <h3>＋ Nueva sede</h3>
                <div className="sede-fields">
                  <label>Nombre
                    <input type="text" placeholder="Ej.: Bodega Norte" value={newSede.name} onChange={(e) => setNewSede({ ...newSede, name: e.target.value })} />
                  </label>
                  <label>Latitud
                    <input type="number" step="0.000001" placeholder="1.212981" value={newSede.lat} onChange={(e) => setNewSede({ ...newSede, lat: e.target.value })} />
                  </label>
                  <label>Longitud
                    <input type="number" step="0.000001" placeholder="-77.280157" value={newSede.lon} onChange={(e) => setNewSede({ ...newSede, lon: e.target.value })} />
                  </label>
                  <label>Radio (m)
                    <input type="number" min="10" max="1000" value={newSede.radius} onChange={(e) => setNewSede({ ...newSede, radius: e.target.value })} />
                  </label>
                </div>
                <p className="cfg-note">Consigue lat/lon en Google Maps: clic derecho sobre el punto → copiar coordenadas. Verifica luego con el Diagnóstico GPS.</p>
                <button
                  className="btn primary"
                  disabled={!newSede.name.trim() || newSede.lat === '' || newSede.lon === ''}
                  onClick={() => {
                    const r = addSede({ name: newSede.name, lat: Number(newSede.lat), lon: Number(newSede.lon), radius: Number(newSede.radius) || 50 });
                    if (r.error) { showToast(r.error); return; }
                    setNewSede({ name: '', lat: '', lon: '', radius: '50' });
                    refresh();
                    showToast(`Sede "${r.name}" creada`);
                  }}
                >
                  Guardar sede
                </button>
              </div>
            </div>
          </section>
        )}
      </div>

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
          <button key={t.id} aria-pressed={tab === t.id} onClick={() => setTab(t.id)} title={t.label}>
            <span className="icon"><Icon name={t.icon} /></span>
            <span className="lbl">{t.label}</span>
            {t.badge ? <span className="badge">{t.badge}</span> : null}
          </button>
        ))}

        <button className="lock-btn" onClick={lockPanel} title="Bloquear el panel">
          <span className="icon"><Icon name="lock" /></span>
          <span className="lbl">Bloquear</span>
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

            <div className="drawer-day">
              <label htmlFor="d-day">Día</label>
              <input
                id="d-day" type="date" value={drawer.day} max={todayKey()}
                onChange={(e) => { setDrawer({ ...drawer, day: e.target.value }); setEvForm(null); }}
              />
              <span className="drawer-hours">{fmtH(pairedHours(drawerEvents, Date.now()))} trabajadas</span>
            </div>

            <div className="drawer-body">
              {drawerEvents.length === 0 && <p className="empty">Sin marcaciones este día. Agrega la entrada y la salida si la persona sí trabajó.</p>}
              {drawerEvents.map((e) => (
                <div className="tl-row" key={e.id}>
                  <span className={`tl-type ${e.type}`}>{e.type === 'in' ? 'Entrada' : 'Salida'}</span>
                  <span className="tl-time">{fmt12(e.ts)}</span>
                  <span className="tl-flag">
                    {e.flag === 'manual' ? 'manual' : e.flag === 'corrected' ? 'corregida' : e.flag === 'late-entry' ? 'tardía' : 'kiosco'}
                  </span>
                  <span className="tl-actions">
                    <button
                      className="btn small"
                      onClick={() => {
                        const d = new Date(e.ts);
                        setEvForm({ mode: 'edit', eventId: e.id, type: e.type, time: `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`, reason: '' });
                      }}
                    >
                      Editar
                    </button>
                    <button className="btn small danger-btn" onClick={() => removeEv(e)}>Eliminar</button>
                  </span>
                </div>
              ))}

              {!evForm && (
                <button className="btn block" onClick={() => setEvForm({ mode: 'add', type: drawerEvents.length % 2 === 0 ? 'in' : 'out', time: '08:00', reason: '' })}>
                  Agregar marcación
                </button>
              )}

              {evForm && (
                <div className="ev-form">
                  <h4>{evForm.mode === 'edit' ? 'Editar marcación' : 'Nueva marcación'}</h4>
                  <div className="ev-form-row">
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
                    />
                  </label>
                  <div className="dialog-actions">
                    <button className="btn" onClick={() => setEvForm(null)}>Cancelar</button>
                    <button className="btn primary" disabled={!evForm.reason.trim()} onClick={saveEvForm}>Guardar</button>
                  </div>
                </div>
              )}
            </div>
          </aside>
        </div>
      )}

      {/* Diálogo de edición de sede (incluye renombrar, propagando al roster) */}
      {editSede && (
        <div className="overlay" onClick={(e) => e.target === e.currentTarget && setEditSede(null)}>
          <div className="dialog" role="dialog" aria-modal="true">
            <h3>Editar sede — {editSede.original}</h3>
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
                onClick={() => {
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
                  const r = updateSede(editSede.original, { name, lat, lon, radius });
                  if (r.error) { showToast(r.error); return; }
                  // Renombrado: propagar a empleados asignados y al filtro activo.
                  if (name !== editSede.original) {
                    for (const p of listPeople()) {
                      if (p.sede === editSede.original) updatePerson(p.id, { sede: name });
                    }
                    if (sedeFilter === editSede.original) setSedeFilter(name);
                  }
                  setEditSede(null);
                  refresh();
                  showToast('Sede actualizada');
                }}
              >
                Guardar cambios
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Diálogo de edición de empleado (CRUD: actualizar datos no biométricos) */}
      {editEmp && (
        <div className="overlay" onClick={(e) => e.target === e.currentTarget && setEditEmp(null)}>
          <div className="dialog" role="dialog" aria-modal="true">
            <h3>Editar empleado — {editEmp.name}</h3>
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
              <label htmlFor="e-hora">Hora esperada de entrada</label>
              <input id="e-hora" type="time" value={editEmp.expectedEntry} onChange={(e) => setEditEmp({ ...editEmp, expectedEntry: e.target.value })} />
            </div>
            <div className="dialog-actions">
              <button className="btn" onClick={() => setEditEmp(null)}>Cancelar</button>
              <button
                className="btn primary"
                disabled={!editEmp.name.trim()}
                onClick={() => {
                  const r = updatePerson(editEmp.id, {
                    name: editEmp.name,
                    cedula: editEmp.cedula,
                    sede: editEmp.sede,
                    expectedEntry: editEmp.expectedEntry,
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

.app-header { display: flex; flex-wrap: wrap; align-items: baseline; gap: 4px 16px; flex: 0 0 auto; }
.app-header .brand {
  font-family: var(--f-display); font-size: 11px; letter-spacing: .24em;
  text-transform: uppercase; color: var(--accent); font-weight: 700;
}
.app-header h1 { font-family: var(--f-display); font-size: 17px; font-weight: 700; letter-spacing: .04em; text-transform: uppercase; }
.app-header .date-note { color: var(--muted); font-size: 12.5px; font-family: var(--f-data); }

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

/* Filtro global de sede (select en el menú lateral).
   Móvil: fila que ocupa todo el ancho de la barra inferior. */
.side-sede { grid-column: 1 / -1; display: flex; align-items: center; gap: 8px; padding: 6px 4px 4px; border-bottom: 1px solid var(--grid); margin-bottom: 4px; }
.side-sede-lbl { font-size: 10px; letter-spacing: .08em; text-transform: uppercase; color: var(--muted); }
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

/* Pantalla de bloqueo (PIN) — .locked anula el grid del escritorio para que
   el PIN quede centrado en toda la pantalla (no en la columna del sidebar) */
.admin-root.locked { display: flex; align-items: center; justify-content: center; max-width: none; height: 100dvh; padding: 20px; }
.pin-gate { display: flex; align-items: center; justify-content: center; width: 100%; }
.pin-card { background: var(--surface); border: 1px solid var(--border); border-radius: 16px; padding: 28px 24px; max-width: 320px; width: 100%; text-align: center; display: flex; flex-direction: column; gap: 10px; }
.pin-card h1 { font-size: 17px; font-weight: 650; }
.pin-card .hint { font-size: 13px; color: var(--muted); }
.pin-card input { font: inherit; font-size: 24px; letter-spacing: 10px; text-align: center; padding: 10px; border-radius: 10px; border: 1px solid var(--border); background: var(--page); color: var(--ink); }
.pin-error { color: var(--crit-text); font-size: 13px; }
.logo.big { width: 48px; height: 48px; font-size: 18px; margin: 0 auto; border-radius: 10px; display: flex; align-items: center; justify-content: center; background: var(--accent); color: var(--accent-ink); font-family: var(--f-display); font-weight: 800; letter-spacing: .04em; }

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

.tabbar { display: grid; grid-template-columns: repeat(4, 1fr); gap: 2px; flex: 0 0 auto; padding: 6px 4px 8px; background: var(--surface); border: 1px solid var(--grid); border-radius: 10px; box-shadow: var(--elev-1); }
/* móvil: el botón bloquear se integra a la rejilla de pestañas */
.tabbar .lock-btn { flex-direction: column; gap: 2px; font-size: 9px; letter-spacing: .08em; text-transform: uppercase; padding: 6px 2px; justify-content: center; align-items: center; }
.tabbar .lock-btn .icon { font-size: 18px; }
.tabbar > button { position: relative; border: 0; background: transparent; color: var(--muted); font-family: var(--f-display); font-size: 9px; font-weight: 600; letter-spacing: .04em; cursor: pointer; display: flex; flex-direction: column; align-items: center; gap: 3px; padding: 6px 2px; border-radius: 8px; }
.tabbar > button .icon { display: flex; line-height: 1; }
.tabbar > button[aria-pressed="true"] { color: var(--accent); background: var(--accent-soft); }
.tabbar .badge { position: absolute; top: 2px; right: calc(50% - 20px); min-width: 16px; height: 16px; border-radius: 8px; background: var(--accent); color: #fff; font-size: 10.5px; font-weight: 700; display: flex; align-items: center; justify-content: center; padding: 0 4px; }

/* Cabecera y pie del menú lateral: solo existen en la vista PC */
.side-top, .side-foot { display: none; }

.overlay { position: fixed; inset: 0; background: rgba(0,0,0,.4); display: flex; align-items: center; justify-content: center; padding: 16px; z-index: 50; }
.dialog { background: var(--surface); color: var(--ink); border: 1px solid var(--grid); border-radius: 10px; padding: 18px 20px; max-width: 400px; width: 100%; box-shadow: 0 12px 40px rgba(16,24,40,0.18); }
.dialog h3 { font-family: var(--f-display); font-size: 14px; font-weight: 700; color: var(--ink); margin-bottom: 2px; }
.dialog .hint { font-size: 13px; color: var(--muted); margin-bottom: 12px; }
.field { display: flex; flex-direction: column; gap: 4px; margin-bottom: 12px; }
.field label { font-size: 13px; font-weight: 600; color: var(--ink-2); }
.field input, .field select { font-family: var(--f-data); font-size: 14px; padding: 7px 10px; border-radius: 8px; border: 1px solid var(--border); background: var(--page); color: var(--ink); color-scheme: light; }
.dialog-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 4px; }

.toast { position: fixed; left: 50%; bottom: 20px; transform: translateX(-50%); background: var(--ink); color: #fff; font-family: var(--f-data); font-size: 13.5px; padding: 9px 18px; border-radius: 8px; z-index: 60; box-shadow: var(--elev-2); }

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
.att-table .att-name { font-weight: 600; }
.att-table .att-sede { color: var(--muted); }
.pager { display: flex; align-items: center; justify-content: center; gap: 12px; padding-top: 10px; font-size: 12.5px; color: var(--muted); }

/* Drawer de detalle (marcaciones del día) */
.overlay.right { justify-content: flex-end; padding: 0; }
.drawer { background: var(--surface); color: var(--ink); width: 100%; max-width: 420px; height: 100%; display: flex; flex-direction: column; border-left: 1px solid var(--grid); box-shadow: -8px 0 30px rgba(16,24,40,0.12); }
.drawer-head { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 16px 18px 12px; border-bottom: 1px solid var(--grid); }
.drawer-head h3 { font-family: var(--f-display); font-size: 15px; font-weight: 700; }
.drawer-id { font-size: 12px; color: var(--muted); }
.drawer-day { display: flex; align-items: center; gap: 10px; padding: 12px 18px; border-bottom: 1px solid var(--grid); font-size: 12.5px; color: var(--muted); }
.drawer-day input { font: inherit; font-size: 13.5px; padding: 6px 10px; border-radius: 6px; border: 1px solid var(--grid); background: var(--surface); color: var(--ink); }
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
    grid-column: 1; grid-row: 1 / 3;
    display: flex; flex-direction: column; gap: 4px;
    align-self: stretch; height: 100%;
    padding: 18px 14px 14px;
    border-radius: 0; border: none; border-right: 1px solid var(--grid);
    box-shadow: none;
  }
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
