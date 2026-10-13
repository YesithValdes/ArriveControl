/**
 * Casos identificables para desarrollo LOCAL.
 * node db/seed-funcionamientos.mjs --listar
 * node --env-file=.env.local db/seed-funcionamientos.mjs --esquema=...
 * Cada corrida agrega solo los casos que no existen para esa fecha.
 * No modifica configuración, datos previos, biometría ni usuarios.
 */
import pg from 'pg'
import { randomUUID } from 'node:crypto'

const args = process.argv.slice(2)
const hoy = new Date(Date.now() - 5 * 3600000).toISOString().slice(0, 10)
const mover = (fecha, dias) => new Date(Date.parse(fecha + 'T12:00:00Z') + dias * 86400000).toISOString().slice(0, 10)
const dow = (fecha) => new Date(fecha + 'T12:00:00Z').getUTCDay()
let dia = mover(hoy, -1)
while (dow(dia) === 0) dia = mover(dia, -1)
const lunesActual = mover(hoy, -((dow(hoy) + 6) % 7))
const lunesCerrado = mover(lunesActual, -7)
const domingo = mover(lunesCerrado, 6)
const franja = { entrada: '08:00', salida: '17:00', almuerzo_min: 60, almuerzo_desde: '12:00', almuerzo_hasta: '13:00' }
const horario = (f) => Object.fromEntries([1, 2, 3, 4, 5, 6].map(d => [d, f]))
const normal = ['08:00', '12:00', '13:00', '17:00']
const casos = []
const caso = (codigo, esperado, horas = normal, opciones = {}) => casos.push({ codigo, esperado, horas, fecha: dia, ...opciones })
caso('PUNTUAL', '8 h registradas; jornada completa.')
caso('ENTRADA_TARDIA', 'Primera entrada 11:30: entrada tardía (umbral actual: 180 min).', ['11:30', '12:00', '13:00', '17:00'])
caso('ENTRADA_LIMITE', 'Primera entrada 11:00: justo en el umbral de entrada tardía.', ['11:00', '12:00', '13:00', '17:00'])
caso('SALIDA_FALTANTE', 'Entrada de un día terminado sin salida.', ['08:00'])
caso('SALIDA_TARDIA', 'Salida 90 min después del horario; depende de la tolerancia configurada.', ['08:00', '12:00', '13:00', '18:30'])
caso('SALIDA_LIMITE', 'Salida 17:15: sin aviso si la tolerancia de salida es 15 min.', ['08:00', '12:00', '13:00', '17:15'])
caso('DESCANSO_EXCEDIDO', 'Pausa 100 min: excede 60 + 10 con tolerancia de fábrica.', ['08:00', '12:00', '13:40', '17:00'])
caso('DESCANSO_LIMITE', 'Pausa 70 min: no excede 60 + 10 con tolerancia de fábrica.', ['08:00', '12:00', '13:10', '17:00'])
caso('JORNADA_INCOMPLETA', 'Horas incompletas: 6 h 30 de 8 previstas; faltan 90 min.', ['08:00', '12:00', '13:00', '15:30'])
caso('VARIAS_ANOMALIAS', 'Entrada tardía, pausa 100 min y salida 18:30.', ['11:30', '12:00', '13:40', '18:30'])
caso('SIN_DESCANSO', '8 h continuas, horario 08:00–16:00 sin almuerzo.', ['08:00', '16:00'], { franja: { entrada: '08:00', salida: '16:00', almuerzo_min: 0 } })
caso('SIN_MARCAR_PAUSA', '9 h registradas: no se descuenta una pausa que no se marcó.', ['08:00', '17:00'])
caso('DOS_PAUSAS', 'Dos pausas de 30 min; 8 h efectivas.', ['08:00', '10:00', '10:30', '12:00', '12:30', '17:00'])
caso('SIN_HORARIO', '6 h registradas; sin comparación con horario.', ['10:00', '16:00'], { sinHorario: true })
caso('DIA_LIBRE', '4 h en día libre; no comparar entrada/salida con una franja inexistente.', ['09:00', '13:00'], { jornada: {} })
caso('HORARIO_VARIABLE', 'Franja del día 09:00–13:00, 4 h sin almuerzo.', ['09:00', '13:00'], { jornada: { [dow(dia)]: { entrada: '09:00', salida: '13:00', almuerzo_min: 0 } } })
caso('NOCTURNO', 'Turno 22:00–06:00 del día siguiente: 8 h, sin salida faltante.', ['22:00', '06:00'], { franja: { entrada: '22:00', salida: '06:00', almuerzo_min: 0 }, cruza: true })
caso('DOMINICAL', '4 h dominicales en semana cerrada; clasificación según reglamento.', ['09:00', '13:00'], { fecha: domingo })
caso('SIN_SALARIO', 'Horas calculadas con valor monetario sin salario disponible.', normal, { salario: null })
caso('INACTIVO', 'Empleado retirado: comprobar listado y filtros de activos.', normal, { activo: false })
caso('SIN_SEDE', 'Empleado sin sede: comprobar filtros y agrupación.', normal, { sinSede: true })
caso('SIN_MARCACIONES', 'Empleado activo sin asistencia registrada.', [])
caso('MARCACION_MANUAL', 'Par manual con auditoría de creación.', ['08:00', '17:00'], { origen: 'manual' })
caso('KIOSCO_DIFERIDO', 'Marcaciones de origen diferido con timestamp del dispositivo.', normal, { origen: 'kiosco_diferido' })
for (const [codigo, horasDia, esperado] of [
  ['SEMANA_COMPLETA', 7, '42 h en seis días de semana cerrada.'],
  ['SEMANA_FALTANTE', 6, '36 h en semana cerrada; faltante frente a la jornada configurada.'],
  ['SEMANA_EXTRA_DIURNA', 9, '54 h en semana cerrada; extra según jornada y modo configurados.'],
  ['SEMANA_EXTRA_NOCTURNA', 10, '60 h nocturnas en semana cerrada; clasificar recargos y extras.'],
]) {
  const nocturna = codigo.endsWith('NOCTURNA')
  caso(codigo, esperado, [], {
    fecha: lunesCerrado,
    franja: nocturna ? { entrada: '19:00', salida: '02:00', almuerzo_min: 0 } : { entrada: '08:00', salida: '15:00', almuerzo_min: 0 },
    semana: { horasDia, nocturna },
  })
}

console.table(casos.map(c => ({ caso: c.codigo, dia: c.fecha, esperado: c.esperado })))
console.log('Los resultados de extras y tolerancias dependen de Ajustes. No se cambia el reglamento.')
console.log('GPS, cámara, anti-rebote, permisos, correo, API y cierres requieren pruebas del flujo real; no se simulan con filas.')
if (args.includes('--listar')) process.exit(0)

const url = new URL(process.env.DATABASE_URL ?? 'postgresql://invalid')
if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) {
  throw new Error('Solo se permite DATABASE_URL de una base local.')
}
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL })
const db = await pool.connect()
try {
  const empresas = (await db.query('select nombre, esquema from control.empresas order by creada_en')).rows
  const esquema = args.find(a => a.startsWith('--esquema='))?.slice('--esquema='.length) ?? (empresas.length === 1 ? empresas[0].esquema : null)
  if (!esquema || !/^[a-z][a-z0-9_]{2,40}$/.test(esquema) || !empresas.some(e => e.esquema === esquema)) {
    throw new Error('Indica una empresa existente con --esquema=...: ' + empresas.map(e => e.esquema).join(', '))
  }
  await db.query('begin')
  await db.query('set search_path to ' + esquema)
  // No se reutilizan nombres ni IDs de sedes reales.
  const sedeNombre = 'PRUEBA FUNCIONAMIENTOS ' + hoy
  let sede = (await db.query('select id from sedes where nombre=$1', [sedeNombre])).rows[0]?.id
  if (!sede) {
    sede = randomUUID()
    await db.query('insert into sedes (id,nombre,lat,lon,radio_m) values ($1,$2,1.2136,-77.2811,60)', [sede, sedeNombre])
  }
  let creados = 0
  let omitidos = 0
  for (const [indice, c] of casos.entries()) {
    const id = 'fixture-func-v1-' + hoy + '-' + c.codigo
    if ((await db.query('select 1 from empleados where id=$1', [id])).rowCount) { omitidos++; continue }
    const f = c.franja ?? franja
    const dias = c.sinHorario ? null : c.jornada ?? horario(f)
    await db.query(
      'insert into empleados (id,nombre,cedula,sede_id,entrada_esperada,salida_esperada,almuerzo_min,jornada_dias,salario_mensual,activo) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',
      [id, 'PRUEBA FUNC ' + c.codigo, '99' + hoy.replaceAll('-', '') + String(indice + 1).padStart(3, '0'), c.sinSede ? null : sede,
       c.sinHorario ? null : f.entrada, c.sinHorario ? null : f.salida, f.almuerzo_min,
       dias == null ? null : JSON.stringify(dias), c.salario === null ? null : 2100000, c.activo ?? true],
    )
    const marcas = []
    if (c.semana) {
      for (let d = 0; d < 6; d++) {
        const fecha = mover(c.fecha, d)
        const ini = c.semana.nocturna ? 19 : 8
        const fin = ini + c.semana.horasDia
        marcas.push(['entrada', fecha, String(ini).padStart(2, '0') + ':00'])
        marcas.push(['salida', mover(fecha, fin >= 24 ? 1 : 0), String(fin % 24).padStart(2, '0') + ':00'])
      }
    } else {
      c.horas.forEach((h, i) => marcas.push([i % 2 ? 'salida' : 'entrada', mover(c.fecha, c.cruza && i > 0 ? 1 : 0), h]))
    }
    for (const [tipo, fecha, hora] of marcas) {
      const ts = fecha + 'T' + hora + ':00-05:00'
      const origen = c.origen ?? 'kiosco'
      const mid = randomUUID()
      await db.query(
        'insert into marcaciones (id,empleado_id,tipo,ts,sede_id,origen,ts_dispositivo) values ($1,$2,$3,$4,$5,$6,$7)',
        [mid, id, tipo, ts, c.sinSede ? null : sede, origen, origen === 'kiosco_diferido' ? ts : null],
      )
      if (origen === 'manual') {
        await db.query(
          "insert into correcciones (marcacion_id,admin_user_id,admin_email,accion,valor_nuevo,motivo) values ($1,'fixture-local','prueba@example.invalid','crear',$2,'Datos de prueba: creación manual')",
          [mid, JSON.stringify({ tipo, ts })],
        )
      }
    }
    creados++
  }
  // Registros de diagnóstico, sin biometría inventada ni envío de notificaciones.
  if (creados > 0) {
    const pid = 'fixture-func-v1-' + hoy + '-PUNTUAL'
    for (const [aceptado, distancia, vida] of [[true, 0.3, true], [false, 0.8, true], [false, 0.3, false]]) {
      await db.query('insert into intentos_kiosco (empleado_id,aceptado,distancia,liveness_ok,sede_id,ts) values ($1,$2,$3,$4,$5,$6)',
        [pid, aceptado, distancia, vida, sede, dia + 'T08:00:00-05:00'])
    }
  }
  await db.query('commit')
  console.log('Empresa: ' + esquema + '. Creados: ' + creados + '; existentes conservados: ' + omitidos + '.')
  console.log('Recarga Asistencia, Anomalías, Empleados, Reportes y diagnóstico del kiosco.')
} catch (e) {
  await db.query('rollback').catch(() => {})
  throw e
} finally {
  db.release()
  await pool.end()
}

