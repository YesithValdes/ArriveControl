/**
 * services/demoDataService.js
 * Datos de demostración completos para el panel del administrador.
 *
 * Siembra DOS cosas:
 *  - Roster (attendance_roster_people): 10 empleados con cédula, sede y
 *    horario esperado. Sin descriptor facial (el kiosco los excluye solo).
 *  - Eventos de jornada (attendance_journey_events): una semana de doble
 *    turno (9–12 y 13–18) mezclando días perfectos y errores reales:
 *      · entrada tardía hoy (olvidó marcar en la mañana)
 *      · salida faltante de ayer
 *      · cascada por olvido de la salida a almuerzo (E9 → S13 → E18 colgada)
 *      · ausente hoy · medio tiempo · horas extra · correcciones del admin
 */

const EVENTS_KEY = 'attendance_journey_events';
const PEOPLE_KEY = 'attendance_roster_people';

const PEOPLE = [
  { id: 'EMP-001', name: 'Laura Gómez',   cedula: '1085245631', sede: 'Sede 1', expectedEntry: '09:00' },
  { id: 'EMP-002', name: 'Carlos Ruiz',   cedula: '1085312478', sede: 'Sede 1', expectedEntry: '09:00' },
  { id: 'EMP-003', name: 'Ana Martínez',  cedula: '1086529814', sede: 'Sede 2', expectedEntry: '09:00' },
  { id: 'EMP-004', name: 'Jorge Delgado', cedula: '1085774102', sede: 'Sede 1', expectedEntry: '09:00' },
  { id: 'EMP-005', name: 'María Torres',  cedula: '1087163925', sede: 'Sede 2', expectedEntry: '09:00' },
  { id: 'EMP-006', name: 'Pedro Salazar', cedula: '1085901347', sede: 'Sede 3', expectedEntry: '09:00' },
  { id: 'EMP-007', name: 'Sofía Ríos',    cedula: '1086420589', sede: 'Sede 2', expectedEntry: '09:00' },
  { id: 'EMP-008', name: 'Andrés Peña',   cedula: '1085637201', sede: 'Sede 3', expectedEntry: '09:00' },
  { id: 'EMP-009', name: 'Diana López',   cedula: '108735846',  sede: 'Sede 1', expectedEntry: '09:00' },
  { id: 'EMP-010', name: 'Camilo Vela',   cedula: '1086194753', sede: 'Sede 3', expectedEntry: '09:00' },
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
    sede: person.sede,
    type,
    ts,
    flag: null,
    correctedBy: null,
    ...extra,
  };
}

/** Día perfecto de doble turno: 9–12 y 13–18 (con minutos de variación). */
function goodDay(events, p, d, { inM = 0, outH = 18, outM = 0 } = {}) {
  events.push(
    ev(p, 'in', at(d, 8, 55 + inM)),
    ev(p, 'out', at(d, 12, 2)),
    ev(p, 'in', at(d, 12, 58)),
    ev(p, 'out', at(d, outH, outM)),
  );
}

export function loadDemoData() {
  const [laura, carlos, ana, jorge, maria, pedro, sofia, andres, diana, camilo] = PEOPLE;
  const events = [];
  const now = new Date();
  const h = now.getHours();
  // Días hábiles de la última semana (sin contar hoy): 1..6 días atrás.

  for (let d = 6; d >= 1; d--) {
    // ── Los cumplidos: doble turno completo toda la semana ──
    goodDay(events, laura, d, { inM: (d % 3) });            // siempre puntual
    goodDay(events, carlos, d, { inM: 8 });                 // llega ~9:03
    goodDay(events, maria, d, { inM: 2 });
    if (d !== 4) goodDay(events, ana, d, { inM: 12 });      // un día no fue

    // Andrés: cumplido y con horas extra (sale 19:30 tres días).
    goodDay(events, andres, d, { outH: d % 2 === 0 ? 19 : 18, outM: d % 2 === 0 ? 30 : 5 });

    // Camilo: medio tiempo — solo turno de la mañana (9 a 13).
    events.push(ev(camilo, 'in', at(d, 8, 57)), ev(camilo, 'out', at(d, 13, 1)));

    // Pedro: irregular — solo trabajó 3 días de la semana.
    if (d % 2 === 0) goodDay(events, pedro, d, { inM: 20 }); // llega ~9:15

    // Diana y Jorge: días normales previos.
    if (d >= 2) goodDay(events, diana, d, { inM: 4 });
    if (d >= 2 && d !== 3) goodDay(events, jorge, d, { inM: 6 });
  }

  // ── CASO 1 · Jorge: AYER olvidó marcar la salida de la tarde ──
  // Marcó 9:00, 12:01 y 12:57… y se fue a las 6 sin pasar por el kiosco.
  events.push(
    ev(jorge, 'in', at(1, 8, 58)),
    ev(jorge, 'out', at(1, 12, 1)),
    ev(jorge, 'in', at(1, 12, 57)),   // >12 h abierta → anomalía "salida faltante"
  );

  // ── CASO 2 · Sofía: hace 2 días olvidó la salida a ALMUERZO ──
  // La alternancia etiquetó mal el resto del día: E 9:00 → S 13:02 (era su
  // regreso) → E 18:04 (era su salida) → entrada colgada → anomalía.
  goodDay(events, sofia, 5); goodDay(events, sofia, 4); goodDay(events, sofia, 3);
  events.push(
    ev(sofia, 'in', at(2, 9, 0)),
    ev(sofia, 'out', at(2, 13, 2)),
    ev(sofia, 'in', at(2, 18, 4)),    // queda abierta → "salida faltante"
  );
  goodDay(events, sofia, 1);

  // ── CASO 3 · Diana: el admin ya corrigió una salida olvidada ──
  events.push(
    ev(diana, 'in', at(3, 9, 1)),
    ev(diana, 'out', at(3, 12, 3)),
    ev(diana, 'in', at(3, 12, 59)),
    ev(diana, 'out', at(3, 18, 0), { flag: 'manual', correctedBy: 'admin' }), // agregada a mano
  );
  // Y una corrección de hora en la entrada de Laura (falla del kiosco).
  events.push(ev(laura, 'in', at(1, 9, 0), { flag: 'corrected', correctedBy: 'admin' }));

  // ── HOY: mezcla de estados en vivo ──
  // Cumplidos: mañana completa y, según la hora real, tarde en curso o cerrada.
  for (const p of [laura, carlos, maria, andres]) {
    events.push(ev(p, 'in', at(0, 8, 56 + (p === carlos ? 7 : 0))));
    if (h >= 12) events.push(ev(p, 'out', at(0, 12, 1)));
    if (h >= 13) events.push(ev(p, 'in', at(0, 12, 58)));
    if (h >= 18) events.push(ev(p, 'out', at(0, 18, p === andres ? 45 : 2)));
  }
  // Camilo (medio tiempo): mañana y salida a la 1.
  events.push(ev(camilo, 'in', at(0, 8, 59)));
  if (h >= 13) events.push(ev(camilo, 'out', at(0, 13, 0)));
  // Sofía y Diana: día normal en curso.
  events.push(ev(sofia, 'in', at(0, 9, 2)));
  events.push(ev(diana, 'in', at(0, 9, 5)));
  if (h >= 12) { events.push(ev(sofia, 'out', at(0, 12, 0))); events.push(ev(diana, 'out', at(0, 12, 4))); }
  if (h >= 13) { events.push(ev(sofia, 'in', at(0, 13, 1))); events.push(ev(diana, 'in', at(0, 13, 3))); }
  // Jorge también vino hoy (su anomalía es de ayer).
  events.push(ev(jorge, 'in', at(0, 9, 4)));
  if (h >= 12) events.push(ev(jorge, 'out', at(0, 12, 2)));
  if (h >= 13) events.push(ev(jorge, 'in', at(0, 13, 0)));
  // CASO 4 · Ana: hoy olvidó marcar la mañana; su primera marcación fue
  // en la tarde → flag "entrada tardía".
  if (h >= 13) {
    events.push(ev(ana, 'in', at(0, 13, 21), { flag: 'late-entry' }));
  }
  // CASO 5 · Pedro: hoy no ha marcado nada → "Sin marcación".

  events.sort((a, b) => a.ts.localeCompare(b.ts));
  localStorage.setItem(EVENTS_KEY, JSON.stringify(events));

  // Roster: agrega/actualiza los 10 demo sin borrar registros reales.
  let roster = [];
  try { roster = JSON.parse(localStorage.getItem(PEOPLE_KEY) || '[]'); } catch { roster = []; }
  const demoIds = new Set(PEOPLE.map((p) => p.id));
  roster = roster.filter((p) => !demoIds.has(p.id));
  for (const p of PEOPLE) {
    roster.push({ ...p, descriptor: null, createdAt: at(30, 9, 0) }); // sin rostro: el kiosco los ignora
  }
  localStorage.setItem(PEOPLE_KEY, JSON.stringify(roster));

  return { people: PEOPLE.length, events: events.length };
}
