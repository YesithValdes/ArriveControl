/**
 * services/demoDataService.js
 * Genera datos de demostración para el panel del administrador: una semana
 * de jornadas para 6 empleados, con anomalías (salida faltante, entrada
 * tardía) y correcciones de admin. Escribe en la misma clave de localStorage
 * que usa journeyService, así el panel los lee como eventos reales.
 */

const EVENTS_KEY = 'attendance_journey_events';

const PEOPLE = [
  { id: 'EMP-001', name: 'Laura Gómez' },
  { id: 'EMP-002', name: 'Carlos Ruiz' },
  { id: 'EMP-003', name: 'Ana Martínez' },
  { id: 'EMP-004', name: 'Jorge Delgado' },
  { id: 'EMP-005', name: 'María Torres' },
  { id: 'EMP-006', name: 'Pedro Salazar' },
];

/** Fecha local de hace `daysAgo` días a la hora hh:mm. */
function at(daysAgo, hh, mm) {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  d.setHours(hh, mm, 0, 0);
  return d.toISOString();
}

let seq = 0;
function ev(person, type, ts, extra = {}) {
  seq += 1;
  return {
    id: `demo-${seq}-${person.id}`,
    personId: person.id,
    personName: person.name,
    type,
    ts,
    flag: null,
    correctedBy: null,
    ...extra,
  };
}

export function loadDemoData() {
  const [laura, carlos, ana, jorge, maria, pedro] = PEOPLE;
  const events = [];

  // Días 6..1 atrás: jornadas normales con pequeñas variaciones por persona.
  for (let d = 6; d >= 1; d--) {
    events.push(ev(laura, 'in', at(d, 7, 58)), ev(laura, 'out', at(d, 17, 4)));
    events.push(ev(carlos, 'in', at(d, 8, 12)), ev(carlos, 'out', at(d, 16, 55)));
    events.push(ev(maria, 'in', at(d, 8, 3)), ev(maria, 'out', at(d, 17, 20)));
    if (d !== 2) events.push(ev(ana, 'in', at(d, 8, 25)), ev(ana, 'out', at(d, 16, 40)));
    if (d % 2 === 0) events.push(ev(pedro, 'in', at(d, 9, 0)), ev(pedro, 'out', at(d, 15, 30)));
  }

  // Jorge: turnos parciales y ANOMALÍA — ayer marcó entrada y nunca salió.
  events.push(ev(jorge, 'in', at(5, 7, 45)), ev(jorge, 'out', at(5, 17, 0)));
  events.push(ev(jorge, 'in', at(3, 7, 50)), ev(jorge, 'out', at(3, 16, 58)));
  events.push(ev(jorge, 'in', at(1, 7, 45))); // salida faltante →  anomalía

  // Corrección previa del admin: a Pedro se le agregó una salida manual.
  events.push(ev(pedro, 'in', at(3, 8, 55)));
  events.push(ev(pedro, 'out', at(3, 17, 0), { flag: 'manual', correctedBy: 'admin' }));

  // Corrección de hora: la entrada de Laura de hace 4 días fue ajustada.
  const fixed = ev(laura, 'in', at(4, 8, 0), { flag: 'corrected', correctedBy: 'admin' });
  events.push(fixed);

  // HOY: equipo trabajando ahora mismo.
  const now = new Date();
  const h = now.getHours();
  events.push(ev(laura, 'in', at(0, 7, 57)));                    // presente
  events.push(ev(carlos, 'in', at(0, 8, 10)));                   // presente
  events.push(ev(maria, 'in', at(0, 8, 1)));
  if (h >= 17) events.push(ev(maria, 'out', at(0, 17, 2)));      // jornada completa
  if (h >= 13) {
    events.push(ev(ana, 'in', at(0, 13, 21), { flag: 'late-entry' })); // ANOMALÍA hoy
  }
  // Pedro hoy no ha marcado → "Sin marcación".

  events.sort((a, b) => a.ts.localeCompare(b.ts));
  localStorage.setItem(EVENTS_KEY, JSON.stringify(events));
  return { people: PEOPLE.length, events: events.length };
}
