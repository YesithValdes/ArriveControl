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
console.log('\n💵 Cálculo de horas con recargo');
const { calcularRegistros } = await import('../lib/calculoHoras.js');

// Vigencias de jornada como las publica el gestor: 7 h/día desde jul-2026.
const VIGENCIAS = [
  { desde: '2026-07-15', horasSemana: 42, horasDia: 7 },
  { desde: '1950-01-01', horasSemana: 48, horasDia: 8 },
];
const SIN_FESTIVOS = new Set();

/** Una marcación como la devuelve SQL (hora Bogotá + epoch absoluto). */
const marca = (tipo, fecha, hora, dow, diasExtra = 0) => {
  const [h, mi] = hora.split(':').map(Number);
  return {
    tipo, fecha, dow,
    minutos: h * 60 + mi,
    epoch: Date.parse(`${fecha}T00:00:00Z`) / 1000 + diasExtra * 86400 + h * 3600 + mi * 60,
  };
};
const unEmpleado = (marcas, jornadaSemanal = null) =>
  new Map([['E1', { cedula: '111', nombre: 'Ana', sede: 'Sede', jornadaSemanal, marcas }]]);

await test('día normal: lo que pasa de la jornada es extra, al final del día', () => {
  // Lunes 08:00–18:00 = 10 h; jornada 7 h → 3 h extra (15:00 a 18:00).
  const regs = calcularRegistros(
    unEmpleado([marca('entrada', '2026-08-03', '08:00', 1), marca('salida', '2026-08-03', '18:00', 1)]),
    { festivos: SIN_FESTIVOS, vigencias: VIGENCIAS },
  );
  assert.equal(regs.length, 1);
  assert.equal(regs[0].tipoHora, 'HED');
  assert.equal(regs[0].horas, 3);
  assert.equal(regs[0].horaInicio, '15:00');
  assert.equal(regs[0].horaFin, '18:00');
});

await test('jornada por debajo del límite no genera extra', () => {
  const regs = calcularRegistros(
    unEmpleado([marca('entrada', '2026-08-03', '08:00', 1), marca('salida', '2026-08-03', '15:00', 1)]),
    { festivos: SIN_FESTIVOS, vigencias: VIGENCIAS },
  );
  assert.equal(regs.length, 0);
});

await test('turno que CRUZA MEDIANOCHE no produce horas negativas', () => {
  // Lunes 16:00 → martes 02:00 = 10 h; 3 h extra deben quedar 23:00–02:00.
  // Antes de la corrección esto daba "-1:00" (bug de medianoche).
  const regs = calcularRegistros(
    unEmpleado([marca('entrada', '2026-08-03', '16:00', 1), marca('salida', '2026-08-04', '02:00', 2, 0)]),
    { festivos: SIN_FESTIVOS, vigencias: VIGENCIAS },
  );
  assert.equal(regs.length, 1);
  assert.equal(regs[0].horas, 3);
  assert.equal(regs[0].horaInicio, '23:00', 'el inicio debe ser una hora válida, no negativa');
  assert.equal(regs[0].horaFin, '02:00');
  assert.match(regs[0].horaInicio, /^\d{2}:\d{2}$/);
  assert.equal(regs[0].tipoHora, 'HEN', '23:00–02:00 cae entero en la franja nocturna');
});

await test('domingo: todo lo trabajado es extra dominical diurna (HEDDF)', () => {
  const regs = calcularRegistros(
    unEmpleado([marca('entrada', '2026-08-02', '08:00', 0), marca('salida', '2026-08-02', '12:00', 0)]),
    { festivos: SIN_FESTIVOS, vigencias: VIGENCIAS },
  );
  assert.equal(regs.length, 1);
  assert.equal(regs[0].tipoHora, 'HEDDF');
  assert.equal(regs[0].horas, 4);
});

await test('festivo entre semana se trata como dominical', () => {
  const regs = calcularRegistros(
    unEmpleado([marca('entrada', '2026-08-03', '08:00', 1), marca('salida', '2026-08-03', '12:00', 1)]),
    { festivos: new Set(['2026-08-03']), vigencias: VIGENCIAS },
  );
  assert.equal(regs.length, 1);
  assert.equal(regs[0].tipoHora, 'HEDDF');
});

await test('jornada especial: la extra empieza donde termina lo pactado', () => {
  // Martes con 7,5 h pactadas; trabaja 8 h → 0,5 h extra (no 1 h).
  const regs = calcularRegistros(
    unEmpleado(
      [marca('entrada', '2026-08-04', '08:00', 2), marca('salida', '2026-08-04', '16:00', 2)],
      [7.5, 7.5, 7.5, 7.5, 7.5, 4.5],
    ),
    { festivos: SIN_FESTIVOS, vigencias: VIGENCIAS },
  );
  assert.equal(regs.length, 1);
  assert.equal(regs[0].horas, 0.5);
  assert.equal(regs[0].horaInicio, '15:30');
});

await test('la referencia externa es estable y única por tramo', () => {
  const hacer = () => calcularRegistros(
    unEmpleado([marca('entrada', '2026-08-03', '08:00', 1), marca('salida', '2026-08-03', '18:00', 1)]),
    { festivos: SIN_FESTIVOS, vigencias: VIGENCIAS },
  )[0].referenciaExterna;
  assert.equal(hacer(), hacer(), 'el mismo tramo debe dar SIEMPRE la misma referencia');
  assert.equal(hacer(), 'arrive-111-20260803-1500-1800-HED');
});

// ── Franja nocturna y valorización ──────────────────────────────────────
// Los cuatro códigos y sus factores son PARÁMETROS editables; lo que se prueba
// aquí es que el tramo se parta donde debe y que la plata salga de multiplicar
// horas × valor hora × factor, sin inventar valores cuando falta el salario.
console.log('\n🌙 Franja nocturna y valorización');
const { partirPorNocturno, valorizarRegistro, valorHoraOrdinaria, normalizarFactores, NOCTURNO_DEFECTO } =
  await import('../lib/tiposHora.js');

await test('un tramo extra que atraviesa las 21:00 se parte en diurno y nocturno', () => {
  // Lunes 08:00–23:00 = 15 h; jornada 7 h → 8 h extra desde las 15:00.
  // 15:00–21:00 diurnas (HED) y 21:00–23:00 nocturnas (HEN).
  const regs = calcularRegistros(
    unEmpleado([marca('entrada', '2026-08-03', '08:00', 1), marca('salida', '2026-08-03', '23:00', 1)]),
    { festivos: SIN_FESTIVOS, vigencias: VIGENCIAS },
  );
  assert.equal(regs.length, 2);
  assert.deepEqual(
    regs.map((r) => [r.tipoHora, r.horaInicio, r.horaFin, r.horas]),
    [['HED', '15:00', '21:00', 6], ['HEN', '21:00', '23:00', 2]],
  );
});

await test('domingo de madrugada a mañana: HENDF y HEDDF en el mismo turno', () => {
  // Domingo 04:00–09:00: 04:00–06:00 nocturno, 06:00–09:00 diurno.
  const regs = calcularRegistros(
    unEmpleado([marca('entrada', '2026-08-02', '04:00', 0), marca('salida', '2026-08-02', '09:00', 0)]),
    { festivos: SIN_FESTIVOS, vigencias: VIGENCIAS },
  );
  assert.deepEqual(
    regs.map((r) => [r.tipoHora, r.horas]),
    [['HENDF', 2], ['HEDDF', 3]],
  );
});

await test('la franja nocturna es configurable', () => {
  // Con corte 22:00–05:00, el mismo turno 08:00–23:00 deja 7 h diurnas y 1 h nocturna.
  const regs = calcularRegistros(
    unEmpleado([marca('entrada', '2026-08-03', '08:00', 1), marca('salida', '2026-08-03', '23:00', 1)]),
    { festivos: SIN_FESTIVOS, vigencias: VIGENCIAS, nocturno: { inicio: 22 * 60, fin: 5 * 60 } },
  );
  assert.deepEqual(regs.map((r) => [r.tipoHora, r.horas]), [['HED', 7], ['HEN', 1]]);
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
  // Jornada 7 h con entrada 13:20 y salida 21:20 → 8 h, 1 h extra (20:20–21:20)
  // que se parte en 0,67 h diurnas + 0,33 h nocturnas. Ninguna llega a 0,5 h;
  // si el mínimo se aplicara a los pedazos se perdería la hora extra entera.
  const regs = calcularRegistros(
    unEmpleado([marca('entrada', '2026-08-03', '13:20', 1), marca('salida', '2026-08-03', '21:20', 1)]),
    { festivos: SIN_FESTIVOS, vigencias: VIGENCIAS },
  );
  assert.equal(regs.length, 2);
  assert.deepEqual(regs.map((r) => r.tipoHora), ['HED', 'HEN']);
  assert.equal(regs.reduce((s, r) => s + r.horas, 0), 1, 'no se puede perder ni un minuto de la extra');
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

console.log(`\n${passed} pruebas pasaron.${process.exitCode ? ' (con fallos)' : ' ✅ Todo OK'}\n`);
