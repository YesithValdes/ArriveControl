/**
 * db/seed-demo.mjs — Datos de PRUEBA para desarrollo local.
 *
 * Llena la base con sedes, empleados y ~8 semanas de marcaciones verosímiles
 * (llegadas tarde, salidas tempranas, extras, dominicales, olvidos de salida),
 * para poder ver el panel con contenido sin depender del gestor ni de nadie.
 *
 * NO tocar en producción: aborta si ya hay empleados, salvo --reset, que borra
 * SOLO las tablas operativas (no los usuarios ni la configuración).
 *
 * Uso:
 *   node --env-file=.env.local db/seed-demo.mjs [--reset] [--semanas=8]
 *
 * Los números salen de un PRNG con semilla fija: dos corridas dan lo mismo,
 * así un bug del panel se puede reproducir tal cual.
 */
import pg from 'pg'

const args = process.argv.slice(2)
const reset = args.includes('--reset')
const semanas = Number(args.find((a) => a.startsWith('--semanas='))?.split('=')[1] ?? 8)

if (!process.env.DATABASE_URL) {
  console.error('Falta DATABASE_URL (usa node --env-file=.env.local).')
  process.exit(1)
}

// PRNG con semilla (mulberry32): reproducible, a diferencia de Math.random.
let semilla = 20260810
const rnd = () => {
  semilla |= 0
  semilla = (semilla + 0x6d2b79f5) | 0
  let t = Math.imul(semilla ^ (semilla >>> 15), 1 | semilla)
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}
const entero = (min, max) => min + Math.floor(rnd() * (max - min + 1))
const uno = (lista) => lista[entero(0, lista.length - 1)]
const pasa = (probabilidad) => rnd() < probabilidad

const SEDES = [
  { id: 'S1', nombre: 'Sede Centro (Pasto)', lat: 1.2136, lon: -77.2811, radio_m: 60 },
  { id: 'S2', nombre: 'Sede Norte (Pasto)', lat: 1.2354, lon: -77.2705, radio_m: 50 },
  { id: 'S3', nombre: 'Bodega Ipiales', lat: 0.8256, lon: -77.6438, radio_m: 80 },
]

const NOMBRES = [
  'Laura Benavides', 'Carlos Rosero', 'Diana Chamorro', 'Andrés Erazo',
  'Paola Guerrero', 'Julián Narváez', 'Marcela Ortega', 'Wilson Cabrera',
  'Sandra Insuasty', 'Óscar Bastidas', 'Yesica Delgado', 'Iván Portilla',
  'Natalia Zambrano', 'Héctor Muñoz',
]

// Jornadas pactadas (Ley 2101): 6 valores [lun..sáb]. null = estándar.
const JORNADAS = [
  null,
  [7.5, 7.5, 7.5, 7.5, 7.5, 4.5],
  [8, 8, 8, 8, 8, 2],
  [7, 7, 7, 7, 7, 7],
]

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL })
const db = await pool.connect()

try {
  const yaHay = await db.query('select count(*)::int as n from asistencia.empleados')
  if (yaHay.rows[0].n > 0 && !reset) {
    console.error(`Ya hay ${yaHay.rows[0].n} empleados. Usa --reset para reemplazar los datos de prueba.`)
    process.exit(1)
  }

  await db.query('begin')

  if (reset) {
    // Borrado en orden de dependencias, con DELETE y SIN cascade a propósito:
    // `user.sede_id` apunta a sedes, y un `truncate ... cascade` se llevaría
    // por delante la tabla de usuarios (y con ella la sesión del admin).
    await db.query(`update asistencia."user" set sede_id = null where sede_id is not null`)
    for (const t of ['envios_rh', 'correcciones', 'intentos_kiosco', 'marcaciones',
                     'dispositivos', 'empleados', 'sedes']) {
      await db.query(`delete from asistencia.${t}`)
    }
    console.log('Datos operativos anteriores borrados.')
  }

  for (const s of SEDES) {
    await db.query(
      `insert into asistencia.sedes (id, nombre, lat, lon, radio_m) values ($1,$2,$3,$4,$5)`,
      [s.id, s.nombre, s.lat, s.lon, s.radio_m],
    )
  }

  const empleados = NOMBRES.map((nombre, i) => ({
    id: `E${String(i + 1).padStart(3, '0')}`,
    nombre,
    cedula: String(1085000000 + entero(100000, 999999)),
    sede_id: uno(SEDES).id,
    // Turnos distintos para que el panel no se vea plano.
    entrada: uno(['07:00', '07:30', '08:00', '09:00']),
    almuerzo_min: uno([0, 30, 60, 60]),
    jornada: uno(JORNADAS),
    // Uno de cada cinco sin salario: el panel debe mostrar guion, no un cero.
    salario: pasa(0.2) ? null : entero(13, 42) * 100000,
    activo: i < NOMBRES.length - 1, // el último, inactivo (retirado)
  }))

  for (const e of empleados) {
    const [hh, mm] = e.entrada.split(':').map(Number)
    const horasEstandar = e.jornada ? null : 7
    const salidaBase = hh + (horasEstandar ?? 8) + e.almuerzo_min / 60
    await db.query(
      `insert into asistencia.empleados
         (id, nombre, cedula, sede_id, entrada_esperada, salida_esperada,
          almuerzo_min, jornada_semanal, salario_mensual, activo)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [
        e.id, e.nombre, e.cedula, e.sede_id, e.entrada,
        `${String(Math.floor(salidaBase)).padStart(2, '0')}:${String(Math.round((salidaBase % 1) * 60)).padStart(2, '0')}`,
        e.almuerzo_min, e.jornada, e.salario, e.activo,
      ],
    )
  }

  // ── Marcaciones ────────────────────────────────────────────────────
  // Se generan hacia atrás desde hoy. Cada día laborado produce entrada y
  // salida; a veces falta la salida (olvido real que el panel debe señalar).
  const hoy = new Date()
  hoy.setHours(0, 0, 0, 0)
  const dias = semanas * 7
  let nMarcaciones = 0
  let nIntentos = 0

  for (let d = dias; d >= 0; d--) {
    const dia = new Date(hoy)
    dia.setDate(dia.getDate() - d)
    const diaSemana = dia.getDay() // 0 = domingo

    for (const e of empleados) {
      if (!e.activo) continue
      if (diaSemana === 0 && !pasa(0.12)) continue // domingo: casi nadie
      if (diaSemana === 6 && !pasa(0.7)) continue  // sábado: media jornada
      if (pasa(0.06)) continue                      // ausencia / incapacidad

      const [hh, mm] = e.entrada.split(':').map(Number)
      // Distribución realista: casi todos puntuales, algunos tarde de verdad.
      const desfase = pasa(0.15) ? entero(16, 75) : entero(-12, 14)
      const entrada = new Date(dia)
      entrada.setHours(hh, mm + desfase, entero(0, 59), 0)

      const sede = pasa(0.05) ? uno(SEDES).id : e.sede_id // alguna visita a otra sede
      await db.query(
        `insert into asistencia.marcaciones (empleado_id, tipo, ts, sede_id, origen)
         values ($1,'entrada',$2,$3,$4)`,
        [e.id, entrada, sede, pasa(0.05) ? 'manual' : 'kiosco'],
      )
      nMarcaciones++

      if (pasa(0.04)) continue // olvidó marcar la salida

      // El domingo no se pacta jornada (todo lo trabajado es extra): se usa un
      // turno corto. Lun–sáb toman la jornada pactada de ESE día.
      const horasBase =
        diaSemana === 0 ? entero(3, 6)
        : e.jornada ? e.jornada[diaSemana - 1]
        : diaSemana === 6 ? 4.5 : 7
      // Extras: a veces se queda de más; el domingo todo es especial.
      const extra = pasa(0.25) ? entero(30, 190) : entero(-20, 25)
      const salida = new Date(entrada)
      salida.setMinutes(salida.getMinutes() + Math.round(horasBase * 60) + e.almuerzo_min + extra)

      await db.query(
        `insert into asistencia.marcaciones (empleado_id, tipo, ts, sede_id, origen)
         values ($1,'salida',$2,$3,$4)`,
        [e.id, salida, sede, pasa(0.05) ? 'kiosco_diferido' : 'kiosco'],
      )
      nMarcaciones++

      // Intentos del kiosco: los aceptados y algún rechazo por reconocimiento.
      await db.query(
        `insert into asistencia.intentos_kiosco (empleado_id, aceptado, distancia, liveness_ok, sede_id, ts)
         values ($1,true,$2,true,$3,$4)`,
        [e.id, 0.24 + rnd() * 0.2, sede, entrada],
      )
      nIntentos++
      if (pasa(0.07)) {
        const fallo = new Date(entrada)
        fallo.setMinutes(fallo.getMinutes() - entero(1, 4))
        await db.query(
          `insert into asistencia.intentos_kiosco (empleado_id, aceptado, distancia, liveness_ok, sede_id, ts)
           values ($1,false,$2,$3,$4,$5)`,
          [pasa(0.5) ? e.id : null, 0.55 + rnd() * 0.3, !pasa(0.3), sede, fallo],
        )
        nIntentos++
      }
    }
  }

  await db.query('commit')

  console.log(`Sedes:        ${SEDES.length}`)
  console.log(`Empleados:    ${empleados.length} (${empleados.filter((e) => e.activo).length} activos)`)
  console.log(`Marcaciones:  ${nMarcaciones} (últimas ${semanas} semanas)`)
  console.log(`Intentos:     ${nIntentos}`)
} catch (e) {
  await db.query('rollback').catch(() => {})
  console.error('Falló el seed:', e.message)
  process.exitCode = 1
} finally {
  db.release()
  await pool.end()
}
