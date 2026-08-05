/**
 * db/migrate.mjs — Corre las migraciones SQL de db/migrations/ en orden.
 * Idempotente: registra cada archivo aplicado en asistencia._migraciones
 * y no lo vuelve a ejecutar.
 *
 * Uso:  node db/migrate.mjs
 * Lee DATABASE_URL de .env.local (o del entorno si ya está definida).
 */
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import pg from 'pg';

const dir = path.dirname(fileURLToPath(import.meta.url));

// Cargar .env.local a mano (los scripts de node no pasan por Next).
if (!process.env.DATABASE_URL) {
  try {
    const env = readFileSync(path.join(dir, '..', '.env.local'), 'utf8');
    for (const line of env.split('\n')) {
      const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  } catch { /* sin .env.local: se exige la variable en el entorno */ }
}
if (!process.env.DATABASE_URL) {
  console.error('Falta DATABASE_URL (en el entorno o en .env.local).');
  process.exit(1);
}

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

const client = await pool.connect();
try {
  await client.query(`create schema if not exists asistencia`);
  await client.query(`
    create table if not exists asistencia._migraciones (
      archivo    text primary key,
      aplicada_en timestamptz not null default now()
    )`);

  const files = readdirSync(path.join(dir, 'migrations')).filter((f) => f.endsWith('.sql')).sort();
  for (const f of files) {
    const done = await client.query('select 1 from asistencia._migraciones where archivo = $1', [f]);
    if (done.rowCount > 0) { console.log(`= ${f} (ya aplicada)`); continue; }
    const sql = readFileSync(path.join(dir, 'migrations', f), 'utf8');
    await client.query('begin');
    try {
      await client.query(sql);
      await client.query('insert into asistencia._migraciones (archivo) values ($1)', [f]);
      await client.query('commit');
      console.log(`+ ${f} aplicada`);
    } catch (e) {
      await client.query('rollback');
      console.error(`x ${f} FALLÓ: ${e.message}`);
      process.exit(1);
    }
  }
  console.log('Migraciones al día.');
} finally {
  client.release();
  await pool.end();
}
