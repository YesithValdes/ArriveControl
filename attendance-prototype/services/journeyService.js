/**
 * services/journeyService.js
 * Lógica de jornadas: alterna ENTRADA/SALIDA por persona con reglas de
 * negocio, detecta anomalías y permite correcciones del administrador.
 *
 * Reglas:
 *  - Alternancia CON REINICIO DIARIO: si el último evento es una ENTRADA de
 *    HOY (mismo día calendario local) → este paso es SALIDA; en cualquier
 *    otro caso → ENTRADA. Cada día empieza de cero:
 *    · El olvido de salida de ayer nunca contamina el día siguiente.
 *    · Nota: una jornada que cruce la medianoche (turno nocturno) NO se
 *      cierra sola — la operación es diurna (8–19); si algún día se
 *      necesitan turnos nocturnos, este es el punto a revisar.
 *  - Anti-rebote: si el último evento fue hace < 3 min, no se registra otro.
 *  - Las HORAS TRABAJADAS salen de sumar los pares entrada→salida marcados.
 *    No se supone ningún horario ni se descuenta almuerzo por configuración:
 *    si la persona marca su pausa, ese tiempo queda fuera de los pares solo.
 *  - Anomalías:
 *    · 'late-entry'   → solo si el empleado TIENE horario de entrada configurado.
 *    · 'early-exit'   → solo si TIENE horario de salida configurado.
 *    · 'missing-exit' → ENTRADA con > 12 h sin salida que la cierre (no depende
 *                       de horario: sin el cierre del par, las horas no se calculan).
 *
 * En producción: tabla 'attendance_events' en Supabase, timestamp del
 * SERVIDOR (nunca del cliente) y cola offline en el kiosco.
 */

const EVENTS_KEY = 'attendance_journey_events';

export const ANTI_BOUNCE_MS = 3 * 60 * 1000;      // 3 minutos
export const NIGHT_WINDOW_MS = 12 * 60 * 60 * 1000; // 12 horas
export const LATE_ENTRY_HOUR = 12;                 // mediodía (fallback sin horario)
export const LATE_TOLERANCE_MIN = 180;             // 3 h después del horario esperado
// Salida temprana: solo alerta si se va MUCHO antes de su hora esperada.
// Salir más tarde NUNCA es anomalía: en esta operación alargarse es normal
// y se contabiliza como horas extra, no como incidencia.
export const EARLY_EXIT_TOLERANCE_MIN = 90;        // 1½ h antes de lo esperado

const hasLS = typeof localStorage !== 'undefined';
const load = () => {
  if (!hasLS) return [];
  try { return JSON.parse(localStorage.getItem(EVENTS_KEY) || '[]'); } catch { return []; }
};
const save = (events) => hasLS && localStorage.setItem(EVENTS_KEY, JSON.stringify(events));

const dayKey = (iso) => iso.slice(0, 10); // YYYY-MM-DD
const HHMM = /^\d{2}:\d{2}$/;

/**
 * Registra el paso de una persona por el kiosco y decide ENTRADA o SALIDA.
 * @returns {{ duplicate?: true, last?: object } | { type: 'in'|'out', event: object, flag: string|null }}
 */
export function registerPassage(person, now = new Date()) {
  const events = load();
  const mine = events.filter((e) => e.personId === person.id).sort((a, b) => a.ts.localeCompare(b.ts));
  const last = mine[mine.length - 1] || null;
  const nowMs = now.getTime();

  // Anti-rebote: doble pasada accidental. Math.abs protege contra relojes
  // que retroceden (NTP/ajuste manual): una diferencia negativa grande NO
  // debe tragarse la marcación como duplicado.
  if (last && Math.abs(nowMs - new Date(last.ts).getTime()) < ANTI_BOUNCE_MS) {
    return { duplicate: true, last };
  }

  // Alternancia con reinicio diario: solo una ENTRADA de HOY (mismo día
  // calendario LOCAL) alterna a salida; cualquier otro caso arranca el día
  // con ENTRADA. Se compara en hora local (no dayKey/UTC) para que las
  // marcaciones de la noche no caigan en el "día" equivocado.
  const sameLocalDay = last && new Date(last.ts).toDateString() === now.toDateString();
  const type = last && last.type === 'in' && sameLocalDay ? 'out' : 'in';

  // Anomalía: primera entrada del día mucho después del horario esperado.
  // El horario es OPCIONAL: sin horario configurado NO se evalúa nada — no
  // se supone ninguna hora de entrada, porque los horarios varían por persona.
  let flag = null;
  if (type === 'in' && HHMM.test(person.expectedEntry || '')) {
    const todayEvents = mine.filter((e) => dayKey(e.ts) === dayKey(now.toISOString()));
    if (todayEvents.length === 0) {
      const [h, m] = person.expectedEntry.split(':').map(Number);
      const nowMin = now.getHours() * 60 + now.getMinutes();
      if (nowMin >= h * 60 + m + LATE_TOLERANCE_MIN) flag = 'late-entry';
    }
  }

  // Anomalía: salida MUY anterior a la esperada. Solo se evalúa aquí, en el
  // momento de marcar; si la persona vuelve a entrar después (almuerzo), la
  // bandera se limpia al cerrar la jornada real (ver clearEarlyExitIfReturned).
  if (type === 'out' && HHMM.test(person.expectedExit || '')) {
    const [xh, xm] = person.expectedExit.split(':').map(Number);
    const nowMin = now.getHours() * 60 + now.getMinutes();
    if (nowMin < xh * 60 + xm - EARLY_EXIT_TOLERANCE_MIN) flag = 'early-exit';
  }

  const event = {
    id: `${nowMs}-${person.id}`,
    personId: person.id,
    personName: person.name,
    sede: person.sede || null, // sede asignada al empleado al momento de marcar
    type,
    ts: now.toISOString(),
    flag,
    correctedBy: null,
  };

  // Si la persona VUELVE a entrar, la salida anterior no era la final: era
  // una pausa (almuerzo, diligencia). Limpiamos su bandera 'early-exit' para
  // no reportar como incidencia lo que fue un descanso normal.
  if (type === 'in' && last && last.type === 'out' && last.flag === 'early-exit') {
    const original = events.find((e) => e.id === last.id);
    if (original) original.flag = null;
  }

  // El guardado puede fallar (almacenamiento lleno/corrupto). NUNCA debe
  // reventar al kiosco ni simular un éxito: se reporta como error manejable.
  try {
    events.push(event);
    save(events);
  } catch {
    return { storageError: true };
  }
  return { type, event, flag };
}

export function listJourneyEvents() {
  return load().sort((a, b) => b.ts.localeCompare(a.ts));
}

/**
 * Agrupa eventos en jornadas por persona y día, y anota anomalías:
 * entradas viejas (>12 h) sin salida se marcan 'missing-exit' al vuelo.
 */
export function getJourneys() {
  const events = load().sort((a, b) => a.ts.localeCompare(b.ts));
  const nowMs = Date.now();
  const byPersonDay = new Map();

  for (const e of events) {
    const key = `${e.personId}|${dayKey(e.ts)}`;
    if (!byPersonDay.has(key)) {
      byPersonDay.set(key, { personId: e.personId, personName: e.personName, day: dayKey(e.ts), events: [] });
    }
    byPersonDay.get(key).events.push(e);
  }

  // Detectar entradas sin cerrar (missing-exit) mirando el evento siguiente
  // de esa persona en el tiempo (puede estar en otro día por turno nocturno).
  const byPerson = new Map();
  for (const e of events) {
    if (!byPerson.has(e.personId)) byPerson.set(e.personId, []);
    byPerson.get(e.personId).push(e);
  }
  for (const list of byPerson.values()) {
    for (let i = 0; i < list.length; i++) {
      const e = list[i];
      if (e.type !== 'in') continue;
      const next = list[i + 1];
      const closed = next && next.type === 'out';
      const age = nowMs - new Date(e.ts).getTime();
      e.missingExit = !closed && age > NIGHT_WINDOW_MS;
    }
  }

  return Array.from(byPersonDay.values()).sort((a, b) => b.day.localeCompare(a.day) || a.personName.localeCompare(b.personName));
}

/** Corrección del admin: agrega un evento manual (p. ej. la salida olvidada). */
export function addManualEvent(personId, personName, type, isoTs, correctedBy = 'admin') {
  const events = load();
  events.push({
    id: `${Date.now()}-manual-${personId}`,
    personId, personName, type, ts: isoTs,
    flag: 'manual',
    correctedBy,
  });
  save(events);
}

/** Corrección del admin: cambia la hora de un evento existente. */
export function updateEventTime(eventId, isoTs, correctedBy = 'admin') {
  const events = load();
  const e = events.find((x) => x.id === eventId);
  if (!e) return false;
  e.ts = isoTs;
  e.flag = e.flag === 'manual' ? 'manual' : 'corrected';
  e.correctedBy = correctedBy;
  save(events);
  return true;
}

/** Corrección del admin: cambia el tipo (entrada↔salida) de un evento. */
export function updateEventType(eventId, type, correctedBy = 'admin') {
  if (type !== 'in' && type !== 'out') return false;
  const events = load();
  const e = events.find((x) => x.id === eventId);
  if (!e) return false;
  e.type = type;
  e.flag = e.flag === 'manual' ? 'manual' : 'corrected';
  e.correctedBy = correctedBy;
  save(events);
  return true;
}

export function deleteEvent(eventId) {
  save(load().filter((e) => e.id !== eventId));
}

export function _resetJourneys() {
  if (hasLS) localStorage.removeItem(EVENTS_KEY);
}
