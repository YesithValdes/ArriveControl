'use client';

/**
 * components/JourneysPanel.jsx
 * Vista de jornadas para el administrador: pares ENTRADA/SALIDA por persona
 * y día, con anomalías resaltadas y corrección manual:
 *   - 'missing-exit' → entrada de >12 h sin salida → botón "Agregar salida".
 *   - 'late-entry'   → primera entrada después del mediodía → marcada ⚠️.
 *   - Cambiar la hora de cualquier evento (queda auditado como 'corrected').
 */

import { useCallback, useEffect, useState } from 'react';
import { getJourneys, addManualEvent, updateEventTime, deleteEvent } from '../services/journeyService.js';

const fmtTime = (iso) => new Date(iso).toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' });
const toTimeInput = (iso) => {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};
const fmtDay = (day) => new Date(day + 'T12:00:00').toLocaleDateString('es-CO', { weekday: 'short', day: 'numeric', month: 'short' });

export default function JourneysPanel() {
  const [journeys, setJourneys] = useState([]);
  const [fixTimes, setFixTimes] = useState({}); // key persona|día -> hora elegida para la salida manual

  const refresh = useCallback(() => setJourneys(getJourneys()), []);
  useEffect(() => { refresh(); }, [refresh]);

  const handleEditTime = (event, hhmm) => {
    if (!hhmm) return;
    const d = new Date(event.ts);
    const [h, m] = hhmm.split(':').map(Number);
    d.setHours(h, m, 0, 0);
    updateEventTime(event.id, d.toISOString());
    refresh();
  };

  const handleAddExit = (j) => {
    const hhmm = fixTimes[`${j.personId}|${j.day}`] || '18:00';
    const [h, m] = hhmm.split(':').map(Number);
    const d = new Date(j.day + 'T12:00:00');
    d.setHours(h, m, 0, 0);
    addManualEvent(j.personId, j.personName, 'out', d.toISOString());
    refresh();
  };

  return (
    <div style={s.card}>
      <h3 style={{ margin: '0 0 4px' }}>📅 Jornadas (entradas / salidas)</h3>
      <p style={s.dim}>Anomalías resaltadas. Las correcciones quedan marcadas como manuales.</p>

      {journeys.length === 0 && <p style={s.dim}>Aún no hay registros de jornada. Se crean al validar en el Kiosco.</p>}

      {journeys.map((j) => {
        const hasMissing = j.events.some((e) => e.missingExit);
        return (
          <div key={`${j.personId}|${j.day}`} style={{ ...s.journey, borderColor: hasMissing ? 'rgba(245,158,11,0.5)' : '#22304A' }}>
            <div style={s.jHead}>
              <strong>{j.personName}</strong>
              <span style={s.jDay}>{fmtDay(j.day)}</span>
            </div>

            {j.events.map((e) => (
              <div key={e.id} style={s.row}>
                <span style={{ ...s.type, color: e.type === 'in' ? '#22C55E' : '#F59E0B' }}>
                  {e.type === 'in' ? '🟢 Entrada' : '🟠 Salida'}
                </span>
                <input
                  type="time"
                  defaultValue={toTimeInput(e.ts)}
                  onBlur={(ev) => ev.target.value !== toTimeInput(e.ts) && handleEditTime(e, ev.target.value)}
                  style={s.timeInput}
                />
                <span style={s.flags}>
                  {e.flag === 'late-entry' && <em title="Primera entrada después del mediodía">⚠️ tardía</em>}
                  {e.flag === 'manual' && <em title="Agregado por el administrador">✍️ manual</em>}
                  {e.flag === 'corrected' && <em title="Hora corregida por el administrador">✏️ corregido</em>}
                  {e.missingExit && <em style={{ color: '#FCD34D' }} title="Más de 12 h sin salida">⏳ sin salida</em>}
                </span>
                <button style={s.del} title="Eliminar evento" onClick={() => { deleteEvent(e.id); refresh(); }}>🗑</button>
              </div>
            ))}

            {hasMissing && (
              <div style={s.fixRow}>
                <span style={{ fontSize: 12, color: '#FCD34D' }}>Cerrar jornada:</span>
                <input
                  type="time"
                  defaultValue="18:00"
                  onChange={(ev) => setFixTimes((t) => ({ ...t, [`${j.personId}|${j.day}`]: ev.target.value }))}
                  style={s.timeInput}
                />
                <button style={s.addBtn} onClick={() => handleAddExit(j)}>＋ Agregar salida</button>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

const s = {
  card: { maxWidth: 460, margin: '16px auto 0', padding: 20, fontFamily: 'system-ui, sans-serif', border: '1px solid #22304A', borderRadius: 16, background: '#0A1120', color: '#E8EEF9' },
  dim: { fontSize: 12, color: '#8296B3', margin: '4px 0 12px' },
  journey: { border: '1px solid #22304A', borderRadius: 12, padding: 12, marginBottom: 10, background: '#141E31' },
  jHead: { display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 8 },
  jDay: { fontSize: 12, color: '#8296B3', textTransform: 'capitalize' },
  row: { display: 'flex', alignItems: 'center', gap: 10, padding: '6px 0', borderTop: '1px solid #22304A', fontSize: 14 },
  type: { fontWeight: 700, fontSize: 13, width: 92, flexShrink: 0 },
  timeInput: { background: '#0A1120', color: '#E8EEF9', border: '1px solid #22304A', borderRadius: 8, padding: '4px 8px', fontFamily: 'ui-monospace, monospace', fontSize: 14, colorScheme: 'dark' },
  flags: { display: 'flex', gap: 8, fontSize: 11, color: '#8296B3', fontStyle: 'normal', flex: 1, flexWrap: 'wrap' },
  del: { marginLeft: 'auto', border: 'none', background: 'transparent', cursor: 'pointer', fontSize: 14, color: '#8296B3' },
  fixRow: { display: 'flex', alignItems: 'center', gap: 10, marginTop: 10, padding: 10, background: 'rgba(245,158,11,0.10)', border: '1px solid rgba(245,158,11,0.35)', borderRadius: 10 },
  addBtn: { border: 'none', background: '#F59E0B', color: '#1C1203', fontWeight: 700, fontSize: 13, padding: '8px 12px', borderRadius: 8, cursor: 'pointer' },
};
