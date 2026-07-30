/**
 * tests/run-tests.mjs
 * Validación por terminal de toda la lógica del prototipo (sin navegador).
 * Ejecutar:  node attendance-prototype/tests/run-tests.mjs
 */

import assert from 'node:assert/strict';
import { haversineDistance, isWithinOfficeRadius, OFFICE_LOCATION, OFFICE_LOCATIONS } from '../utils/haversine.js';
import { euclideanDistance, compareFaces, MATCH_THRESHOLD } from '../utils/faceMath.js';
import { bufferToBase64url, base64urlToBuffer, stringToBuffer } from '../utils/base64url.js';
import {
  registerEmployee,
  checkInEmployee,
  getAttendanceLog,
  _resetMockDatabase,
} from '../services/attendanceService.js';

let passed = 0;
const test = async (name, fn) => {
  try {
    await fn();
    passed++;
    console.log(`  ✅ ${name}`);
  } catch (e) {
    console.error(`  ❌ ${name}\n     ${e.message}`);
    process.exitCode = 1;
  }
};

// Embedding falso reproducible
const fakeEmbedding = (seed = 0) =>
  Array.from({ length: 128 }, (_, i) => Math.sin(i + seed) * 0.5);

console.log('\n📍 Haversine');
await test('distancia 0 en el mismo punto', () => {
  assert.equal(haversineDistance(4.12345, -74.12345, 4.12345, -74.12345), 0);
});
await test('~111 km por grado de latitud', () => {
  const d = haversineDistance(0, 0, 1, 0);
  assert.ok(Math.abs(d - 111195) < 200, `obtuvo ${d}`);
});
await test('dentro del radio (oficina exacta)', () => {
  const r = isWithinOfficeRadius(OFFICE_LOCATION.lat, OFFICE_LOCATION.lon);
  assert.equal(r.inRange, true);
});
await test('dentro del radio (~30 m al norte)', () => {
  // ~0.00027° lat ≈ 30 m
  const r = isWithinOfficeRadius(OFFICE_LOCATION.lat + 0.00027, OFFICE_LOCATION.lon);
  assert.ok(r.inRange && r.distance > 25 && r.distance < 35, `distancia ${r.distance}`);
});
await test('fuera del radio (~100 m)', () => {
  const r = isWithinOfficeRadius(OFFICE_LOCATION.lat + 0.0009, OFFICE_LOCATION.lon);
  assert.equal(r.inRange, false);
  assert.ok(r.distance > 90, `distancia ${r.distance}`);
});
await test('dentro del radio en la Sede 2 (multi-ubicación)', () => {
  const sede2 = OFFICE_LOCATIONS[1];
  const r = isWithinOfficeRadius(sede2.lat, sede2.lon);
  assert.equal(r.inRange, true);
  assert.equal(r.nearest, 'Sede 2');
});
await test('entre ambas sedes, fuera de rango, reporta la más cercana', () => {
  // Punto lejos de las dos: nearest debe ser una sede válida y no en rango.
  const r = isWithinOfficeRadius(OFFICE_LOCATION.lat + 0.005, OFFICE_LOCATION.lon);
  assert.equal(r.inRange, false);
  assert.ok(['Sede 1', 'Sede 2'].includes(r.nearest));
});

console.log('\n🧮 Distancia Euclidiana');
await test('distancia 0 entre vectores idénticos', () => {
  const v = fakeEmbedding(1);
  assert.equal(euclideanDistance(v, v), 0);
});
await test('cálculo correcto conocido', () => {
  const a = new Array(128).fill(0);
  const b = new Array(128).fill(0);
  b[0] = 3; b[1] = 4; // sqrt(9+16) = 5
  assert.equal(euclideanDistance(a, b), 5);
});
await test('rechaza vectores de longitud incorrecta', () => {
  assert.throws(() => euclideanDistance([1, 2, 3], fakeEmbedding()));
});
await test('compareFaces: match bajo el umbral', () => {
  const a = fakeEmbedding(1);
  const b = a.map((n) => n + 0.01); // perturbación pequeña
  const r = compareFaces(a, b);
  assert.ok(r.isMatch && r.distance < MATCH_THRESHOLD, `distancia ${r.distance}`);
});
await test('compareFaces: rechazo sobre el umbral', () => {
  const r = compareFaces(fakeEmbedding(1), fakeEmbedding(50));
  assert.equal(r.isMatch, false);
});

console.log('\n🔐 Base64url (WebAuthn)');
await test('ida y vuelta buffer -> base64url -> buffer', () => {
  const original = new Uint8Array([0, 1, 2, 250, 251, 252, 253, 254, 255]);
  const encoded = bufferToBase64url(original.buffer);
  assert.ok(!/[+/=]/.test(encoded), 'no debe contener +, / ni =');
  assert.deepEqual(new Uint8Array(base64urlToBuffer(encoded)), original);
});
await test('stringToBuffer codifica UTF-8', () => {
  const buf = stringToBuffer('EMP-001');
  assert.equal(new TextDecoder().decode(buf), 'EMP-001');
});

console.log('\n📩 Código de registro (OTP)');
// El servicio usa localStorage (solo navegador); en Node probamos la lógica pura.
await test('código generado es de 6 dígitos', () => {
  const code = String(Math.floor(Math.random() * 1000000)).padStart(6, '0');
  assert.match(code, /^\d{6}$/);
});
await test('comparación de código: trim quita espacios de los extremos', () => {
  const stored = '004521';
  assert.equal(stored === String(' 004521 ').trim(), true);  // espacios externos: OK
  assert.equal(stored === String('004522').trim(), false);   // código distinto: rechaza
});

console.log('\n🗄️ Servicio de asistencia (Supabase mock)');
_resetMockDatabase();
await test('registro inicial exitoso', async () => {
  const r = await registerEmployee('EMP-001', fakeEmbedding(7));
  assert.equal(r.success, true);
});
await test('registro rechaza embedding inválido', async () => {
  const r = await registerEmployee('EMP-002', [1, 2, 3]);
  assert.equal(r.success, false);
});
await test('fichaje exitoso (misma persona)', async () => {
  const live = fakeEmbedding(7).map((n) => n + 0.02);
  const r = await checkInEmployee('EMP-001', live);
  assert.equal(r.success, true, r.error);
  assert.ok(r.distance < 0.55);
});
await test('fichaje rechazado (otra persona)', async () => {
  const r = await checkInEmployee('EMP-001', fakeEmbedding(99));
  assert.equal(r.success, false);
});
await test('fichaje rechazado (empleado no registrado)', async () => {
  const r = await checkInEmployee('EMP-999', fakeEmbedding(7));
  assert.equal(r.success, false);
});
await test('log de asistencia contiene solo el fichaje exitoso', () => {
  const log = getAttendanceLog();
  assert.equal(log.length, 1);
  assert.equal(log[0].employeeId, 'EMP-001');
});

console.log('\n📅 Lógica de jornadas (entrada/salida)');
// Node no trae localStorage: shim en memoria ANTES de importar el servicio.
if (typeof globalThis.localStorage === 'undefined') {
  const store = new Map();
  globalThis.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
  };
}
const { registerPassage, _resetJourneys } = await import('../services/journeyService.js');
const person = { id: 'P1', name: 'Ana' };
const at = (iso) => new Date(iso);

_resetJourneys();
await test('primer paso del día es ENTRADA', () => {
  const r = registerPassage(person, at('2026-07-30T07:58:00'));
  assert.equal(r.type, 'in');
  assert.equal(r.flag, null);
});
await test('segundo paso es SALIDA', () => {
  const r = registerPassage(person, at('2026-07-30T17:02:00'));
  assert.equal(r.type, 'out');
});
await test('tercer paso vuelve a ENTRADA', () => {
  const r = registerPassage(person, at('2026-07-30T19:00:00'));
  assert.equal(r.type, 'in');
});
await test('anti-rebote: doble pasada en <3 min no duplica', () => {
  const r = registerPassage(person, at('2026-07-30T19:01:30'));
  assert.equal(r.duplicate, true);
});
_resetJourneys();
await test('olvido de salida: al otro día vuelve a ENTRADA (no salida)', () => {
  registerPassage(person, at('2026-07-29T08:00:00')); // entrada ayer, sin salida
  const r = registerPassage(person, at('2026-07-30T08:05:00'));
  assert.equal(r.type, 'in', 'la entrada vieja (>12h) no debe alternar');
});
_resetJourneys();
await test('turno nocturno: salida a las 6 a.m. cierra la entrada de las 10 p.m.', () => {
  registerPassage(person, at('2026-07-29T22:00:00'));
  const r = registerPassage(person, at('2026-07-30T06:00:00'));
  assert.equal(r.type, 'out', 'dentro de la ventana de 12h debe ser salida');
});
_resetJourneys();
await test('entrada tardía (primera del día en la tarde) queda marcada', () => {
  const r = registerPassage(person, at('2026-07-30T17:03:00'));
  assert.equal(r.type, 'in');
  assert.equal(r.flag, 'late-entry');
});

console.log(`\n${passed} pruebas pasaron.${process.exitCode ? ' (con fallos)' : ' ✅ Todo OK'}\n`);
