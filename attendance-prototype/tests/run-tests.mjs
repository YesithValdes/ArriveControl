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

// ── Entrada sin salida: se cierra con el horario ────────────────────────
// Antes, olvidar marcar la salida costaba el día ENTERO: el par no se cerraba
// y ese día valía cero. Ahora se cierra en la hora en que terminaba su
// jornada. El horario de las pruebas es el real de un cliente: L–V 09:00–17:30
// y sábado 09:00–13:30.
console.log('\n🕗 Entrada sin salida: cierre con el horario');

const LV = { entrada: '09:00', salida: '17:30', almuerzo_min: 60, almuerzo_desde: '13:00', almuerzo_hasta: '14:00' };
const HORARIO = {
  1: LV, 2: LV, 3: LV, 4: LV, 5: LV,
  // Sábado corrido: sin pausa, así que tampoco tiene hora de almuerzo.
  6: { entrada: '09:00', salida: '13:30', almuerzo_min: 0 },
};
// Un día cualquiera POSTERIOR a las marcaciones: así el día ya terminó y el
// cierre aplica. Fijo, para que la prueba no dependa de cuándo se ejecute.
const DESPUES = { festivos: SIN_FESTIVOS, vigencias: VIGENCIAS, hoy: '2026-08-10' };

const conHorario = (marcas, jornadaDias = HORARIO, jornadaSemanal = null) =>
  new Map([['E1', { cedula: '111', nombre: 'Ana', sede: 'Sede', jornadaSemanal, jornadaDias, marcas }]]);
/** Suma de horas de todos los tramos extra que salieron. */
const totalExtra = (regs) => Math.round(regs.reduce((s, r) => s + r.horas, 0) * 10000) / 10000;
// Jornada pactada CORTA (2 h/día): así el cierre siempre deja horas extra y la
// prueba puede leer en qué hora exacta cerró, que es lo que se quiere fijar.
const CORTA = [2, 2, 2, 2, 2, 2];

await test('entró en la mañana y no volvió a marcar: cuenta hasta el almuerzo', () => {
  // Nunca marcó su salida a almorzar, así que solo consta la mañana. La hora
  // (13:00) sale del HORARIO, no de ningún cálculo.
  const regs = calcularRegistros(conHorario([marca('entrada', '2026-08-03', '09:00', 1)], HORARIO, CORTA), DESPUES);
  assert.equal(regs[regs.length - 1].horaFin, '13:00', 'debe cerrar al almuerzo, no al final del día');
  assert.equal(totalExtra(regs), 2, '4 h trabajadas − 2 h de jornada');
});

await test('la hora de almuerzo se respeta tal cual, no se deduce', () => {
  // Dos personas con la MISMA franja y distinta hora de almuerzo tienen que
  // cerrar en horas distintas: es justo lo que no lograba el punto medio.
  const temprano = { ...LV, almuerzo_desde: '11:30' };
  const tarde = { ...LV, almuerzo_min: 120, almuerzo_desde: '14:00' };
  const cierre = (dia) => calcularRegistros(
    conHorario([marca('entrada', '2026-08-03', '09:00', 1)], { 1: dia }, CORTA), DESPUES,
  ).at(-1).horaFin;
  assert.equal(cierre(temprano), '11:30');
  assert.equal(cierre(tarde), '14:00', 'dos horas de almuerzo y a otra hora: también se respeta');
});

await test('entró DESPUÉS del almuerzo y olvidó la salida: cierra al final', () => {
  // Ya pasó la hora de almorzar, así que su tope es el final de la jornada.
  const regs = calcularRegistros(conHorario([marca('entrada', '2026-08-03', '14:00', 1)], HORARIO, CORTA), DESPUES);
  assert.equal(regs[regs.length - 1].horaFin, '17:30');
  assert.equal(totalExtra(regs), 1.5, '3 h 30 trabajadas − 2 h de jornada');
});

await test('entró DESPUÉS de su hora de salida: ese día no cuenta', () => {
  // Su jornada termina 17:30 y marca entrada a las 18:00: no abre día nuevo.
  const regs = calcularRegistros(conHorario([marca('entrada', '2026-08-03', '18:00', 1)]), DESPUES);
  assert.equal(regs.length, 0);
});

await test('salió a almorzar y olvidó la salida final', () => {
  // 09:00–13:00 (4 h) + 14:00 sin cerrar → cierra 17:30 (3,5 h) = 7,5 h.
  const regs = calcularRegistros(conHorario([
    marca('entrada', '2026-08-03', '09:00', 1),
    marca('salida', '2026-08-03', '13:00', 1),
    marca('entrada', '2026-08-03', '14:00', 1),
  ]), DESPUES);
  assert.equal(totalExtra(regs), 0.5, '7,5 h trabajadas − 7 h de jornada');
});

await test('una entrada tardía suelta no borra lo que ya había marcado', () => {
  // 09:00–16:00 son 7 h reales; la entrada de las 18:00 se descarta y el día
  // se queda con esas 7 h, no en cero.
  const regs = calcularRegistros(conHorario([
    marca('entrada', '2026-08-03', '09:00', 1),
    marca('salida', '2026-08-03', '16:00', 1),
    marca('entrada', '2026-08-03', '18:00', 1),
  ]), DESPUES);
  assert.equal(totalExtra(regs), 0, 'trabajó exactamente su jornada: sin extras');
});

await test('sin horario configurado el día queda en cero', () => {
  const regs = calcularRegistros(conHorario([marca('entrada', '2026-08-03', '09:00', 1)], null), DESPUES);
  assert.equal(regs.length, 0, 'sin hora pactada no hay con qué cerrar');
});

await test('día libre (no está en su horario): tampoco se cierra', () => {
  // El sábado existe en el horario pero el domingo no: es día libre.
  const regs = calcularRegistros(conHorario([marca('entrada', '2026-08-02', '09:00', 0)]), DESPUES);
  assert.equal(regs.length, 0);
});

await test('el día EN CURSO no se cierra: todavía puede marcar', () => {
  const regs = calcularRegistros(
    conHorario([marca('entrada', '2026-08-03', '09:00', 1)]),
    { ...DESPUES, hoy: '2026-08-03' },
  );
  assert.equal(regs.length, 0, 'la jornada de hoy sigue abierta');
});

await test('turno nocturno: cierra en la madrugada del día siguiente', () => {
  // Horario 22:00–06:00: la salida del horario es del día siguiente.
  const noche = { 1: { entrada: '22:00', salida: '06:00', almuerzo_min: 0 } };
  const regs = calcularRegistros(
    conHorario([marca('entrada', '2026-08-03', '22:00', 1)], noche),
    DESPUES,
  );
  assert.equal(totalExtra(regs), 1, '8 h de turno − 7 h de jornada');
  assert.equal(regs[regs.length - 1].horaFin, '06:00', 'cruza la medianoche');
});

await test('la salida del día siguiente NO se empareja con la entrada de ayer', () => {
  // Antes esto producía un turno de ~32 h. Ahora el lunes se cierra solo
  // —al almuerzo, porque no marcó nada más— y la salida suelta del martes
  // se descarta.
  const regs = calcularRegistros(conHorario([
    marca('entrada', '2026-08-03', '09:00', 1),
    marca('salida', '2026-08-04', '17:30', 2, 1),
  ], HORARIO, CORTA), DESPUES);
  assert.equal(regs[regs.length - 1].horaFin, '13:00', 'el lunes cierra al almuerzo');
  assert.equal(totalExtra(regs), 2);
  assert.ok(regs.every((r) => r.fecha === '2026-08-03'), 'nada debe atribuirse al martes');
});

await test('una salida MARCADA nunca se recorta al horario', () => {
  // Se quedó hasta las 20:00 y sí marcó: son 11 h reales, no 8,5.
  const regs = calcularRegistros(conHorario([
    marca('entrada', '2026-08-03', '09:00', 1),
    marca('salida', '2026-08-03', '20:00', 1),
  ]), DESPUES);
  assert.equal(totalExtra(regs), 4, '11 h trabajadas − 7 h de jornada');
});

await test('dos entradas seguidas no cierran las DOS: nada se cuenta dos veces', () => {
  // Faltó una salida en medio. Cerrar la de 09:00 en su horario la solaparía
  // con la de 11:00 y el mismo rato se pagaría dos veces (llegó a dar 8 h de
  // extra en un día de 6,5 h trabajadas). La primera se descarta.
  const regs = calcularRegistros(conHorario([
    marca('entrada', '2026-08-03', '09:00', 1),
    marca('entrada', '2026-08-03', '11:00', 1),
  ]), DESPUES);
  assert.equal(totalExtra(regs), 0, '11:00–17:30 son 6,5 h: por debajo de la jornada');
  assert.ok(!regs.some((r) => r.horaInicio < '11:00'), 'nada puede empezar antes de la última entrada');
});

await test('respaldo: empleados viejos sin horario por día', () => {
  // Los registrados antes de los horarios por día solo tienen los campos
  // uniformes; deben cerrarse igual.
  const viejo = new Map([['E1', {
    cedula: '111', nombre: 'Ana', sede: 'Sede', jornadaSemanal: null, jornadaDias: null,
    entradaEsperada: '09:00', salidaEsperada: '17:30',
    marcas: [marca('entrada', '2026-08-03', '09:00', 1)],
  }]]);
  assert.equal(totalExtra(calcularRegistros(viejo, DESPUES)), 1.5);
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

await test('las llaves del CSS están balanceadas', () => {
  const css = cssDelPanel('../components/AdminPanel.jsx');
  assert.ok(css, 'no se encontró el bloque de estilos');
  let abren = 0;
  let cierran = 0;
  for (const c of css) {
    if (c === '{') abren++;
    else if (c === '}') cierran++;
  }
  assert.equal(cierran, abren, `sobran ${Math.abs(abren - cierran)} llaves`);
});

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

// ── Novedades deducidas del horario ─────────────────────────────────────
// «Salida temprana» aparecía en el panel pero NUNCA se marcaba: la regla se
// quedó en journeyService.js, el servicio del prototipo que panelStore
// reemplazó. El filtro existía y siempre devolvía cero.
console.log('\n🚩 Novedades: entrada tardía y salida temprana');
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
const banderas = (evs) => marcarNovedades(evs, GENTE, '2026-08-10').map((e) => e.flag);

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
await test('se fue a las 15:00 y no volvió: salida temprana', () => {
  assert.deepEqual(banderas([ev('in', '09:00'), ev('out', '15:00')]), [null, 'early-exit']);
});
await test('la salida a ALMORZAR no es salida temprana', () => {
  // 13:00 es mucho antes de las 17:30, pero después volvió: no era la final.
  assert.deepEqual(banderas([ev('in', '09:00'), ev('out', '13:00'), ev('in', '14:00'), ev('out', '17:30')]),
    [null, null, null, null]);
});
await test('salir un poco antes no es novedad', () => {
  // 16:30 es una hora antes; el margen es de hora y media.
  assert.deepEqual(banderas([ev('in', '09:00'), ev('out', '16:30')]), [null, null]);
});
await test('el día EN CURSO no se juzga: todavía puede volver', () => {
  const evs = [ev('in', '09:00'), ev('out', '13:00')];
  assert.deepEqual(marcarNovedades(evs, GENTE, '2026-08-03').map((e) => e.flag), [null, null]);
});
await test('sin horario ese día no hay contra qué comparar', () => {
  // Domingo: no está en su jornada, así que nada se marca.
  assert.deepEqual(banderas([ev('in', '14:00', '2026-08-02'), ev('out', '15:00', '2026-08-02')]), [null, null]);
});
await test('las dos novedades pueden convivir en un día', () => {
  assert.deepEqual(banderas([ev('in', '12:30'), ev('out', '15:00')]), ['late-entry', 'early-exit']);
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

console.log(`\n${passed} pruebas pasaron.${process.exitCode ? ' (con fallos)' : ' ✅ Todo OK'}\n`);
