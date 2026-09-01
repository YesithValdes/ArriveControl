/**
 * db/calibracion-v2.mjs — Calibra los umbrales del modelo facial v2 con las
 * mediciones REALES que el kiosco persiste en `intentos_kiosco` (migración 012).
 *
 * Lee similitudes de intentos ACEPTADOS (genuinos: la persona era quien dijo)
 * y las del SEGUNDO candidato de cada intento (el impostor más cercano en ese
 * momento), y propone V2_UMBRAL_SIM / V2_MARGEN_SIM con holgura entre ambas
 * distribuciones. Solo lectura; el ajuste se aplica a mano en utils/faceMath.js.
 *
 * Uso:
 *   node --env-file=.env.local db/calibracion-v2.mjs [--esquema=empresa_de_smartgadgets]
 *   (o con DATABASE_URL de producción en el entorno)
 */
import pg from 'pg'

const esquema = process.argv.find((a) => a.startsWith('--esquema='))?.split('=')[1] ?? 'empresa_de_smartgadgets'
if (!/^[a-z][a-z0-9_]{2,40}$/.test(esquema)) { console.error(`Esquema inválido: ${esquema}`); process.exit(1) }
if (!process.env.DATABASE_URL) { console.error('Falta DATABASE_URL.'); process.exit(1) }

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL })
const db = await pool.connect()

const pct = (arr, p) => {
  if (arr.length === 0) return null
  const s = [...arr].sort((a, b) => a - b)
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))]
}
const f = (x) => (x == null ? '—' : x.toFixed(3))

try {
  const { rows } = await db.query(`
    select aceptado, v2_mejor, v2_segundo, modo, creado_en
      from ${esquema}.intentos_kiosco
     where v2_mejor is not null
     order by creado_en`)
  if (rows.length === 0) {
    console.log('Aún no hay mediciones v2. Se acumulan solas con cada marcación (tras re-registrar rostros).')
    process.exit(0)
  }

  const genuinos = rows.filter((r) => r.aceptado).map((r) => r.v2_mejor)
  const impostores = rows.filter((r) => r.v2_segundo != null).map((r) => r.v2_segundo)
  const margenes = rows.filter((r) => r.aceptado && r.v2_segundo != null).map((r) => r.v2_mejor - r.v2_segundo)

  console.log(`Mediciones v2: ${rows.length} intentos (${genuinos.length} aceptados) · desde ${new Date(rows[0].creado_en).toISOString().slice(0, 10)}`)
  console.log(`\nGENUINOS (similitud del aceptado) — p5 ${f(pct(genuinos, 5))} · p25 ${f(pct(genuinos, 25))} · mediana ${f(pct(genuinos, 50))}`)
  console.log(`IMPOSTOR MÁS CERCANO (2º candidato) — mediana ${f(pct(impostores, 50))} · p95 ${f(pct(impostores, 95))} · máx ${f(pct(impostores, 100))}`)
  console.log(`MARGEN 1º−2º en aceptados — p5 ${f(pct(margenes, 5))} · mediana ${f(pct(margenes, 50))}`)

  // Propuesta: el umbral parte al p5 de genuinos y al p95 de impostores por
  // la mitad (con piso 0.30); el margen, la mitad del p5 de márgenes reales.
  const g5 = pct(genuinos, 5), i95 = pct(impostores, 95)
  if (g5 != null && i95 != null) {
    const umbral = Math.max(0.30, (g5 + i95) / 2)
    const holgura = g5 - i95
    console.log(`\nSeparación genuino(p5) − impostor(p95): ${f(holgura)} ${holgura > 0.15 ? '(sana)' : '(¡ESTRECHA! revisar fotos)'}`)
    console.log(`Sugerencia → V2_UMBRAL_SIM ≈ ${f(umbral)} · V2_MARGEN_SIM ≈ ${f(Math.max(0.05, (pct(margenes, 5) ?? 0.1) / 2))}`)
    console.log('(aplicar en utils/faceMath.js si difiere de lo actual: 0.35 / 0.08)')
  } else {
    console.log('\nFaltan datos de alguna de las dos poblaciones para sugerir umbrales.')
  }
} finally { db.release(); await pool.end() }
