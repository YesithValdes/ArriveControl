/**
 * services/rosterService.js
 * Gestiona el "roster" de personas registradas (nombre + descriptor facial)
 * y el registro de intentos de validación para calcular métricas de confianza
 * (FAR / FRR / anti-spoofing). Todo persistido en localStorage (mock).
 *
 * En producción esto vive en Supabase; aquí es una simulación local para el
 * piloto de pruebas.
 */

const PEOPLE_KEY = 'attendance_roster_people';
const ATTEMPTS_KEY = 'attendance_roster_attempts';

const hasLS = typeof localStorage !== 'undefined';
const load = (k, def) => {
  if (!hasLS) return def;
  try { return JSON.parse(localStorage.getItem(k) || JSON.stringify(def)); } catch { return def; }
};
const save = (k, v) => hasLS && localStorage.setItem(k, JSON.stringify(v));

// ── Personas registradas ──────────────────────────────────────────────
// Estructura: { id, name, cedula, descriptor: number[128], createdAt }
// La foto NUNCA se guarda: solo el vector de 128 floats extraído de ella.

export function listPeople() {
  return load(PEOPLE_KEY, []);
}

// Normaliza la cédula a solo dígitos: "1.085.312.456" === "1085312456".
const normalizeCedula = (cedula) => String(cedula || '').replace(/\D/g, '');

export function findByCedula(cedula) {
  const c = normalizeCedula(cedula);
  return listPeople().find((p) => p.cedula === c) || null;
}

export function addPerson(name, descriptor, cedula = '', expectedEntry = '08:00', sede = '') {
  const people = listPeople();
  const c = normalizeCedula(cedula);
  if (c && people.some((p) => p.cedula === c)) {
    return { error: `Ya existe un empleado registrado con la cédula ${c}.` };
  }
  const id = 'P' + (Date.now().toString(36)) + Math.floor(Math.random() * 1000);
  const person = {
    id,
    name: name.trim() || id,
    cedula: c,
    // Hora esperada de entrada ("HH:MM"): la alerta de entrada tardía se
    // calcula respecto a ESTE horario, no a una hora fija global.
    expectedEntry: /^\d{2}:\d{2}$/.test(expectedEntry) ? expectedEntry : '08:00',
    // Sede asignada: se usa para filtrar el dashboard por sede y para
    // limitar la validación GPS a la sede del empleado (no a cualquiera).
    sede: String(sede || '').trim(),
    descriptor,
    createdAt: new Date().toISOString(),
  };
  people.push(person);
  save(PEOPLE_KEY, people);
  return person;
}

export function removePerson(id) {
  save(PEOPLE_KEY, listPeople().filter((p) => p.id !== id));
}

export function getPerson(id) {
  return listPeople().find((p) => p.id === id) || null;
}

// ── Registro de intentos ──────────────────────────────────────────────
// kind: 'genuine' (soy la persona) | 'impostor' (soy otra) | 'spoof' (foto/video)
// Estructura: { id, targetId, targetName, kind, distance, livenessOk, accepted, ts }

export function logAttempt(entry) {
  const attempts = load(ATTEMPTS_KEY, []);
  attempts.push({ id: Date.now(), ts: new Date().toISOString(), ...entry });
  save(ATTEMPTS_KEY, attempts);
  return attempts.length;
}

export function listAttempts() {
  return load(ATTEMPTS_KEY, []);
}

export function clearAttempts() {
  save(ATTEMPTS_KEY, []);
}

/**
 * Calcula métricas de confianza a partir del log de intentos.
 *  - FRR (Falso Rechazo): intentos genuinos que fueron rechazados.
 *  - FAR (Falsa Aceptación): intentos de impostor que fueron aceptados.
 *  - Spoof: intentos con foto/video y cuántos se bloquearon.
 */
export function computeMetrics() {
  const attempts = listAttempts();
  const genuine = attempts.filter((a) => a.kind === 'genuine');
  const impostor = attempts.filter((a) => a.kind === 'impostor');
  const spoof = attempts.filter((a) => a.kind === 'spoof');

  const genuineRejected = genuine.filter((a) => !a.accepted).length;
  const impostorAccepted = impostor.filter((a) => a.accepted).length;
  const spoofBlocked = spoof.filter((a) => !a.accepted).length;

  const pct = (num, den) => (den === 0 ? null : Math.round((num / den) * 1000) / 10);

  return {
    total: attempts.length,
    genuine: genuine.length,
    impostor: impostor.length,
    spoof: spoof.length,
    frr: pct(genuineRejected, genuine.length),          // % — bajo es bueno
    far: pct(impostorAccepted, impostor.length),        // % — debe ser 0
    spoofBlockRate: pct(spoofBlocked, spoof.length),    // % — alto es bueno
    genuineRejected,
    impostorAccepted,
    spoofBlocked,
  };
}
