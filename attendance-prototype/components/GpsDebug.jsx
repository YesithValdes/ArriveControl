'use client';

/**
 * components/GpsDebug.jsx
 * Diagnóstico de ubicación: muestra EN VIVO lo que reporta el GPS del
 * dispositivo (lat, lon, precisión) y la distancia a cada sede, para
 * distinguir un problema de GPS (coordenadas imprecisas) de uno de lógica.
 */

import { useEffect, useRef, useState } from 'react';
import { haversineDistance, MAX_RADIUS_METERS } from '../utils/haversine.js';
import { getSedes } from '../services/sedesService.js';

export default function GpsDebug() {
  const [reading, setReading] = useState(null);
  const [best, setBest] = useState(null); // mejor precisión observada
  const [error, setError] = useState(null);
  const [samples, setSamples] = useState(0);
  const [sedes, setSedes] = useState([]);
  const watchId = useRef(null);
  useEffect(() => { setSedes(getSedes()); }, []);

  const start = () => {
    setError(null);
    setBest(null);
    setSamples(0);
    if (!('geolocation' in navigator)) {
      setError('Este navegador no soporta geolocalización.');
      return;
    }
    watchId.current = navigator.geolocation.watchPosition(
      (pos) => {
        const r = {
          lat: pos.coords.latitude,
          lon: pos.coords.longitude,
          accuracy: pos.coords.accuracy,
          ts: new Date().toLocaleTimeString(),
        };
        setReading(r);
        setSamples((n) => n + 1);
        setBest((b) => (!b || r.accuracy < b.accuracy ? r : b));
      },
      (err) => setError(`${err.code}: ${err.message}`),
      { enableHighAccuracy: true, timeout: 20000, maximumAge: 0 }
    );
  };

  const stop = () => {
    if (watchId.current != null) navigator.geolocation.clearWatch(watchId.current);
    watchId.current = null;
  };

  useEffect(() => stop, []);

  const distances = (coord) =>
    sedes.map((o) => ({
      name: `${o.name} (radio ${o.radius ?? MAX_RADIUS_METERS} m)`,
      d: Math.round(haversineDistance(coord.lat, coord.lon, o.lat, o.lon) * 10) / 10,
    }));

  return (
    <div style={s.card}>
      <h2 style={{ margin: '0 0 4px' }}>📍 Diagnóstico GPS</h2>
      <p style={s.sub}>Radio permitido: {MAX_RADIUS_METERS} m · Muestras recibidas: {samples}</p>

      <div style={s.actions}>
        <button style={s.btn} onClick={start}>▶️ Iniciar lectura en vivo</button>
        <button style={s.btnGhost} onClick={stop}>⏹ Detener</button>
      </div>

      {error && <div style={s.err}>Error: {error}</div>}

      {reading && (
        <>
          <Section title="Lectura actual" r={reading} distances={distances(reading)} />
          {best && <Section title={`Mejor precisión (±${Math.round(best.accuracy)} m)`} r={best} distances={distances(best)} />}
        </>
      )}

      <div style={s.help}>
        <strong>Cómo interpretarlo:</strong>
        <ul style={s.ul}>
          <li>Si la <strong>precisión (accuracy)</strong> es mayor que {MAX_RADIUS_METERS} m, el GPS no puede confirmar el radio de forma fiable — la distancia se ve "errónea" por eso.</li>
          <li>Copia <strong>lat/lon</strong> en Google Maps: si el punto no cae donde estás, el GPS del equipo está fallando (no el código).</li>
          <li>Al aire libre la precisión mejora; en interiores o entre edificios empeora mucho.</li>
        </ul>
      </div>
    </div>
  );
}

function Section({ title, r, distances }) {
  return (
    <div style={s.box}>
      <div style={s.boxTitle}>{title} · {r.ts}</div>
      <Row k="Latitud" v={r.lat.toFixed(7)} />
      <Row k="Longitud" v={r.lon.toFixed(7)} />
      <Row k="Precisión" v={`±${Math.round(r.accuracy)} m`} warn={r.accuracy > 50} />
      <div style={s.distTitle}>Distancia a cada sede:</div>
      {distances.map((x) => (
        <Row key={x.name} k={x.name} v={`${x.d} m`} good={x.d <= 50} />
      ))}
    </div>
  );
}

function Row({ k, v, warn, good }) {
  return (
    <div style={s.row}>
      <span style={s.k}>{k}</span>
      <span style={{ ...s.v, color: warn ? '#dc2626' : good ? '#16a34a' : '#111827' }}>{v}</span>
    </div>
  );
}

const s = {
  card: { maxWidth: 460, margin: '0 auto', padding: 20, fontFamily: 'system-ui, sans-serif', border: '1px solid #e5e7eb', borderRadius: 16 },
  sub: { fontSize: 13, color: '#6b7280' },
  actions: { display: 'flex', gap: 8, margin: '10px 0' },
  btn: { padding: '12px 14px', fontSize: 15, borderRadius: 10, border: 'none', background: '#2563eb', color: '#fff', cursor: 'pointer' },
  btnGhost: { padding: '12px 14px', fontSize: 15, borderRadius: 10, border: '1px solid #d1d5db', background: '#fff', cursor: 'pointer' },
  err: { background: '#fef2f2', border: '1px solid #fca5a5', color: '#991b1b', padding: 10, borderRadius: 8, fontSize: 14 },
  box: { border: '1px solid #e5e7eb', borderRadius: 10, padding: 12, margin: '10px 0' },
  boxTitle: { fontSize: 13, fontWeight: 700, color: '#374151', marginBottom: 6 },
  row: { display: 'flex', justifyContent: 'space-between', padding: '3px 0', fontSize: 14 },
  k: { color: '#6b7280' },
  v: { fontFamily: 'monospace', fontWeight: 700 },
  distTitle: { fontSize: 12, color: '#6b7280', marginTop: 8 },
  help: { marginTop: 12, padding: 12, background: '#f8fafc', border: '1px dashed #cbd5e1', borderRadius: 10, fontSize: 13 },
  ul: { margin: '8px 0 0', paddingLeft: 18, lineHeight: 1.6 },
};
