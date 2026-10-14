/**
 * db/seed-anomalias.mjs — Datos de PRUEBA para las anomalías «Salida tardía»
 * y «Descanso excedido».
 *
 * NO borra nada de la empresa: agrega empleados cuyo nombre empieza por
 * «PRUEBA » (horario Lun–Sáb 08:00–17:00, almuerzo 12:00–13:00) con
 * marcaciones de días YA TERMINADOS dentro de los últimos 7 (lo que mira la
 * bandeja). Hay casos que deben aparecer y casos que NO, para comprobar las
 * tolerancias. Correrlo otra vez reemplaza solo esos empleados.
 *
 * Solo contra una base LOCAL.
 *
 * Uso:
 *   node --env-file=.env.local db/seed-anomalias.mjs [--esquema=x]
 *   node --env-file=.env.local db/seed-anomalias.mjs --borrar     (quita los PRUEBA)
 */
import pg from 'pg'

const args = process.argv.slice(2)
const arg = (nombre) => args.find((a) => a.startsWith(`--${nombre}=`))?.split('=')[1]
const borrar = args.includes('--borrar')
let esquema = arg('esquema') ?? null

if (!process.env.DATABASE_URL) {
  console.error('Falta DATABASE_URL (usa node --env-file=.env.local).')
  process.exit(1)
}
if (!/@(localhost|127\.0\.0\.1)(:\d+)?\//.test(process.env.DATABASE_URL)) {
  console.error('Datos de prueba solo en una base local: DATABASE_URL no apunta a localhost.')
  process.exit(1)
}

const PREFIJO = 'PRUEBA '
const FRANJA = { entrada: '08:00', salida: '17:00', almuerzo_min: 60, almuerzo_desde: '12:00', almuerzo_hasta: '13:00' }
const JORNADA = Object.fromEntries([1, 2, 3, 4, 5, 6].map((d) => [String(d), FRANJA]))

// Cada caso: marcaciones de UN día [tipo, 'HH:MM:SS'] y lo que se espera ver.
// Con la configuración de fábrica: tolerancia de salida 15 min, descanso
// 60 min + 10 de tolerancia.
const CASOS = [
  { nombre: 'SALIDA TARDIA', espera: 'Salida tardía (1 h 30 después)',
    marcas: [['entrada', '07:58:12'], ['salida', '12:01:40'], ['entrada', '12:58:05'], ['salida', '18:30:22']] },
  { nombre: 'SALIDA EN TOLERANCIA', espera: 'nada (salió 10 min tarde, dentro de 15)',
    marcas: [['entrada', '08:02:00'], ['salida', '12:00:30'], ['entrada', '12:59:10'], ['salida', '17:10:00']] },
  { nombre: 'DESCANSO EXCEDIDO', espera: 'Descanso excedido (100 min de 60)',
    marcas: [['entrada', '07:55:00'], ['salida', '12:00:00'], ['entrada', '13:40:00'], ['salida', '17:02:00']] },
  { nombre: 'DESCANSO EN TOLERANCIA', espera: 'nada (68 min, dentro de 60 + 10)',
    marcas: [['entrada', '08:00:00'], ['salida', '12:00:00'], ['entrada', '13:08:00'], ['salida', '17:00:30']] },
  { nombre: 'AMBAS', espera: 'Descanso excedido (85 min) y Salida tardía (1 h)',
    marcas: [['entrada', '08:01:00'], ['salida', '12:05:00'], ['entrada', '13:30:00'], ['salida', '18:00:00']] },
  { nombre: 'SALIDA ANTICIPADA', espera: 'nada (irse antes no es anomalía)',
    marcas: [['entrada', '08:00:00'], ['salida', '12:00:00'], ['entrada', '13:00:00'], ['salida', '15:30:00']] },
]

/** Día YYYY-MM-DD en Bogotá, `n` días antes de hoy. */
const diaBogota = (n) => new Date(Date.now() - 5 * 3600000 - n * 86400000).toISOString().slice(0, 10)
const esDomingo = (f) => new Date(`${f}T12:00:00Z`).getUTCDay() === 0

/** Días laborables ya terminados (ayer hacia atrás), sin domingos, dentro de 6 días. */
const diasLaborables = []
for (let n = 1; n <= 6 && diasLaborables.length < 5; n++) {
  const f = diaBogota(n)
  if (!esDomingo(f)) diasLaborables.push(f)
}

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL })
const db = await pool.connect()

try {
  const { rows: empresas } = await db.query(`select nombre, esquema from control.empresas order by creada_en`)
  if (!esquema) {
    if (empresas.length !== 1) {
      console.error(`Hay ${empresas.length} empresas; di cuál con --esquema=: ${empresas.map((e) => e.esquema).join(', ')}`)
      process.exit(1)
    }
    esquema = empresas[0].esquema
  }
  if (!/^[a-z][a-z0-9_]{2,40}$/.test(esquema) || !empresas.some((e) => e.esquema === esquema)) {
    console.error(`No hay ninguna empresa con el esquema "${esquema}".`)
    process.exit(1)
  }
  await db.query(`set search_path to ${esquema}`)
  console.log(`Empresa: ${empresas.find((e) => e.esquema === esquema).nombre} (${esquema})`)

  await db.query('begin')

  // Quita SOLO los empleados de prueba anteriores y lo que cuelga de ellos.
  const viejos = (await db.query(`select id from empleados where nombre like $1`, [`${PREFIJO}%`])).rows.map((r) => r.id)
  if (viejos.length) {
    // Todas las tablas del esquema que cuelgan del empleado, menos marcaciones
    // (va al final: de ella cuelgan las correcciones).
    const { rows: tablas } = await db.query(
      `select table_name from information_schema.columns
        where table_schema = $1 and column_name = 'empleado_id' and table_name <> 'marcaciones'`,
      [esquema],
    )
    if ((await db.query(`select 1 from information_schema.columns where table_schema = $1 and table_name = 'correcciones' and column_name = 'marcacion_id'`, [esquema])).rowCount) {
      await db.query(`delete from correcciones where marcacion_id in (select id from marcaciones where empleado_id = any($1))`, [viejos])
    }
    for (const { table_name: t } of tablas) {
      await db.query(`delete from ${t} where empleado_id = any($1)`, [viejos])
    }
    await db.query(`delete from marcaciones where empleado_id = any($1)`, [viejos])
    await db.query(`delete from empleados where id = any($1)`, [viejos])
  }

  if (borrar) {
    await db.query('commit')
    console.log(`Borrados ${viejos.length} empleados de prueba.`)
  } else {
    const filas = []
    for (const [i, c] of CASOS.entries()) {
      const fecha = diasLaborables[i % diasLaborables.length]
      const { rows } = await db.query(
        `insert into empleados (nombre, cedula, entrada_esperada, salida_esperada, almuerzo_min, jornada_dias, activo)
         values ($1, $2, '08:00', '17:00', 60, $3, true) returning id`,
        [`${PREFIJO}${c.nombre}`, `9900000${String(i + 1).padStart(3, '0')}`, JSON.stringify(JORNADA)],
      )
      for (const [tipo, hora] of c.marcas) {
        await db.query(
          `insert into marcaciones (empleado_id, tipo, ts, origen) values ($1, $2, $3, 'kiosco')`,
          [rows[0].id, tipo, `${fecha}T${hora}-05:00`],
        )
      }
      filas.push({ empleado: `${PREFIJO}${c.nombre}`, dia: fecha, 'debe verse': c.espera })
    }
    await db.query('commit')
    console.table(filas)
    console.log('Recarga el panel → Anomalías. Para quitarlos: --borrar')
  }
} catch (e) {
  await db.query('rollback').catch(() => {})
  console.error('Falló:', e.message)
  process.exitCode = 1
} finally {
  db.release()
  await pool.end()
}
