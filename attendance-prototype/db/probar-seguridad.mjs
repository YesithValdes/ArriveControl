/**
 * db/probar-seguridad.mjs — Prueba de punta a punta de las llaves por empresa
 * y del acceso de soporte, contra una base LOCAL de verdad.
 *
 * Crea dos empresas desechables, ejercita todo y las elimina al final. Se
 * niega a correr contra cualquier base que no sea localhost.
 *
 * Uso:
 *   DATABASE_URL=postgresql://postgres@localhost:5432/arrivecontrol_local \
 *     node db/probar-seguridad.mjs
 * (las migraciones de control deben estar al día: node db/migrate.mjs)
 */
import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

if (!/@(localhost|127\.0\.0\.1)(:\d+)?\//.test(process.env.DATABASE_URL ?? '')) {
  console.error('Esta prueba crea y borra empresas: solo corre contra una base LOCAL (DATABASE_URL a localhost).')
  process.exit(1)
}

const raiz = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
process.chdir(raiz) // crearEmpresa lee la plantilla desde el directorio actual

const maestra1 = randomBytes(32).toString('base64')
const maestra2 = randomBytes(32).toString('base64')
process.env.ARRIVE_LLAVE_MAESTRA = maestra1
process.env.ARRIVE_LLAVE_MAESTRA_ID = 'm1'

const { control } = await import('../lib/db.js')
const { crearEmpresa } = await import('../lib/empresas.js')
const { eliminarEmpresa } = await import('../lib/plataforma.js')
const llaves = await import('../lib/llaves.js')
const soporte = await import('../lib/soporte.js')

let pasaron = 0
const prueba = async (nombre, fn) => {
  try { await fn(); pasaron++; console.log(`  ✅ ${nombre}`) } catch (e) { console.error(`  ❌ ${nombre}\n     ${e.message}`); process.exitCode = 1 }
}
const falla = async (promesa, patron) => {
  try { await promesa } catch (e) { if (patron) assert.match(e.message, patron); return }
  throw new Error('Se esperaba un error y no lo hubo.')
}

/** Corre un trozo de código en OTRO proceso, con otras llaves maestras. */
function enOtroProceso(entorno, codigo) {
  const r = spawnSync(process.execPath, ['--no-warnings', '--input-type=module', '-e', codigo], {
    cwd: raiz, encoding: 'utf8',
    env: { ...process.env, ARRIVE_LLAVE_MAESTRA_ANTERIOR: '', ARRIVE_LLAVE_MAESTRA_ANTERIOR_ID: '', ...entorno },
  })
  if (r.status !== 0) throw new Error(`Subproceso falló: ${r.stderr || r.stdout}`)
  return r.stdout.trim()
}

const sufijo = randomBytes(3).toString('hex')
const A = await crearEmpresa({ nombre: `Prueba Seguridad A ${sufijo}` })
const B = await crearEmpresa({ nombre: `Prueba Seguridad B ${sufijo}` })
const dueno = { id: 'usuario-dueno-prueba', email: 'dueno@prueba.local' }
const superadmin = { id: 'usuario-superadmin-prueba', email: 'soporte@arrive.local' }
let llaveRecuperacion

try {
  console.log('\n🗝️  DEK por empresa')
  await prueba('cada empresa nace con su DEK v1 envuelta con la maestra', async () => {
    const { rows } = await control(
      `select empresa_id, version, maestra_id, dek_recuperacion from control.empresa_llaves where empresa_id = any($1)`,
      [[A.id, B.id]],
    )
    assert.equal(rows.length, 2)
    for (const r of rows) { assert.equal(r.version, 1); assert.equal(r.maestra_id, 'm1'); assert.equal(r.dek_recuperacion, null) }
  })
  await prueba('la DEK nunca se guarda en claro (el sobre no contiene 32 bytes sueltos)', async () => {
    const { rows } = await control(`select dek_maestra from control.empresa_llaves where empresa_id = $1`, [A.id])
    assert.match(rows[0].dek_maestra, /^ac1\.m1\./)
  })
  await prueba('cifrar y descifrar un dato de la empresa', async () => {
    const s = await llaves.cifrarDato(A, 'empleados.cedula', '1023456789')
    assert.notEqual(s, '1023456789')
    assert.equal(await llaves.descifrarDato(A, 'empleados.cedula', s), '1023456789')
  })
  await prueba('un dato de A NO se abre como si fuera de B', async () => {
    const s = await llaves.cifrarDato(A, 'empleados.cedula', '1023456789')
    await falla(llaves.descifrarDato(B, 'empleados.cedula', s))
  })
  await prueba('un valor en claro pasa intacto (migración por etapas)', async () => {
    assert.equal(await llaves.descifrarDato(A, 'empleados.cedula', '1023456789'), '1023456789')
    assert.equal(await llaves.cifrarDato(A, 'empleados.cedula', null), null)
  })
  await prueba('la DEK envuelta de A copiada a B no sirve (aad atado a la empresa)', async () => {
    const r = enOtroProceso({}, `
      import { control } from './lib/db.js'
      import { descifrarDato, cifrarDato, olvidarLlaves } from './lib/llaves.js'
      const A = { id: '${A.id}' }, B = { id: '${B.id}' }
      const s = await cifrarDato(B, 'empleados.cedula', 'x')
      await control("update control.empresa_llaves set dek_maestra = (select dek_maestra from control.empresa_llaves where empresa_id = $1) where empresa_id = $2", [A.id, B.id])
      olvidarLlaves()
      let abrio = true
      try { await descifrarDato(B, 'empleados.cedula', s) } catch { abrio = false }
      console.log(abrio ? 'ABRIO' : 'RECHAZADA')
      process.exit()
    `)
    assert.equal(r, 'RECHAZADA')
  })
  // Lo anterior dañó a B a propósito; se le da una DEK nueva para seguir.
  await control(`delete from control.empresa_llaves where empresa_id = $1`, [B.id])
  llaves.olvidarLlaves()
  await llaves.asegurarLlave(B)

  console.log('\n🧾 Llave de recuperación')
  await prueba('el dueño la genera una vez; se entrega en texto y no se guarda', async () => {
    const r = await llaves.generarRecuperacion(A, { creadaPor: dueno.email })
    llaveRecuperacion = r.texto
    assert.match(llaveRecuperacion, /^([A-Z2-7]{4}-){12}[A-Z2-7]{4}$/)
    const { rows } = await control(`select dek_recuperacion, recuperacion_huella from control.empresa_llaves where empresa_id = $1`, [A.id])
    assert.ok(rows[0].dek_recuperacion && rows[0].recuperacion_huella)
    assert.ok(!JSON.stringify(rows).includes(llaveRecuperacion.replace(/-/g, '')))
  })
  await prueba('generar otra sin «reemplazar» se rechaza', async () => {
    assert.deepEqual(await llaves.generarRecuperacion(A), { error: 'YA_EXISTE' })
  })
  await prueba('verificar: la correcta sí, una cualquiera no', async () => {
    assert.equal(await llaves.verificarRecuperacion(A, llaveRecuperacion), true)
    assert.equal(await llaves.verificarRecuperacion(A, llaveRecuperacion.toLowerCase()), true)
    const otra = (await import('../lib/cifrado.js')).nuevaRecuperacion().texto
    assert.equal(await llaves.verificarRecuperacion(A, otra), false)
    assert.equal(await llaves.verificarRecuperacion(B, llaveRecuperacion), false)
  })
  await prueba('estado visible para el dueño', async () => {
    const e = await llaves.estadoLlaves(A)
    assert.equal(e.configurado, true); assert.equal(e.tieneDek, true); assert.equal(e.recuperacion.creadaPor, dueno.email)
  })

  console.log('\n🔁 Maestra perdida o rotada')
  const sobreAntes = await llaves.cifrarDato(A, 'empleados.salario', '3500000')
  await prueba('con OTRA maestra y sin la anterior, la DEK no se abre', async () => {
    const r = enOtroProceso({ ARRIVE_LLAVE_MAESTRA: maestra2, ARRIVE_LLAVE_MAESTRA_ID: 'm2' }, `
      import { descifrarDato } from './lib/llaves.js'
      try { await descifrarDato({ id: '${A.id}' }, 'empleados.salario', '${sobreAntes}'); console.log('ABRIO') }
      catch (e) { console.log(/maestra "m1"/.test(e.message) ? 'SIN_MAESTRA' : e.message) }
      process.exit()
    `)
    assert.equal(r, 'SIN_MAESTRA')
  })
  await prueba('la llave de recuperación la restaura bajo la maestra nueva, y los datos se abren', async () => {
    const r = enOtroProceso({ ARRIVE_LLAVE_MAESTRA: maestra2, ARRIVE_LLAVE_MAESTRA_ID: 'm2' }, `
      import { restaurarConRecuperacion, descifrarDato } from './lib/llaves.js'
      const A = { id: '${A.id}' }
      const mala = await restaurarConRecuperacion(A, 'AAAA-AAAA-AAAA-AAAA-AAAA-AAAA-AAAA-AAAA-AAAA-AAAA-AAAA-AAAA-AAAA')
      const r = await restaurarConRecuperacion(A, '${llaveRecuperacion}')
      const dato = await descifrarDato(A, 'empleados.salario', '${sobreAntes}')
      console.log(JSON.stringify({ mala: mala.error, ok: r.ok, dato }))
      process.exit()
    `)
    assert.deepEqual(JSON.parse(r), { mala: 'LLAVE_INVALIDA', ok: true, dato: '3500000' })
  })
  await prueba('rotación ordenada: con la anterior configurada, rotar-maestra re-envuelve todo', async () => {
    // Ahora A está bajo m2 y B bajo m1. Se rota a m3 conservando m2 como anterior:
    // A se re-envuelve, B queda reportada (su maestra m1 no está).
    const maestra3 = randomBytes(32).toString('base64')
    const r = enOtroProceso({
      ARRIVE_LLAVE_MAESTRA: maestra3, ARRIVE_LLAVE_MAESTRA_ID: 'm3',
      ARRIVE_LLAVE_MAESTRA_ANTERIOR: maestra2, ARRIVE_LLAVE_MAESTRA_ANTERIOR_ID: 'm2',
    }, `
      import { reenvolverConMaestraVigente, descifrarDato } from './lib/llaves.js'
      const r = await reenvolverConMaestraVigente()
      const dato = await descifrarDato({ id: '${A.id}' }, 'empleados.salario', '${sobreAntes}')
      console.log(JSON.stringify({ sinB: r.sinMaestra.some((s) => s.startsWith('${B.id}')), dato }))
      process.exit()
    `)
    assert.deepEqual(JSON.parse(r), { sinB: true, dato: '3500000' })
    const { rows } = await control(`select maestra_id from control.empresa_llaves where empresa_id = $1`, [A.id])
    assert.equal(rows[0].maestra_id, 'm3')
  })

  console.log('\n🛟 Acceso de soporte')
  let aut
  await prueba('no se autoriza más de 72 h, ni sin motivo', async () => {
    assert.match((await soporte.autorizarSoporte({ empresa: A, usuario: dueno, horas: 73, motivo: 'revisar marcaciones' })).error, /72/)
    assert.match((await soporte.autorizarSoporte({ empresa: A, usuario: dueno, horas: 24, motivo: 'x' })).error, /motivo|caracteres/)
  })
  await prueba('la BASE también impide más de 72 h', async () => {
    await falla(control(
      `insert into control.soporte_autorizaciones (empresa_id, autorizada_por, motivo, desde, hasta)
       values ($1, 'x', 'intento directo', now(), now() + interval '73 hours')`, [A.id],
    ), /soporte_maximo_72h/)
  })
  await prueba('el dueño autoriza 72 h; queda vigente', async () => {
    aut = (await soporte.autorizarSoporte({ empresa: A, usuario: dueno, horas: 72, motivo: 'Revisar marcaciones de octubre' })).autorizacion
    assert.equal(aut.vigente, true)
    assert.ok((await soporte.autorizacionVigente(aut.id)))
    assert.ok((await soporte.autorizacionesVigentes()).some((v) => v.id === aut.id && v.empresa_nombre === A.nombre))
  })
  await prueba('una segunda mientras hay una vigente se rechaza', async () => {
    assert.match((await soporte.autorizarSoporte({ empresa: A, usuario: dueno, horas: 2, motivo: 'otra ventana' })).error, /vigente/)
  })
  await prueba('la autorización no se edita ni se borra', async () => {
    await falla(control(`update control.soporte_autorizaciones set hasta = hasta + interval '1 day' where id = $1`, [aut.id]), /solo se permite revocar/)
    await falla(control(`delete from control.soporte_autorizaciones where id = $1`, [aut.id]), /no se borra/)
  })
  await prueba('cada acceso queda en la bitácora, que no se edita ni se borra', async () => {
    await soporte.registrarAcceso({ autorizacion: aut, usuario: superadmin, accion: 'entrar', metodo: 'POST', ruta: '/api/plataforma/soporte' })
    await soporte.registrarAcceso({ autorizacion: aut, usuario: superadmin, accion: 'ver', metodo: 'GET', ruta: '/api/empleados' })
    await soporte.registrarAcceso({ autorizacion: aut, usuario: superadmin, accion: 'denegado', metodo: 'POST', ruta: '/api/marcaciones/manual', detalle: 'requería «corregir»' })
    const accesos = await soporte.accesosDe(A)
    assert.deepEqual(accesos.map((a) => a.accion), ['denegado', 'ver', 'entrar'])
    await falla(control(`update control.soporte_accesos set accion = 'ver' where empresa_id = $1`, [A.id]), /no se modifica/)
    await falla(control(`delete from control.soporte_accesos where empresa_id = $1`, [A.id]), /no se modifica/)
  })
  await prueba('B no ve las autorizaciones ni la bitácora de A, ni puede revocarlas', async () => {
    assert.equal((await soporte.autorizacionesDe(B)).length, 0)
    assert.equal((await soporte.accesosDe(B)).length, 0)
    assert.equal(await soporte.revocarSoporte({ empresa: B, usuario: dueno, id: aut.id }), null)
  })
  await prueba('al revocar deja de estar vigente al instante; revocar dos veces no hace nada', async () => {
    const r = await soporte.revocarSoporte({ empresa: A, usuario: dueno, id: aut.id })
    assert.equal(r.vigente, false)
    assert.equal(await soporte.autorizacionVigente(aut.id), null)
    assert.equal(await soporte.revocarSoporte({ empresa: A, usuario: dueno, id: aut.id }), null)
  })
  await prueba('una vencida tampoco es vigente', async () => {
    const { rows } = await control(
      `insert into control.soporte_autorizaciones (empresa_id, autorizada_por, motivo, desde, hasta)
       values ($1, 'x', 'ventana ya pasada', now() - interval '3 hours', now() - interval '1 hour') returning id`, [A.id],
    )
    assert.equal(await soporte.autorizacionVigente(rows[0].id), null)
  })
  await prueba('ids basura no llegan a la base', async () => {
    assert.equal(await soporte.autorizacionVigente("1' or '1'='1"), null)
  })

  console.log('\n🗑️  Eliminar la empresa')
  await prueba('sus llaves se borran (borrado criptográfico); la auditoría queda', async () => {
    const r = await eliminarEmpresa(A.id, A.esquema)
    assert.equal(r.ok, true)
    const llavesA = await control(`select 1 from control.empresa_llaves where empresa_id = $1`, [A.id])
    const auditoria = await control(`select 1 from control.soporte_accesos where empresa_id = $1`, [A.id])
    const autorizaciones = await control(`select 1 from control.soporte_autorizaciones where empresa_id = $1`, [A.id])
    assert.equal(llavesA.rowCount, 0)
    assert.equal(auditoria.rowCount, 3)
    assert.ok(autorizaciones.rowCount >= 2)
  })
} finally {
  // B siempre se limpia; A ya se borró en la última prueba (si llegó).
  for (const e of [A, B]) {
    try { await eliminarEmpresa(e.id, e.esquema) } catch { /* ya no estaba */ }
  }
}

console.log(`\n${pasaron} pruebas de seguridad pasaron.${process.exitCode ? ' HAY FALLOS.' : ''}\n`)
process.exit()
