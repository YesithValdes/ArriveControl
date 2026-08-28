/**
 * scripts/migrar.mjs — Aplica las migraciones PENDIENTES a una base.
 *
 * Cubre las dos mitades del esquema:
 *   · db/migrations/control/  → una sola vez, en el esquema `control`.
 *   · db/migrations/empresa/  → a CADA empresa registrada.
 *
 * Antes solo existía el runner de empresas y las de `control` se aplicaban a
 * mano; así fue como una migración quedó sin aplicar en producción y el canje
 * de códigos habría reventado. Idempotente: usa una tabla `_migraciones` por
 * esquema y solo corre lo que falte.
 *
 * Uso (desde attendance-prototype):
 *   node scripts/migrar.mjs                # usa .env.production
 *   node scripts/migrar.mjs .env.local     # o el archivo que digas
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

const sqlDe = (carpeta) => {
  const dir = path.join(raiz, 'db', 'migrations', carpeta)
  return readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()
    .map((archivo) => ({ archivo, sql: readFileSync(path.join(dir, archivo), 'utf8') }))
}

/**
 * Corre las migraciones que le falten a un esquema. Cada una va en su propia
 * transacción: si la quinta falla, las cuatro anteriores quedan aplicadas y
 * registradas, y al reintentar se retoma justo ahí.
 */
async function migrar(db, esquema, migraciones, { fijarSearchPath }) {
  await db.query(`create table if not exists ${esquema}._migraciones (
    archivo text primary key, aplicada_en timestamptz not null default now())`)
  const { rows } = await db.query(`select archivo from ${esquema}._migraciones`)
  const hechas = new Set(rows.map((r) => r.archivo))
  let aplicadas = 0
  for (const m of migraciones) {
    if (hechas.has(m.archivo)) continue
    await db.query('begin')
    try {
      // Las de empresa van sin prefijo de esquema: se lo fija el search_path.
      // Las de control lo escriben ellas mismas, así que no se toca.
      if (fijarSearchPath) await db.query(`set local search_path to ${esquema}`)
      await db.query(m.sql)
      await db.query(`insert into ${esquema}._migraciones (archivo) values ($1)`, [m.archivo])
      await db.query('commit')
      aplicadas += 1
      console.log(`  ${esquema} ← ${m.archivo}`)
    } catch (e) {
      await db.query('rollback')
      throw new Error(`${m.archivo}: ${e.message}`)
    }
  }
  return aplicadas
}

const db = await pool.connect()
let fallos = 0
try {
  const deControl = sqlDe('control')
  const deEmpresa = sqlDe('empresa')
  console.log(`${archivoEnv} · ${deControl.length} migración(es) de control, ${deEmpresa.length} de empresa.`)

  // ── control ──────────────────────────────────────────────────────────
  try {
    const n = await migrar(db, 'control', deControl, { fijarSearchPath: false })
    if (n === 0) console.log('  control: al día')
  } catch (e) {
    console.error(`  control: ERROR — ${e.message}`)
    fallos += 1
  }

  // ── cada empresa ─────────────────────────────────────────────────────
  const { rows: empresas } = await db.query('select nombre, esquema from control.empresas order by esquema')
  console.log(`${empresas.length} empresa(s).`)
  for (const { nombre, esquema } of empresas) {
    if (!/^[a-z][a-z0-9_]{2,40}$/.test(esquema)) { console.warn(`  ${esquema}: nombre raro, saltada`); continue }
    try {
      const n = await migrar(db, esquema, deEmpresa, { fijarSearchPath: true })
      if (n === 0) console.log(`  ${esquema} (${nombre}): al día`)
    } catch (e) {
      // Una empresa que falla no detiene a las demás.
      console.error(`  ${esquema}: ERROR — ${e.message}`)
      fallos += 1
    }
  }
} finally {
  db.release()
  await pool.end()
}
process.exit(fallos > 0 ? 1 : 0)
