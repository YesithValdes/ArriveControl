'use client';
/**
 * services/panelStore.js — Los datos del panel, desde POSTGRES vía API.
 *
 * Reemplaza a journeyService/rosterService/sedesService/configService
 * (localStorage) conservando sus MISMAS formas de datos, para que
 * AdminPanel y EmployeeRegister cambien solo la importación:
 *
 *   syncPanel()  →  descarga todo a un store en memoria
 *   getters      →  síncronos, leen del store (como antes)
 *   mutaciones   →  llaman a la API y actualizan el store local
 *
 * Las anomalías siguen derivándose en el cliente; aquí solo se anota el
 * flag 'late-entry' (primera entrada del día muy tarde vs. horario) y
 * 'manual'/'corrected' (desde origen y la auditoría), como hacía el
 * journeyService original.
 */

export const NIGHT_WINDOW_MS = 12 * 60 * 60 * 1000;
const LATE_TOLERANCE_MIN = 180;

// ── Store en memoria ──────────────────────────────────────────────────
const store = {
  events: [],       // forma journeyService: {id, personId, personName, sede, type, ts, flag, correctedBy}
  people: [],       // forma rosterService: {id, name, cedula, sede, expectedEntry, expectedExit, breakMinutes, createdAt, activo}
  sedes: [],        // forma sedesService: {id, name, lat, lon, radius}
  cfg: { weeklyHours: 42, graceMinutes: 15, holidays: [] },
  audit: [],        // correcciones crudas (para trazabilidad extendida)
  cargado: false,
};

const hhmm = (t) => (t ? String(t).slice(0, 5) : '');
const bogotaDay = (iso) => new Date(new Date(iso).getTime() - 5 * 3600000).toISOString().slice(0, 10);

async function api(url, opts = {}) {
  const r = await fetch(url, { headers: { 'Content-Type': 'application/json' }, ...opts });
  const d = await r.json().catch(() => ({}));
  if (!r.ok || d.ok === false) throw new Error(d.error || `Error ${r.status} en ${url}`);
  return d;
}

/** Descarga todo del servidor. Llamar al montar el panel y tras cada mutación. */
export async function syncPanel() {
  // Rango: últimos 60 días — suficiente para dashboard, reportes y anomalías.
  const desde = bogotaDay(new Date(Date.now() - 60 * 24 * 3600000).toISOString());
  const [marc, emp, sed, cfg, corr] = await Promise.all([
    api(`/api/marcaciones?desde=${desde}`),
    api('/api/empleados'),
    api('/api/sedes'),
    api('/api/config'),
    api('/api/correcciones'),
  ]);

  store.sedes = sed.sedes.map((s) => ({ id: s.id, name: s.nombre, lat: s.lat, lon: s.lon, radius: s.radio_m }));

  store.people = emp.empleados.map((e) => ({
    id: e.id,
    name: e.nombre,
    cedula: e.cedula || '',
    sede: e.sede_nombre || '',
    sedeId: e.sede_id || '',
    expectedEntry: hhmm(e.entrada_esperada),
    expectedExit: hhmm(e.salida_esperada),
    breakMinutes: e.almuerzo_min,
    jornadaSemanal: e.jornada_semanal ?? null, // [lun..sáb] o null = estándar
    createdAt: e.creado_en,
    activo: e.activo,
    tieneRostro: e.tiene_rostro,
    descriptor: null,
  }));

  store.cfg = {
    // 42 h de respaldo (Ley 2101 vigente) si el gestor no respondió, para que
    // los cálculos del panel no se rompan; gestorError avisa en Ajustes.
    weeklyHours: cfg.config.horas_semana ?? 42,
    graceMinutes: cfg.config.gracia_min,
    holidays: (cfg.config.festivos ?? []).map((f) => String(f).slice(0, 10)),
    // Jornada y festivos son de SOLO LECTURA: la fuente única es el gestor RH.
    gestorUrl: cfg.gestor_url ?? null,
    gestorError: cfg.gestor_error ?? null,
  };

  store.audit = corr.correcciones;
  const correccionPorMarcacion = new Map();
  for (const c of corr.correcciones) {
    if (c.marcacion_id && !correccionPorMarcacion.has(c.marcacion_id)) correccionPorMarcacion.set(c.marcacion_id, c);
  }

  const horarioPorEmpleado = new Map(store.people.map((p) => [p.id, p.expectedEntry]));
  const eventos = marc.marcaciones.map((m) => {
    const corr = correccionPorMarcacion.get(m.id);
    return {
      id: m.id,
      personId: m.empleado_id,
      personName: m.empleado_nombre,
      sede: m.sede_nombre || '',
      type: m.tipo === 'entrada' ? 'in' : 'out',
      ts: m.ts,
      flag: m.origen === 'manual' ? 'manual' : corr ? 'corrected' : null,
      correctedBy: m.origen === 'manual' || corr ? (corr?.admin_email || 'admin') : null,
    };
  });

  // Flag 'late-entry': primera entrada del día muy tarde vs. horario esperado.
  const porPersonaDia = new Map();
  for (const e of eventos) {
    if (e.type !== 'in') continue;
    const k = `${e.personId}|${bogotaDay(e.ts)}`;
    if (!porPersonaDia.has(k) || e.ts < porPersonaDia.get(k).ts) porPersonaDia.set(k, e);
  }
  for (const primera of porPersonaDia.values()) {
    const esperado = horarioPorEmpleado.get(primera.personId);
    if (!/^\d{2}:\d{2}$/.test(esperado || '')) continue;
    const d = new Date(new Date(primera.ts).getTime() - 5 * 3600000); // hora Bogotá
    const min = d.getUTCHours() * 60 + d.getUTCMinutes();
    const [h, m] = esperado.split(':').map(Number);
    if (min >= h * 60 + m + LATE_TOLERANCE_MIN && !primera.flag) primera.flag = 'late-entry';
  }

  store.events = eventos;
  store.cargado = true;
  return store;
}

export const panelCargado = () => store.cargado;

// ── journeyService (lectura) ──────────────────────────────────────────
export function listJourneyEvents() {
  return [...store.events].sort((a, b) => b.ts.localeCompare(a.ts));
}

// ── journeyService (mutaciones del admin — motivo OBLIGATORIO) ────────
export async function addManualEvent(personId, personName, type, isoTs, motivo) {
  await api('/api/marcaciones/manual', {
    method: 'POST',
    body: JSON.stringify({
      empleado_id: personId,
      tipo: type === 'in' ? 'entrada' : 'salida',
      ts: isoTs,
      motivo: motivo || 'Ajuste manual del administrador',
    }),
  });
}

export async function updateEventTime(eventId, isoTs, motivo) {
  await api(`/api/marcaciones/${eventId}`, {
    method: 'PATCH',
    body: JSON.stringify({ ts: isoTs, motivo: motivo || 'Corrección de hora' }),
  });
}

export async function updateEventType(eventId, type, motivo) {
  await api(`/api/marcaciones/${eventId}`, {
    method: 'PATCH',
    body: JSON.stringify({ tipo: type === 'in' ? 'entrada' : 'salida', motivo: motivo || 'Corrección de tipo' }),
  });
}

export async function deleteEvent(eventId, motivo = 'Marcación errónea eliminada desde el panel') {
  await api(`/api/marcaciones/${eventId}?motivo=${encodeURIComponent(motivo)}`, { method: 'DELETE' });
}

// ── rosterService ─────────────────────────────────────────────────────
export function listPeople() {
  return store.people.filter((p) => p.activo);
}

export async function removePerson(id) {
  await api(`/api/empleados/${id}`, { method: 'DELETE' });
  store.people = store.people.filter((p) => p.id !== id);
}

export async function updatePerson(id, partial) {
  const body = {};
  if ('name' in partial) body.nombre = partial.name;
  if ('cedula' in partial) body.cedula = partial.cedula;
  if ('sede' in partial) {
    const sede = store.sedes.find((s) => s.name === partial.sede);
    body.sede_id = sede?.id ?? null;
  }
  if ('expectedEntry' in partial) body.entrada_esperada = partial.expectedEntry || null;
  if ('expectedExit' in partial) body.salida_esperada = partial.expectedExit || null;
  if ('breakMinutes' in partial) body.almuerzo_min = partial.breakMinutes === '' || partial.breakMinutes == null ? null : Number(partial.breakMinutes);
  if ('jornadaSemanal' in partial) body.jornada_semanal = partial.jornadaSemanal;
  const d = await api(`/api/empleados/${id}`, { method: 'PATCH', body: JSON.stringify(body) });
  return { name: d.empleado.nombre };
}

export async function addPerson(name, descriptor, extra = {}) {
  const sede = store.sedes.find((s) => s.name === extra.sede);
  try {
    const d = await api('/api/empleados', {
      method: 'POST',
      body: JSON.stringify({
        nombre: name,
        cedula: extra.cedula || null,
        sede_id: sede?.id ?? extra.sedeId ?? null,
        entrada_esperada: extra.expectedEntry || null,
        salida_esperada: extra.expectedExit || null,
        almuerzo_min: extra.breakMinutes ?? null,
        descriptor_facial: descriptor,
      }),
    });
    return { id: d.empleado.id, name: d.empleado.nombre };
  } catch (e) {
    return { error: e.message };
  }
}

/**
 * Jornada del DÍA para efectos de horas extra — la MISMA regla que usa
 * lib/nomina.js al liquidar, para que el panel y la nómina siempre cuadren:
 * la pactada del empleado para ese día de la semana (jornada distribuida)
 * o, sin pacto, la legal diaria (semanal / 6). Domingo: 0 (todo es extra).
 * @param {object} person  con jornadaSemanal ([lun..sáb] o null)
 * @param {string} fechaISO  YYYY-MM-DD (día Bogotá)
 */
export function jornadaDelDia(person, fechaISO) {
  const dow = new Date(`${fechaISO}T12:00:00Z`).getUTCDay(); // 0=dom … 6=sáb
  if (dow === 0) return 0;
  const pactada = person?.jornadaSemanal?.[dow - 1];
  return pactada ?? (store.cfg.weeklyHours ?? 42) / 6;
}

/** Horas de jornada esperada al día (o null si el horario es libre). */
export function expectedDailyHours(person) {
  const HHMM = /^\d{2}:\d{2}$/;
  if (!person || !HHMM.test(person.expectedEntry || '') || !HHMM.test(person.expectedExit || '')) return null;
  const [eh, em] = person.expectedEntry.split(':').map(Number);
  const [xh, xm] = person.expectedExit.split(':').map(Number);
  let mins = (xh * 60 + xm) - (eh * 60 + em);
  if (mins <= 0) mins += 24 * 60; // turno que cruza medianoche
  mins -= person.breakMinutes ?? 0;
  return Math.max(0, mins) / 60;
}

// ── sedesService ──────────────────────────────────────────────────────
export function getSedes() {
  return store.sedes;
}

export async function addSede({ name, lat, lon, radius = 50 }) {
  try {
    const d = await api('/api/sedes', {
      method: 'POST',
      body: JSON.stringify({ nombre: name, lat, lon, radio_m: radius }),
    });
    return { name: d.sede.nombre };
  } catch (e) {
    return { error: e.message };
  }
}

export async function updateSede(nombreActual, partial) {
  const sede = store.sedes.find((s) => s.name === nombreActual);
  if (!sede) return { error: 'Sede no encontrada.' };
  const body = {};
  if ('name' in partial) body.nombre = partial.name;
  if ('lat' in partial) body.lat = partial.lat;
  if ('lon' in partial) body.lon = partial.lon;
  if ('radius' in partial) body.radio_m = partial.radius;
  try {
    await api(`/api/sedes/${sede.id}`, { method: 'PATCH', body: JSON.stringify(body) });
    return { ok: true };
  } catch (e) {
    return { error: e.message };
  }
}

export async function removeSede(nombre) {
  const sede = store.sedes.find((s) => s.name === nombre);
  if (!sede) return { error: 'Sede no encontrada.' };
  try {
    await api(`/api/sedes/${sede.id}`, { method: 'DELETE' });
    return { ok: true };
  } catch (e) {
    return { error: e.message };
  }
}

// ── configService ─────────────────────────────────────────────────────
export function getLaborConfig() {
  return store.cfg;
}

/**
 * Actualiza local al instante (para la UI) y persiste en el servidor.
 * Solo la gracia es editable aquí; jornada y festivos se cambian en el gestor.
 */
export function saveLaborConfig(partial) {
  store.cfg = { ...store.cfg, ...partial };
  if (!('graceMinutes' in partial)) return store.cfg;
  api('/api/config', { method: 'PATCH', body: JSON.stringify({ gracia_min: partial.graceMinutes }) })
    .catch((e) => console.error('No se pudo guardar la configuración:', e.message));
  return store.cfg;
}
