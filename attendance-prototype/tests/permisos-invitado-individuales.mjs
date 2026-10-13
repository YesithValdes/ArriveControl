/** Integración local: datos y cambios se revierten siempre. */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import pg from 'pg'
import * as roles from '../lib/roles.js'

for (const line of readFileSync(new URL('../.env.local', import.meta.url), 'utf8').split('\n')) {
  const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/)
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '')
}
const url = new URL(process.env.DATABASE_URL)
assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(url.hostname), 'Esta prueba solo se ejecuta en una base local')
const client = new pg.Client({ connectionString: process.env.DATABASE_URL })
await client.connect()
await client.query('begin')
try {
  const tag = randomUUID().replaceAll('-', '').slice(0, 12)
  const company = (await client.query(`insert into control.empresas (nombre, esquema) values ($1, $2) returning id`, ['Prueba permisos', 'prueba_' + tag])).rows[0].id
  const otherCompany = (await client.query(`insert into control.empresas (nombre, esquema) values ($1, $2) returning id`, ['Prueba otra empresa', 'otra_' + tag])).rows[0].id
  const makeUser = async (name, empresa, rol = 'invitado') => (await client.query(`insert into control."user" (name, email, empresa_id, rol) values ($1, $2, $3, $4) returning id`, [name, name + tag + '@example.invalid', empresa, rol])).rows[0].id
  const a = await makeUser('a', company), b = await makeUser('b', company)
  const foreign = await makeUser('foreign', otherCompany), admin = await makeUser('admin', company, 'admin')
  let ctx = { estado: 'OK', empresa: { id: company } }
  // Ejecutar los handlers reales con la sesión controlada y la conexión transaccional.
  const source = readFileSync(new URL('../app/api/roles/invitado/route.js', import.meta.url), 'utf8')
    .replace(/^import .*$/gm, '').replaceAll('export ', '')
  const handlers = new Function('NextResponse', 'pool', 'estadoAcceso', 'estadoAHttp', 'estadoAMensaje', 'MODULOS_INVITADO', 'PERMISOS_INVITADO_FIJOS', 'normalizarPermisosInvitado', 'permisosInvitado', source + '\nreturn { GET, PUT };')(
    { json: (body, init) => Response.json(body, init) }, client,
    async accion => { assert.equal(accion, 'usuarios'); return ctx }, () => 403, () => 'Sin permiso',
    roles.MODULOS_INVITADO, roles.PERMISOS_INVITADO_FIJOS, roles.normalizarPermisosInvitado, roles.permisosInvitado,
  )
  const request = (id, tipo = 'usuario', permisos) => new Request('http://localhost/api/roles/invitado?' + new URLSearchParams({ id, tipo }), permisos === undefined ? {} : { method: 'PUT', body: JSON.stringify({ permisos }) })
  assert.equal((await handlers.GET(request(a))).status, 200)
  assert.equal((await handlers.PUT(request(a, 'usuario', ['sedes:editar']))).status, 200)
  const readA = await (await handlers.GET(request(a))).json()
  const readB = await (await handlers.GET(request(b))).json()
  assert.deepEqual(readA.permisos, ['asistencia:ver', 'sedes:ver', 'sedes:editar'])
  assert.deepEqual(readB.permisos, roles.PERMISOS_INVITADO, 'Otro Invitado conserva todos sus permisos')
  assert.ok(roles.puede('invitado', 'config', null, 'sedes:editar', { permisos_invitado: readA.permisos }))
  assert.ok(!roles.puede('invitado', 'config', null, 'sedes:eliminar', { permisos_invitado: readA.permisos }))
  assert.equal((await handlers.PUT(request(foreign, 'usuario', []))).status, 404)
  assert.equal((await handlers.GET(request(foreign))).status, 404)
  assert.equal((await handlers.PUT(request(admin, 'usuario', []))).status, 404)
  assert.equal((await handlers.PUT(request(a, 'usuario', [42]))).status, 400)
  assert.equal((await handlers.GET(new Request('http://localhost/api/roles/invitado'))).status, 400)
  const invite = (await client.query(`insert into control.invitaciones (empresa_id, email, rol) values ($1, $2, 'invitado') returning id`, [company, 'invite' + tag + '@example.invalid'])).rows[0].id
  assert.equal((await handlers.PUT(request(invite, 'invitacion', []))).status, 200)
  assert.deepEqual((await (await handlers.GET(request(invite, 'invitacion'))).json()).permisos, ['asistencia:ver'])
  const joiningUser = (await client.query(`insert into control."user" (name, email) values ('Invitado de prueba', $1) returning id, email`, ['invite' + tag + '@example.invalid'])).rows[0]
  const registrationSource = readFileSync(new URL('../lib/registro.js', import.meta.url), 'utf8').replace(/^import .*$/gm, '').replaceAll('export ', '')
  const assignCompany = new Function('control', 'crearEmpresa', registrationSource + '\nreturn asignarEmpresa;')(
    (sql, params) => client.query(sql, params), () => { throw new Error('Una invitación no debe crear otra empresa') },
  )
  assert.equal((await assignCompany(joiningUser)).via, 'invitacion')
  const joined = (await client.query('select empresa_id, rol, permisos_invitado from control."user" where id = $1', [joiningUser.id])).rows[0]
  assert.equal(joined.empresa_id, company)
  assert.equal(joined.rol, 'invitado')
  assert.deepEqual(joined.permisos_invitado, ['asistencia:ver'], 'Aceptar conserva los permisos individuales de la invitación')
  assert.equal((await handlers.PUT(request(invite, 'invitacion', roles.PERMISOS_INVITADO))).status, 404)
  ctx = { estado: 'SIN_PERMISO' }
  assert.equal((await handlers.GET(request(a))).status, 403)
  assert.equal((await handlers.PUT(request(a, 'usuario', []))).status, 403)
  console.log('Permisos individuales: persistencia, independencia, acciones, invitaciones y aislamiento entre empresas OK.')
} finally {
  await client.query('rollback')
  await client.end()
}
