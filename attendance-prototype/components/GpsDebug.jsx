'use client';

/**
 * components/GpsDebug.jsx
 * Diagnóstico de ubicación: muestra EN VIVO lo que reporta el GPS del
 * dispositivo (lat, lon, precisión) y la distancia a cada sede, para
 * distinguir un problema de GPS (coordenadas imprecisas) de uno de lógica.
 */

import { useEffect, useRef, useState } from 'react';
import { haversineDistance, MAX_RADIUS_METERS } from '../utils/haversine.js';
import { cargarSedes } from '../services/kioskoApi.js';

export default function GpsDebug() {
  const [reading, setReading] = useState(null);
  const [best, setBest] = useState(null); // mejor precisión observada
  const [error, setError] = useState(null);
  const [samples, setSamples] = useState(0);
  const [sedes, setSedes] = useState([]);
  const watchId = useRef(null);
  // Sedes REALES desde la base de datos (/api/sedes) — nunca del viejo
  // sedesService de localStorage, que mostraba sedes de prueba sembradas.
  useEffect(() => {
    cargarSedes()
      .then((rows) => setSedes(rows.map((r) => ({ name: r.nombre, lat: r.lat, lon: r.lon, radius: r.radio_m }))))
      .catch((e) => setError(`No se pudieron cargar las sedes: ${e.message}`));
  }, []);

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
        <strong>Cómo leerlo</strong>
        <ul style={s.ul}>
          <li>Precisión mayor a {MAX_RADIUS_METERS} m: el radio no es confiable.</li>
          <li>Verifica lat/lon en Google Maps.</li>
          <li>Al aire libre mejora; en interiores empeora.</li>
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
      <span style={{ ...s.v, color: warn ? 'var(--crit-text)' : good ? 'var(--good-text)' : 'var(--ink)' }}>{v}</span>
    </div>
  );
}

// Estilos derivados del sistema de diseño (app/globals.css): sin hex literales.
const s = {
  card: { maxWidth: 460, margin: '0 auto', padding: 20, fontFamily: 'var(--f-body)', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--r-lg)', boxShadow: 'var(--elev-1)' },
  sub: { fontSize: 13, color: 'var(--muted)' },
  actions: { display: 'flex', gap: 8, margin: '10px 0' },
  btn: { padding: '12px 14px', fontSize: 15, fontFamily: 'inherit', fontWeight: 600, borderRadius: 'var(--r-md)', border: 'none', background: 'var(--accent)', color: 'var(--accent-ink)', cursor: 'pointer' },
  btnGhost: { padding: '12px 14px', fontSize: 15, fontFamily: 'inherit', borderRadius: 'var(--r-md)', border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--ink)', cursor: 'pointer' },
  err: { background: 'var(--crit-soft)', border: '1px solid var(--crit)', color: 'var(--crit-text)', padding: 10, borderRadius: 'var(--r-sm)', fontSize: 14 },
  box: { border: '1px solid var(--border)', borderRadius: 'var(--r-md)', padding: 12, margin: '10px 0' },
  boxTitle: { fontSize: 13, fontWeight: 700, color: 'var(--ink-2)', marginBottom: 6 },
  row: { display: 'flex', justifyContent: 'space-between', padding: '3px 0', fontSize: 14 },
  k: { color: 'var(--muted)' },
  v: { fontFamily: 'var(--f-data)', fontWeight: 700, fontVariantNumeric: 'tabular-nums' },
  distTitle: { fontSize: 12, color: 'var(--muted)', marginTop: 8 },
  help: { marginTop: 12, padding: 12, background: 'var(--page)', border: '1px dashed var(--grid)', borderRadius: 'var(--r-md)', fontSize: 13, color: 'var(--ink-2)' },
  ul: { margin: '8px 0 0', paddingLeft: 18, lineHeight: 1.6 },
};
