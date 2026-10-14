/**
 * db/llaves.mjs — Operación de las llaves de cifrado (lib/llaves.js).
 *
 *   node db/llaves.mjs nueva-maestra
 *       Imprime una llave maestra nueva (32 bytes en base64). No toca ninguna
 *       base. Va a ARRIVE_LLAVE_MAESTRA del servidor — y a un lugar seguro
 *       fuera de él: sin ella (ni las llaves de recuperación de cada empresa)
 *       los datos cifrados no se pueden abrir.
 *
 *   node db/llaves.mjs estado
 *       Qué empresas tienen DEK, con qué maestra y si tienen recuperación.
 *
 *   node db/llaves.mjs provisionar
 *       Crea la DEK de toda empresa que no tenga (las que existían antes del
 *       cifrado). Idempotente.
 *
 *   node db/llaves.mjs rotar-maestra
 *       Re-envuelve con la maestra VIGENTE las DEK envueltas con la ANTERIOR
 *       (ARRIVE_LLAVE_MAESTRA_ANTERIOR + _ID). No toca datos de empresas.
 *
 * DATABASE_URL y las ARRIVE_LLAVE_* se leen del entorno o de .env.local.
 * Contra una base que NO es local, todo lo que escribe exige --produccion.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { randomBytes } from 'node:crypto'

const [orden, ...resto] = process.argv.slice(2)

if (orden === 'nueva-maestra') {
  console.log(randomBytes(32).toString('base64'))
  process.exit(0)
}

const dir = path.dirname(fileURLToPath(import.meta.url))
try {
  for (const linea of readFileSync(path.join(dir, '..', '.env.local'), 'utf8').split('\n')) {
    const m = linea.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/)
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '')
  }
} catch { /* sin .env.local: se exige el entorno */ }

if (!process.env.DATABASE_URL) {
  console.error('Falta DATABASE_URL.')
  process.exit(1)
}

const ORDENES = ['estado', 'provisionar', 'rotar-maestra']
if (!ORDENES.includes(orden)) {
  console.error(`Uso: node db/llaves.mjs <nueva-maestra|${ORDENES.join('|')}> [--produccion]`)
  process.exit(1)
}

const esLocal = /@(localhost|127\.0\.0\.1)(:\d+)?\//.test(process.env.DATABASE_URL)
if (!esLocal && orden !== 'estado' && !resto.includes('--produccion')) {
  console.error('DATABASE_URL no es una base local. Si de verdad es lo que quieres, repite con --produccion.')
  process.exit(1)
}

// Importación DIFERIDA: lib/db.js lee DATABASE_URL al cargarse, y aquí ya está
// definida.
const { control } = await import('../lib/db.js')
const llaves = await import('../lib/llaves.js')

try {
  if (orden === 'estado') {
    const { rows } = await control(
      `select e.nombre, e.esquema, l.version, l.maestra_id, l.dek_recuperacion is not null as con_recuperacion
         from control.empresas e
         left join control.empresa_llaves l on l.empresa_id = e.id and l.estado = 'activa'
        order by e.creada_en`,
    )
    console.log(`Cifrado configurado en este entorno: ${llaves.cifradoConfigurado() ? 'sí' : 'NO (falta ARRIVE_LLAVE_MAESTRA)'}`)
    for (const r of rows) {
      const dek = r.version ? `DEK v${r.version} (maestra ${r.maestra_id})` : 'SIN DEK'
      console.log(`  ${r.esquema.padEnd(30)} ${dek.padEnd(28)} recuperación: ${r.con_recuperacion ? 'sí' : 'no'}`)
    }
    if (rows.length === 0) console.log('  (sin empresas)')
  }

  if (orden === 'provisionar') {
    const { rows } = await control(
      `select e.id, e.esquema from control.empresas e
        where not exists (select 1 from control.empresa_llaves l where l.empresa_id = e.id and l.estado = 'activa')
        order by e.creada_en`,
    )
    for (const e of rows) {
      await llaves.asegurarLlave(e)
      console.log(`  + ${e.esquema}: DEK creada`)
    }
    console.log(rows.length ? `${rows.length} empresa(s) con DEK nueva.` : 'Todas las empresas ya tenían DEK.')
  }

  if (orden === 'rotar-maestra') {
    const r = await llaves.reenvolverConMaestraVigente()
    console.log(`${r.reenvueltas} DEK(s) re-envueltas con la maestra vigente.`)
    if (r.sinMaestra.length) {
      console.error(`Sin la maestra con que estaban envueltas (configura la ANTERIOR o usa la recuperación): ${r.sinMaestra.join(', ')}`)
      process.exitCode = 1
    }
  }
} catch (e) {
  console.error('Error:', e.message)
  process.exitCode = 1
}
process.exit()
