/**
 * db/probar-aislamiento.mjs — La prueba de que el multi-empresa funciona.
 *
 * Crea una empresa de juguete, le mete datos, y comprueba que NO se ven desde
 * la otra. Sin esto, «cada empresa tiene su esquema» es una intención, no un
 * hecho comprobado.
 *
 * Al terminar borra la empresa de prueba, pase lo que pase.
 *
 * Uso:  node db/probar-aislamiento.mjs
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const dir = path.dirname(fileURLToPath(import.meta.url))
if (!process.env.DATABASE_URL) {
  try {
    const env = readFileSync(path.join(dir, '..', '.env.local'), 'utf8')
    for (const line of env.split('\n')) {
      const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/)
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '')
    }
  } catch { /* sin .env.local */ }
}
process.chdir(path.join(dir, '..'))   // crearEmpresa lee db/migrations/empresa

const { control, conEmpresa } = await import('../lib/db.js')
const { crearEmpresa, empresaPorApiKey, cabeOtroEmpleado } = await import('../lib/empresas.js')

let fallos = 0
const ok = (b, msg) => { console.log(`  ${b ? '✓' : '✗'} ${msg}`); if (!b) fallos++ }

let prueba = null
try {
  const { rows: [real] } = await control(
    `select id, nombre, esquema, api_key from control.empresas order by creada_en limit 1`,
  )
  console.log(`Empresa existente: ${real.nombre} (${real.esquema})\n`)

  // ── Los datos de siempre siguen ahí ─────────────────────────────────
  const conteo = await conEmpresa(real.esquema, async (db) => ({
    empleados: (await db.query(`select count(*)::int n from empleados`)).rows[0].n,
    marcaciones: (await db.query(`select count(*)::int n from marcaciones`)).rows[0].n,
    sedes: (await db.query(`select count(*)::int n from sedes`)).rows[0].n,
  }))
  console.log('Datos tras la migración')
  ok(conteo.marcaciones === 1151, `marcaciones: ${conteo.marcaciones} (esperadas 1151)`)
  ok(conteo.empleados === 14, `empleados: ${conteo.empleados} (esperados 14)`)
  ok(conteo.sedes === 3, `sedes: ${conteo.sedes} (esperadas 3)`)

  // ── Nace una segunda empresa ────────────────────────────────────────
  console.log('\nSegunda empresa')
  prueba = await crearEmpresa({ nombre: 'Panadería de Prueba' })
  ok(Boolean(prueba.esquema), `creada con esquema "${prueba.esquema}"`)
  ok(prueba.esquema !== real.esquema, 'su esquema es distinto al de la primera')
  ok(prueba.plan === 'gratis', `nace en plan ${prueba.plan}`)
  ok(prueba.limite_empleados === 10, `con tope de ${prueba.limite_empleados} empleados`)

  const suyo = await conEmpresa(prueba.esquema, async (db) => ({
    empleados: (await db.query(`select count(*)::int n from empleados`)).rows[0].n,
    config: (await db.query(`select count(*)::int n from config_laboral`)).rows[0].n,
  }))
  ok(suyo.empleados === 0, 'nace sin empleados')
  ok(suyo.config === 1, 'nace con su fila de configuración laboral')

  // ── EL AISLAMIENTO ──────────────────────────────────────────────────
  console.log('\nAislamiento')
  await conEmpresa(prueba.esquema, (db) => db.query(
    `insert into sedes (nombre, lat, lon) values ('Sede de juguete', 1, 1)`,
  ))
  const sedesPrueba = await conEmpresa(prueba.esquema, async (db) =>
    (await db.query(`select nombre from sedes`)).rows.map((r) => r.nombre))
  const sedesReal = await conEmpresa(real.esquema, async (db) =>
    (await db.query(`select nombre from sedes`)).rows.map((r) => r.nombre))

  ok(sedesPrueba.includes('Sede de juguete'), 'la sede nueva se ve en SU empresa')
  ok(!sedesReal.includes('Sede de juguete'), 'la sede nueva NO se ve en la otra empresa')
  ok(sedesReal.length === 3, `la otra empresa conserva sus ${sedesReal.length} sedes`)

  // La cédula puede repetirse entre empresas: es única DENTRO de cada una.
  const cedulaReal = await conEmpresa(real.esquema, async (db) =>
    (await db.query(`select cedula from empleados where cedula is not null limit 1`)).rows[0]?.cedula)
  if (cedulaReal) {
    await conEmpresa(prueba.esquema, (db) => db.query(
      `insert into empleados (nombre, cedula) values ('Homónimo', $1)`, [cedulaReal],
    ))
    ok(true, `la misma cédula (${cedulaReal}) existe en las dos empresas sin chocar`)
  }

  // ── El candado del esquema ──────────────────────────────────────────
  console.log('\nValidación del nombre de esquema')
  let rechazado = false
  try {
    await conEmpresa('publico; drop schema control cascade; --', (db) => db.query('select 1'))
  } catch { rechazado = true }
  ok(rechazado, 'un nombre de esquema con SQL inyectado se rechaza')

  // ── El tope del plan gratuito ───────────────────────────────────────
  console.log('\nTope del plan gratuito')
  const cupo = await cabeOtroEmpleado(prueba)
  ok(cupo.cabe, `con ${cupo.actuales} de ${cupo.limite} empleados, cabe otro`)
  await conEmpresa(prueba.esquema, (db) => db.query(
    `insert into empleados (nombre, cedula)
     select 'Relleno ' || g, '900' || g from generate_series(1, 10) g`,
  ))
  const lleno = await cabeOtroEmpleado(prueba)
  ok(!lleno.cabe, `con ${lleno.actuales} de ${lleno.limite}, ya NO cabe otro`)

  // ── La clave de API es por empresa ──────────────────────────────────
  console.log('\nClave de API')
  const porClave = await empresaPorApiKey(real.api_key)
  ok(porClave?.esquema === real.esquema, 'la clave de una empresa resuelve a SU esquema')
  const inventada = await empresaPorApiKey('clave-que-nadie-tiene')
  ok(inventada === null, 'una clave inventada no resuelve a ninguna empresa')

  console.log(fallos === 0 ? '\n✅ Aislamiento correcto.' : `\n❌ ${fallos} fallo(s).`)
  if (fallos > 0) process.exitCode = 1
} finally {
  if (prueba) {
    await control(`drop schema if exists ${prueba.esquema} cascade`)
    await control(`delete from control.empresas where id = $1`, [prueba.id])
    console.log(`\n(empresa de prueba "${prueba.esquema}" eliminada)`)
  }
  process.exit(process.exitCode ?? 0)
}
