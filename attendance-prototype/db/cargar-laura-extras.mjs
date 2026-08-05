/**
 * db/cargar-laura-extras.mjs — Más horas extra para Laura en agosto:
 * cierra su jornada de HOY (mar 4) a las 20:30 → la tarde 13:02–20:30
 * deja el día en ~11,4 h (unas +3 h sobre su jornada esperada), además
 * del lunes que ya salía a las 20:00.
 *
 * Re-ejecutable: si ya existe la salida de las 20:30, no la duplica.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const dir = path.dirname(fileURLToPath(import.meta.url));
if (!process.env.DATABASE_URL) {
  const env = readFileSync(path.join(dir, '..', '.env.local'), 'utf8');
  for (const line of env.split('\n')) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}
const { pool } = await import('../lib/db.js');

const { rows: [laura] } = await pool.query(
  `select id, nombre, sede_id from asistencia.empleados where cedula = '52234567'`,
);
if (!laura) { console.error('No se encontró a Laura (cédula 52234567).'); process.exit(1); }

const SALIDA = '2026-08-04T20:30:00-05:00';
const { rowCount: yaExiste } = await pool.query(
  `select 1 from asistencia.marcaciones
    where empleado_id = $1 and tipo = 'salida' and ts = $2::timestamptz and not eliminada`,
  [laura.id, SALIDA],
);
if (yaExiste) {
  console.log('La salida de las 20:30 de hoy ya existía. Nada que hacer.');
} else {
  await pool.query(
    `insert into asistencia.marcaciones (empleado_id, tipo, ts, sede_id, origen)
     values ($1, 'salida', $2::timestamptz, $3, 'kiosco')`,
    [laura.id, SALIDA, laura.sede_id],
  );
  console.log(`Salida 20:30 de hoy agregada para ${laura.nombre}.`);
}

// Resumen de sus días de agosto
const { rows } = await pool.query(`
  with pares as (
    select (m.ts at time zone 'America/Bogota')::date as dia,
           m.ts as entrada, lead(m.ts) over (order by m.ts) as salida,
           m.tipo, lead(m.tipo) over (order by m.ts) as tipo_sig
    from asistencia.marcaciones m
    where m.empleado_id = $1 and not m.eliminada
      and (m.ts at time zone 'America/Bogota')::date >= '2026-08-01'
  )
  select dia::text,
         round(sum(extract(epoch from (salida - entrada))/3600)
           filter (where tipo='entrada' and tipo_sig='salida')::numeric, 1) as horas
  from pares group by dia order by dia
`, [laura.id]);
console.table(rows);
await pool.end();
