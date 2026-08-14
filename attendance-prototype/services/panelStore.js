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
  horarios: [],     // plantillas POR DÍAS: {id, nombre, dias: {"0".."6": {entrada, salida, almuerzoMin}}}
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

// ── Jornada POR DÍAS de la semana ─────────────────────────────────────
// Forma API/BD: {"0".."6": {entrada, salida, almuerzo_min}} (0=domingo …
// 6=sábado); día ausente = libre. En el cliente el campo es almuerzoMin.

export const DIAS_CORTOS = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
// Orden de edición/lectura: la semana laboral empieza en lunes.
export const ORDEN_SEMANA = [1, 2, 3, 4, 5, 6, 0];

const diasACliente = (d) => {
  if (d == null) return null;
  const out = {};
  for (const [k, f] of Object.entries(d)) {
    out[k] = { entrada: hhmm(f.entrada), salida: hhmm(f.salida), almuerzoMin: f.almuerzo_min ?? 0 };
  }
  return out;
};
const diasAApi = (d) => {
  const out = {};
  for (const [k, f] of Object.entries(d ?? {})) {
    if (!f) continue;
    out[k] = { entrada: f.entrada, salida: f.salida, almuerzo_min: Number(f.almuerzoMin) || 0 };
  }
  return out;
};

/**
 * Franja esperada de una persona para una FECHA concreta (día Bogotá).
 * Con jornada por días manda el día de la semana; sin ella, la franja
 * uniforme de siempre. null = ese día es libre (o no tiene horario).
 * @returns {{entrada, salida, almuerzoMin} | null}
 */
export function franjaEsperada(person, fechaISO) {
  if (person?.jornadaDias) {
    const dow = new Date(`${fechaISO}T12:00:00Z`).getUTCDay(); // 0=dom … 6=sáb
    return person.jornadaDias[String(dow)] ?? null;
  }
  const HHMM = /^\d{2}:\d{2}$/;
  if (person && HHMM.test(person.expectedEntry || '') && HHMM.test(person.expectedExit || '')) {
    return { entrada: person.expectedEntry, salida: person.expectedExit, almuerzoMin: person.breakMinutes ?? 0 };
  }
  return null;
}

/** Horas de una franja (salida − entrada − almuerzo); null si no hay franja. */
export function horasFranja(f) {
  if (!f) return null;
  const [eh, em] = f.entrada.split(':').map(Number);
  const [xh, xm] = f.salida.split(':').map(Number);
  let mins = (xh * 60 + xm) - (eh * 60 + em);
  if (mins <= 0) mins += 24 * 60; // turno que cruza medianoche
  mins -= Number(f.almuerzoMin) || 0;
  return Math.max(0, mins) / 60;
}

/** Suma de horas de la semana de un mapa de días. */
export function horasSemanaDias(dias) {
  return Object.values(dias ?? {}).reduce((s, f) => s + (horasFranja(f) ?? 0), 0);
}

/**
 * Resumen legible de un mapa de días, agrupando días CONSECUTIVOS (en orden
 * lunes→domingo) con la misma franja: "Lun–Vie 08:00–17:00 · Sáb 08:00–12:00".
 */
export function resumenDias(dias) {
  if (!dias || Object.keys(dias).length === 0) return 'sin días';
  const franjaTxt = (f) => `${f.entrada}–${f.salida}`;
  const grupos = [];
  for (const d of ORDEN_SEMANA) {
    const f = dias[String(d)];
    if (!f) { grupos.push(null); continue; }
    const txt = franjaTxt(f);
    const prev = grupos[grupos.length - 1];
    if (prev && prev.txt === txt) prev.dias.push(d);
    else grupos.push({ txt, dias: [d] });
  }
  return grupos
    .filter(Boolean)
    .map((g) => {
      const nombre = g.dias.length > 1
        ? `${DIAS_CORTOS[g.dias[0]]}–${DIAS_CORTOS[g.dias[g.dias.length - 1]]}`
        : DIAS_CORTOS[g.dias[0]];
      return `${nombre} ${g.txt}`;
    })
    .join(' · ');
}

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

  // Flag 'late-entry': primera entrada del día muy tarde vs. la franja
  // esperada de ESE día de la semana (la jornada puede variar por día).
  const personaPorId = new Map(store.people.map((p) => [p.id, p]));
  const porPersonaDia = new Map();
  for (const e of eventos) {
    if (e.type !== 'in') continue;
    const k = `${e.personId}|${bogotaDay(e.ts)}`;
    if (!porPersonaDia.has(k) || e.ts < porPersonaDia.get(k).ts) porPersonaDia.set(k, e);
  }
  for (const primera of porPersonaDia.values()) {
    const franja = franjaEsperada(personaPorId.get(primera.personId), bogotaDay(primera.ts));
    const esperado = franja?.entrada;
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
  const [marc, emp, sed, cfg, corr, hor] = await Promise.all([
    api(`/api/marcaciones?desde=${desde}`),
    api('/api/empleados'),
    api('/api/sedes'),
    api('/api/config'),
    api('/api/correcciones'),
    api('/api/horarios'),
  ]);

  store.sedes = sed.sedes.map((s) => ({ id: s.id, name: s.nombre, lat: s.lat, lon: s.lon, radius: s.radio_m }));
  store.horarios = hor.horarios.map((h) => ({
    id: h.id, nombre: h.nombre, dias: diasACliente(h.dias),
  }));

  store.people = emp.empleados.map((e) => ({
    id: e.id,
    name: e.nombre,
    cedula: e.cedula || '',
    correo: e.correo || '',
    sede: e.sede_nombre || '',
    sedeId: e.sede_id || '',
    validarSede: e.validar_sede === true,
    validarUbicacion: e.validar_ubicacion === true,
    expectedEntry: hhmm(e.entrada_esperada),
    expectedExit: hhmm(e.salida_esperada),
    breakMinutes: e.almuerzo_min,
    // Jornada POR DÍAS (copia del horario asignado); null = usar la uniforme.
    jornadaDias: diasACliente(e.jornada_dias),
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
  if ('correo' in partial) body.correo = partial.correo || null;
  if ('sede' in partial) {
    const sede = store.sedes.find((s) => s.name === partial.sede);
    body.sede_id = sede?.id ?? null;
  }
  if ('expectedEntry' in partial) body.entrada_esperada = partial.expectedEntry || null;
  if ('expectedExit' in partial) body.salida_esperada = partial.expectedExit || null;
  if ('breakMinutes' in partial) body.almuerzo_min = partial.breakMinutes === '' || partial.breakMinutes == null ? null : Number(partial.breakMinutes);
  if ('jornadaDias' in partial) body.jornada_dias = partial.jornadaDias == null ? null : diasAApi(partial.jornadaDias);
  if ('jornadaSemanal' in partial) body.jornada_semanal = partial.jornadaSemanal;
  if ('validarSede' in partial) body.validar_sede = partial.validarSede === true;
  if ('validarUbicacion' in partial) body.validar_ubicacion = partial.validarUbicacion === true;
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
        correo: extra.correo || null,
        sede_id: sede?.id ?? extra.sedeId ?? null,
        validar_sede: extra.validarSede === true,
        validar_ubicacion: extra.validarUbicacion === true,
        entrada_esperada: extra.expectedEntry || null,
        salida_esperada: extra.expectedExit || null,
        almuerzo_min: extra.breakMinutes ?? null,
        jornada_dias: extra.jornadaDias == null ? null : diasAApi(extra.jornadaDias),
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

// ── horariosService ───────────────────────────────────────────────────
// Plantillas de jornada POR DÍAS con nombre: al asignarlas a un empleado se
// COPIA su mapa de días (los cálculos siguen leyendo del empleado).
export function getHorarios() {
  return store.horarios ?? [];
}

export async function addHorario({ nombre, dias }) {
  try {
    const d = await api('/api/horarios', {
      method: 'POST',
      body: JSON.stringify({ nombre, dias: diasAApi(dias) }),
    });
    return { nombre: d.horario.nombre };
  } catch (e) {
    return { error: e.message };
  }
}

export async function updateHorario(id, partial) {
  const body = {};
  if ('nombre' in partial) body.nombre = partial.nombre;
  if ('dias' in partial) body.dias = diasAApi(partial.dias);
  try {
    await api(`/api/horarios/${id}`, { method: 'PATCH', body: JSON.stringify(body) });
    return { ok: true };
  } catch (e) {
    return { error: e.message };
  }
}

export async function removeHorario(id) {
  try {
    await api(`/api/horarios/${id}`, { method: 'DELETE' });
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
