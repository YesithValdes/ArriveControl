import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { validarEquipo, guardarEquipo } from '../lib/equipos.js'
import { puede, normalizarPermisosInvitado } from '../lib/roles.js'

assert.deepEqual(validarEquipo({nombre:'  Equipo   A ',descripcion:' Descripción ',miembros:['a','a','b']}),{nombre:'Equipo A',descripcion:'Descripción',miembros:['a','b'],responsable_id:null,activa:true,color:'#2b6cb0'})
for(const datos of [{nombre:'',miembros:[]},{nombre:'A',miembros:['']},{nombre:'A',miembros:[42]},{nombre:'A',descripcion:'x'.repeat(501),miembros:[]},{nombre:'A',miembros:[],color:'rojo'},{nombre:'A',miembros:[],responsable_id:42}]) assert.throws(()=>validarEquipo(datos),e=>e.status===400)
const invitado={permisos_invitado:normalizarPermisosInvitado(['equipos:crear'])}
assert.ok(invitado.permisos_invitado.includes('equipos:ver'))
assert.ok(puede('invitado','config',null,'equipos:crear',invitado))
assert.ok(!puede('invitado','config',null,'equipos:eliminar',invitado))

const source=readFileSync(new URL('../app/api/equipos/route.js',import.meta.url),'utf8').replace(/^import .*$/gm,'').replaceAll('export ','')
let autorizado=false
const handlers=new Function('NextResponse','estadoAcceso','estadoAHttp','estadoAMensaje','conEmpresa','guardarEquipo',source+'\nreturn {GET,POST};')({json:(body,init)=>Response.json(body,init)},async(accion,opts)=>{assert.equal(opts.permisoInvitado,accion==='ver'?'equipos:ver':'equipos:crear');return {estado:autorizado?'OK':'SIN_PERMISO'}},()=>403,()=> 'Sin permiso',()=>{throw new Error('No debe consultar sin autorización o con JSON inválido')},guardarEquipo)
assert.equal((await handlers.GET()).status,403)
assert.equal((await handlers.POST(new Request('http://localhost/api/equipos',{method:'POST',body:'{}'}))).status,403)
autorizado=true
assert.equal((await handlers.POST(new Request('http://localhost/api/equipos',{method:'POST',body:'JSON inválido'}))).status,400)
console.log('Equipos: validaciones y permisos OK.')

if(process.argv.includes('--db')) {
 for(const line of readFileSync(new URL('../.env.local',import.meta.url),'utf8').split('\n')) {
  const m=line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/)
  if(m&&!process.env[m[1]])process.env[m[1]]=m[2].replace(/^["']|["']$/g,'')
 }
 assert.ok(['localhost','127.0.0.1','[::1]'].includes(new URL(process.env.DATABASE_URL).hostname),'Solo base local')
 const pg=(await import('pg')).default,db=new pg.Client({connectionString:process.env.DATABASE_URL})
 await db.connect()
 try {
  await db.query('begin')
  const esquema=(await db.query('select esquema from control.empresas limit 1')).rows[0].esquema
  assert.match(esquema,/^[a-z][a-z0-9_]{2,40}$/)
  await db.query('set local search_path to '+esquema)
  const personas=(await db.query('select id from empleados where activo limit 2')).rows.map(p=>p.id)
  assert.ok(personas.length)
  const tag='Equipo transaccional '+randomUUID()
  const a=await guardarEquipo(db,null,{nombre:tag,miembros:personas})
  const b=await guardarEquipo(db,null,{nombre:tag+' B',miembros:[personas[0]]})
  assert.equal((await db.query('select count(*)::int as n from equipo_miembros where empleado_id=$1 and equipo_id=any($2)',[personas[0],[a.id,b.id]])).rows[0].n,2,'Una persona puede estar en varios equipos')
  await guardarEquipo(db,a.id,{nombre:tag+' editado',descripcion:'Actualizado',miembros:[]})
  assert.equal((await db.query('select count(*)::int as n from equipo_miembros where equipo_id=$1',[a.id])).rows[0].n,0)
  await assert.rejects(guardarEquipo(db,null,{nombre:'Inválido',miembros:['empleado-de-otra-empresa']}),e=>e.status===400)
  await assert.rejects(guardarEquipo(db,'equipo-inexistente',{nombre:'Inválido',miembros:[]}),e=>e.status===404)
  await db.query('savepoint duplicado')
  await assert.rejects(guardarEquipo(db,null,{nombre:(tag+' B').toUpperCase(),miembros:[]}),e=>e.code==='23505')
  await db.query('rollback to savepoint duplicado')
  await db.query('delete from equipos where id=$1',[b.id])
  assert.equal((await db.query('select count(*)::int as n from equipo_miembros where equipo_id=$1',[b.id])).rows[0].n,0)
  assert.equal((await db.query('select count(*)::int as n from empleados where id=any($1)',[personas])).rows[0].n,personas.length,'Eliminar equipo conserva colaboradores')
  console.log('Equipos: creación, edición, múltiples grupos, duplicados, eliminación y conservación de colaboradores OK. Todos los cambios se revierten.')
 } finally {await db.query('rollback');await db.end()}
}
