/**
 * scripts/migrar-empresas.mjs — Aplica las migraciones PENDIENTES de
 * db/migrations/empresa/ a TODAS las empresas existentes.
 *
 * Las migraciones corren completas solo al CREAR una empresa (lib/empresas.js);
 * este script es el complemento para los esquemas que ya existían cuando se
 * agregó un .sql nuevo. Es idempotente: usa la tabla _migraciones de cada
 * esquema y solo corre lo que falte.
 *
 * Uso (desde attendance-prototype):
 *   node scripts/migrar-empresas.mjs                # usa .env.production
 *   node scripts/migrar-empresas.mjs .env.local     # o el archivo que digas
 */
import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import pg from 'pg'

const raiz = process.cwd()
const archivoEnv = process.argv[2] || '.env.production'

// Lector de .env mínimo: sin dependencia de dotenv.
for (const linea of readFileSync(path.join(raiz, archivoEnv), 'utf8').split('\n')) {
  const m = linea.match(/^\s*([A-Z0-9_]+)\s*=\s*"?([^"#]*)"?\s*$/)
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim()
}
if (!process.env.DATABASE_URL) {
  console.error(`No hay DATABASE_URL en ${archivoEnv}.`)
  process.exit(1)
}

const esLocal = /localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL)
const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: esLocal ? false : { rejectUnauthorized: false },
})

const dir = path.join(raiz, 'db', 'migrations', 'empresa')
const archivos = readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()

const db = await pool.connect()
try {
  const { rows: empresas } = await db.query('select nombre, esquema from control.empresas order by esquema')
  console.log(`${empresas.length} empresa(s); ${archivos.length} migración(es) en disco.`)

  for (const { nombre, esquema } of empresas) {
    if (!/^[a-z][a-z0-9_]{2,40}$/.test(esquema)) { console.warn(`  ${esquema}: nombre raro, saltada`); continue }
    await db.query('begin')
    try {
      await db.query(`create table if not exists ${esquema}._migraciones (
        archivo text primary key, aplicada_en timestamptz not null default now())`)
      const { rows } = await db.query(`select archivo from ${esquema}._migraciones`)
      const hechas = new Set(rows.map((r) => r.archivo))
      let aplicadas = 0
      for (const archivo of archivos) {
        if (hechas.has(archivo)) continue
        await db.query(`set local search_path to ${esquema}`)
        await db.query(readFileSync(path.join(dir, archivo), 'utf8'))
        await db.query(`insert into ${esquema}._migraciones (archivo) values ($1)`, [archivo])
        aplicadas += 1
        console.log(`  ${esquema} ← ${archivo}`)
      }
      await db.query('commit')
      if (aplicadas === 0) console.log(`  ${esquema} (${nombre}): al día`)
    } catch (e) {
      await db.query('rollback')
      console.error(`  ${esquema}: ERROR — ${e.message} (rollback; las demás siguen)`)
    }
  }
} finally {
  db.release()
  await pool.end()
}
