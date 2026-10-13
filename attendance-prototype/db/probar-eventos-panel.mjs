/** Prueba local de avisos tras COMMIT, sin sondeo de datos. */
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
const url=new URL(process.env.DATABASE_URL??'postgresql://invalid')
if(!['localhost','127.0.0.1','[::1]'].includes(url.hostname))throw Error('Solo base local.')
const {control,conEmpresa}=await import('../lib/db.js')
const {escucharCambiosPanel}=await import('../lib/eventosPanel.js')
const empresas=(await control('select esquema from control.empresas')).rows
const argumento=process.argv.find(a=>a.startsWith('--esquema='))?.slice(10)
const esquema=argumento??(empresas.length===1?empresas[0].esquema:null)
if(!empresas.some(e=>e.esquema===esquema))throw Error('Indica --esquema=...')
const id='prueba-eventos-'+randomUUID()
const eventos=[],ajenos=[]
let esperando=null,pruebas=0
const cerrar=await escucharCambiosPanel(esquema,tablas=>{eventos.push(tablas);esperando?.(tablas)},()=>{throw Error('Se perdió LISTEN')})
const cerrarOtro=await escucharCambiosPanel('otra_empresa_prueba',t=>ajenos.push(t),()=>{})
const esperar=async operacion=>{
 let timeout
 const evento=new Promise((res,rej)=>{esperando=res;timeout=setTimeout(()=>rej(Error('No llegó aviso de cambio.')),2000)})
 try{await operacion();return await evento}finally{clearTimeout(timeout);esperando=null}
}
const test=async(nombre,fn)=>{await fn();pruebas++;console.log('OK:',nombre)}
const pausa=()=>new Promise(r=>setTimeout(r,100))
try{
 await test('guardar avisa empleados después de confirmar la transacción',async()=>{
  const tablas=await esperar(()=>conEmpresa(esquema,db=>db.query("insert into empleados (id,nombre) values ($1,'PRUEBA TEMPORAL EVENTOS')",[id])))
  assert.deepEqual(tablas,['empleados'])
  const dato=await conEmpresa(esquema,db=>db.query('select 1 from empleados where id=$1',[id]))
  assert.equal(dato.rowCount,1)
 })
 await test('editar avisa una sola vez por transacción, aunque haya varias escrituras',async()=>{
  const n=eventos.length
  await esperar(()=>conEmpresa(esquema,async db=>{
   await db.query('update empleados set nombre=$2 where id=$1',[id,'PRUEBA TEMPORAL EVENTOS EDITADA'])
   await db.query('update empleados set activo=false where id=$1',[id])
  }))
  await pausa()
  assert.equal(eventos.length,n+1)
 })
 await test('leer y editar cero filas no envían avisos',async()=>{
  const n=eventos.length
  await conEmpresa(esquema,db=>db.query('select id from empleados where id=$1',[id]))
  await conEmpresa(esquema,db=>db.query('update empleados set activo=true where id=$1',[id+'-no-existe']))
  await pausa()
  assert.equal(eventos.length,n)
 })
 await test('ROLLBACK no envía avisos ni persiste los cambios',async()=>{
  const n=eventos.length
  await assert.rejects(conEmpresa(esquema,async db=>{
   await db.query('update empleados set nombre=$2 where id=$1',[id,'NO GUARDAR'])
   throw Error('Revertir prueba')
  }),/Revertir prueba/)
  await pausa()
  assert.equal(eventos.length,n)
  const r=await conEmpresa(esquema,db=>db.query('select nombre from empleados where id=$1',[id]))
  assert.equal(r.rows[0].nombre,'PRUEBA TEMPORAL EVENTOS EDITADA')
 })
 await test('avisos aislados por empresa',async()=>{assert.equal(ajenos.length,0)})
 await test('eliminar envía un aviso de cambio',async()=>{
  const t=await esperar(()=>conEmpresa(esquema,db=>db.query('delete from empleados where id=$1',[id])))
  assert.deepEqual(t,['empleados'])
 })
 console.log(pruebas+' pruebas de eventos pasaron.')
}finally{
 cerrar();cerrarOtro()
 await conEmpresa(esquema,db=>db.query('delete from empleados where id=$1',[id]))
 await globalThis.__arriveControlPool?.end()
}
