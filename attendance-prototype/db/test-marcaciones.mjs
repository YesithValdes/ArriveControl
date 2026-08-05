/**
 * db/test-marcaciones.mjs — Test de integración de lib/marcaciones.js contra
 * la base REAL (esquema asistencia). Crea un empleado temporal, ejercita la
 * lógica del servidor y limpia todo al final, pase lo que pase.
 *
 * Uso:  node db/test-marcaciones.mjs
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import assert from 'node:assert/strict';

const dir = path.dirname(fileURLToPath(import.meta.url));
if (!process.env.DATABASE_URL) {
  const env = readFileSync(path.join(dir, '..', '.env.local'), 'utf8');
  for (const line of env.split('\n')) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}

// Importar DESPUÉS de cargar el entorno (lib/db.js exige DATABASE_URL).
const { pool } = await import('../lib/db.js');
const { registrarPaso, listarMarcaciones } = await import('../lib/marcaciones.js');

const EMP = 'TEST-E999';
const SEDE = 'S1';
const iso = (dia, hora) => `${dia}T${hora}:00-05:00`;
const AYER = '2026-07-20';
const HOY_T = '2026-07-21'; // "hoy" del escenario (pasado, no choca con datos demo)

let pasan = 0;
const test = async (nombre, fn) => {
  try { await fn(); pasan++; console.log(`  ok  ${nombre}`); }
  catch (e) { console.error(`  X   ${nombre}\n      ${e.message}`); process.exitCode = 1; }
};

const limpiar = async () => {
  await pool.query(`delete from asistencia.marcaciones where empleado_id = $1`, [EMP]);
  await pool.query(`delete from asistencia.empleados where id = $1`, [EMP]);
};

try {
  await limpiar();
  await pool.query(
    `insert into asistencia.empleados (id, nombre, cedula, sede_id, entrada_esperada, salida_esperada, activo)
     values ($1, 'Empleado De Prueba', '999999999', $2, '08:00', '17:24', true)`,
    [EMP, SEDE],
  );

  console.log('\nLógica de marcaciones sobre Postgres');

  await test('empleado inexistente es rechazado', async () => {
    const r = await registrarPaso({ empleadoId: 'NO-EXISTE', sedeId: SEDE });
    assert.equal(r.error, 'EMPLEADO_NO_ENCONTRADO');
  });

  await test('primer paso del día es ENTRADA', async () => {
    const r = await registrarPaso({ empleadoId: EMP, sedeId: SEDE, diferido: true, tsDispositivo: iso(AYER, '08:00') });
    assert.equal(r.tipo, 'entrada');
    assert.equal(r.marcacion.origen, 'kiosco_diferido');
  });

  await test('anti-rebote: doble pasada en <3 min devuelve duplicado', async () => {
    const r = await registrarPaso({ empleadoId: EMP, sedeId: SEDE, diferido: true, tsDispositivo: iso(AYER, '08:02') });
    assert.equal(r.duplicado, true);
  });

  await test('segundo paso del mismo día es SALIDA', async () => {
    const r = await registrarPaso({ empleadoId: EMP, sedeId: SEDE, diferido: true, tsDispositivo: iso(AYER, '12:00') });
    assert.equal(r.tipo, 'salida');
  });

  await test('tercer paso (vuelta de almuerzo) es ENTRADA', async () => {
    const r = await registrarPaso({ empleadoId: EMP, sedeId: SEDE, diferido: true, tsDispositivo: iso(AYER, '13:00') });
    assert.equal(r.tipo, 'entrada');
  });

  await test('reinicio diario: entrada de ayer sin cerrar NO alterna hoy', async () => {
    // La entrada de las 13:00 de ayer quedó abierta (olvidó salir).
    const r = await registrarPaso({ empleadoId: EMP, sedeId: SEDE, diferido: true, tsDispositivo: iso(HOY_T, '07:55') });
    assert.equal(r.tipo, 'entrada', 'el día nuevo debe arrancar de cero');
  });

  await test('la hora oficial de un paso NO diferido la pone la base de datos', async () => {
    const antes = new Date((await pool.query('select now() as n')).rows[0].n);
    const r = await registrarPaso({ empleadoId: EMP, sedeId: SEDE });
    // (el último evento del escenario es de 2026: no hay anti-rebote con "ahora")
    const ts = new Date(r.marcacion.ts);
    assert.ok(Math.abs(ts - antes) < 5000, `ts=${r.marcacion.ts} difiere del now() del servidor`);
    assert.equal(r.marcacion.ts_dispositivo, null);
  });

  await test('listarMarcaciones filtra por día Bogotá y trae nombre/sede', async () => {
    const rows = await listarMarcaciones({ empleadoId: EMP, desde: AYER, hasta: AYER });
    assert.equal(rows.length, 3, `esperaba 3 de ${AYER}, llegaron ${rows.length}`);
    assert.equal(rows[0].empleado_nombre, 'Empleado De Prueba');
    assert.deepEqual(rows.map((r) => r.tipo), ['entrada', 'salida', 'entrada']);
  });

  console.log(`\n${pasan} pruebas pasaron.${process.exitCode ? ' (con fallos)' : ' Todo OK'}\n`);
} finally {
  await limpiar();
  await pool.end();
}
