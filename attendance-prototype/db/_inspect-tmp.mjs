import { readFileSync } from 'node:fs';
import path from 'node:path';
import pg from 'pg';

const root = process.argv[2];
if (!process.env.DATABASE_URL) {
  const env = readFileSync(path.join(root, '.env.local'), 'utf8');
  for (const line of env.split('\n')) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

const { rows: tablas } = await pool.query(`
  select table_schema, table_name from information_schema.tables
  where table_schema not in ('pg_catalog','information_schema','asistencia')
  order by table_schema, table_name`);
console.log('TABLAS DEL GESTOR:');
for (const t of tablas) console.log(' ', t.table_schema + '.' + t.table_name);

// Busca la tabla que parezca de colaboradores/empleados
const candidatas = tablas.filter((t) => /colaborador|empleado|persona/i.test(t.table_name));
for (const c of candidatas) {
  const { rows: cols } = await pool.query(`
    select column_name, data_type from information_schema.columns
    where table_schema = $1 and table_name = $2 order by ordinal_position`, [c.table_schema, c.table_name]);
  console.log(`\nCOLUMNAS de ${c.table_schema}.${c.table_name}:`);
  console.log(' ', cols.map((x) => x.column_name).join(', '));
  const { rows: n } = await pool.query(`select count(*)::int as n from "${c.table_schema}"."${c.table_name}"`);
  console.log('  filas:', n[0].n);
}
await pool.end();
