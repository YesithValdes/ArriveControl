/**
 * db/marcaciones-hoy.mjs — Marcaciones de HOY para probar el panel en local.
 *
 * Complemento de seed-demo.mjs (que genera historia hacia atrás): esto pinta el
 * día actual con una mezcla realista — gente trabajando (entrada sin salida),
 * gente que ya terminó, un llegado tarde y algunos que aún no marcan.
 *
 * Uso:
 *   node --env-file=.env.local db/marcaciones-hoy.mjs [--esquema=smartgadgets] [--reset-hoy]
 *
 * --reset-hoy borra SOLO las marcaciones de hoy antes de insertar (re-ejecutable).
 */
import pg from 'pg'

const args = process.argv.slice(2)
const esquema = args.find((a) => a.startsWith('--esquema='))?.split('=')[1] ?? 'smartgadgets'
const resetHoy = args.includes('--reset-hoy')

if (!/^[a-z][a-z0-9_]{2,40}$/.test(esquema)) {
  console.error(`Esquema inválido: "${esquema}"`)
  process.exit(1)
}
if (!process.env.DATABASE_URL) {
  console.error('Falta DATABASE_URL (usa node --env-file=.env.local).')
  process.exit(1)
}

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL })
const db = await pool.connect()

/** Fecha de hoy a una hora local dada ("08:03"). */
const hoyA = (hhmm, seg = 0) => {
  const [h, m] = hhmm.split(':').map(Number)
  const d = new Date()
  d.setHours(h, m, seg, 0)
  return d
}

try {
  await db.query('begin')
  await db.query(`set local search_path to ${esquema}`)

  if (resetHoy) {
    const r = await db.query(`delete from marcaciones where ts::date = current_date`)
    console.log(`Borradas ${r.rowCount} marcaciones de hoy.`)
  }

  const { rows: emps } = await db.query(
    `select id, nombre, sede_id, entrada_esperada from empleados where activo order by nombre`,
  )
  if (emps.length === 0) {
    throw new Error(`No hay empleados activos en ${esquema}. Corre antes db/seed-demo.mjs.`)
  }

  const marcar = async (e, tipo, hhmm) => {
    await db.query(
      `insert into marcaciones (empleado_id, tipo, ts, sede_id, origen)
       values ($1, $2, $3, $4, 'kiosco')`,
      [e.id, tipo, hoyA(hhmm, Math.floor(Math.random() * 60)), e.sede_id],
    )
    console.log(`  ${e.nombre}: ${tipo} ${hhmm}`)
  }

  // Mezcla: los primeros 5 están TRABAJANDO (solo entrada, uno tarde);
  // los 3 siguientes ya TERMINARON (entrada y salida, saldos variados);
  // el resto queda SIN MARCACIÓN (no deben aparecer en la tabla).
  const trabajando = emps.slice(0, 5)
  const terminaron = emps.slice(5, 8)

  console.log('Trabajando ahora:')
  const horasEntrada = ['07:02', '07:31', '08:00', '08:05', '09:47'] // el último, tarde
  for (let i = 0; i < trabajando.length; i++) {
    await marcar(trabajando[i], 'entrada', horasEntrada[i])
  }

  console.log('Jornada terminada:')
  const turnos = [['06:58', '16:02'], ['08:01', '17:21'], ['08:04', '14:20']] // el último salió temprano
  for (let i = 0; i < terminaron.length; i++) {
    await marcar(terminaron[i], 'entrada', turnos[i][0])
    await marcar(terminaron[i], 'salida', turnos[i][1])
  }

  await db.query('commit')
  console.log(`\nListo: ${trabajando.length} trabajando, ${terminaron.length} con jornada cerrada, ` +
    `${emps.length - trabajando.length - terminaron.length} sin marcación (no deben salir en la tabla).`)
} catch (e) {
  await db.query('rollback').catch(() => {})
  console.error('Falló:', e.message)
  process.exitCode = 1
} finally {
  db.release()
  await pool.end()
}
