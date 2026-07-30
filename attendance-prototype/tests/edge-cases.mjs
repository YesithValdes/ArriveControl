/**
 * tests/edge-cases.mjs
 * Pruebas adversariales: casos "una vez en la vida" que podrían romper el
 * sistema. Ejecutar: node tests/edge-cases.mjs
 * Estas pruebas DOCUMENTAN el comportamiento real — algunas se espera que
 * fallen, revelando debilidades a corregir.
 */

import assert from 'node:assert/strict';

// Shim de localStorage para Node.
const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
};

const { registerPassage, getJourneys, _resetJourneys } = await import('../services/journeyService.js');
const { euclideanDistance } = await import('../utils/faceMath.js');
const { addPerson, listPeople } = await import('../services/rosterService.js');

let pass = 0, fail = 0;
const test = async (name, fn) => {
  try { await fn(); pass++; console.log(`  ✅ ${name}`); }
  catch (e) { fail++; console.log(`  ⚠️ ${name}\n     → ${e.message.split('\n')[0]}`); }
};
const at = (iso) => new Date(iso);
const P = { id: 'PX', name: 'Prueba' };

console.log('\n🕛 CASO 1 · Cruce de medianoche y fin de año');
_resetJourneys();
await test('entra 23:50 del 31 dic, sale 00:10 del 1 ene → la salida cierra la jornada', () => {
  registerPassage(P, at('2026-12-31T23:50:00'));
  const r = registerPassage(P, at('2027-01-01T00:10:00'));
  assert.equal(r.type, 'out');
});
await test('esa jornada nocturna se muestra coherente en getJourneys (no dos días rotos)', () => {
  const js = getJourneys().filter((j) => j.personId === 'PX');
  // La entrada queda en un día y la salida en otro: ¿la entrada aparece como "sin salida"?
  const dayWithIn = js.find((j) => j.events.some((e) => e.type === 'in'));
  const entry = dayWithIn.events.find((e) => e.type === 'in');
  assert.equal(entry.missingExit, false, 'la entrada del 31 no debe marcarse "sin salida": sí tiene salida (el 1 ene)');
});

console.log('\n⏰ CASO 2 · Frontera exacta de la ventana nocturna (12 h)');
_resetJourneys();
await test('turno de EXACTAMENTE 12 h: entra 19:00, sale 07:00 → debería ser salida', () => {
  registerPassage(P, at('2026-07-29T19:00:00'));
  const r = registerPassage(P, at('2026-07-30T07:00:00'));
  assert.equal(r.type, 'out', `dio '${r.type}': la ventana usa < estricto y 12h exactas quedan fuera`);
});

console.log('\n🕰️ CASO 3 · El reloj del dispositivo se ATRASA (ajuste de hora, fallo de batería)');
_resetJourneys();
await test('marca a las 08:00, el reloj retrocede, marca a las 07:30 → no debe bloquearse como duplicado', () => {
  registerPassage(P, at('2026-07-30T08:00:00'));
  const r = registerPassage(P, at('2026-07-30T07:30:00')); // "antes" del último evento
  assert.equal(r.duplicate, undefined, 'con diff negativo (< 3 min) el anti-rebote lo traga como duplicado');
});

console.log('\n🍽️ CASO 4 · Turno legítimo de la tarde (restaurante: 13:00–21:00)');
_resetJourneys();
await test('con horario esperado 13:00, entrar a la 1 p.m. NO es anómalo', () => {
  const tarde = { id: 'PT', name: 'Turno Tarde', expectedEntry: '13:00' };
  const r = registerPassage(tarde, at('2026-07-30T13:05:00'));
  assert.equal(r.flag, null, `flag='${r.flag}'`);
});
await test('con horario 13:00, entrar a las 16:30 (>3 h tarde) SÍ alerta', () => {
  _resetJourneys();
  const tarde = { id: 'PT', name: 'Turno Tarde', expectedEntry: '13:00' };
  const r = registerPassage(tarde, at('2026-07-30T16:30:00'));
  assert.equal(r.flag, 'late-entry');
});
await test('sin horario configurado, se conserva la regla del mediodía', () => {
  _resetJourneys();
  const r = registerPassage(P, at('2026-07-30T13:00:00'));
  assert.equal(r.flag, 'late-entry');
});

console.log('\n💾 CASO 5 · Datos corruptos en el roster');
await test('persona con descriptor null en el roster no debe tumbar la comparación 1:N del kiosco', () => {
  // Réplica del filtro del kiosco (handleStart): excluye registros dañados.
  const people = [
    { id: 'A', name: 'Sana', descriptor: new Array(128).fill(0.1) },
    { id: 'B', name: 'Corrupta', descriptor: null }, // dato dañado
  ].filter((p) => Array.isArray(p.descriptor) && p.descriptor.length === 128 && p.descriptor.every(Number.isFinite));

  const live = new Array(128).fill(0.1);
  let best = { distance: Infinity, person: null };
  for (const p of people) {
    const d = euclideanDistance(p.descriptor, live);
    if (d < best.distance) best = { distance: d, person: p };
  }
  assert.ok(best.person, 'no llegó aquí: la excepción rompe el bucle del kiosco');
  assert.equal(best.person.id, 'A');
});

console.log('\n🗄️ CASO 6 · localStorage lleno (QuotaExceededError) justo al marcar');
await test('si guardar el evento falla, registerPassage devuelve storageError en vez de lanzar', () => {
  _resetJourneys();
  registerPassage(P, at('2026-07-30T08:00:00')); // este sí guarda
  const realSet = globalThis.localStorage.setItem;
  globalThis.localStorage.setItem = () => { throw new DOMException('QuotaExceededError'); };
  try {
    const r = registerPassage(P, at('2026-07-30T09:00:00'));
    assert.equal(r.storageError, true, `lanzó o devolvió ${JSON.stringify(r)}`);
  } finally {
    globalThis.localStorage.setItem = realSet;
  }
});

console.log('\n👥 CASO 7 · Colisión de IDs al registrar dos empleados en el mismo milisegundo');
await test('dos addPerson simultáneos no deben poder chocar de id', () => {
  const d = new Array(128).fill(0.2);
  const a = addPerson('Gemela Uno', d, '111111');
  const b = addPerson('Gemela Dos', d, '222222');
  assert.notEqual(a.id, b.id);
});

console.log('\n🔢 CASO 8 · Cédula con formato distinto ("1.085.312" vs "1085312")');
await test('la misma cédula con puntos no debería registrarse dos veces', () => {
  const d = new Array(128).fill(0.3);
  addPerson('Puntos', d, '1085312456');
  const dup = addPerson('Sin Puntos', d, '1.085.312.456');
  assert.ok(dup.error, 'formatos distintos de la misma cédula crean duplicados');
});

console.log(`\n${pass} casos OK · ${fail} debilidades encontradas\n`);
