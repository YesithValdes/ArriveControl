/**
 * tests/run-tests.mjs
 * Validación por terminal de toda la lógica del prototipo (sin navegador).
 * Ejecutar:  node attendance-prototype/tests/run-tests.mjs
 */

import assert from 'node:assert/strict';
import { haversineDistance, isWithinOfficeRadius, OFFICE_LOCATION, OFFICE_LOCATIONS } from '../utils/haversine.js';
import { euclideanDistance, compareFaces, MATCH_THRESHOLD } from '../utils/faceMath.js';
import { bufferToBase64url, base64urlToBuffer, stringToBuffer } from '../utils/base64url.js';

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

// (El bloque "Servicio de asistencia (Supabase mock)" se eliminó junto con
// services/attendanceService.js: era del prototipo demo pre-Postgres.)

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
await test('reinicio diario: la marcación de las 6 a.m. del día siguiente es ENTRADA', () => {
  registerPassage(person, at('2026-07-29T22:00:00'));
  const r = registerPassage(person, at('2026-07-30T06:00:00'));
  assert.equal(r.type, 'in', 'cambió el día calendario: la alternancia se reinicia');
});
_resetJourneys();
await test('sin horario configurado, entrar en la tarde NO se marca como tardía', () => {
  // El horario es OPCIONAL: sin él, el sistema no supone ninguna hora esperada.
  const r = registerPassage(person, at('2026-07-30T17:03:00'));
  assert.equal(r.type, 'in');
  assert.equal(r.flag, null);
});
_resetJourneys();
await test('CON horario configurado, la entrada tardía sí se marca', () => {
  const conHorario = { id: 'P2', name: 'Beto', expectedEntry: '08:00' };
  const r = registerPassage(conHorario, at('2026-07-30T17:03:00'));
  assert.equal(r.type, 'in');
  assert.equal(r.flag, 'late-entry');
});

// ── Cálculo de horas con recargo ────────────────────────────────────────
// Es la ÚNICA implementación de esta regla en todo el producto (la nómina la
// consume por API), así que un error aquí llega directo al pago.
//
// La regla es POR SEMANA: las primeras 42 h de lunes a sábado son ordinarias
// y lo que sigue es extra; domingo y festivo van aparte. La semana de las
// pruebas es la del lunes 3 de agosto de 2026, y «hoy» es el lunes siguiente
// para que ya esté cerrada.
console.log('\n💵 Cálculo de horas con recargo (por semana)');
const { calcularRegistros, emparejarMarcas, horasDeHorario } = await import('../lib/calculoHoras.js');

// Jornada de la empresa: 42 h/semana (Ley 2101 desde jul-2026).
const VIGENCIAS = [
  { desde: '2026-07-15', horasSemana: 42, horasDia: 7 },
  { desde: '1950-01-01', horasSemana: 48, horasDia: 8 },
];
const SIN_FESTIVOS = new Set();
const CERRADA = { festivos: SIN_FESTIVOS, vigencias: VIGENCIAS, hoy: '2026-08-10' };

/** Una marcación como la devuelve SQL (hora Bogotá + epoch absoluto). */
const marca = (tipo, fecha, hora, dow, diasExtra = 0) => {
  const [h, mi] = hora.split(':').map(Number);
  return {
    tipo, fecha, dow,
    minutos: h * 60 + mi,
    epoch: Date.parse(`${fecha}T00:00:00Z`) / 1000 + diasExtra * 86400 + h * 3600 + mi * 60,
  };
};
const dowDe = (fecha) => new Date(`${fecha}T12:00:00Z`).getUTCDay();
/** Un turno entrada→salida en un día; si la salida es menor, cruza medianoche. */
const turno = (fecha, entrada, salida) => {
  const cruza = salida <= entrada;
  const manana = new Date(Date.parse(`${fecha}T12:00:00Z`) + 86400000).toISOString().slice(0, 10);
  return [
    marca('entrada', fecha, entrada, dowDe(fecha)),
    marca('salida', cruza ? manana : fecha, salida, cruza ? dowDe(manana) : dowDe(fecha)),
  ];
};
const unEmpleado = (marcas, extra = {}) =>
  new Map([['E1', { cedula: '111', nombre: 'Ana', sede: 'Sede', marcas, ...extra }]]);
const SEMANA = { lun: '2026-08-03', mar: '2026-08-04', mie: '2026-08-05', jue: '2026-08-06', vie: '2026-08-07', sab: '2026-08-08', dom: '2026-08-09' };
/** Suma de horas de todos los tramos que salieron. */
const totalExtra = (regs) => Math.round(regs.reduce((s, r) => s + r.horas, 0) * 10000) / 10000;
/** 42 h justas: 7h 30 de lunes a viernes y 4h 30 el sábado. */
const SEMANA_42 = [
  ...turno(SEMANA.lun, '09:00', '16:30'), ...turno(SEMANA.mar, '09:00', '16:30'), ...turno(SEMANA.mie, '09:00', '16:30'),
  ...turno(SEMANA.jue, '09:00', '16:30'), ...turno(SEMANA.vie, '09:00', '16:30'), ...turno(SEMANA.sab, '09:00', '13:30'),
];

await test('42 h justas de lunes a sábado: sin extra', () => {
  assert.equal(calcularRegistros(unEmpleado(SEMANA_42), CERRADA).length, 0);
});

await test('lo que pasa de 42 es extra y cae en las ÚLTIMAS horas de la semana', () => {
  // 9 h de lunes a viernes = 45 h → 3 h extra: las últimas del viernes.
  const regs = calcularRegistros(unEmpleado([
    ...turno(SEMANA.lun, '08:00', '17:00'), ...turno(SEMANA.mar, '08:00', '17:00'), ...turno(SEMANA.mie, '08:00', '17:00'),
    ...turno(SEMANA.jue, '08:00', '17:00'), ...turno(SEMANA.vie, '08:00', '17:00'),
  ]), CERRADA);
  assert.deepEqual(regs.map((r) => [r.fecha, r.tipoHora, r.horaInicio, r.horaFin, r.horas]), [[SEMANA.vie, 'HED', '14:00', '17:00', 3]]);
  assert.equal(regs[0].observaciones, 'Sede · semana del 2026-08-03');
});

await test('un día largo y uno corto se compensan: sin extra si no pasa de 42', () => {
  // Lunes 11 h y martes 4 h; el resto normal → 42 h justas.
  const regs = calcularRegistros(unEmpleado([
    ...turno(SEMANA.lun, '08:00', '19:00'), ...turno(SEMANA.mar, '08:00', '12:00'),
    ...turno(SEMANA.mie, '09:00', '16:30'), ...turno(SEMANA.jue, '09:00', '16:30'), ...turno(SEMANA.vie, '09:00', '16:30'),
    ...turno(SEMANA.sab, '09:00', '13:30'),
  ]), CERRADA);
  assert.equal(regs.length, 0, 'las 4 h de más del lunes pagaron las 3,5 h de menos del martes');
});

await test('quien no llega a 42 no tiene extra aunque un día se haya quedado hasta tarde', () => {
  const regs = calcularRegistros(unEmpleado([...turno(SEMANA.lun, '08:00', '20:00'), ...turno(SEMANA.mar, '08:00', '15:00')]), CERRADA);
  assert.equal(regs.length, 0);
});

await test('el cruce de las 42 parte un turno a la mitad; los pedazos anteriores entran completos', () => {
  // 45 h de lunes a viernes + 12 min el sábado = 45,2 h → 3,2 h extra:
  // el sábado entero (0,2 h, aunque no llegue a media hora) y las últimas
  // 3 h del viernes. El mínimo de 0,5 h es sobre la extra de la semana.
  const regs = calcularRegistros(unEmpleado([
    ...turno(SEMANA.lun, '08:00', '17:00'), ...turno(SEMANA.mar, '08:00', '17:00'), ...turno(SEMANA.mie, '08:00', '17:00'),
    ...turno(SEMANA.jue, '08:00', '17:00'), ...turno(SEMANA.vie, '08:00', '17:00'), ...turno(SEMANA.sab, '08:00', '08:12'),
  ]), CERRADA);
  assert.deepEqual(
    regs.map((r) => [r.fecha, r.horaInicio, r.horaFin, r.horas]),
    [[SEMANA.vie, '14:00', '17:00', 3], [SEMANA.sab, '08:00', '08:12', 0.2]],
  );
  assert.equal(totalExtra(regs), 3.2, 'no se pierde ni un minuto');
});

await test('una extra semanal menor a 0,5 h se descarta (mínimo de fábrica)', () => {
  const regs = calcularRegistros(unEmpleado([...SEMANA_42.slice(0, 10), ...turno(SEMANA.sab, '09:00', '13:50')]), CERRADA);
  assert.equal(regs.length, 0, '20 minutos de más en la semana no llegan al mínimo');
});
await test('la extra mínima es de la empresa: sin mínimo, esos 20 min sí se liquidan', () => {
  const marcas = [...SEMANA_42.slice(0, 10), ...turno(SEMANA.sab, '09:00', '13:50')];
  const regs = calcularRegistros(unEmpleado(marcas), { ...CERRADA, extraMinima: 0 });
  assert.equal(regs.length, 1);
  assert.equal(regs[0].tipoHora, 'HED');
  assert.equal(Math.round(regs[0].horas * 60), 20);
  // Y con una hora de mínimo, 45 min de más tampoco cuentan.
  const regs45 = calcularRegistros(unEmpleado([...SEMANA_42.slice(0, 10), ...turno(SEMANA.sab, '09:00', '14:15')]), { ...CERRADA, extraMinima: 1 });
  assert.equal(regs45.length, 0);
});
await test('el mínimo lleva vigencia: se evalúa con el lunes de cada semana', () => {
  const marcas = [...SEMANA_42.slice(0, 10), ...turno(SEMANA.sab, '09:00', '13:50')];
  const regs = calcularRegistros(unEmpleado(marcas), { ...CERRADA, extraMinima: (lunes) => (lunes === SEMANA.lun ? 0 : 0.5) });
  assert.equal(regs.length, 1, 'esa semana regía «sin mínimo»');
});

await test('semana EN CURSO: nada de lunes a sábado, aunque ya vaya por encima de 42', () => {
  const marcas = [...turno(SEMANA.lun, '06:00', '21:00'), ...turno(SEMANA.mar, '06:00', '21:00'), ...turno(SEMANA.mie, '06:00', '21:00')];
  assert.equal(calcularRegistros(unEmpleado(marcas), { ...CERRADA, hoy: '2026-08-07' }).length, 0, 'jueves: la semana sigue abierta');
  assert.equal(calcularRegistros(unEmpleado(marcas), { ...CERRADA, hoy: '2026-08-09' }).length, 0, 'domingo: todavía no cerró');
  assert.equal(totalExtra(calcularRegistros(unEmpleado(marcas), CERRADA)), 3, 'lunes siguiente: 45 h − 42');
});

await test('la cantidad de extra es la MISMA que muestra el panel (lib/semanaLaboral.js)', async () => {
  const { resumenSemana } = await import('../lib/semanaLaboral.js');
  const marcas = [
    ...turno(SEMANA.lun, '08:00', '17:00'), ...turno(SEMANA.mar, '08:00', '17:00'), ...turno(SEMANA.mie, '08:00', '17:00'),
    ...turno(SEMANA.jue, '08:00', '17:00'), ...turno(SEMANA.vie, '08:00', '15:00'), ...turno(SEMANA.sab, '08:00', '09:00'),
  ];
  const regs = calcularRegistros(unEmpleado(marcas), CERRADA);
  const horasPorDia = new Map([[SEMANA.lun, 9], [SEMANA.mar, 9], [SEMANA.mie, 9], [SEMANA.jue, 9], [SEMANA.vie, 7], [SEMANA.sab, 1]]);
  const panel = resumenSemana({ lunes: SEMANA.lun, horasPorDia, festivos: SIN_FESTIVOS, horasHorario: () => null, hoy: '2026-08-10' });
  assert.equal(totalExtra(regs), panel.extra);
  assert.equal(panel.extra, 2);
});

await test('domingo: HEDDF desde la primera hora, y sale aunque la semana siga en curso', () => {
  const regs = calcularRegistros(unEmpleado(turno(SEMANA.dom, '08:00', '12:00')), { ...CERRADA, hoy: '2026-08-09' });
  assert.deepEqual(regs.map((r) => [r.tipoHora, r.horas]), [['HEDDF', 4]]);
});

await test('el domingo NO entra en las 42: no se compensa con los días cortos', () => {
  // 42 h justas de lunes a sábado + 3 h el domingo: 0 extra semanal y las 3 h
  // del domingo con recargo dominical.
  const regs = calcularRegistros(unEmpleado([...SEMANA_42, ...turno(SEMANA.dom, '09:00', '12:00')]), CERRADA);
  assert.deepEqual(regs.map((r) => [r.fecha, r.tipoHora, r.horas]), [[SEMANA.dom, 'HEDDF', 3]]);
});

await test('festivo entre semana: lo trabajado es festiva, y su horario se acredita a las 42', () => {
  // Lunes festivo con horario de 7h 30. Martes a viernes 9 h (36 h) y sábado
  // 4h 30 = 40,5 h reales; con las 7,5 h acreditadas son 48 → 6 h extra. Sin
  // el crédito, 40,5 h no habrían generado nada.
  const LV = { entrada: '09:00', salida: '17:30', almuerzo_min: 60 };
  const horario = { 1: LV, 2: LV, 3: LV, 4: LV, 5: LV, 6: { entrada: '09:00', salida: '13:30', almuerzo_min: 0 } };
  const semana = [
    ...turno(SEMANA.mar, '08:00', '17:00'), ...turno(SEMANA.mie, '08:00', '17:00'),
    ...turno(SEMANA.jue, '08:00', '17:00'), ...turno(SEMANA.vie, '08:00', '17:00'), ...turno(SEMANA.sab, '09:00', '13:30'),
  ];
  const cfg = { ...CERRADA, festivos: new Set([SEMANA.lun]) };
  const sinMarcar = calcularRegistros(unEmpleado(semana, { jornadaDias: horario }), cfg);
  assert.equal(totalExtra(sinMarcar), 6);
  assert.ok(sinMarcar.every((r) => r.tipoHora === 'HED'));

  const trabajado = calcularRegistros(unEmpleado([...turno(SEMANA.lun, '10:00', '12:00'), ...semana], { jornadaDias: horario }), cfg);
  assert.deepEqual(trabajado.filter((r) => r.fecha === SEMANA.lun).map((r) => [r.tipoHora, r.horas]), [['HEDDF', 2]]);
  assert.equal(totalExtra(trabajado), 8, 'las 2 h festivas + las mismas 6 h de la semana');

  const sinHorario = calcularRegistros(unEmpleado(semana), cfg);
  assert.equal(sinHorario.length, 0, 'sin horario no hay nada que acreditar: 40,5 h no pasan de 42');
});

await test('horas del horario de un día: salida − entrada − almuerzo', () => {
  const e = { jornadaDias: {
    1: { entrada: '09:00', salida: '17:30', almuerzo_min: 60 },
    2: { entrada: '09:00', salida: '17:30', almuerzo_min: 0, almuerzo_desde: '12:00', almuerzo_hasta: '14:00' },
    3: { entrada: '22:00', salida: '06:00', almuerzo_min: 0 },
    6: { entrada: '09:00', salida: '13:30', almuerzo_min: 0 },
  } };
  assert.equal(horasDeHorario(e, SEMANA.lun), 7.5);
  assert.equal(horasDeHorario(e, SEMANA.mar), 6.5, 'sin minutos calculados, se toma el rango');
  assert.equal(horasDeHorario(e, SEMANA.mie), 8, 'turno que cruza medianoche');
  assert.equal(horasDeHorario(e, SEMANA.sab), 4.5);
  assert.equal(horasDeHorario(e, SEMANA.dom), null, 'día sin horario');
  assert.equal(horasDeHorario({ jornadaDias: null, entradaEsperada: '08:00', salidaEsperada: '17:00', almuerzoMin: 60 }, SEMANA.lun), 8, 'respaldo uniforme');
});

await test('turno que CRUZA MEDIANOCHE no produce horas negativas', () => {
  // 36 h de lunes a jueves + viernes 16:00 → sábado 02:00 (10 h) = 46 h →
  // 4 h extra: 22:00–02:00, enteras en la franja nocturna. Antes de la
  // corrección esto daba "-1:00" (bug de medianoche).
  const regs = calcularRegistros(unEmpleado([
    ...turno(SEMANA.lun, '08:00', '17:00'), ...turno(SEMANA.mar, '08:00', '17:00'), ...turno(SEMANA.mie, '08:00', '17:00'),
    ...turno(SEMANA.jue, '08:00', '17:00'), ...turno(SEMANA.vie, '16:00', '02:00'),
  ]), CERRADA);
  assert.deepEqual(regs.map((r) => [r.fecha, r.tipoHora, r.horaInicio, r.horaFin, r.horas]), [[SEMANA.vie, 'HEN', '22:00', '02:00', 4]]);
});

await test('la referencia externa es estable y única por tramo', () => {
  const hacer = () => calcularRegistros(unEmpleado([
    ...turno(SEMANA.lun, '08:00', '17:00'), ...turno(SEMANA.mar, '08:00', '17:00'), ...turno(SEMANA.mie, '08:00', '17:00'),
    ...turno(SEMANA.jue, '08:00', '17:00'), ...turno(SEMANA.vie, '08:00', '17:00'),
  ]), CERRADA)[0].referenciaExterna;
  assert.equal(hacer(), hacer(), 'el mismo tramo debe dar SIEMPRE la misma referencia');
  assert.equal(hacer(), 'arrive-111-20260807-1400-1700-HED');
});

await test('la jornada semanal de la empresa es la que manda (44 h)', () => {
  const regs = calcularRegistros(unEmpleado([
    ...turno(SEMANA.lun, '08:00', '17:00'), ...turno(SEMANA.mar, '08:00', '17:00'), ...turno(SEMANA.mie, '08:00', '17:00'),
    ...turno(SEMANA.jue, '08:00', '17:00'), ...turno(SEMANA.vie, '08:00', '17:00'),
  ]), { ...CERRADA, vigencias: [{ desde: '1950-01-01', horasSemana: 44, horasDia: 44 / 6 }] });
  assert.equal(totalExtra(regs), 1);
});

// ── Modo POR DÍA (configurable en Ajustes → Reglamento) ─────────────────
console.log('\n📅 Modo por día: la jornada del día sale del horario');
const LV75 = { entrada: '09:00', salida: '17:30', almuerzo_min: 60 };
const HORARIO_75 = { 1: LV75, 2: LV75, 3: LV75, 4: LV75, 5: LV75, 6: { entrada: '09:00', salida: '13:30', almuerzo_min: 0 } };
const POR_DIA = { ...CERRADA, modoExtra: 'dia' };

await test('lo que pasa de la jornada del horario ese día es extra de ese día', () => {
  // Lunes 08:00–17:00 son 9 h contra un horario de 7h 30 → 1,5 h extra
  // (15:30–17:00), aunque el resto de la semana no exista.
  const regs = calcularRegistros(unEmpleado(turno(SEMANA.lun, '08:00', '17:00'), { jornadaDias: HORARIO_75 }), POR_DIA);
  assert.deepEqual(regs.map((r) => [r.fecha, r.tipoHora, r.horaInicio, r.horaFin, r.horas]), [[SEMANA.lun, 'HED', '15:30', '17:00', 1.5]]);
});
await test('el sábado corto también da extra: 7 h contra 4h 30 de horario', () => {
  // Con el cálculo viejo (7 h planas) este sábado nunca daba nada.
  const regs = calcularRegistros(unEmpleado(turno(SEMANA.sab, '08:00', '15:00'), { jornadaDias: HORARIO_75 }), POR_DIA);
  assert.equal(totalExtra(regs), 2.5);
});
await test('los días NO se compensan entre sí en modo día', () => {
  // Lunes 9 h (1,5 extra) y martes 4 h (por debajo): la extra del lunes se
  // queda; en modo semana estos dos días juntos no darían nada.
  const marcas = [...turno(SEMANA.lun, '08:00', '17:00'), ...turno(SEMANA.mar, '08:00', '12:00')];
  assert.equal(totalExtra(calcularRegistros(unEmpleado(marcas, { jornadaDias: HORARIO_75 }), POR_DIA)), 1.5);
  assert.equal(calcularRegistros(unEmpleado(marcas, { jornadaDias: HORARIO_75 }), CERRADA).length, 0, 'por semana: 13 h no pasan de 42');
});
await test('sin horario ese día, la jornada es la legal repartida (42 ÷ 6 = 7 h)', () => {
  const regs = calcularRegistros(unEmpleado(turno(SEMANA.lun, '08:00', '17:00')), POR_DIA);
  assert.equal(totalExtra(regs), 2);
});
await test('el día de HOY sí cuenta en modo día: sus pares son reales', () => {
  const regs = calcularRegistros(unEmpleado(turno(SEMANA.lun, '08:00', '17:00'), { jornadaDias: HORARIO_75 }), { ...POR_DIA, hoy: SEMANA.lun });
  assert.equal(totalExtra(regs), 1.5);
});
await test('domingo, mínimo de 0,5 h y partición nocturna: igual que por semana', () => {
  const dom = calcularRegistros(unEmpleado(turno(SEMANA.dom, '08:00', '12:00'), { jornadaDias: HORARIO_75 }), POR_DIA);
  assert.deepEqual(dom.map((r) => [r.tipoHora, r.horas]), [['HEDDF', 4]]);
  const corto = calcularRegistros(unEmpleado(turno(SEMANA.lun, '09:00', '16:50'), { jornadaDias: HORARIO_75 }), POR_DIA);
  assert.equal(corto.length, 0, '7h 50 − 7h 30 = 20 min: bajo el mínimo');
  const noche = calcularRegistros(unEmpleado(turno(SEMANA.lun, '13:00', '23:00'), { jornadaDias: HORARIO_75 }), POR_DIA);
  assert.deepEqual(noche.map((r) => [r.tipoHora, r.horaInicio, r.horaFin]), [['HED', '20:30', '21:00'], ['HEN', '21:00', '23:00']]);
});
await test('el modo lleva vigencia: se evalúa con el LUNES de cada semana', () => {
  // Cambio a modo día el miércoles 5: esa semana sigue por semana (su lunes
  // es anterior), la siguiente ya va por día. Una semana nunca se parte.
  const modo = (fecha) => (fecha >= '2026-08-05' ? 'dia' : 'semana');
  const marcas = [
    ...turno(SEMANA.jue, '08:00', '17:00'),            // semana del 3: 9 h solas → por semana, nada
    ...turno('2026-08-13', '08:00', '17:00'),          // semana del 10: 9 h → por día, 1,5 h
  ];
  const regs = calcularRegistros(unEmpleado(marcas, { jornadaDias: HORARIO_75 }), { ...CERRADA, hoy: '2026-08-17', modoExtra: modo });
  assert.deepEqual(regs.map((r) => [r.fecha, r.horas]), [['2026-08-13', 1.5]]);
});
await test('la vigencia de pago trae el modo, y sin valor es «semana»', async () => {
  // configLaboral importa db.js, que exige la variable aunque no se conecte.
  process.env.DATABASE_URL ??= 'postgresql://pruebas:x@localhost:5432/pruebas';
  const { pagoVigenteEn } = await import('../lib/configLaboral.js');
  const vig = [{ desde: '2026-09-15', modoExtra: 'dia' }, { desde: '1950-01-01', modoExtra: 'semana' }];
  assert.equal(pagoVigenteEn(vig, '2026-09-20', {}).modoExtra, 'dia');
  assert.equal(pagoVigenteEn(vig, '2026-09-01', {}).modoExtra, 'semana');
});

// ── Franja nocturna y valorización ──────────────────────────────────────
// Los cuatro códigos y sus factores son PARÁMETROS editables; lo que se prueba
// aquí es que el tramo se parta donde debe y que la plata salga de multiplicar
// horas × valor hora × factor, sin inventar valores cuando falta el salario.
console.log('\n🌙 Franja nocturna y valorización');
const { partirPorNocturno, valorizarRegistro, valorHoraOrdinaria, normalizarFactores, NOCTURNO_DEFECTO } =
  await import('../lib/tiposHora.js');

// 36 h de lunes a jueves; el viernes es el turno que cada prueba varía.
const LUN_JUE = [
  ...turno(SEMANA.lun, '08:00', '17:00'), ...turno(SEMANA.mar, '08:00', '17:00'),
  ...turno(SEMANA.mie, '08:00', '17:00'), ...turno(SEMANA.jue, '08:00', '17:00'),
];

await test('un tramo extra que atraviesa las 21:00 se parte en diurno y nocturno', () => {
  // Viernes 08:00–23:00 = 15 h → 51 h → 9 h extra desde las 14:00:
  // 14:00–21:00 diurnas (HED) y 21:00–23:00 nocturnas (HEN).
  const regs = calcularRegistros(unEmpleado([...LUN_JUE, ...turno(SEMANA.vie, '08:00', '23:00')]), CERRADA);
  assert.deepEqual(
    regs.map((r) => [r.tipoHora, r.horaInicio, r.horaFin, r.horas]),
    [['HED', '14:00', '21:00', 7], ['HEN', '21:00', '23:00', 2]],
  );
});

await test('domingo de madrugada a mañana: HENDF y HEDDF en el mismo turno', () => {
  // Domingo 04:00–09:00: 04:00–06:00 nocturno, 06:00–09:00 diurno.
  const regs = calcularRegistros(unEmpleado(turno(SEMANA.dom, '04:00', '09:00')), CERRADA);
  assert.deepEqual(regs.map((r) => [r.tipoHora, r.horas]), [['HENDF', 2], ['HEDDF', 3]]);
});

await test('la franja nocturna es configurable', () => {
  // Con corte 22:00–05:00, el mismo viernes deja 8 h diurnas y 1 h nocturna.
  const regs = calcularRegistros(
    unEmpleado([...LUN_JUE, ...turno(SEMANA.vie, '08:00', '23:00')]),
    { ...CERRADA, nocturno: { inicio: 22 * 60, fin: 5 * 60 } },
  );
  assert.deepEqual(regs.map((r) => [r.tipoHora, r.horas]), [['HED', 8], ['HEN', 1]]);
});

await test('partir un tramo conserva TODAS las horas', () => {
  // 20:40 → 21:50 (minutos absolutos): nada se puede perder al redondear.
  const partes = partirPorNocturno(20 * 60 + 40, 21 * 60 + 50, NOCTURNO_DEFECTO);
  assert.equal(partes.length, 2);
  assert.deepEqual(partes.map((p) => p.nocturna), [false, true]);
  assert.equal(partes.reduce((s, p) => s + (p.hasta - p.desde), 0), 70, 'la suma debe dar los 70 minutos');
});

await test('un tramo que no toca la franja no se parte', () => {
  const partes = partirPorNocturno(9 * 60, 17 * 60, NOCTURNO_DEFECTO);
  assert.deepEqual(partes, [{ desde: 540, hasta: 1020, nocturna: false }]);
});

await test('el mínimo de 0,5 h se mide ANTES de partir, no por pedazo', () => {
  // 36 h + viernes 14:20–21:20 (7 h) = 43 h → 1 h extra (20:20–21:20), que
  // se parte en 0,67 h diurnas + 0,33 h nocturnas. Ninguna llega a 0,5 h; si
  // el mínimo se aplicara a los pedazos se perdería la hora extra entera.
  const regs = calcularRegistros(unEmpleado([...LUN_JUE, ...turno(SEMANA.vie, '14:20', '21:20')]), CERRADA);
  assert.equal(regs.length, 2);
  assert.deepEqual(regs.map((r) => r.tipoHora), ['HED', 'HEN']);
  assert.equal(totalExtra(regs), 1, 'no se puede perder ni un minuto de la extra');
});

await test('valor hora ordinaria = salario ÷ divisor configurable', () => {
  assert.equal(valorHoraOrdinaria(1_440_000, 240), 6000);
  assert.equal(valorHoraOrdinaria(1_440_000, 180), 8000);
  assert.equal(valorHoraOrdinaria(null, 240), null, 'sin salario no hay valor hora');
  assert.equal(valorHoraOrdinaria(1_440_000, 0), null, 'un divisor inválido no puede dar Infinity');
});

await test('valorizar multiplica horas × valor hora × factor', () => {
  const r = valorizarRegistro(
    { tipoHora: 'HED', horas: 3 },
    { salarioMensual: 1_440_000, factores: { HED: 1.25 }, divisor: 240 },
  );
  assert.equal(r.valorHora, 6000);
  assert.equal(r.factor, 1.25);
  assert.equal(r.valor, 22_500); // 3 h × 6000 × 1.25
});

await test('sin salario NO se inventa un valor', () => {
  const r = valorizarRegistro({ tipoHora: 'HEN', horas: 2 }, { salarioMensual: null });
  assert.equal(r.valor, null, 'debe quedar en null para que el reporte diga «sin salario»');
  assert.equal(r.valorHora, null);
  assert.equal(r.horas, 2, 'las horas se siguen contando aunque no se valoricen');
});

await test('un factor corrupto cae al de fábrica, no rompe la liquidación', () => {
  const f = normalizarFactores({ HED: '125', HEN: null, HEDDF: 2.5 });
  assert.equal(f.HED, 1.25, '"125" no es un factor válido: se usa el de fábrica');
  assert.equal(f.HEN, 1.75);
  assert.equal(f.HEDDF, 2.5, 'un valor válido sí se respeta');
  assert.equal(f.HENDF, 2.65, 'un código ausente se completa');
});

// ── Entrada sin salida: se cierra con el horario ────────────────────────
// Antes, olvidar marcar la salida costaba el día ENTERO: el par no se cerraba
// y ese día valía cero. Ahora se cierra en la hora en que terminaba su
// jornada. El horario de las pruebas es el real de un cliente: L–V 09:00–17:30
// y sábado 09:00–13:30. Se prueba sobre los PARES (`emparejarMarcas`), que
// es donde vive el cierre; qué es extra ya no depende del día.
console.log('\n🕗 Entrada sin salida: cierre con el horario');

const LV = { entrada: '09:00', salida: '17:30', almuerzo_min: 60, almuerzo_desde: '13:00', almuerzo_hasta: '14:00' };
const HORARIO = {
  1: LV, 2: LV, 3: LV, 4: LV, 5: LV,
  // Sábado corrido: sin pausa, así que tampoco tiene hora de almuerzo.
  6: { entrada: '09:00', salida: '13:30', almuerzo_min: 0 },
};
// Un día cualquiera POSTERIOR a las marcaciones: así el día ya terminó y el
// cierre aplica. Fijo, para que la prueba no dependa de cuándo se ejecute.
const DESPUES = { festivos: SIN_FESTIVOS, hoy: '2026-08-10' };

const pares = (marcas, jornadaDias = HORARIO, cfg = DESPUES) =>
  emparejarMarcas({ jornadaDias, marcas }, cfg);
const horasTotales = (ps) => Math.round(ps.reduce((s, p) => s + p.horas, 0) * 10000) / 10000;
const min = (hhmm) => { const [h, m] = hhmm.split(':').map(Number); return h * 60 + m; };

await test('entró en la mañana y no volvió a marcar: cuenta hasta el almuerzo', () => {
  // Nunca marcó su salida a almorzar, así que solo consta la mañana. La hora
  // (13:00) sale del HORARIO, no de ningún cálculo.
  const ps = pares([marca('entrada', '2026-08-03', '09:00', 1)]);
  assert.equal(ps.length, 1);
  assert.equal(ps[0].hasta, min('13:00'), 'debe cerrar al almuerzo, no al final del día');
  assert.equal(ps[0].horas, 4);
  assert.equal(ps[0].automatico, true, 'queda señalado como cierre por horario');
});

await test('la hora de almuerzo se respeta tal cual, no se deduce', () => {
  // Dos personas con la MISMA franja y distinta hora de almuerzo tienen que
  // cerrar en horas distintas: es justo lo que no lograba el punto medio.
  const temprano = { ...LV, almuerzo_desde: '11:30' };
  const tarde = { ...LV, almuerzo_min: 120, almuerzo_desde: '14:00' };
  const cierre = (dia) => pares([marca('entrada', '2026-08-03', '09:00', 1)], { 1: dia })[0].hasta;
  assert.equal(cierre(temprano), min('11:30'));
  assert.equal(cierre(tarde), min('14:00'), 'dos horas de almuerzo y a otra hora: también se respeta');
});

await test('entró DESPUÉS del almuerzo y olvidó la salida: cierra al final', () => {
  // Ya pasó la hora de almorzar, así que su tope es el final de la jornada.
  const ps = pares([marca('entrada', '2026-08-03', '14:00', 1)]);
  assert.equal(ps[0].hasta, min('17:30'));
  assert.equal(ps[0].horas, 3.5);
});

await test('entró DESPUÉS de su hora de salida: ese día no cuenta', () => {
  // Su jornada termina 17:30 y marca entrada a las 18:00: no abre día nuevo.
  assert.equal(pares([marca('entrada', '2026-08-03', '18:00', 1)]).length, 0);
});

await test('salió a almorzar y olvidó la salida final', () => {
  // 09:00–13:00 (4 h) + 14:00 sin cerrar → cierra 17:30 (3,5 h) = 7,5 h.
  const ps = pares([
    marca('entrada', '2026-08-03', '09:00', 1),
    marca('salida', '2026-08-03', '13:00', 1),
    marca('entrada', '2026-08-03', '14:00', 1),
  ]);
  assert.equal(horasTotales(ps), 7.5);
});

await test('una entrada tardía suelta no borra lo que ya había marcado', () => {
  // 09:00–16:00 son 7 h reales; la entrada de las 18:00 se descarta y el día
  // se queda con esas 7 h, no en cero.
  const ps = pares([
    marca('entrada', '2026-08-03', '09:00', 1),
    marca('salida', '2026-08-03', '16:00', 1),
    marca('entrada', '2026-08-03', '18:00', 1),
  ]);
  assert.equal(horasTotales(ps), 7);
});

await test('sin horario configurado el día queda en cero', () => {
  assert.equal(pares([marca('entrada', '2026-08-03', '09:00', 1)], null).length, 0, 'sin hora pactada no hay con qué cerrar');
});

await test('día libre (no está en su horario): tampoco se cierra', () => {
  // El sábado existe en el horario pero el domingo no: es día libre.
  assert.equal(pares([marca('entrada', '2026-08-02', '09:00', 0)]).length, 0);
});

await test('el día EN CURSO no se cierra: todavía puede marcar', () => {
  assert.equal(pares([marca('entrada', '2026-08-03', '09:00', 1)], HORARIO, { ...DESPUES, hoy: '2026-08-03' }).length, 0, 'la jornada de hoy sigue abierta');
});

await test('turno nocturno: cierra en la madrugada del día siguiente', () => {
  // Horario 22:00–06:00: la salida del horario es del día siguiente.
  const noche = { 1: { entrada: '22:00', salida: '06:00', almuerzo_min: 0 } };
  const ps = pares([marca('entrada', '2026-08-03', '22:00', 1)], noche);
  assert.equal(ps[0].horas, 8);
  assert.equal(ps[0].hasta, 30 * 60, 'cruza la medianoche: minuto 1800 del día de entrada');
});

await test('la salida del día siguiente NO se empareja con la entrada de ayer', () => {
  // Antes esto producía un turno de ~32 h. Ahora el lunes se cierra solo
  // —al almuerzo, porque no marcó nada más— y la salida suelta del martes
  // se descarta.
  const ps = pares([
    marca('entrada', '2026-08-03', '09:00', 1),
    marca('salida', '2026-08-04', '17:30', 2, 1),
  ]);
  assert.equal(ps.length, 1);
  assert.equal(ps[0].fecha, '2026-08-03', 'nada debe atribuirse al martes');
  assert.equal(ps[0].hasta, min('13:00'), 'el lunes cierra al almuerzo');
});

await test('una salida MARCADA nunca se recorta al horario', () => {
  // Se quedó hasta las 20:00 y sí marcó: son 11 h reales, no 8,5.
  const ps = pares([marca('entrada', '2026-08-03', '09:00', 1), marca('salida', '2026-08-03', '20:00', 1)]);
  assert.equal(ps[0].horas, 11);
  assert.equal(ps[0].automatico, undefined);
});

await test('dos entradas seguidas no cierran las DOS: nada se cuenta dos veces', () => {
  // Faltó una salida en medio. Cerrar la de 09:00 en su horario la solaparía
  // con la de 11:00 y el mismo rato se pagaría dos veces (llegó a dar 8 h de
  // extra en un día de 6,5 h trabajadas). La primera se descarta; la segunda
  // cierra al almuerzo, como cualquier entrada de la mañana sin más marcas.
  const ps = pares([marca('entrada', '2026-08-03', '09:00', 1), marca('entrada', '2026-08-03', '11:00', 1)]);
  assert.equal(ps.length, 1);
  assert.equal(ps[0].desde, min('11:00'), 'nada puede empezar antes de la última entrada');
  assert.equal(ps[0].hasta, min('13:00'));
  assert.equal(horasTotales(ps), 2);
});

await test('respaldo: empleados viejos sin horario por día', () => {
  // Los registrados antes de los horarios por día solo tienen los campos
  // uniformes; deben cerrarse igual.
  const ps = emparejarMarcas(
    { jornadaDias: null, entradaEsperada: '09:00', salidaEsperada: '17:30', marcas: [marca('entrada', '2026-08-03', '09:00', 1)] },
    DESPUES,
  );
  assert.equal(ps[0].horas, 8.5);
});

// ── Umbrales del reconocimiento v2 ──────────────────────────────────────
// Son cuatro números que deciden si a alguien se le atribuye la jornada de
// otro. Se calibraron con 284 marcaciones reales el 2026-09-10, después de
// que un empleado fuera reconocido como otra persona con similitud 0.408.
console.log('\n🎯 Umbrales del reconocimiento facial');
const { V2_UMBRAL_SIM: UMBRAL, V2_MARGEN_SIM: MARGEN, V2_LIMITE_COLISION_SIM: COLISION, similitudCosenoV2 } =
  await import('../utils/faceMath.js');

await test('registrar dos caras parecidas es imposible por encima del umbral', () => {
  // LA invariante. Si se pudiera registrar a dos personas con caras más
  // parecidas de lo que hace falta para reconocerlas, el kiosco tendría
  // GARANTIZADO confundirlas — que es exactamente lo que pasó cuando cinco
  // empleados quedaron registrados con la misma cara.
  assert.ok(COLISION <= UMBRAL,
    `el límite de colisión (${COLISION}) no puede superar al umbral de aceptación (${UMBRAL})`);
});

await test('el umbral deja fuera el error que se midió en producción', () => {
  // El caso real: 0.408 fue aceptado y no debió serlo.
  assert.ok(UMBRAL > 0.408, `con umbral ${UMBRAL} ese error volvería a pasar`);
});

await test('el umbral no se pasa de estricto', () => {
  // La mediana de los aciertos reales fue 0.603 y el p25 0.518: por encima de
  // 0.52 se empezaría a rechazar a gente legítima en masa.
  assert.ok(UMBRAL <= 0.52, `con umbral ${UMBRAL} se rechazaría más de un cuarto de las marcaciones buenas`);
});

await test('el margen sigue siendo un freno alcanzable', () => {
  // El margen real más ajustado fue 0.095. Pedir más que eso convertiría en
  // ambiguas marcaciones que hoy son correctas.
  assert.ok(MARGEN > 0 && MARGEN < 0.095, `un margen de ${MARGEN} rechazaría casos que se midieron como buenos`);
});

await test('la similitud coseno se comporta como debe', () => {
  const a = Array.from({ length: 512 }, (_, i) => Math.sin(i));
  const b = a.map((n) => -n);
  assert.ok(Math.abs(similitudCosenoV2(a, a) - 1) < 1e-9, 'consigo mismo debe dar 1');
  assert.ok(Math.abs(similitudCosenoV2(a, b) + 1) < 1e-9, 'con su opuesto debe dar −1');
});

// ── Resumen diario que se envía por correo ──────────────────────────────
// Un correo al terminar el día, en vez de uno por marcación. Cuenta lo que
// pasó de verdad, así que tiene que cuadrar con lo que la nómina pagará: si
// el correo dice 7 h y el reporte dice 4, la gente deja de creerle a los dos.
console.log('\n📧 Resumen diario');
const { resumenDelDia, hhmmss, horasCortas, enDoce } = await import('../lib/resumenDiario.js');

const JUAN = {
  nombre: 'Juan',
  correo: 'juan@ejemplo.com',
  jornada_dias: {
    1: { entrada: '09:00', salida: '17:30', almuerzo_min: 60, almuerzo_desde: '13:00' },
    6: { entrada: '09:00', salida: '13:30', almuerzo_min: 0 },
  },
};
const LUNES = 1;
const mk = (tipo, hora, sede = 'Principal') => {
  const [h, m] = hora.split(':').map(Number);
  return { tipo, minutos: h * 60 + m, sede };
};

await test('día completo: suma las dos parejas, sin avisos', () => {
  const r = resumenDelDia(JUAN, [mk('entrada', '09:03'), mk('salida', '13:00'), mk('entrada', '14:00'), mk('salida', '17:30')], LUNES);
  assert.equal(hhmmss(r.trabajadoSeg), '7:27:00');
  assert.equal(r.marcas.length, 4);
  assert.deepEqual(r.avisos, []);
});

await test('sin marcaciones no hay resumen que enviar', () => {
  // Quien no trabajó no recibe correo: un «no marcaste» diario es ruido.
  assert.equal(resumenDelDia(JUAN, [], LUNES), null);
});

await test('olvidó la salida final: cierra en su horario y lo AVISA', () => {
  const r = resumenDelDia(JUAN, [mk('entrada', '09:00'), mk('salida', '13:00'), mk('entrada', '14:00')], LUNES);
  assert.equal(hhmmss(r.trabajadoSeg), '7:30:00');
  const ultima = r.marcas[r.marcas.length - 1];
  assert.equal(ultima.automatica, true);
  assert.equal(enDoce(ultima.minutos), '05:30 p. m.');
  assert.match(r.avisos[0].texto, /No marcaste tu salida/);
});

await test('solo marcó al llegar: cuenta hasta el almuerzo', () => {
  // La misma regla que el cálculo de nómina, para que los dos números cuadren.
  const r = resumenDelDia(JUAN, [mk('entrada', '09:00')], LUNES);
  assert.equal(hhmmss(r.trabajadoSeg), '4:00:00');
  assert.match(r.avisos[0].texto, /empieza tu almuerzo/);
});

await test('entró pasada su salida y no cerró: no se inventa nada', () => {
  const r = resumenDelDia(JUAN, [mk('entrada', '18:00')], LUNES);
  assert.equal(r.trabajadoSeg, 0);
  assert.match(r.avisos[0].texto, /no se pudo contar/);
});

await test('entrada tardía: avisa con las dos horas', () => {
  const r = resumenDelDia(JUAN, [mk('entrada', '12:30'), mk('salida', '17:30')], LUNES);
  const tarde = r.avisos.find((a) => a.clase === 'tarde');
  assert.ok(tarde, 'debía avisar de la entrada tardía');
  assert.match(tarde.texto, /12:30 p\. m\..*09:00 a\. m\./);
});

await test('irse antes de la hora NO genera aviso (se quitó la salida temprana)', () => {
  const r = resumenDelDia(JUAN, [mk('entrada', '09:00'), mk('salida', '15:00')], LUNES);
  assert.deepEqual(r.avisos, []);
});

await test('un día sin horario se resume igual, sin comparaciones', () => {
  const suelto = { nombre: 'Ana', correo: 'a@b.c', jornada_dias: null, entrada_esperada: null, salida_esperada: null };
  const r = resumenDelDia(suelto, [mk('entrada', '08:00'), mk('salida', '12:00')], LUNES);
  assert.equal(hhmmss(r.trabajadoSeg), '4:00:00');
  assert.deepEqual(r.avisos, [], 'sin horario no hay contra qué comparar');
});

await test('las horas se muestran como la gente las lee', () => {
  assert.equal(enDoce(0), '12:00 a. m.');
  assert.equal(enDoce(12 * 60), '12:00 p. m.');
  assert.equal(enDoce(17 * 60 + 30), '05:30 p. m.');
  assert.equal(horasCortas(7.5 * 3600), '7h 30m');
  assert.equal(horasCortas(45 * 60), '45 min');
});

// ── Lo que se usa, ¿está importado? ─────────────────────────────────────
// El proyecto es JavaScript sin tipos, así que usar algo que no se importó
// compila igual y revienta en la tablet, con el kiosco en marcha y gente
// esperando. Pasó: se cambió `puntos5DeFaceApi` por `puntos5DeMediaPipe` en
// el cuerpo y no en el import.
console.log('\n🔗 Importaciones de los módulos de rostro');
const { readFileSync: leerMod } = await import('node:fs');

await test('todo lo que se usa de lib/rostroV2.js está importado', () => {
  const fuentes = ['../components/KioskMode.jsx', '../components/EmployeeRegister.jsx', '../components/DiagnosticoAlineacion.jsx'];
  const modulo = leerMod(new URL('../lib/rostroV2.js', import.meta.url), 'utf8');
  // Lo que rostroV2 ofrece: `export function x`, `export const x`, `export { a, b }`.
  const exporta = new Set([
    ...[...modulo.matchAll(/^export (?:async )?function (\w+)/gm)].map((m) => m[1]),
    ...[...modulo.matchAll(/^export const (\w+)/gm)].map((m) => m[1]),
    ...[...modulo.matchAll(/^export \{([^}]+)\}/gm)].flatMap((m) => m[1].split(',').map((s) => s.trim())),
  ]);
  assert.ok(exporta.size >= 5, `se esperaban varios exports, se hallaron ${exporta.size}`);

  const faltantes = [];
  for (const f of fuentes) {
    const src = leerMod(new URL(f, import.meta.url), 'utf8');
    const linea = src.match(/import \{([^}]+)\} from '[^']*rostroV2\.js'/);
    if (!linea) continue;
    const importados = new Set(linea[1].split(',').map((s) => s.trim()));
    const cuerpo = src.slice(src.indexOf('export default'));
    for (const nombre of exporta) {
      // Se usa como llamada o como valor, pero no se importó.
      if (new RegExp(`\\b${nombre}\\s*\\(`).test(cuerpo) && !importados.has(nombre)) {
        faltantes.push(`${f.split('/').pop()} usa ${nombre} sin importarlo`);
      }
    }
  }
  assert.deepEqual(faltantes, [], faltantes.join('\n     '));
});

// ── Modelos empaquetados en el APK ──────────────────────────────────────
// La app Android es un cascarón que carga la web remota, así que la primera
// arrancada bajaba ~25 MB de modelos. Ahora viajan dentro del APK y
// ModelosLocales.java intercepta `/models/` y `/wasm/` para servirlos del
// disco. Tres cosas pueden romperlo en silencio, y las tres se prueban aquí.
console.log('\n📦 Modelos dentro del APK');
const { readFileSync: leerTxt, existsSync: hay } = await import('node:fs');
const leerRel = (r) => leerTxt(new URL(r, import.meta.url), 'utf8');

// Prefijos que ModelosLocales.java atiende, sacados del propio Java para que
// no puedan quedar diciendo cosas distintas.
const javaModelos = leerRel('../android/app/src/main/java/com/kupocell/arrivecontrol/ModelosLocales.java');
const PREFIJOS = [...javaModelos.matchAll(/startsWith\("([^"]+)"\)/g)].map((m) => m[1]);

await test('el Java intercepta /models/ y /wasm/', () => {
  assert.deepEqual([...PREFIJOS].sort(), ['/models/', '/wasm/']);
});

await test('todo lo que el código pide cae dentro de esos prefijos', () => {
  // Si alguien publica un modelo en otra carpeta, se bajaría de la red para
  // siempre sin que nadie se entere: aquí se entera.
  const fuentes = ['../components/KioskMode.jsx', '../lib/rostroV2.js', '../components/EmployeeRegister.jsx'];
  const rutas = new Set();
  for (const f of fuentes) {
    for (const m of leerRel(f).matchAll(/'(\/(?:models|wasm|assets|modelos)[^']*)'/g)) rutas.add(m[1]);
  }
  assert.ok(rutas.size >= 4, `se esperaban varias rutas de modelos, se hallaron ${rutas.size}`);
  const fuera = [...rutas].filter((r) => !PREFIJOS.some((p) => (r + '/').startsWith(p)));
  assert.deepEqual(fuera, [], `estas rutas no se empaquetarían: ${fuera.join(', ')}`);
});

await test('la lista de empaquetado apunta a archivos que existen', () => {
  const script = leerRel('../scripts/empaquetar-modelos.mjs');
  const lista = [...script.matchAll(/^\s*'((?:models|wasm)\/[^']+)',/gm)].map((m) => m[1]);
  assert.ok(lista.length >= 10, `la lista parece vacía (${lista.length} archivos)`);
  const perdidos = lista.filter((r) => !hay(new URL(`../public/${r}`, import.meta.url)));
  assert.deepEqual(perdidos, [], `la lista nombra archivos que no están en public/: ${perdidos.join(', ')}`);
});

// ── El CSS del panel está bien formado ──────────────────────────────────
// Los estilos viven en una plantilla de texto dentro del componente, así que
// nadie los valida: ni el compilador ni el navegador se quejan. Una llave de
// más cierra su @media antes de tiempo y TODAS las reglas siguientes quedan
// fuera — que fue exactamente como el dashboard perdió sus dos columnas al
// borrar unas reglas que ya no se usaban.
console.log('\n🧱 CSS del panel');
const { readFileSync: leerCss } = await import('node:fs');

const cssDelPanel = (archivo) => {
  const t = leerCss(new URL(archivo, import.meta.url), 'utf8');
  const i = t.indexOf('const CSS = `');
  if (i === -1) return null;
  return t.slice(i + 13, t.lastIndexOf('`'));
};

// Los dos paneles llevan su CSS en una plantilla de texto, y los dos se
// editan a mano: la revisión vale para ambos.
const PANELES = ['../components/AdminPanel.jsx', '../components/PlataformaPanel.jsx'];

for (const panel of PANELES) {
  const nombre = panel.split('/').pop();
  await test(`llaves balanceadas — ${nombre}`, () => {
    const css = cssDelPanel(panel);
    assert.ok(css, 'no se encontró el bloque de estilos');
    let abren = 0;
    let cierran = 0;
    for (const c of css) {
      if (c === '{') abren++;
      else if (c === '}') cierran++;
    }
    assert.equal(cierran, abren, `sobran ${Math.abs(abren - cierran)} llaves`);
  });

  await test(`sin propiedades fuera de toda regla — ${nombre}`, () => {
    const css = cssDelPanel(panel);
    const pila = [];
    const huerfanas = [];
    for (const [n, cruda] of css.split('\n').entries()) {
      const linea = cruda.replace(/\/\*.*?\*\//g, '').trim();
      if (!linea) continue;
      if (pila[pila.length - 1] !== 'regla' && /^[a-z-]+\s*:\s*[^;{]+;$/.test(linea) && !linea.startsWith('--')) {
        huerfanas.push(`línea ${n + 1}: ${linea.slice(0, 60)}`);
      }
      for (const c of linea) {
        if (c === '{') pila.push(linea.trimStart().startsWith('@') ? 'grupo' : 'regla');
        else if (c === '}') pila.pop();
      }
    }
    assert.deepEqual(huerfanas, [], `hay propiedades fuera de toda regla:\n     ${huerfanas.join('\n     ')}`);
  });
}

await test('no quedan bloques huérfanos (cuerpo sin selector)', () => {
  // Al borrar la línea del selector queda su cuerpo suelto: propiedades
  // sueltas donde el CSS espera una regla. El navegador las ignora en
  // silencio y arrastra consigo lo que venga después.
  const css = cssDelPanel('../components/AdminPanel.jsx');
  // Pila de bloques abiertos: 'regla' (un selector) o 'grupo' (@media y
  // compañía). Una propiedad solo puede vivir dentro de una REGLA; si el
  // bloque de más adentro es un @media —o no hay ninguno— quedó huérfana.
  const pila = [];
  const huerfanas = [];
  for (const [n, cruda] of css.split('\n').entries()) {
    const linea = cruda.replace(/\/\*.*?\*\//g, '').trim();
    if (!linea) continue;
    const dentroDeRegla = pila[pila.length - 1] === 'regla';
    if (!dentroDeRegla && /^[a-z-]+\s*:\s*[^;{]+;$/.test(linea) && !linea.startsWith('--')) {
      huerfanas.push(`línea ${n + 1}: ${linea.slice(0, 60)}`);
    }
    for (const c of linea) {
      if (c === '{') pila.push(linea.trimStart().startsWith('@') ? 'grupo' : 'regla');
      else if (c === '}') pila.pop();
    }
  }
  assert.deepEqual(huerfanas, [], `hay propiedades fuera de toda regla:\n     ${huerfanas.join('\n     ')}`);
});

await test('el dashboard conserva sus dos columnas en PC', () => {
  // La regla debe estar DENTRO del @media de escritorio: si un cierre de más
  // la deja fuera, el dashboard se apila en una sola columna.
  const css = cssDelPanel('../components/AdminPanel.jsx');
  let profundidad = 0;
  let dentro = false;
  for (const linea of css.split('\n')) {
    if (/@media \(min-width: 900px\)/.test(linea)) profundidad = 1;
    if (/\.dash-grid \{[^}]*grid-template-columns:\s*minmax\(0, 2\.2fr\)/.test(linea)) dentro = profundidad > 0;
    for (const c of linea) {
      if (c === '{' && profundidad) profundidad++;
      else if (c === '}' && profundidad) profundidad--;
    }
  }
  assert.equal(dentro, true, 'las dos columnas quedaron fuera del @media de PC');
});

await test('las reglas de la barra en móvil viven en el @media de móvil, no en el de PC', () => {
  // Estuvieron dentro de @media (min-width: 900px): en el celular no
  // aplicaban, la derecha de la barra no podía encogerse y el avatar se salía
  // del borde redondeado. Se localiza en qué @media cae cada regla clave.
  const css = cssDelPanel('../components/AdminPanel.jsx');
  const enBloque = {};
  let actual = null;
  let profundidad = 0;
  for (const linea of css.split('\n')) {
    const m = linea.match(/@media \((max|min)-width: (\d+)px\)/);
    if (m && profundidad === 0) actual = `${m[1]}${m[2]}`;
    if (profundidad === 1 && actual) {
      for (const clave of ['.head-right {', '.head-guia {', '.head-user-btn {']) {
        if (linea.trim().startsWith(clave)) (enBloque[clave] ??= new Set()).add(actual);
      }
    }
    for (const c of linea) {
      if (c === '{') profundidad++;
      else if (c === '}') { profundidad--; if (profundidad === 0) actual = null; }
    }
  }
  for (const clave of ['.head-right {', '.head-guia {', '.head-user-btn {']) {
    assert.ok(enBloque[clave]?.has('max899'), `${clave} debe tener su versión en @media (max-width: 899px)`);
    assert.ok(!enBloque[clave]?.has('min900'), `${clave} no debe redefinirse en el bloque de PC`);
  }
});

await test('los bloques de semana del cajón no se encogen dentro del scroll', () => {
  // El cuerpo del cajón es una columna flex con scroll. Un hijo con
  // overflow:hidden (los bloques lo llevan para redondear las esquinas) se
  // encoge para caber y RECORTA su contenido: la semana en curso salía con el
  // lunes a medias y a la anterior le faltaba el último día.
  const css = cssDelPanel('../components/AdminPanel.jsx');
  const regla = css.match(/^\.sem-bloque \{([^}]*)\}/m)?.[1] ?? '';
  assert.match(regla, /overflow:\s*hidden/, 'si deja de recortar, esta prueba ya no aplica');
  assert.match(regla, /flex:\s*0 0 auto|flex-shrink:\s*0/, 'debe llevar flex-shrink: 0');
});

await test('una clase nueva no reutiliza el nombre de otra que ya tiene reglas', () => {
  // El cajón por semanas nació con la clase «semana»… que ya era la rejilla
  // de 6 columnas del editor de horarios: los días de cada semana salieron
  // repartidos en columnas. En un CSS de este tamaño nadie se acuerda de
  // todos los nombres, así que se comprueba: una clase simple (`.x {`) solo
  // puede definirse UNA vez en el nivel superior. Las que ya estaban
  // repetidas antes de esta prueba quedan como lista conocida; no crece.
  const YA_REPETIDAS = new Set(['.admin-root', '.head-badge', '.rep-table', '.drawer', '.tabbar', '.side-foot', '.att-tablewrap', '.costo-tipos', '.costo-tipo']);
  const css = cssDelPanel('../components/AdminPanel.jsx');
  const vistas = new Map();
  let profundidad = 0;
  for (const [n, cruda] of css.split('\n').entries()) {
    const linea = cruda.replace(/\/\*.*?\*\//g, '').trim();
    if (profundidad === 0) {
      const m = linea.match(/^(\.[a-zA-Z0-9_-]+)\s*\{/);
      if (m) {
        if (!vistas.has(m[1])) vistas.set(m[1], []);
        vistas.get(m[1]).push(n + 1);
      }
    }
    for (const c of linea) {
      if (c === '{') profundidad++;
      else if (c === '}') profundidad--;
    }
  }
  const nuevas = [...vistas].filter(([clase, lineas]) => lineas.length > 1 && !YA_REPETIDAS.has(clase));
  assert.deepEqual(nuevas, [], `clases definidas dos veces: ${nuevas.map(([c, l]) => `${c} (líneas ${l.join(', ')})`).join('; ')}`);
});

// ── Novedades deducidas del horario ─────────────────────────────────────
// Solo la entrada tardía. La «salida temprana» se quitó de todo el sistema
// (2026-09-16): irse antes no es incidencia, se ve en la cuenta de horas.
console.log('\n🚩 Novedades: entrada tardía (y nada más)');
const { marcarNovedades } = await import('../services/panelStore.js');

const ANA = {
  id: 'P1',
  jornadaDias: {
    1: { entrada: '09:00', salida: '17:30', almuerzoMin: 60, almuerzoDesde: '13:00', almuerzoHasta: '14:00' },
    6: { entrada: '09:00', salida: '13:30', almuerzoMin: 0 },
  },
};
const GENTE = new Map([['P1', ANA]]);
// 2026-08-03 es lunes. Hora Bogotá = UTC-5.
const ev = (tipo, hora, dia = '2026-08-03') => ({
  personId: 'P1', type: tipo, ts: `${dia}T${hora}:00-05:00`, flag: null,
});
/** Banderas que quedaron, en orden. */
const banderas = (evs) => marcarNovedades(evs, GENTE).map((e) => e.flag);

await test('día normal: sin novedades', () => {
  assert.deepEqual(banderas([ev('in', '09:05'), ev('out', '13:00'), ev('in', '14:00'), ev('out', '17:30')]),
    [null, null, null, null]);
});
await test('entrada 3 h tarde: entrada tardía', () => {
  assert.deepEqual(banderas([ev('in', '12:10'), ev('out', '17:30')]), ['late-entry', null]);
});
await test('entrada tarde pero dentro del margen: sin novedad', () => {
  // 11:00 son 2 h de retraso: molesto, pero no es una incidencia que revisar.
  assert.deepEqual(banderas([ev('in', '11:00'), ev('out', '17:30')]), [null, null]);
});
await test('irse a las 15:00 sin volver NO es novedad: la salida temprana no existe', () => {
  assert.deepEqual(banderas([ev('in', '09:00'), ev('out', '15:00')]), [null, null]);
});
await test('ni la salida a almorzar, claro', () => {
  assert.deepEqual(banderas([ev('in', '09:00'), ev('out', '13:00'), ev('in', '14:00'), ev('out', '17:30')]),
    [null, null, null, null]);
});
await test('sin horario ese día no hay contra qué comparar', () => {
  // Domingo: no está en su jornada, así que nada se marca.
  assert.deepEqual(banderas([ev('in', '14:00', '2026-08-02'), ev('out', '15:00', '2026-08-02')]), [null, null]);
});
await test('entrada tarde y salida antes: solo la entrada es novedad', () => {
  assert.deepEqual(banderas([ev('in', '12:30'), ev('out', '15:00')]), ['late-entry', null]);
});

// ── Validación de la hora de almuerzo del horario ───────────────────────
console.log('\n🍽️  Hora de almuerzo en el horario');
const { validarDias } = await import('../lib/horariosDias.js');
const dia = (extra) => ({ 1: { entrada: '09:00', salida: '17:30', almuerzo_min: 60, ...extra } });

await test('el rango se guarda y de ÉL sale la duración', () => {
  // La duración no se teclea: si el rango dice 90 minutos, mandar 60 no
  // cambia nada. Es lo que impide que los dos datos se contradigan.
  const r = validarDias(dia({ almuerzo_desde: '13:00', almuerzo_hasta: '14:30' }));
  assert.equal(r.error, undefined);
  assert.deepEqual(
    [r.dias['1'].almuerzo_desde, r.dias['1'].almuerzo_hasta, r.dias['1'].almuerzo_min],
    ['13:00', '14:30', 90],
  );
});
await test('dos horas de almuerzo se respetan', () => {
  const r = validarDias(dia({ almuerzo_desde: '12:00', almuerzo_hasta: '14:00' }));
  assert.equal(r.dias['1'].almuerzo_min, 120);
});
await test('sin rango el horario sigue siendo válido', () => {
  // Los horarios creados antes de que existiera no se rompen: conservan su
  // duración y no se les inventa un rango.
  const r = validarDias(dia({}));
  assert.equal(r.error, undefined);
  assert.equal(r.dias['1'].almuerzo_min, 60);
  assert.equal('almuerzo_desde' in r.dias['1'], false);
});
await test('media pareja se rechaza', () => {
  assert.match(validarDias(dia({ almuerzo_desde: '13:00' })).error ?? '', /las dos horas/);
  assert.match(validarDias(dia({ almuerzo_hasta: '14:00' })).error ?? '', /las dos horas/);
});
await test('el almuerzo no puede salirse de la jornada', () => {
  assert.match(validarDias(dia({ almuerzo_desde: '08:00', almuerzo_hasta: '09:30' })).error ?? '', /dentro de la jornada/);
  assert.match(validarDias(dia({ almuerzo_desde: '17:00', almuerzo_hasta: '18:00' })).error ?? '', /dentro de la jornada/);
});
await test('turno nocturno: el almuerzo de madrugada es válido', () => {
  // 22:00–06:00 con pausa de 02:00 a 03:00. Comparado como TEXTO, "02:00"
  // sería menor que "22:00" y se rechazaría un horario correcto.
  const r = validarDias({ 1: { entrada: '22:00', salida: '06:00', almuerzo_desde: '02:00', almuerzo_hasta: '03:00' } });
  assert.equal(r.error, undefined);
  assert.equal(r.dias['1'].almuerzo_min, 60);
});
await test('una hora mal escrita se rechaza', () => {
  assert.match(validarDias(dia({ almuerzo_desde: '13', almuerzo_hasta: '14:00' })).error ?? '', /HH:MM/);
});

// ── La semana como unidad de la hora extra ──────────────────────────────
console.log('\n📆 Semana laboral: la extra se define al cerrar');
const { resumenSemana, lunesDe, domingoDe } = await import('../lib/semanaLaboral.js');

// Horario de 7h 30 lunes–viernes y 4h 30 el sábado (= 42 h), como el de la
// mayoría en la empresa; el domingo no tiene horario.
const HORARIO_42 = (fecha) => {
  const dow = new Date(`${fecha}T12:00:00Z`).getUTCDay();
  return dow === 0 ? null : dow === 6 ? 4.5 : 7.5;
};
const semana = (dias, extra = {}) => resumenSemana({
  lunes: '2026-09-07',
  horasPorDia: new Map(Object.entries(dias)),
  festivos: new Set(),
  horasHorario: HORARIO_42,
  hoy: '2026-09-14', // lunes siguiente: la semana YA cerró
  ...extra,
});

await test('lunes y domingo de cualquier fecha', () => {
  assert.equal(lunesDe('2026-09-12'), '2026-09-07'); // sábado
  assert.equal(lunesDe('2026-09-13'), '2026-09-07'); // domingo sigue en la misma semana
  assert.equal(lunesDe('2026-09-14'), '2026-09-14'); // lunes es su propio lunes
  assert.equal(domingoDe('2026-09-09'), '2026-09-13');
});
await test('días largos compensan días cortos: sin extra si no pasa de 42', () => {
  // 9 h el lunes, 6 h el martes y lo normal el resto: 42 h justas.
  const r = semana({ '2026-09-07': 9, '2026-09-08': 6, '2026-09-09': 7.5, '2026-09-10': 7.5, '2026-09-11': 7.5, '2026-09-12': 4.5 });
  assert.equal(r.cerrada, true);
  assert.equal(r.ordinarias, 42);
  assert.equal(r.extra, 0);
  assert.equal(r.faltante, 0);
});
await test('lo que pasa de 42 en la semana es extra', () => {
  const r = semana({ '2026-09-07': 8, '2026-09-08': 8, '2026-09-09': 8, '2026-09-10': 8, '2026-09-11': 8, '2026-09-12': 4.5 });
  assert.equal(r.extra, 2.5);
});
await test('quien no llega a 42 no tiene extra aunque un día se haya quedado tarde', () => {
  const r = semana({ '2026-09-07': 10, '2026-09-08': 7, '2026-09-09': 7 });
  assert.equal(r.extra, 0);
  assert.equal(r.faltante, 18);
});
await test('en curso: la extra NO se estima (null), solo se acumula', () => {
  const r = semana({ '2026-09-07': 10, '2026-09-08': 10 }, { hoy: '2026-09-10' });
  assert.equal(r.cerrada, false);
  assert.equal(r.trabajado, 20);
  assert.equal(r.extra, null);
  assert.equal(r.faltante, null);
});
await test('el domingo que termina la semana todavía cuenta como en curso', () => {
  assert.equal(semana({}, { hoy: '2026-09-13' }).cerrada, false);
  assert.equal(semana({}, { hoy: '2026-09-14' }).cerrada, true);
});
await test('el domingo va aparte: no entra en las 42 y es dominical siempre', () => {
  // 42 h exactas de lunes a sábado + 3 h el domingo: la extra por semana es
  // 0 y las 3 h del domingo salen como dominicales, no se «compensan».
  const r = semana({ '2026-09-07': 7.5, '2026-09-08': 7.5, '2026-09-09': 7.5, '2026-09-10': 7.5, '2026-09-11': 7.5, '2026-09-12': 4.5, '2026-09-13': 3 });
  assert.equal(r.ordinarias, 42);
  assert.equal(r.dominicales, 3);
  assert.equal(r.extra, 0);
  assert.equal(r.trabajado, 45);
});
await test('festivo entre semana: se acreditan las horas de su horario, con aviso', () => {
  // Lunes festivo sin marcar. Trabaja normal martes a sábado (34,5 h). Sin
  // el crédito quedaría 7,5 h por debajo de 42; con él, la semana cuadra.
  const r = semana(
    { '2026-09-08': 7.5, '2026-09-09': 7.5, '2026-09-10': 7.5, '2026-09-11': 7.5, '2026-09-12': 4.5 },
    { festivos: new Set(['2026-09-07']) },
  );
  assert.equal(r.acreditadas, 7.5);
  assert.deepEqual(r.festivosAcreditados, [{ fecha: '2026-09-07', horas: 7.5 }]);
  assert.equal(r.cuenta, 42);
  assert.equal(r.extra, 0);
  assert.equal(r.faltante, 0);
});
await test('festivo trabajado: lo marcado es dominical Y el horario se acredita igual', () => {
  const r = semana(
    { '2026-09-07': 3, '2026-09-08': 7.5, '2026-09-09': 7.5, '2026-09-10': 7.5, '2026-09-11': 7.5, '2026-09-12': 4.5 },
    { festivos: new Set(['2026-09-07']) },
  );
  assert.equal(r.dominicales, 3);
  assert.equal(r.ordinarias, 34.5);
  assert.equal(r.acreditadas, 7.5);
  assert.equal(r.extra, 0);
});
await test('festivo en un día sin horario no acredita nada', () => {
  // Alguien de lunes a viernes: un sábado festivo no le cambia la cuenta.
  const soloLV = (f) => (HORARIO_42(f) === 4.5 ? null : HORARIO_42(f));
  const r = semana({}, { festivos: new Set(['2026-09-12']), horasHorario: soloLV });
  assert.equal(r.acreditadas, 0);
  assert.deepEqual(r.festivosAcreditados, []);
});
await test('la jornada semanal de la empresa es configurable', () => {
  const r = semana({ '2026-09-07': 8, '2026-09-08': 8, '2026-09-09': 8, '2026-09-10': 8, '2026-09-11': 8, '2026-09-12': 8 }, { horasSemana: 44 });
  assert.equal(r.extra, 4);
});

// ── Enlace firmado del modo prueba ──────────────────────────────────────
// El roster facial es dato biométrico: solo lo baja un aparato activado, una
// sesión o este enlace, que firma el servidor y vence solo. Si la firma no
// se comprobara bien, cualquiera con la URL tendría los rostros de todos.
console.log('\n🧪 Enlace del modo prueba');
process.env.BETTER_AUTH_SECRET ??= 'secreto-de-pruebas';
const { firmarEnlacePrueba, empresaDelEnlacePrueba, VIGENCIA_PRUEBA_H } = await import('../lib/pruebaReconocimiento.js');
const EMPRESA = '4d0c9c4a-0000-4000-8000-000000000001';

await test('un enlace recién firmado identifica a su empresa', () => {
  const { token, vence } = firmarEnlacePrueba(EMPRESA);
  assert.equal(empresaDelEnlacePrueba(token), EMPRESA);
  const horas = (Date.parse(vence) - Date.now()) / 3600000;
  assert.ok(horas > VIGENCIA_PRUEBA_H - 0.01 && horas <= VIGENCIA_PRUEBA_H, `vence en ${VIGENCIA_PRUEBA_H} h`);
});
await test('cambiar una letra del token lo invalida', () => {
  const { token } = firmarEnlacePrueba(EMPRESA);
  const [cuerpo, sello] = token.split('.');
  const otroCuerpo = Buffer.from(JSON.stringify({ e: EMPRESA.replace('1', '2'), x: Date.now() + 3600000 })).toString('base64url');
  assert.equal(empresaDelEnlacePrueba(`${otroCuerpo}.${sello}`), null, 'otra empresa con la misma firma: no');
  assert.equal(empresaDelEnlacePrueba(`${cuerpo}.${sello.slice(0, -1)}x`), null, 'firma tocada: no');
});
await test('un enlace vencido ya no sirve', () => {
  const { token } = firmarEnlacePrueba(EMPRESA, -1); // venció hace una hora
  assert.equal(empresaDelEnlacePrueba(token), null);
});
await test('basura no revienta: simplemente no es válida', () => {
  for (const t of ['', '1', 'a.b', 'x'.repeat(50), null, undefined, 'eyJ9.']) assert.equal(empresaDelEnlacePrueba(t), null);
});
await test('«prueba=1» a secas NO es un token', async () => {
  // Es el modo prueba de siempre, que necesita sesión o aparato. El cliente
  // solo manda X-Prueba-Token cuando el valor es más largo que «1».
  const src = leerCss(new URL('../services/kioskoApi.js', import.meta.url), 'utf8');
  assert.match(src, /t\.length > 1 \? t : ''/);
  assert.equal(empresaDelEnlacePrueba('1'), null);
});
await test('solo el roster acepta el token: ninguna otra API lo lee', async () => {
  // Si mañana alguien lo mete en empresaDeLaPeticion, todas las APIs del
  // kiosco (marcar incluida) lo aceptarían. Se comprueba que el nombre del
  // encabezado aparezca ÚNICAMENTE en la ruta del roster.
  const { readdirSync, statSync } = await import('node:fs');
  const archivos = [];
  const recorrer = (dir) => { for (const n of readdirSync(dir)) { const p = `${dir}/${n}`; if (statSync(p).isDirectory()) recorrer(p); else if (/\.(js|jsx|mjs)$/.test(n)) archivos.push(p); } };
  for (const d of ['app', 'lib', 'services']) recorrer(new URL(`../${d}`, import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
  const conToken = archivos.filter((p) => /x-prueba-token/i.test(leerCss(p, 'utf8')) && !p.endsWith('kioskoApi.js'));
  assert.deepEqual(conToken.map((p) => p.split('/').slice(-3).join('/')), ['api/empleados/route.js']);
});

// ── Placeholders de SQL en las rutas ────────────────────────────────────
console.log('\n🧾 SQL de las rutas');
await test('todo placeholder de parámetro lleva su $ (`= $N`, nunca `= N`)', async () => {
  // Al escribir `sets.push(\`modo_extra = $${args.length}\`)` se perdió el
  // primer «$» y el SQL quedó `modo_extra = 1`: Postgres lo rechazaba y la
  // ruta devolvía 500 sin cuerpo. El panel «guardaba» y la siguiente
  // sincronización lo deshacía. Se buscan interpolaciones de args.length
  // que no vayan precedidas de $.
  const { readdirSync, statSync, readFileSync } = await import('node:fs');
  const raiz = new URL('../app/api', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
  const archivos = [];
  const recorrer = (dir) => { for (const n of readdirSync(dir)) { const p = `${dir}/${n}`; if (statSync(p).isDirectory()) recorrer(p); else if (n.endsWith('.js')) archivos.push(p); } };
  recorrer(raiz);
  const malos = [];
  for (const p of archivos) {
    for (const [n, linea] of readFileSync(p, 'utf8').split('\n').entries()) {
      if (/[^$]\$\{args\.length\}/.test(linea) && /=\s*\$\{args\.length\}/.test(linea)) malos.push(`${p.split('/').slice(-3).join('/')}:${n + 1}`);
    }
  }
  assert.deepEqual(malos, [], `falta el $ del placeholder en: ${malos.join(', ')}`);
});

// ── Qué guarda el Service Worker ────────────────────────────────────────
// El caché del navegador es COMÚN a todas las cuentas: no se separa por
// sesión ni se vacía al salir. Si una página renderizada con la identidad de
// alguien entra ahí, al cambiar de cuenta el navegador se la sirve a la
// siguiente persona. Pasó: el panel quedaba con el nombre y la empresa del
// usuario anterior y solo se arreglaba borrando los datos del sitio a mano.
//
// Se prueba la DECISIÓN, que es donde estuvo el fallo: para cada URL, si el
// worker la intercepta (y por tanto la puede guardar) o la deja pasar a la red.
console.log('\n🗄️  Service Worker: qué se puede guardar');
const { default: vm } = await import('node:vm');
const { readFileSync: leerArchivo } = await import('node:fs');

/** Carga public/sw.js en un contexto falso y devuelve su manejador de fetch. */
const cargarServiceWorker = () => {
  let alHacerFetch = null;
  const unCache = { match: async () => null, put: async () => {} };
  const contexto = {
    self: {
      addEventListener: (tipo, fn) => { if (tipo === 'fetch') alHacerFetch = fn; },
      skipWaiting: () => {},
      clients: { claim: async () => {} },
      location: { origin: 'https://app.test' },
    },
    caches: { open: async () => unCache, keys: async () => [], delete: async () => true },
    fetch: async () => ({ ok: true, status: 200, clone: () => ({}) }),
    URL, console,
  };
  vm.createContext(contexto);
  vm.runInContext(leerArchivo(new URL('../public/sw.js', import.meta.url), 'utf8'), contexto);
  if (!alHacerFetch) throw new Error('sw.js no registró un manejador de fetch');
  return alHacerFetch;
};

const alHacerFetch = cargarServiceWorker();

/** ¿El worker intercepta esta petición? Interceptar = puede guardarla. */
const seGuarda = (ruta, modo = 'no-cors') => {
  let interceptada = false;
  alHacerFetch({
    request: { method: 'GET', url: `https://app.test${ruta}`, mode: modo },
    respondWith: () => { interceptada = true; },
  });
  return interceptada;
};

await test('el HTML del kiosco NO se guarda: así se auto-actualiza', () => {
  // El worker existe para que los ~16 MB de modelos no se vuelvan a bajar en
  // cada arranque, no para servir la página sin red. Dejar el HTML fuera es
  // lo que permite que un despliegue nuevo llegue solo al kiosco.
  assert.equal(seGuarda('/', 'navigate'), false);
});
await test('el panel NO se guarda: lleva la sesión renderizada dentro', () => {
  assert.equal(seGuarda('/admin', 'navigate'), false);
});
await test('ninguna pantalla del panel se guarda', () => {
  for (const r of ['/admin/empleados', '/admin/ajustes/plan', '/admin/bienvenida', '/admin/registro']) {
    assert.equal(seGuarda(r, 'navigate'), false, `${r} no debe guardarse`);
  }
});
await test('el login NO se guarda: muestra quién tiene la sesión abierta', () => {
  assert.equal(seGuarda('/login', 'navigate'), false);
});
await test('la plataforma del superadmin NO se guarda', () => {
  assert.equal(seGuarda('/plataforma', 'navigate'), false);
});
await test('las cargas RSC de Next tampoco: son el mismo HTML por otra puerta', () => {
  assert.equal(seGuarda('/admin?_rsc=1a2b3c'), false);
  assert.equal(seGuarda('/plataforma?_rsc=9z8y'), false);
});
await test('los datos nunca se guardan', () => {
  assert.equal(seGuarda('/api/marcaciones'), false);
  assert.equal(seGuarda('/api/auth/get-session'), false);
});
await test('los archivos pesados e inmutables SÍ se guardan', () => {
  // Los tres únicos: modelos faciales, wasm de MediaPipe y los chunks con
  // hash de Next. Inmutables los tres, así que el caché nunca puede servir
  // una versión vieja de un archivo nuevo.
  assert.equal(seGuarda('/models/face_recognition_model.bin'), true);
  assert.equal(seGuarda('/wasm/vision_wasm_internal.wasm'), true);
  assert.equal(seGuarda('/_next/static/chunks/main-abc123.js'), true);
});
await test('lo demás va a la red, sin guardarse', () => {
  assert.equal(seGuarda('/manifest.webmanifest'), false);
  assert.equal(seGuarda('/icon-512.png'), false);
});
await test('una pantalla nueva queda FUERA por defecto', () => {
  // La lista es de lo permitido, no de lo prohibido: si mañana alguien agrega
  // una pantalla con sesión, no entra al caché sin tocar esto a propósito.
  assert.equal(seGuarda('/reportes-confidenciales', 'navigate'), false);
  assert.equal(seGuarda('/lo-que-sea'), false);
});

// ── Orden de declaraciones en los componentes ───────────────────────────
// Un `useEffect(..., [cfg.periodoPago])` quedó diez líneas ANTES de
// `const [cfg] = useState(...)`: compiló (Next no renderiza /admin al
// construir) y en producción fue «Cannot access 'ex' before initialization»,
// pantalla en blanco para todos. Lo que se evalúa durante el render no
// puede nombrar una constante del componente declarada más abajo.
console.log('\n🔁 Orden de declaraciones');
const { usosAntesDeDeclarar } = await import('./ordenDeclaraciones.mjs');
const COMPONENTES = [
  ['../components/AdminPanel.jsx', 'AdminPanel'],
  ['../components/PlataformaPanel.jsx', 'PlataformaPanel'],
  ['../components/KioskMode.jsx', 'KioskMode'],
  ['../components/EmployeeRegister.jsx', 'EmployeeRegister'],
];
for (const [archivo, componente] of COMPONENTES) {
  await test(`nada se usa antes de declararse — ${componente}`, () => {
    const fuente = leerCss(new URL(archivo, import.meta.url), 'utf8');
    const usos = usosAntesDeDeclarar(fuente, componente);
    assert.deepEqual(usos, [], `se usa antes de declararse: ${usos.map((u) => `${u.nombre} (línea ${u.linea}, declarada en ${u.declarada})`).join('; ')}`);
  });
}
await test('el detector ve un arreglo de dependencias que nombra algo declarado después', () => {
  // El caso real: el efecto arriba, la constante abajo.
  const roto = `export default function X() {
  useEffect(() => { setV(cfg.periodoPago); }, [cfg.periodoPago]);
  const [cfg] = useState({});
  return (
    <div />
  );
}`;
  assert.deepEqual(usosAntesDeDeclarar(roto, 'X'), [{ nombre: 'cfg', linea: 2, declarada: 3 }]);
});
await test('el detector no se asusta con callbacks, comentarios ni cadenas', () => {
  const sano = `export default function X() {
  // aquí se habla de cfg, pero es un comentario
  const t = 'cfg en una cadena';
  const f = () => cfg.x;
  useEffect(() => { f(cfg); }, []);
  const [cfg] = useState({});
  return (
    <div />
  );
}`;
  assert.deepEqual(usosAntesDeDeclarar(sano, 'X'), []);
});

// ── Mi empresa: lo que se guarda se tiene que poder leer ─────────────
// El NIT se guardaba (PATCH /api/empresa) pero la lista de columnas con la
// que la sesión carga la empresa no lo traía: el GET devolvía siempre vacío
// y en pantalla parecía que no se guardaba.
console.log('\n🏢 Mi empresa');
await test('la empresa se carga con las columnas que el panel edita (nombre y NIT)', () => {
  const fuente = leerCss(new URL('../lib/empresas.js', import.meta.url), 'utf8');
  const campos = /const CAMPOS = `([^`]+)`/.exec(fuente)?.[1] ?? '';
  const lista = campos.split(',').map((c) => c.trim());
  for (const c of ['nombre', 'nit']) assert.ok(lista.includes(c), `falta «${c}» en CAMPOS`);
});

// ── API de horas para nómina / gestión ───────────────────────────────
console.log('\n🔌 API de horas');
const { resumirLote } = await import('../lib/nomina.js');
const tramo = (documento, tipoHora, horas, valor, pagado, n) => ({
  documento, tipoHora, horas, valor, pagado, _empleadoId: `E${documento}`,
  referenciaExterna: `arrive-${documento}-20260901-0800-1700-${tipoHora}-${n}`,
});
const LOTE = {
  registros: [
    tramo('111', 'HED', 2, 20000, true, 1), tramo('111', 'HED', 1.5, 15000.4, false, 2), tramo('111', 'HEDDF', 1, 18000, false, 3),
    tramo('222', 'HED', 3, null, false, 4),
  ],
  porEmpleado: new Map([['E111', { nombre: 'Ana Pérez', sede: 'Centro' }], ['E222', { nombre: 'Luis Gómez', sede: null }]]),
};
await test('resume por empleado: horas por tipo, valor redondeado una vez y estado de pago', () => {
  const { empleados, totales } = resumirLote(LOTE);
  const ana = empleados.find((e) => e.documento === '111');
  assert.equal(ana.nombre, 'Ana Pérez');
  assert.equal(ana.horas.HED, 3.5);
  assert.equal(ana.horas.HEDDF, 1);
  assert.equal(ana.horasExtra, 4.5);
  assert.equal(ana.valor, 53000, 'el peso se redondea sobre el total, no tramo a tramo');
  assert.equal(ana.pago, 'parcial');
  assert.deepEqual(ana.referenciasPendientes.length, 2);
  assert.equal(totales.empleados, 2);
  assert.equal(totales.valor, 53000);
  assert.equal(totales.valorPendiente, 33000);
});
await test('sin salario: valor null, se cuenta aparte y no rompe los totales', () => {
  const { empleados, totales } = resumirLote(LOTE);
  const luis = empleados.find((e) => e.documento === '222');
  assert.equal(luis.valor, null);
  assert.equal(luis.sinSalario, true);
  assert.equal(luis.pago, 'pendiente');
  assert.equal(totales.sinSalario, 1);
});
await test('el período se pide por mes y quincena, o por desde/hasta', async () => {
  const { rangoPedido } = await import('../lib/periodoHoras.js');
  const q = (s) => rangoPedido(new URLSearchParams(s));
  assert.deepEqual(q('mes=2026-09&quincena=1'), { desde: '2026-09-01', hasta: '2026-09-15' });
  assert.deepEqual(q('mes=2026-09&quincena=2'), { desde: '2026-09-16', hasta: '2026-09-30' });
  assert.deepEqual(q('mes=2026-02&quincena=2'), { desde: '2026-02-16', hasta: '2026-02-28' }, 'febrero termina el 28');
  assert.deepEqual(q('mes=2026-09'), { desde: '2026-09-01', hasta: '2026-09-30' }, 'sin quincena, el mes entero');
  assert.deepEqual(q('desde=2026-09-01&hasta=2026-09-15'), { desde: '2026-09-01', hasta: '2026-09-15' });
  assert.equal(q(''), null, 'sin parámetros no hay rango');
  assert.ok(q('mes=2026-13').error, 'mes 13 no existe');
  assert.ok(q('mes=2026-09&quincena=3').error, 'solo hay dos quincenas');
  assert.ok(q('desde=2026-09-20&hasta=2026-09-10').error, 'desde no puede ir después de hasta');
});
await test('las tres rutas de /api/horas entran con la clave de API (accesoHoras)', () => {
  for (const ruta of ['../app/api/horas/route.js', '../app/api/horas/resumen/route.js', '../app/api/horas/pagadas/route.js']) {
    const fuente = leerCss(new URL(ruta, import.meta.url), 'utf8');
    assert.match(fuente, /accesoHoras\(req, '(ver|liquidar)'\)/, `${ruta} no pasa por accesoHoras`);
  }
});

// ── Foto de perfil (avatar) ──────────────────────────────────────────
console.log('\n🖼️  Foto de perfil');
const { decodificarImagen, MAX_ENTRADA_BYTES } = await import('../lib/avatar.js');
const PNG_1PX = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
await test('acepta data URL y base64 a secas, y devuelve los mismos bytes', () => {
  const a = decodificarImagen(`data:image/png;base64,${PNG_1PX}`);
  const b = decodificarImagen(PNG_1PX);
  assert.equal(a.error, null); assert.equal(b.error, null);
  assert.ok(a.bytes.equals(b.bytes));
  assert.equal(a.bytes.subarray(1, 4).toString(), 'PNG');
});
await test('rechaza lo que no es imagen: vacío, otro tipo, texto suelto, demasiado grande', () => {
  assert.ok(decodificarImagen('').error);
  assert.ok(decodificarImagen('data:text/plain;base64,aG9sYQ==').error);
  assert.ok(decodificarImagen('esto no es base64!!').error);
  assert.ok(decodificarImagen('A'.repeat(Math.ceil((MAX_ENTRADA_BYTES + 1000) * 4 / 3))).error, 'más de 6 MB');
});
await test('la copia de persona que usan Asistencia y Anomalías conserva la foto (avatarEn)', () => {
  // La miniatura no salía en Asistencia porque esa pantalla trabaja con una
  // copia recortada de cada persona, y la copia no traía avatarEn.
  const fuente = leerCss(new URL('../components/AdminPanel.jsx', import.meta.url), 'utf8');
  const copia = /byId\.set\(p\.id, \{[^}]*\}\)/.exec(fuente)?.[0] ?? '';
  assert.ok(copia, 'no se encontró la copia de persona');
  assert.match(copia, /avatarEn:/, 'la copia debe llevar avatarEn');
});
await test('la ruta del avatar acepta id interno o cédula y guarda solo JPEG normalizado', () => {
  const fuente = leerCss(new URL('../app/api/empleados/[id]/avatar/route.js', import.meta.url), 'utf8');
  assert.match(fuente, /\(id = \$1 or cedula = \$1\)/, 'busca por id o por cédula');
  assert.match(fuente, /prepararAvatar\(bytes\)/, 'siempre pasa por la normalización');
  assert.match(fuente, /x-api-key/, 'entra con la clave de API');
});

console.log(`\n${passed} pruebas pasaron.${process.exitCode ? ' (con fallos)' : ' ✅ Todo OK'}\n`);
