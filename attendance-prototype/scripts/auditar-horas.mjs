/**
 * scripts/auditar-horas.mjs — Cuánto trabajó cada quien en una semana. SOLO LEE.
 *
 * Saca de la base las marcaciones de una semana y las pasa por el MISMO motor
 * con el que se liquida la nómina (lib/calculoHoras.js), para revisar a ojo,
 * día por día: qué pares entrada→salida armó, cuántas horas suman y cuánto
 * sale como extra de cada tipo al cerrar la semana. Si aquí cuadra, la nómina
 * cuadra: no hay una segunda copia del cálculo.
 *
 * Uso (desde attendance-prototype):
 *   node scripts/auditar-horas.mjs                        última semana completa (lun–dom)
 *   node scripts/auditar-horas.mjs --semana 2026-09-07    la semana que contiene ese día
 *   node scripts/auditar-horas.mjs --empleado camila      filtra por nombre o cédula
 *   node scripts/auditar-horas.mjs --empresa empresa_de_gem_ai
 *   node scripts/auditar-horas.mjs --resumen              solo la tabla por persona
 *   node scripts/auditar-horas.mjs --env local            contra .env.local (por defecto, producción)
 *
 * GARANTÍA DE SOLO LECTURA. No basta con «solo hace select»: la conexión se
 * abre con `default_transaction_read_only = on`, así que si algo —propio o de
 * una librería— intentara escribir, Postgres lo rechaza. El pooler de Supabase
 * ignora ese ajuste como parámetro de arranque, por eso se fija con un SET
 * apenas conecta; y se le presta la conexión a lib/db.js por la misma costura
 * que usa el hot-reload (`globalThis.__arriveControlPool`), sin tocarlo.
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import pg from 'pg'

// ── Argumentos ──────────────────────────────────────────────────────────────
const arg = (nombre) => {
  const i = process.argv.indexOf(`--${nombre}`)
  return i === -1 ? null : (process.argv[i + 1] ?? true)
}
const ENV = arg('env') === 'local' ? '.env.local' : '.env.production'
const SOLO_RESUMEN = process.argv.includes('--resumen')
const FILTRO_EMPRESA = arg('empresa')
const FILTRO_EMPLEADO = arg('empleado')?.toString().toLowerCase() ?? null

for (const linea of readFileSync(path.join(process.cwd(), ENV), 'utf8').split('\n')) {
  const m = linea.match(/^\s*([A-Z0-9_]+)\s*=\s*"?([^"#]*)"?\s*$/)
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim()
}
if (!process.env.DATABASE_URL) { console.error(`Falta DATABASE_URL en ${ENV}`); process.exit(1) }

// ── Semana ──────────────────────────────────────────────────────────────────
const hoyBogota = () => new Date(Date.now() - 5 * 3600000).toISOString().slice(0, 10)
const sumarDias = (iso, n) => new Date(Date.parse(`${iso}T12:00:00Z`) + n * 86400000).toISOString().slice(0, 10)
const dowDe = (iso) => new Date(`${iso}T12:00:00Z`).getUTCDay()
const lunesDe = (iso) => sumarDias(iso, -((dowDe(iso) + 6) % 7))

let lunes
if (arg('semana')) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(arg('semana'))) { console.error('--semana debe ser YYYY-MM-DD'); process.exit(1) }
  lunes = lunesDe(arg('semana'))
} else {
  // La última COMPLETA: la que terminó el domingo pasado.
  lunes = sumarDias(lunesDe(hoyBogota()), -7)
}
const domingo = sumarDias(lunes, 6)
const HOY = hoyBogota()

// ── Conexión de SOLO LECTURA, prestada a lib/db.js ──────────────────────────
const esLocal = /localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL)
const cliente = new pg.Client({
  connectionString: process.env.DATABASE_URL,
  ssl: esLocal ? false : { rejectUnauthorized: false },
})
await cliente.connect()
await cliente.query('set default_transaction_read_only = on')
if ((await cliente.query('show default_transaction_read_only')).rows[0].default_transaction_read_only !== 'on') {
  console.error('No se pudo poner la sesión en solo lectura; no sigo.')
  process.exit(1)
}
// Un solo cliente hace de «pool»: el script es secuencial, así que basta.
globalThis.__arriveControlPool = {
  connect: async () => ({ query: (...a) => cliente.query(...a), release: () => {} }),
  query: (...a) => cliente.query(...a),
}

// Importar DESPUÉS de prestar la conexión: db.js la toma al cargarse.
const { control } = await import('../lib/db.js')
const { construirLote } = await import('../lib/nomina.js')
const { configLaboral } = await import('../lib/configLaboral.js')
const { emparejarMarcas, horasDeHorario } = await import('../lib/calculoHoras.js')
const { CODIGOS_HORA } = await import('../lib/tiposHora.js')
const { hhmmss, horasCortas } = await import('../lib/resumenDiario.js')
const { resumenSemana } = await import('../lib/semanaLaboral.js')

// ── Formato ─────────────────────────────────────────────────────────────────
const DIAS = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb']
const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic']
const fechaCorta = (iso) => `${DIAS[dowDe(iso)]} ${Number(iso.slice(8, 10))} ${MESES[Number(iso.slice(5, 7)) - 1]}`
const hora = (min) => hhmmss(((min % 1440) + 1440) % 1440 * 60) // minutos del día → H:MM:SS
const hm = (h) => horasCortas(h * 3600)
const hmCero = (h) => (h > 1 / 3600 ? hm(h) : '—')
const ancho = (s, n) => String(s).padEnd(n)
const der = (s, n) => String(s).padStart(n)

console.log(`\nSemana del ${fechaCorta(lunes)} al ${fechaCorta(domingo)} (${lunes} → ${domingo})`)
console.log(`Base: ${new URL(process.env.DATABASE_URL).hostname} · ${ENV} · solo lectura`)
if (domingo >= HOY) console.log(`⚠ La semana NO ha terminado: el día de hoy (${HOY}) queda abierto y no se cierra por horario.`)

// ── Empresas ────────────────────────────────────────────────────────────────
const { rows: empresas } = await control(
  `select esquema, nombre from control.empresas order by creada_en`,
)
const resumenGlobal = []

for (const empresa of empresas) {
  if (FILTRO_EMPRESA && empresa.esquema !== FILTRO_EMPRESA) continue

  const cfg = await configLaboral(empresa.esquema)
  const { registros, porEmpleado } = await construirLote(empresa.esquema, { desde: lunes, hasta: domingo })
  if (porEmpleado.size === 0) continue

  console.log(`\n${'═'.repeat(100)}\n${empresa.nombre}  (${empresa.esquema}) · jornada de la empresa: ${cfg.vigencias[0].horasSemana} h/semana = ${hm(cfg.vigencias[0].horasDia)}/día`)

  const extrasDe = new Map() // empleadoId → registros
  for (const r of registros) {
    if (!extrasDe.has(r._empleadoId)) extrasDe.set(r._empleadoId, [])
    extrasDe.get(r._empleadoId).push(r)
  }

  const empleados = [...porEmpleado.entries()].sort((a, b) => a[1].nombre.localeCompare(b[1].nombre))
  for (const [id, e] of empleados) {
    if (FILTRO_EMPLEADO && !e.nombre.toLowerCase().includes(FILTRO_EMPLEADO) && !String(e.cedula).includes(FILTRO_EMPLEADO)) continue

    const pares = emparejarMarcas(e, { festivos: cfg.festivos, hoy: HOY })
    const extras = extrasDe.get(id) ?? []

    // Qué marcaciones quedaron dentro de un par, para señalar las que no.
    const usadas = new Set()
    for (const p of pares) {
      const ent = e.marcas.find((m) => m.tipo === 'entrada' && m.fecha === p.fecha && Math.abs(m.minutos - p.desde) < 1e-6)
      if (ent) usadas.add(ent)
      if (!p.automatico && ent) {
        const finEpoch = Number(ent.epoch) + p.horas * 3600
        const sal = e.marcas.find((m) => m.tipo === 'salida' && Math.abs(Number(m.epoch) - finEpoch) < 0.5)
        if (sal) usadas.add(sal)
      }
    }

    const tot = { trabajado: 0, porTipo: Object.fromEntries(CODIGOS_HORA.map((c) => [c, 0])), avisos: 0 }
    const lineas = []

    for (let i = 0; i < 7; i++) {
      const fecha = sumarDias(lunes, i)
      const dow = dowDe(fecha)
      const marcas = e.marcas.filter((m) => m.fecha === fecha)
      const ps = pares.filter((p) => p.fecha === fecha)
      const ex = extras.filter((r) => r.fecha === fecha)
      if (marcas.length === 0 && ps.length === 0) continue

      const trabajado = ps.reduce((s, p) => s + p.horas, 0)
      const dominical = dow === 0 || cfg.festivos.has(fecha)
      const extraDia = ex.reduce((s, r) => s + r.horas, 0)

      tot.trabajado += trabajado
      for (const r of ex) tot.porTipo[r.tipoHora] += r.horas

      const horario = e.jornadaDias?.[String(dow)]
      const franja = horario ? `${horario.entrada.slice(0, 5)}–${horario.salida.slice(0, 5)}` : (e.entradaEsperada ? `${String(e.entradaEsperada).slice(0, 5)}–${String(e.salidaEsperada).slice(0, 5)}` : 'sin horario')

      const marcasTxt = marcas.map((m) => `${usadas.has(m) ? '' : '⚠'}${m.tipo === 'entrada' ? 'E' : 'S'} ${hora(m.minutos)}`).join('  ')
      const paresTxt = ps.map((p) => `${hora(p.desde)}→${hora(p.hasta)}${p.automatico ? ' (cierre por horario)' : ''} = ${hm(p.horas)}`).join(' · ')
      const exTxt = ex.map((r) => `${r.tipoHora} ${r.horaInicio}–${r.horaFin} ${hm(r.horas)}`).join(', ')

      const avisos = []
      const sueltas = marcas.filter((m) => !usadas.has(m))
      if (sueltas.length) { avisos.push(`${sueltas.length} marcación(es) sin pareja, no cuentan`); tot.avisos++ }
      if (dominical) avisos.push(fecha === HOY ? 'hoy' : (dow === 0 ? 'domingo: recargo desde la primera hora' : 'festivo: recargo desde la primera hora'))
      else if (fecha === HOY) avisos.push('hoy: sigue abierto')

      lineas.push(
        `  ${ancho(fechaCorta(fecha), 11)} ${ancho(franja, 12)} ${ancho(marcasTxt, 44)}`,
        `  ${' '.repeat(24)} pares: ${paresTxt || '(ninguno)'}`,
        `  ${' '.repeat(24)} trabajado ${der(hm(trabajado), 7)} · extra ${der(hmCero(extraDia), 7)}${exTxt ? `  [${exTxt}]` : ''}${avisos.length ? `\n  ${' '.repeat(24)} ⚠ ${avisos.join(' · ')}` : ''}`,
      )
    }

    const liquidableTotal = Object.values(tot.porTipo).reduce((a, b) => a + b, 0)

    // La cuenta de la semana (lib/semanaLaboral.js) al lado de lo que el
    // motor entregó: es la misma función que usa el motor, así que la extra
    // de las dos columnas tiene que coincidir. Si no, algo se rompió.
    const horasHorario = (fecha) => horasDeHorario(e, fecha)
    const horasPorDia = new Map()
    for (const p of pares) horasPorDia.set(p.fecha, (horasPorDia.get(p.fecha) ?? 0) + p.horas)
    const sem = resumenSemana({ lunes, horasPorDia, festivos: cfg.festivos, horasHorario, horasSemana: cfg.vigencias[0].horasSemana, hoy: HOY })
    const fila = {
      empleado: e.nombre,
      cedula: e.cedula,
      trabajado: hm(tot.trabajado),
      'extra (motor)': hmCero(liquidableTotal),
      ...Object.fromEntries(CODIGOS_HORA.map((c) => [c, hmCero(tot.porTipo[c])])),
      'SEMANAL: extra': sem.cerrada ? hmCero(sem.extra) : 'en curso',
      'SEMANAL: dominical': hmCero(sem.dominicales),
      avisos: tot.avisos || '',
    }
    resumenGlobal.push(fila)

    if (SOLO_RESUMEN) continue
    const pactada = e.jornadaSemanal ? `jornada pactada ${e.jornadaSemanal.map((h) => hm(h)).join('/')}` : 'sin jornada pactada (usa la de la empresa)'
    console.log(`\n── ${e.nombre} · CC ${e.cedula} · ${e.sede ?? 'sin sede'} · ${pactada}`)
    for (const l of lineas) console.log(l)
    console.log(`  TOTAL semana: trabajado ${hm(tot.trabajado)} · extra (motor) ${hmCero(liquidableTotal)}`
      + (liquidableTotal > 0 ? ` → ${CODIGOS_HORA.filter((c) => tot.porTipo[c] > 0).map((c) => `${c} ${hm(tot.porTipo[c])}`).join(', ')}` : ''))
    console.log(`  CUENTA SEMANAL: ${sem.cerrada ? 'cerrada' : 'EN CURSO (la extra se define al cerrar)'} · L–S ${hm(sem.ordinarias)}`
      + (sem.acreditadas > 0 ? ` + festivo acreditado ${hm(sem.acreditadas)} (${sem.festivosAcreditados.map((f) => f.fecha).join(', ')})` : '')
      + ` = ${hm(sem.cuenta)} de ${cfg.vigencias[0].horasSemana} h`
      + (sem.cerrada ? (sem.extra > 0 ? ` → extra ${hm(sem.extra)}` : ` → sin extra${sem.faltante > 0.001 ? ` (faltaron ${hm(sem.faltante)})` : ''}`) : '')
      + (sem.dominicales > 0.001 ? ` · dominical/festivo ${hm(sem.dominicales)}` : ''))
  }
}

console.log(`\n${'═'.repeat(100)}\nRESUMEN de la semana ${lunes} → ${domingo}`)
if (resumenGlobal.length === 0) console.log('  Nadie marcó en esa semana.')
else console.table(resumenGlobal)
console.log(`
Cómo leerlo:
  · trabajado            suma de los pares entrada→salida (con los cierres por horario cuando faltó la salida).
  · extra (motor)        lo que el motor de nómina entrega (lib/calculoHoras.js): lo que pasa de la jornada semanal entre lunes y
                         sábado —solo con la semana cerrada—, ubicado en las últimas horas de la semana y partido en HED/HEN;
                         más el domingo y el festivo, con recargo desde la primera hora (HEDDF/HENDF).
  · SEMANAL              la misma cuenta hecha por lib/semanaLaboral.js, que es lo que muestra el panel. Debe coincidir con la anterior.
  · ⚠ marcación sin pareja  una entrada o salida que no cerró turno (p. ej. dos entradas seguidas, o salida sin entrada): NO suma horas.
`)

await cliente.end()
