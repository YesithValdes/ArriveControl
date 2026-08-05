/**
 * db/check-horas.mjs — Validación: horas y extras semanales calculadas EN SQL
 * desde asistencia.marcaciones. Debe coincidir con el panel y la demo:
 * Laura 42 · Andrés 52,3 (10,3 extra) · María 46 (4) · Jorge 42 · Camilo 20.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import pg from 'pg';

const dir = path.dirname(fileURLToPath(import.meta.url));
if (!process.env.DATABASE_URL) {
  const env = readFileSync(path.join(dir, '..', '.env.local'), 'utf8');
  for (const line of env.split('\n')) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

const { rows } = await pool.query(`
  with pares as (
    select m.empleado_id,
           m.ts as entrada,
           lead(m.ts)  over (partition by m.empleado_id order by m.ts) as salida,
           m.tipo,
           lead(m.tipo) over (partition by m.empleado_id order by m.ts) as tipo_sig
    from asistencia.marcaciones m
    where not m.eliminada
  )
  select e.nombre,
         round(sum(extract(epoch from (p.salida - p.entrada)) / 3600)::numeric, 1) as horas,
         greatest(0, round((sum(extract(epoch from (p.salida - p.entrada)) / 3600)
           - (select horas_semana from asistencia.config_laboral))::numeric, 1)) as extras
  from pares p
  join asistencia.empleados e on e.id = p.empleado_id
  where p.tipo = 'entrada' and p.tipo_sig = 'salida'
  group by e.nombre
  order by horas desc
`);
console.table(rows);
await pool.end();
