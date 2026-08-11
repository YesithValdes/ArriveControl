/**
 * db/verificar-plantilla.mjs — ¿La plantilla de empresa produce el MISMO
 * esquema que el que ya está en producción?
 *
 * Por qué existe. Las ocho migraciones originales se consolidaron en
 * `migrations/empresa/001_base.sql`, y ese archivo pasó a ser el acta de
 * nacimiento de toda empresa nueva. Pero sobre el esquema que ya existe nunca
 * se ejecuta de verdad —está lleno de `if not exists`—, así que una diferencia
 * entre lo que dice el archivo y lo que hay en la base NO se notaría hasta
 * crear la segunda empresa, y para entonces sería un cliente con un esquema
 * distinto al de todos los demás.
 *
 * Esto lo detecta antes: crea un esquema desechable, le aplica la plantilla y
 * compara columna por columna y restricción por restricción contra el real.
 *
 * Uso:  node db/verificar-plantilla.mjs [esquema-real]     (por defecto: asistencia)
 *
 * No modifica nada: el esquema de prueba se elimina siempre, incluso si falla.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import pg from 'pg';

const dir = path.dirname(fileURLToPath(import.meta.url));

if (!process.env.DATABASE_URL) {
  try {
    const env = readFileSync(path.join(dir, '..', '.env.local'), 'utf8');
    for (const line of env.split('\n')) {
      const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  } catch { /* sin .env.local */ }
}
if (!process.env.DATABASE_URL) {
  console.error('Falta DATABASE_URL.');
  process.exit(1);
}

const REAL = process.argv[2] ?? 'asistencia';
const PRUEBA = '_verif_plantilla';

// Tablas que la plantilla de empresa NO crea porque se mudaron a `control`,
// más el registro de migraciones, que lo crea el corredor.
const FUERA = new Set(['user', 'session', 'account', 'verification', 'dispositivos', '_migraciones']);

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const c = await pool.connect();

const columnas = async (esq) => (await c.query(
  `select table_name, column_name, data_type, udt_name,
          coalesce(numeric_precision::text, '') || '/' || coalesce(numeric_scale::text, '') as num,
          is_nullable, coalesce(column_default, '') as def
     from information_schema.columns
    where table_schema = $1
    order by table_name, column_name`, [esq],
)).rows;

const restricciones = async (esq) => (await c.query(
  `select conrelid::regclass::text as tabla, contype, pg_get_constraintdef(oid) as def
     from pg_constraint where connamespace = $1::regnamespace
    order by 1, 2, 3`, [esq],
)).rows;

const indices = async (esq) => (await c.query(
  `select tablename, indexdef from pg_indexes where schemaname = $1 order by 1, 2`, [esq],
)).rows;

/** Quita el nombre del esquema para poder comparar dos esquemas distintos. */
const limpiar = (s, esq) =>
  s.replaceAll(`${esq}.`, '').replaceAll(`"${esq}".`, '');

let fallos = 0;
const fallo = (msg) => { fallos++; console.log(`  ✗ ${msg}`); };

try {
  await c.query(`drop schema if exists ${PRUEBA} cascade`);
  await c.query(`create schema ${PRUEBA}`);

  // Aplicar la plantilla al esquema desechable, igual que lo haría migrate.mjs.
  const carpeta = path.join(dir, 'migrations', 'empresa');
  const archivos = readdirSync(carpeta).filter((f) => f.endsWith('.sql')).sort();
  for (const f of archivos) {
    await c.query('begin');
    await c.query(`set local search_path to ${PRUEBA}`);
    await c.query(readFileSync(path.join(carpeta, f), 'utf8'));
    await c.query('commit');
  }
  console.log(`Plantilla aplicada (${archivos.join(', ')}). Comparando contra "${REAL}"…\n`);

  // ── Columnas ──────────────────────────────────────────────────────
  const colReal = (await columnas(REAL)).filter((r) => !FUERA.has(r.table_name));
  const colPrueba = await columnas(PRUEBA);
  const clave = (r) => `${r.table_name}.${r.column_name}`;
  const mapaPrueba = new Map(colPrueba.map((r) => [clave(r), r]));
  const mapaReal = new Map(colReal.map((r) => [clave(r), r]));

  for (const r of colReal) {
    const p = mapaPrueba.get(clave(r));
    if (!p) { fallo(`falta en la plantilla: ${clave(r)}`); continue; }
    if (r.udt_name !== p.udt_name) fallo(`${clave(r)}: tipo ${r.udt_name} (real) ≠ ${p.udt_name} (plantilla)`);
    if (r.num !== p.num) fallo(`${clave(r)}: precisión ${r.num} (real) ≠ ${p.num} (plantilla)`);
    if (r.is_nullable !== p.is_nullable) fallo(`${clave(r)}: nulable ${r.is_nullable} ≠ ${p.is_nullable}`);
    if (r.def !== p.def) fallo(`${clave(r)}: default «${r.def}» ≠ «${p.def}»`);
  }
  for (const p of colPrueba) {
    if (!mapaReal.has(clave(p))) fallo(`sobra en la plantilla: ${clave(p)}`);
  }
  console.log(`Columnas comparadas: ${colReal.length}`);

  // ── Restricciones ─────────────────────────────────────────────────
  const norm = (rows, esq) => new Set(
    rows.filter((r) => !FUERA.has(limpiar(r.tabla, esq).replaceAll('"', '')))
        .map((r) => `${limpiar(r.tabla, esq)} ${limpiar(r.def, esq)}`),
  );
  const resReal = norm(await restricciones(REAL), REAL);
  const resPrueba = norm(await restricciones(PRUEBA), PRUEBA);
  for (const r of resReal) if (!resPrueba.has(r)) fallo(`falta restricción: ${r}`);
  for (const r of resPrueba) if (!resReal.has(r)) fallo(`sobra restricción: ${r}`);
  console.log(`Restricciones comparadas: ${resReal.size}`);

  // ── Índices ───────────────────────────────────────────────────────
  const idx = (rows, esq) => new Set(
    rows.filter((r) => !FUERA.has(r.tablename))
        .map((r) => limpiar(r.indexdef, esq).replace(/^CREATE (UNIQUE )?INDEX \w+ ON /, '$1ON ')),
  );
  const idxReal = idx(await indices(REAL), REAL);
  const idxPrueba = idx(await indices(PRUEBA), PRUEBA);
  for (const r of idxReal) if (!idxPrueba.has(r)) fallo(`falta índice: ${r}`);
  for (const r of idxPrueba) if (!idxReal.has(r)) fallo(`sobra índice: ${r}`);
  console.log(`Índices comparados: ${idxReal.size}`);

  console.log(
    fallos === 0
      ? '\n✅ La plantilla reproduce exactamente el esquema real.'
      : `\n❌ ${fallos} diferencia(s). Una empresa nueva NO quedaría igual que "${REAL}".`,
  );
  if (fallos > 0) process.exitCode = 1;
} finally {
  await c.query(`drop schema if exists ${PRUEBA} cascade`);
  c.release();
  await pool.end();
}
