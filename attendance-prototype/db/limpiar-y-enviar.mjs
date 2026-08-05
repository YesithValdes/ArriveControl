/**
 * db/limpiar-y-enviar.mjs — Deja la integración en estado limpio y coherente:
 *  1. Borra de public.novedad_horas TODO lo que envió ArriveControl
 *     (los duplicados de la semana pasada incluidos) y limpia la bitácora.
 *  2. Reenvía el período completo 27 jul – 4 ago con la REGLA DIARIA
 *     (7 h/día, domingo especial) — un solo juego de tramos, sin duplicados.
 *  3. Verifica qué quedó en novedad_horas.
 *
 * Uso:  node db/limpiar-y-enviar.mjs
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const dir = path.dirname(fileURLToPath(import.meta.url));
const env = readFileSync(path.join(dir, '..', '.env.local'), 'utf8');
for (const line of env.split('\n')) {
  const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
}
const { pool } = await import('../lib/db.js');
const { construirLote, registrarEnvio } = await import('../lib/nomina.js');

// ── 1. Limpieza ───────────────────────────────────────────────────────
const { rows: cols } = await pool.query(`
  select column_name from information_schema.columns
  where table_schema = 'public' and table_name = 'novedad_horas'`);
const colNames = cols.map((c) => c.column_name);
console.log('Columnas de novedad_horas:', colNames.join(', '));

// Identificar lo nuestro: por referencia si existe la columna; si no, por la
// marca de agua de las observaciones ("· semana del").
let borradas;
if (colNames.includes('referencia_externa')) {
  ({ rowCount: borradas } = await pool.query(
    `delete from public.novedad_horas where referencia_externa like 'arrive-%'`,
  ));
} else {
  ({ rowCount: borradas } = await pool.query(
    `delete from public.novedad_horas where observaciones like '%· semana del %'`,
  ));
}
console.log(`novedad_horas: ${borradas} fila(s) de ArriveControl eliminadas (duplicados incluidos).`);

const { rowCount: bitacora } = await pool.query(`delete from asistencia.envios_rh`);
console.log(`Bitácora envios_rh: ${bitacora} fila(s) limpiadas.`);

// ── 2. Reenvío con la regla diaria ────────────────────────────────────
const rango = { desde: '2026-07-27', hasta: '2026-08-04' };
const { registros } = await construirLote(rango);
console.log(`\nLote (regla diaria, ${rango.desde} → ${rango.hasta}): ${registros.length} tramos`);

const url = `${process.env.GESTOR_URL || 'http://localhost:3000'}/api/integraciones/horas`;
const r = await fetch(url, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'X-API-Key': process.env.INTEGRACION_HORAS_API_KEY ?? '' },
  body: JSON.stringify({ registros: registros.map(({ _empleadoId, _semana, ...x }) => x) }),
});
const datos = await r.json();
console.log(`Respuesta del gestor (HTTP ${r.status}):`, JSON.stringify(datos));

if (r.ok && datos.ok !== false) {
  await registrarEnvio(registros, datos, 'reenvio-regla-diaria');

  // ── 3. Verificación ─────────────────────────────────────────────────
  const { rows } = await pool.query(`
    select c.nombres || ' ' || c.apellidos as colaborador,
           to_char(nh.fecha at time zone 'America/Bogota', 'YYYY-MM-DD') as fecha,
           nh.hora_inicio, nh.hora_fin, nh.tipo_hora, nh.horas
      from public.novedad_horas nh
      join public.colaborador c on c.id = nh.colaborador_id
     order by nh.fecha, c.apellidos, nh.hora_inicio`);
  console.log(`\nnovedad_horas ahora (${rows.length} filas):`);
  console.table(rows);
}
await pool.end();
