/**
 * services/sedesService.js
 * Sedes EDITABLES desde el panel (persistidas en localStorage).
 * La primera vez se siembran desde OFFICE_LOCATIONS (utils/haversine.js);
 * después, la fuente de verdad es este servicio. Cada sede tiene su propio
 * radio GPS en metros.
 */

import { OFFICE_LOCATIONS, MAX_RADIUS_METERS } from '../utils/haversine.js';

const KEY = 'attendance_sedes';
const hasLS = typeof localStorage !== 'undefined';

const defaults = () => OFFICE_LOCATIONS.map((o) => ({ ...o, radius: MAX_RADIUS_METERS }));

export function getSedes() {
  if (!hasLS) return defaults();
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || 'null');
    if (!Array.isArray(raw) || raw.length === 0) return defaults();
    return raw.filter((s) => s && s.name && Number.isFinite(s.lat) && Number.isFinite(s.lon))
      .map((s) => ({ ...s, radius: Number.isFinite(s.radius) && s.radius > 0 ? s.radius : MAX_RADIUS_METERS }));
  } catch {
    return defaults();
  }
}

function save(list) {
  if (hasLS) localStorage.setItem(KEY, JSON.stringify(list));
  return list;
}

export function addSede({ name, lat, lon, radius = MAX_RADIUS_METERS }) {
  const n = String(name || '').trim();
  if (!n) return { error: 'La sede necesita un nombre.' };
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) {
    return { error: 'Coordenadas inválidas (lat entre -90 y 90, lon entre -180 y 180).' };
  }
  const sedes = getSedes();
  if (sedes.some((s) => s.name.toLowerCase() === n.toLowerCase())) {
    return { error: `Ya existe una sede llamada "${n}".` };
  }
  const sede = { name: n, lat, lon, radius: radius > 0 ? radius : MAX_RADIUS_METERS };
  save([...sedes, sede]);
  return sede;
}

export function updateSede(name, partial) {
  const sedes = getSedes();
  const i = sedes.findIndex((s) => s.name === name);
  if (i < 0) return { error: 'Sede no encontrada.' };
  sedes[i] = { ...sedes[i], ...partial };
  save(sedes);
  return sedes[i];
}

export function removeSede(name) {
  const sedes = getSedes();
  if (sedes.length <= 1) return { error: 'Debe existir al menos una sede.' };
  save(sedes.filter((s) => s.name !== name));
  return { ok: true };
}
