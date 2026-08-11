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

import { FACTORES_DEFECTO, DIVISOR_DEFECTO } from '../lib/tiposHora.js';

export const NIGHT_WINDOW_MS = 12 * 60 * 60 * 1000;
const LATE_TOLERANCE_MIN = 180;

// ── Store en memoria ──────────────────────────────────────────────────
const store = {
  events: [],       // forma journeyService: {id, personId, personName, sede, type, ts, flag, correctedBy}
  people: [],       // forma rosterService: {id, name, cedula, sede, expectedEntry, expectedExit, breakMinutes, createdAt, activo}
  sedes: [],        // forma sedesService: {id, name, lat, lon, radius}
  cfg: {
    weeklyHours: 42, graceMinutes: 15, holidays: [],
    factores: FACTORES_DEFECTO, divisorHorasMes: DIVISOR_DEFECTO,
    nocturnoInicio: '21:00', nocturnoFin: '06:00',
  },
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

/**
 * Marcaciones crudas → eventos con la forma de journeyService.
 *
 * Vive aparte de `syncPanel` porque los reportes piden un rango cualquiera
 * (que puede ser más viejo que la ventana sincronizada) y deben interpretar
 * esas marcaciones EXACTAMENTE igual que el resto del panel: si un reporte
 * marcara las llegadas tarde con otro criterio, dos pantallas dirían cosas
 * distintas de la misma persona el mismo día.
 */
function construirEventos(marcaciones, correcciones = []) {
  const correccionPorMarcacion = new Map();
  for (const c of correcciones) {
    if (c.marcacion_id && !correccionPorMarcacion.has(c.marcacion_id)) correccionPorMarcacion.set(c.marcacion_id, c);
  }

  const eventos = marcaciones.map((m) => {
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
  const horarioPorEmpleado = new Map(store.people.map((p) => [p.id, p.expectedEntry]));
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
  return eventos;
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
    // numeric de Postgres viaja como texto; null = sin registrar (opcional).
    salarioMensual: e.salario_mensual == null ? null : Number(e.salario_mensual),
    createdAt: e.creado_en,
    activo: e.activo,
    tieneRostro: e.tiene_rostro,
    descriptor: null,
  }));

  store.cfg = {
    // 42 h de respaldo (Ley 2101 vigente) por si la fila viniera incompleta,
    // para que los cálculos del panel no se rompan.
    weeklyHours: cfg.config.horas_semana ?? 42,
    graceMinutes: cfg.config.gracia_min,
    holidays: (cfg.config.festivos ?? []).map((f) => String(f).slice(0, 10)),
    // Valorización: cómo se paga cada tipo de hora extra.
    factores: cfg.config.factores_hora ?? FACTORES_DEFECTO,
    divisorHorasMes: cfg.config.divisor_horas_mes ?? DIVISOR_DEFECTO,
    nocturnoInicio: cfg.config.nocturno_inicio ?? '21:00',
    nocturnoFin: cfg.config.nocturno_fin ?? '06:00',
  };

  store.audit = corr.correcciones;

  store.events = construirEventos(marc.marcaciones, corr.correcciones);
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
  // Salario: '' o null lo dejan SIN registrar (y sus horas sin valorizar).
  if ('salarioMensual' in partial) {
    const s = partial.salarioMensual;
    body.salario_mensual = s === '' || s == null ? null : Number(s);
  }
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
        salario_mensual: extra.salarioMensual ?? null,
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
 * Todo es editable: cada empresa define sus propias reglas.
 */
export function saveLaborConfig(partial) {
  store.cfg = { ...store.cfg, ...partial };
  const body = {};
  if ('graceMinutes' in partial) body.gracia_min = partial.graceMinutes;
  if ('weeklyHours' in partial) body.horas_semana = partial.weeklyHours;
  if ('holidays' in partial) body.festivos = partial.holidays;
  if ('factores' in partial) body.factores_hora = partial.factores;
  if ('divisorHorasMes' in partial) body.divisor_horas_mes = Number(partial.divisorHorasMes);
  if ('nocturnoInicio' in partial) body.nocturno_inicio = partial.nocturnoInicio;
  if ('nocturnoFin' in partial) body.nocturno_fin = partial.nocturnoFin;
  if (Object.keys(body).length === 0) return store.cfg;
  api('/api/config', { method: 'PATCH', body: JSON.stringify(body) })
    .catch((e) => console.error('No se pudo guardar la configuración:', e.message));
  return store.cfg;
}

// ── Horas extra valorizadas ───────────────────────────────────────────

/**
 * Tramos con recargo del período, ya con su valor en pesos.
 *
 * Viene del SERVIDOR (`GET /api/horas`), no del cálculo aproximado que el
 * panel hace para el resto de la pantalla: es exactamente lo mismo que
 * consume quien liquida, y en un reporte que habla de dinero no puede haber
 * dos cifras distintas según dónde se mire.
 *
 * @param {string} desde  YYYY-MM-DD
 * @param {string} hasta  YYYY-MM-DD
 * @returns {Promise<Array>} tramos {documento, fecha, tipoHora, horas, factor, valorHora, valor, …}
 */
export async function getHorasValorizadas(desde, hasta) {
  const d = await api(`/api/horas?desde=${desde}&hasta=${hasta}`);
  return d.registros ?? [];
}

/**
 * Marca (o desmarca) tramos de hora extra como ya pagados.
 *
 * Se envían las REFERENCIAS de los tramos, no un rango: la referencia
 * identifica un tramo concreto y sobrevive a los recálculos.
 *
 * @param {string[]} referencias
 * @param {boolean} pagado
 */
export async function marcarHorasPagadas(referencias, pagado) {
  await api('/api/horas/pagadas', {
    method: 'POST',
    body: JSON.stringify({ referencias, pagado }),
  });
}

/**
 * Eventos de asistencia de un rango CUALQUIERA, pedidos al servidor.
 *
 * `syncPanel` solo trae los últimos 60 días — suficiente para el dashboard,
 * pero no para un reporte de un mes viejo. Sin esto, pedir enero mostraba las
 * horas extra (que sí se calculan en el servidor sobre cualquier rango) al
 * lado de cero días trabajados, que se lee como un error del sistema.
 *
 * @param {string} desde  YYYY-MM-DD (día Bogotá)
 * @param {string} hasta  YYYY-MM-DD (inclusive)
 */
export async function getEventosRango(desde, hasta) {
  const d = await api(`/api/marcaciones?desde=${desde}&hasta=${hasta}`);
  // Las correcciones ya están en memoria y no dependen del rango: se reusan
  // en vez de pedirlas otra vez (solo aportan el flag 'corrected').
  return construirEventos(d.marcaciones ?? [], store.audit);
}
