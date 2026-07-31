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
  _resetJourneys,
  NIGHT_WINDOW_MS,
} from '../services/journeyService.js';
import { listPeople, removePerson } from '../services/rosterService.js';
import { getLaborConfig, saveLaborConfig } from '../services/configService.js';
import { OFFICE_LOCATIONS } from '../utils/haversine.js';

const ADMIN_PIN = '1234'; // prototipo — en producción: roles/login en Supabase
import { loadDemoData } from '../services/demoDataService.js';

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
  const [toast, setToast] = useState(null);
  const [dialog, setDialog] = useState(null); // { personId, personName, type, time, reason, eventId? }
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
    const sedeNames = OFFICE_LOCATIONS.map((o) => o.name);
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
        return {
          id,
          name: r.name,
          cedula: rosterById.get(id)?.cedula || '',
          sede: r.sede || rosterById.get(id)?.sede || '',
          days: new Set(r.events.filter((e) => e.type === 'in').map((e) => dayKey(e.ts))).size,
          hours: pairedHours(r.events, nowMs),
          extras,
          lateCount: r.events.filter((e) => e.flag === 'late-entry').length,
        };
      })
      .filter((r) => sedeFilter === 'all' || r.sede === sedeFilter)
      .sort((a, b) => b.hours - a.hours);
  }, [tick, repFrom, repTo, sedeFilter, cfg]);

  // Exporta el reporte visible a CSV (separador ; — Excel en español).
  const exportCSV = () => {
    const head = ['Empleado', 'Cédula', 'Sede', 'Días trabajados', 'Horas totales', `Horas extra (>${cfg.weeklyHours}h/sem)`, 'Entradas tardías'];
    const lines = report.map((r) => [r.name, r.cedula, r.sede, r.days, r.hours.toFixed(2).replace('.', ','), r.extras.toFixed(2).replace('.', ','), r.lateCount]);
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

  const saveAdjust = () => {
    const { personId, personName, type, time, reason, eventId } = dialog;
    if (!time || !reason.trim()) return;
    const iso = new Date(`${todayKey()}T${time}:00`).toISOString();
    if (eventId) updateEventTime(eventId, iso, 'admin');
    else addManualEvent(personId, personName, type, iso, 'admin');
    setDialog(null);
    refresh();
    showToast(`Ajuste guardado para ${personName}`);
  };

  const openFix = (a) => {
    if (a.kind === 'missing-exit') {
      setDialog({ personId: a.person.id, personName: a.person.name, type: 'out', time: '17:00', reason: '' });
    } else {
      setDialog({ personId: a.person.id, personName: a.person.name, type: 'in', time: '08:00', reason: '', eventId: a.event.id });
    }
  };

  const tabs = [
    { id: 'dashboard', icon: '📊', label: 'Dashboard' },
    { id: 'anomalias', icon: '⚠️', label: 'Anomalías', badge: data.anomalies.length },
    { id: 'equipo', icon: '🕐', label: 'Asistencia' },
    { id: 'empleados', icon: '👤', label: 'Empleados' },
    { id: 'reportes', icon: '📄', label: 'Reportes' },
    { id: 'historial', icon: '📋', label: 'Historial' },
    { id: 'ajustes', icon: '⚙️', label: 'Ajustes' },
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
        <option value="all">🌐 Todas las sedes</option>
        {OFFICE_LOCATIONS.map((o) => (
          <option key={o.name} value={o.name}>📍 {o.name}</option>
        ))}
      </select>
    </div>
  );

  // ── Pantalla de bloqueo: PIN antes de mostrar cualquier dato ──────────
  if (locked) {
    return (
      <div className="admin-root">
        <style>{CSS}</style>
        <div className="pin-gate">
          <div className="pin-card">
            <span className="logo big" aria-hidden="true">⏱</span>
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
                      <span className="sede-name">📍 {s.name}</span>
                      <span>{s.present}/{s.total}</span>
                      <span className={s.absent > 0 ? 'warn-num' : ''}>{s.absent}</span>
                      <span>{fmtH(s.hours)}</span>
                      <span className={s.anomalies > 0 ? 'crit-num' : ''}>{s.anomalies}</span>
                    </div>
                  ))}
                </div>
                {data.sinSede > 0 && (
                  <p className="axis-note">⚠️ {data.sinSede} empleado(s) sin sede asignada — re-regístralos o asígnales sede al migrar a base de datos.</p>
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
              {view.anomalies.length === 0 && <p className="empty">✓ No hay anomalías pendientes. Todo en orden.</p>}
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
            <h2>Asistencia de hoy</h2>
            <p className="hint">Entrada, salida y horas por empleado. Usa «Ajustar» para agregar o corregir una marcación.</p>
            <div className="scrollable">
              {view.rows.length === 0 && <p className="empty">No hay personas {sedeFilter === 'all' ? 'registradas' : `en ${sedeFilter}`}.</p>}
              {view.rows.map((r) => (
                <div className="emp-card" key={r.person.id}>
                  <div className="emp-head">
                    <div>
                      <span className="emp-name">{r.person.name}</span>
                      <span className="emp-id"> · {r.sede || 'sin sede'}</span>
                    </div>
                    {statusChip(r)}
                  </div>
                  <div className="emp-data">
                    <span><b>Entrada</b> {fmt12(r.firstIn?.ts)}</span>
                    <span><b>Salida</b> {fmt12(r.lastOut?.ts)}</span>
                    <span><b>Horas</b> {fmtH(r.hoursToday)}</span>
                  </div>
                  <button
                    className="btn"
                    onClick={() => setDialog({ personId: r.person.id, personName: r.person.name, type: 'out', time: '17:00', reason: '' })}
                  >
                    Ajustar
                  </button>
                </div>
              ))}
            </div>
          </section>
        )}

        {tab === 'empleados' && (
          <section className="card grow">
            <h2>Empleados registrados <span className="muted-count">{roster.length}</span></h2>
            <p className="hint">Personas que pueden marcar en el kiosco. El registro es por foto, con cédula, sede y horario.</p>
            <Link className="btn primary block" href="/admin/registro">＋ Registrar empleado</Link>
            <div className="scrollable">
              {roster.length === 0 && <p className="empty">No hay empleados {sedeFilter === 'all' ? 'registrados' : `en ${sedeFilter}`}.</p>}
              {roster.map((p) => (
                <div className="emp-card" key={p.id}>
                  <div className="emp-head">
                    <div>
                      <span className="emp-name">{p.name}</span>
                      <span className="emp-id"> · {p.cedula ? `C.C. ${p.cedula}` : 'sin cédula'}</span>
                    </div>
                    <button
                      className="btn danger-btn"
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
                  </div>
                  <div className="emp-data">
                    <span><b>Sede</b> {p.sede || '—'}</span>
                    <span><b>Entrada esperada</b> {p.expectedEntry || '—'}</span>
                    <span><b>Registro</b> {new Date(p.createdAt).toLocaleDateString('es-CO', { day: 'numeric', month: 'short', year: 'numeric' })}</span>
                  </div>
                </div>
              ))}
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
              <button className="btn primary" onClick={exportCSV} disabled={report.length === 0}>⬇ Exportar CSV</button>
            </div>
            <div className="scrollable">
              {report.length === 0 && <p className="empty">Sin marcaciones en este período{sedeFilter !== 'all' ? ` para ${sedeFilter}` : ''}.</p>}
              {report.length > 0 && (
                <div className="rep-table" role="table">
                  <div className="rep-row head" role="row">
                    <span>Empleado</span><span>Sede</span><span>Días</span><span>Horas</span><span>Extras</span><span>Tardías</span>
                  </div>
                  {report.map((r) => (
                    <div className="rep-row" role="row" key={r.id}>
                      <span className="rep-name">{r.name}</span>
                      <span>{r.sede || '—'}</span>
                      <span>{r.days}</span>
                      <span>{fmtH(r.hours)}</span>
                      <span className={r.extras > 0 ? 'warn-num' : ''}>{r.extras > 0 ? fmtH(r.extras) : '—'}</span>
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
            <p className="hint">Reglamento laboral y herramientas del sistema.</p>
            <div className="scrollable">
              {/* Reglamento interno — regula extras y puntualidad en todo el panel */}
              <div className="cfg-group">
                <h3>⚖️ Reglamento laboral</h3>
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

              {/* Sedes (solo lectura por ahora) */}
              <div className="cfg-group">
                <h3>📍 Sedes registradas</h3>
                {OFFICE_LOCATIONS.map((o) => (
                  <div className="cfg-sede" key={o.name}>
                    <span>{o.name}</span>
                    <small>{o.lat.toFixed(5)}, {o.lon.toFixed(5)}</small>
                  </div>
                ))}
                <p className="cfg-note">Para agregar o mover sedes, edita <code>utils/haversine.js</code> (editable desde el panel al migrar a base de datos).</p>
              </div>

              <h3 className="tools-title">Herramientas</h3>
              <Link className="tool" href="/">
                <span className="icon">🖥️</span>
                <span><b>Ir al kiosco</b><br /><small>La pantalla de marcación facial (1:N).</small></span>
              </Link>
              <Link className="tool" href="/gps">
                <span className="icon">📍</span>
                <span><b>Diagnóstico GPS</b><br /><small>Verifica precisión y distancia a cada sede desde este dispositivo.</small></span>
              </Link>
              <button
                className="tool"
                onClick={() => {
                  const r = loadDemoData();
                  refresh();
                  showToast(`Datos demo cargados: ${r.people} empleados, ${r.events} eventos`);
                }}
              >
                <span className="icon">✨</span>
                <span><b>Cargar datos de demostración</b><br /><small>Una semana de jornadas, anomalías y correcciones de ejemplo.</small></span>
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
                <span className="icon">🗑️</span>
                <span><b>Restablecer datos de jornadas</b><br /><small>Borra los eventos de prueba guardados en este dispositivo.</small></span>
              </button>
            </div>
          </section>
        )}
      </div>

      <nav className="tabbar" aria-label="Navegación del panel">
        {/* Cabecera del menú lateral (solo PC): logo + nombre + botón esconder */}
        <div className="side-top">
          <span className="logo" aria-hidden="true">⏱</span>
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
            {collapsed ? '»' : '«'}
          </button>
        </div>

        {/* Filtro global de sede (arriba del menú): aplica a todas las vistas */}
        {sedeChips}

        {tabs.map((t) => (
          <button key={t.id} aria-pressed={tab === t.id} onClick={() => setTab(t.id)} title={t.label}>
            <span className="icon">{t.icon}</span>
            <span className="lbl">{t.label}</span>
            {t.badge ? <span className="badge">{t.badge}</span> : null}
          </button>
        ))}

        <button className="lock-btn" onClick={lockPanel} title="Bloquear el panel">
          <span className="icon">🔒</span>
          <span className="lbl">Bloquear</span>
        </button>

        <div className="side-foot">v0.1 · prototipo</div>
      </nav>

      {dialog && (
        <div className="overlay" onClick={(e) => e.target === e.currentTarget && setDialog(null)}>
          <div className="dialog" role="dialog" aria-modal="true">
            <h3>{dialog.eventId ? 'Corregir marcación' : 'Ajustar marcación'} — {dialog.personName}</h3>
            <p className="hint">
              {dialog.eventId
                ? 'Cambia la hora del evento a la hora real. Quedará marcado como corregido.'
                : 'Agrega una entrada o salida manual de hoy. Quedará marcada como manual.'}
            </p>
            {!dialog.eventId && (
              <div className="field">
                <label htmlFor="f-tipo">Tipo de marcación</label>
                <select id="f-tipo" value={dialog.type} onChange={(e) => setDialog({ ...dialog, type: e.target.value })}>
                  <option value="in">Entrada</option>
                  <option value="out">Salida</option>
                </select>
              </div>
            )}
            <div className="field">
              <label htmlFor="f-hora">Hora</label>
              <input id="f-hora" type="time" value={dialog.time} onChange={(e) => setDialog({ ...dialog, time: e.target.value })} />
            </div>
            <div className="field">
              <label htmlFor="f-motivo">Motivo del ajuste</label>
              <input
                id="f-motivo" type="text" placeholder="Ej.: olvidó marcar la salida"
                value={dialog.reason} onChange={(e) => setDialog({ ...dialog, reason: e.target.value })}
              />
            </div>
            <div className="dialog-actions">
              <button className="btn" onClick={() => setDialog(null)}>Cancelar</button>
              <button className="btn primary" disabled={!dialog.reason.trim()} onClick={saveAdjust}>Guardar ajuste</button>
            </div>
          </div>
        </div>
      )}

      {toast && <div className="toast show" role="status">{toast}</div>}
    </div>
  );
}

const CSS = `
.admin-root {
  /* Tema claro monocromo: fondo blanco y un solo AZUL en distintas tonalidades
     (de más claro a más profundo: #7cc8f5 → #0d8ce8 → #2b6bff → #1636c8) */
  --page: #f2f5fb;
  --surface: #ffffff;
  --ink: #0e1a30; --ink-2: #42536e; --muted: #7d8aa3;
  --grid: #e2e8f4; --border: rgba(13,140,232,0.16);
  --accent: #0d8ce8; --accent-2: #2b6bff; --accent-ink: #ffffff;
  --accent-soft: rgba(13,140,232,0.08);
  --glow: 0 0 14px rgba(13,140,232,0.28);
  --glow-2: 0 0 14px rgba(43,107,255,0.28);
  /* Elevaciones (estilo 3D suave): luz desde arriba-izquierda, sombra abajo */
  --elev-1: 0 1px 2px rgba(14,26,48,0.06), 0 6px 16px rgba(14,26,48,0.09), inset 0 1px 0 rgba(255,255,255,0.9);
  --elev-2: 0 2px 4px rgba(14,26,48,0.08), 0 14px 34px rgba(14,26,48,0.14), inset 0 1px 0 rgba(255,255,255,0.9);
  --press: inset 0 2px 6px rgba(14,26,48,0.12), inset 0 -1px 0 rgba(255,255,255,0.7);
  /* Estados en el mismo azul, diferenciados por tonalidad + texto del chip:
     ok = azul cielo · aviso = azul medio · crítico = azul eléctrico profundo */
  --good-text: #0d8ce8; --good-soft: rgba(13,140,232,0.09);
  --warn-text: #2b6bff; --warn-soft: rgba(43,107,255,0.10);
  --crit: #1636c8; --crit-text: #1636c8; --crit-soft: rgba(22,54,200,0.10);

  /* Montserrat para todo; los roles se diferencian por peso y espaciado */
  --f-display: var(--font-montserrat), system-ui, sans-serif;
  --f-data: var(--font-montserrat), system-ui, sans-serif;
  --f-body: var(--font-montserrat), system-ui, sans-serif;

  font-family: var(--f-body);
  font-weight: 300;
  color: var(--ink);
  background:
    radial-gradient(ellipse 80% 50% at 50% -10%, rgba(13,140,232,0.08), transparent),
    radial-gradient(ellipse 60% 40% at 90% 110%, rgba(43,107,255,0.07), transparent),
    var(--page);
  height: 100dvh; max-width: 560px; margin: 0 auto;
  display: flex; flex-direction: column; gap: 10px;
  padding: 14px 12px 10px; box-sizing: border-box;
}
.admin-root * { box-sizing: border-box; margin: 0; }
.admin-root b, .admin-root .emp-name, .admin-root .who { font-weight: 600; }

.app-header { display: flex; flex-wrap: wrap; align-items: baseline; gap: 4px 16px; flex: 0 0 auto; }
.app-header .brand {
  font-family: var(--f-display); font-size: 11px; letter-spacing: .32em;
  text-transform: uppercase; color: var(--accent); font-weight: 700;
  text-shadow: var(--glow);
}
.app-header h1 { font-family: var(--f-display); font-size: 17px; font-weight: 700; letter-spacing: .04em; text-transform: uppercase; }
.app-header .date-note { color: var(--muted); font-size: 12.5px; font-family: var(--f-data); }

.screen { flex: 1 1 auto; min-height: 0; display: flex; flex-direction: column; gap: 10px; }
.card { background: var(--surface); border: 1px solid var(--border); border-radius: 12px; padding: 14px; box-shadow: var(--elev-1); }
.card.grow { flex: 1 1 auto; min-height: 0; display: flex; flex-direction: column; }
.card h2 { font-family: var(--f-display); font-size: 13px; font-weight: 700; letter-spacing: .08em; text-transform: uppercase; margin-bottom: 2px; color: var(--accent); }
.card .hint { font-size: 13px; color: var(--muted); margin-bottom: 10px; }
.scrollable { overflow-y: auto; flex: 1 1 auto; min-height: 0; overscroll-behavior: contain; padding-right: 2px; }
.axis-note { font-size: 12px; color: var(--muted); margin-top: 8px; }
.empty { color: var(--muted); font-size: 14px; padding: 8px 0; }

.tiles { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; flex: 0 0 auto; }
.tile { background: var(--surface); border: 1px solid var(--border); border-radius: 12px; padding: 10px 12px; box-shadow: var(--elev-1); }
.tile .label { font-family: var(--f-display); font-size: 9.5px; letter-spacing: .18em; text-transform: uppercase; color: var(--muted); }
.tile .value { font-family: var(--f-data); font-size: 24px; font-weight: 700; line-height: 1.2; color: var(--accent); text-shadow: var(--glow); }
.tile .sub { font-size: 12.5px; color: var(--ink-2); }
.tile.alerta .value { color: var(--crit-text); text-shadow: 0 0 14px rgba(22,54,200,0.30); }

.chip { display: inline-flex; align-items: center; gap: 6px; font-family: var(--f-data); font-size: 12px; font-weight: 600; padding: 2px 10px; border-radius: 999px; white-space: nowrap; border: 1px solid currentColor; }
.chip::before { content: ""; width: 7px; height: 7px; border-radius: 50%; background: currentColor; box-shadow: 0 0 8px currentColor; }
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

/* Pantalla de bloqueo (PIN) */
.pin-gate { min-height: 100dvh; display: flex; align-items: center; justify-content: center; padding: 20px; }
.pin-card { background: var(--surface); border: 1px solid var(--border); border-radius: 16px; padding: 28px 24px; max-width: 320px; width: 100%; text-align: center; display: flex; flex-direction: column; gap: 10px; }
.pin-card h1 { font-size: 17px; font-weight: 650; }
.pin-card .hint { font-size: 13px; color: var(--muted); }
.pin-card input { font: inherit; font-size: 24px; letter-spacing: 10px; text-align: center; padding: 10px; border-radius: 10px; border: 1px solid var(--border); background: var(--page); color: var(--ink); }
.pin-error { color: var(--crit-text); font-size: 13px; }
.logo.big { width: 52px; height: 52px; font-size: 26px; margin: 0 auto; border-radius: 14px; display: flex; align-items: center; justify-content: center; background: linear-gradient(135deg, var(--accent), var(--accent-2)); color: var(--accent-ink); }

/* Empleados / Reportes */
.muted-count { color: var(--muted); font-weight: 400; }
.btn.block { display: block; width: 100%; text-align: center; text-decoration: none; margin-bottom: 10px; box-sizing: border-box; }
.danger-btn { color: var(--crit-text); border-color: var(--crit-soft); }
.danger-btn:hover { background: var(--crit-soft); }
.rep-controls { display: flex; flex-wrap: wrap; align-items: end; gap: 10px; margin-bottom: 10px; }
.rep-controls label { display: flex; flex-direction: column; gap: 3px; font-size: 12px; color: var(--muted); }
.rep-controls input { font: inherit; font-size: 13.5px; padding: 7px 10px; border-radius: 8px; border: 1px solid var(--border); background: var(--page); color: var(--ink); }
.rep-table { display: flex; flex-direction: column; font-size: 13px; font-variant-numeric: tabular-nums; }
.rep-row { display: grid; grid-template-columns: 1.6fr 1fr 0.6fr 0.9fr 0.7fr; gap: 6px; padding: 8px 0; border-top: 1px solid var(--grid); align-items: center; }
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
.hrow .fill.over { background: linear-gradient(90deg, var(--accent), var(--warn-text)); }
.hrow .limit { position: absolute; top: -2px; bottom: -2px; width: 2px; background: var(--crit); opacity: .7; }
.hrow .val .extra { display: block; font-style: normal; font-size: 10.5px; color: var(--warn-text); font-weight: 700; }

/* Botón bloquear del menú */
.lock-btn { border: 0; background: transparent; color: var(--muted); font: inherit; font-size: 12px; font-weight: 600; cursor: pointer; display: flex; align-items: center; gap: 10px; padding: 10px 14px; border-radius: 12px; }
.lock-btn:hover { background: var(--crit-soft); color: var(--crit-text); }

.btn { border: 1px solid var(--border); background: var(--surface); color: var(--accent); font-family: var(--f-data); font-size: 13.5px; padding: 7px 14px; border-radius: 8px; cursor: pointer; box-shadow: 0 1px 2px rgba(14,26,48,0.08), 0 3px 8px rgba(14,26,48,0.08); }
.btn:hover { background: var(--accent-soft); box-shadow: var(--glow); }
.btn:active { box-shadow: var(--press); transform: translateY(1px); }
.btn.primary { background: linear-gradient(135deg, var(--accent), var(--accent-2)); border-color: transparent; color: var(--accent-ink); font-weight: 700; box-shadow: 0 2px 4px rgba(14,26,48,0.15), 0 8px 20px rgba(13,140,232,0.35), inset 0 1px 0 rgba(255,255,255,0.25); }
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
.hrow .fill { position: absolute; inset: 0 auto 0 0; background: linear-gradient(90deg, var(--accent), var(--accent-2)); border-radius: 0 4px 4px 0; min-width: 2px; box-shadow: 0 0 10px rgba(13,140,232,0.35); }
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

.tabbar { display: grid; grid-template-columns: repeat(4, 1fr); gap: 2px; flex: 0 0 auto; padding: 6px 4px 8px; background: var(--surface); border: 1px solid var(--border); border-radius: 18px; box-shadow: 0 2px 14px rgba(14,26,48,0.06); }
/* móvil: el botón bloquear se integra a la rejilla de pestañas */
.tabbar .lock-btn { flex-direction: column; gap: 2px; font-size: 9px; letter-spacing: .08em; text-transform: uppercase; padding: 6px 2px; justify-content: center; align-items: center; }
.tabbar .lock-btn .icon { font-size: 18px; }
.tabbar > button { position: relative; border: 0; background: transparent; color: var(--muted); font-family: var(--f-display); font-size: 9px; font-weight: 600; letter-spacing: .08em; text-transform: uppercase; cursor: pointer; display: flex; flex-direction: column; align-items: center; gap: 2px; padding: 6px 2px; border-radius: 12px; }
.tabbar > button .icon { font-size: 18px; line-height: 1; }
.tabbar > button[aria-pressed="true"] { color: var(--accent-ink); background: linear-gradient(135deg, var(--accent), var(--accent-2)); box-shadow: var(--glow), var(--glow-2); }
.tabbar .badge { position: absolute; top: 2px; right: calc(50% - 20px); min-width: 16px; height: 16px; border-radius: 999px; background: var(--crit); color: #fff; font-size: 10.5px; font-weight: 700; display: flex; align-items: center; justify-content: center; padding: 0 4px; box-shadow: 0 0 10px rgba(22,54,200,0.4); }

/* Cabecera y pie del menú lateral: solo existen en la vista PC */
.side-top, .side-foot { display: none; }

.overlay { position: fixed; inset: 0; background: rgba(0,0,0,.4); display: flex; align-items: center; justify-content: center; padding: 16px; z-index: 50; }
.dialog { background: var(--surface); color: var(--ink); border: 1px solid var(--accent); border-radius: 14px; padding: 18px 20px; max-width: 400px; width: 100%; box-shadow: var(--glow), 0 12px 40px rgba(14,26,48,0.18); }
.dialog h3 { font-family: var(--f-display); font-size: 13px; font-weight: 700; letter-spacing: .06em; text-transform: uppercase; color: var(--accent); margin-bottom: 2px; }
.dialog .hint { font-size: 13px; color: var(--muted); margin-bottom: 12px; }
.field { display: flex; flex-direction: column; gap: 4px; margin-bottom: 12px; }
.field label { font-size: 13px; font-weight: 600; color: var(--ink-2); }
.field input, .field select { font-family: var(--f-data); font-size: 14px; padding: 7px 10px; border-radius: 8px; border: 1px solid var(--border); background: var(--page); color: var(--ink); color-scheme: light; }
.dialog-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 4px; }

.toast { position: fixed; left: 50%; bottom: 20px; transform: translateX(-50%); background: var(--surface); color: var(--accent); border: 1px solid var(--accent); font-family: var(--f-data); font-size: 14px; padding: 9px 18px; border-radius: 999px; z-index: 60; box-shadow: var(--glow); }

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
    flex: 0 0 auto; width: 38px; height: 38px; border-radius: 11px;
    display: flex; align-items: center; justify-content: center; font-size: 20px;
    background: linear-gradient(135deg, var(--accent), var(--accent-2));
    box-shadow: var(--glow); color: var(--accent-ink);
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
  .side-top .collapse-btn:hover { background: var(--accent-soft); box-shadow: var(--glow); }
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
  .card { border: none; border-radius: 14px; padding: 18px 20px; background: var(--surface); box-shadow: var(--elev-1); }
  .tiles { gap: 14px; }
  .tile { border: none; background: var(--surface); box-shadow: var(--elev-1); transition: box-shadow .2s, transform .2s; }
  .tile:hover { box-shadow: var(--elev-2); transform: translateY(-2px); }
  .tool, .emp-card { border: none; background: var(--surface); box-shadow: var(--elev-1); transition: box-shadow .2s, transform .2s; }
  .tool:hover { box-shadow: var(--elev-2); transform: translateY(-2px); background: var(--surface); }
  .emp-card:hover { box-shadow: var(--elev-2); }

  /* sidebar y encabezado proyectan sombra sobre el contenido */
  .tabbar { background: var(--surface); box-shadow: 6px 0 20px rgba(14,26,48,0.07); border-right: none; }
  .app-header { box-shadow: 0 6px 18px rgba(14,26,48,0.06); border-bottom: none; position: relative; z-index: 2; }
  .dialog { box-shadow: var(--elev-2), 0 24px 70px rgba(14,26,48,0.25); }
  .card { padding: 18px 22px; border-radius: 14px; }
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
