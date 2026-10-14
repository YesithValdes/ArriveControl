import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { calcularDetalleJornada, rangoJornada, moverPeriodo, hoyBogota } from '../lib/detalleJornada.js'
import { rangoPedido } from '../lib/periodoHoras.js'
import { lunesDe, domingoDe, sumarDias } from '../lib/semanaLaboral.js'
import { puede } from '../lib/roles.js'

const cfg = { festivos: new Set(), vigencias: [{ desde: '1950-01-01', horasSemana: 8 }], nocturno: { inicio: 1080, fin: 360 }, modoExtra: 'semana', extraMinimaH: 0, topeExtraSemanal: 12 }
const marca = (fecha, hora, tipo) => ({ id: fecha + hora, fecha, tipo, minutos: Number(hora.slice(0, 2)) * 60 + Number(hora.slice(3, 5)), dow: new Date(fecha + 'T12:00:00Z').getUTCDay(), epoch: Date.parse(fecha + 'T' + hora + ':00-05:00') / 1000, tieneFoto: true })
const e = { id: 'a', nombre: 'Prueba', cedula: '123', marcas: [marca('2026-10-05', '08:00', 'entrada'), marca('2026-10-05', '12:00', 'salida'), marca('2026-10-05', '13:00', 'entrada'), marca('2026-10-05', '19:00', 'salida'), marca('2026-10-11', '09:00', 'entrada'), marca('2026-10-11', '13:00', 'salida')] }
const rango = { desde: '2026-10-05', hasta: '2026-10-11' }
const semana = calcularDetalleJornada(e, cfg, rango, '2026-10-13', true).semanas[0]
assert.equal(semana.trabajado, 14)
assert.equal(semana.ordinarias, 8)
assert.equal(semana.diurnas, 1)
assert.equal(semana.nocturnas, 1)
assert.equal(semana.dominicales, 4)
assert.equal(semana.extras, 6)
assert.equal(semana.limiteExtras, 12)
assert.equal(semana.dias[0].fotos.length, 4)
assert.equal(semana.dias[0].segmentos.find(s => s.tipo === 'almuerzo').hasta - semana.dias[0].segmentos.find(s => s.tipo === 'almuerzo').desde, 60)
assert.equal(semana.dias[1].entrada, null)
assert.equal(calcularDetalleJornada(e, cfg, rango, '2026-10-13', false).semanas[0].dias[0].fotos.length, 0)
assert.equal(calcularDetalleJornada(e, { ...cfg, nocturno: { inicio: 1200, fin: 360 } }, rango, '2026-10-13').semanas[0].nocturnas, 0)
assert.equal(calcularDetalleJornada(e, cfg, rango, '2026-10-08').semanas[0].diurnas, 0)
const noche = { ...e, marcas: [marca('2026-10-05', '22:00', 'entrada'), marca('2026-10-06', '04:00', 'salida')] }
const nocturna = calcularDetalleJornada(noche, { ...cfg, vigencias: [{ desde: '1950-01-01', horasSemana: 2 }] }, rango, '2026-10-13').semanas[0]
assert.equal(nocturna.trabajado, 6)
assert.equal(nocturna.ordinarias, 2)
assert.equal(nocturna.nocturnas, 4)
assert.equal(nocturna.dias[0].salida, 1680)
assert.deepEqual(rangoJornada('2028-02-20', 'b'), { desde: '2028-02-16', hasta: '2028-02-29' })
assert.deepEqual(moverPeriodo('2026-12-16', 'b', 1), { fecha: '2027-01-01', modo: 'a' })

const source = readFileSync(new URL('../app/api/empleados/[id]/jornada/route.js', import.meta.url), 'utf8').replace(/^import .*$/gm, '').replaceAll('export ', '')
function handler({ estadoAcceso, tienePermiso, conEmpresa, configLaboral }) {
  return new Function('NextResponse', 'estadoAcceso', 'estadoAHttp', 'estadoAMensaje', 'tienePermiso', 'conEmpresa', 'configLaboral', 'rangoPedido', 'lunesDe', 'domingoDe', 'sumarDias', 'calcularDetalleJornada', source + '\nreturn GET;')({ json: (body, init) => Response.json(body, init) }, estadoAcceso, () => 403, () => 'Sin permiso', tienePermiso, conEmpresa, configLaboral, rangoPedido, lunesDe, domingoDe, sumarDias, calcularDetalleJornada)
}
const req = new Request('http://localhost/api/empleados/a/jornada?desde=2026-10-05&hasta=2026-10-11'), params = { params: Promise.resolve({ id: 'a' }) }
let permisos = []
const get = handler({ estadoAcceso: async (_, opts) => { assert.equal(opts.permisoInvitado, 'colaboradores:ver'); return { estado: 'OK', usuario: {}, empresa: {} } }, tienePermiso: (_, __, ___, clave) => permisos.includes(clave), conEmpresa: () => { throw new Error('No consultar sin permisos o con rango inválido') } })
assert.equal((await get(req, params)).status, 403)
permisos = ['marcaciones:ver']
assert.equal((await get(req, params)).status, 403)
permisos.push('asistencia:reportes')
assert.equal((await get(new Request('http://localhost/api/empleados/a/jornada'), params)).status, 400)
console.log('Detalle de jornada: totales, pausas, clasificación, noche, fotos, filtros y permisos OK.')

if (process.argv.includes('--db')) {
  for (const line of readFileSync(new URL('../.env.local', import.meta.url), 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/)
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '')
  }
  assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(new URL(process.env.DATABASE_URL).hostname), 'Solo base local')
  const pg = (await import('pg')).default, db = new pg.Client({ connectionString: process.env.DATABASE_URL })
  const { conEmpresa } = await import('../lib/db.js'), { configLaboral } = await import('../lib/configLaboral.js')
  await db.connect()
  try {
    const empresa = (await db.query('select id, esquema from control.empresas limit 1')).rows[0]
    const persona = (await conEmpresa(empresa.esquema, conn => conn.query('select id from empleados limit 1'))).rows[0]
    const usuario = { rol: 'invitado', permisos_invitado: ['colaboradores:ver', 'marcaciones:ver', 'asistencia:reportes'] }
    const GET = handler({ estadoAcceso: async () => ({ estado: 'OK', usuario, empresa, esquema: empresa.esquema }), tienePermiso: (u, accion, empresa, clave) => puede(u.rol, accion, empresa, clave, u), conEmpresa, configLaboral })
    const response = await GET(new Request('http://localhost/api/empleados/a/jornada?mes=' + hoyBogota().slice(0, 7)), { params: Promise.resolve(persona) })
    assert.equal(response.status, 200)
    const data = await response.json()
    assert.equal(data.verFotos, false)
    assert.ok(data.semanas.length >= 4)
    for (const s of data.semanas) {
      assert.equal(s.dias.length, 7)
      assert.ok(Math.abs(s.trabajado - s.ordinarias - s.diurnas - s.nocturnas - s.dominicales) < .001)
      assert.ok(s.dias.every(d => d.fotos.length === 0))
    }
    console.log('Endpoint: lectura real local, totales y privacidad de fotos OK. No se modificaron datos.')
  } finally { await db.end(); await globalThis.__arriveControlPool.end() }
}
