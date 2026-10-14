/** Datos locales de permisos e incapacidades. Repetible sin duplicados. */
import {conEmpresa,control} from '../lib/db.js'
import {guardarPermiso,anularPermiso,registrosPermisos} from '../lib/permisosDb.js'
const url=new URL(process.env.DATABASE_URL??'postgresql://invalid')
if(!['localhost','127.0.0.1','[::1]'].includes(url.hostname))throw Error('Solo base local.')
const esquema=process.argv.find(a=>a.startsWith('--esquema='))?.slice(10)
const empresa=(await control('select id,esquema from control.empresas where esquema=$1',[esquema])).rows[0]
if(!empresa)throw Error('Indica --esquema=...')
const hoy=new Date(Date.now()-5*3600000).toISOString().slice(0,10)
const mover=(f,d)=>new Date(Date.parse(f+'T12:00:00Z')+d*86400000).toISOString().slice(0,10)
const ayer=mover(hoy,-1)
const franja={entrada:'08:00',salida:'17:00',almuerzo_desde:'12:00',almuerzo_hasta:'13:00',almuerzo_min:60}
const casos=[
 ['PERMISO_DIA', 'permiso',false,hoy,null,null,[],false,false],
 ['INCAPACIDAD_DIAS','incapacidad',false,hoy,null,null,[],false,false],
 ['INCAPACIDAD_DESCUENTO','incapacidad',true,hoy,null,null,[],false,false],
 ['INCAPACIDAD_DIA_LIBRE','incapacidad',false,hoy,null,null,[],true,false],
 ['PERMISO_HORAS','permiso',false,ayer,'15:00','17:00',['08:00','12:00','13:00','15:00'],false,false],
 ['INCAPACIDAD_HORAS','incapacidad',false,ayer,'15:00','17:00',['08:00','12:00','13:00','15:00'],false,false],
 ['PERMISO_HORAS_DESCUENTO','permiso',true,ayer,'15:00','17:00',['08:00','12:00','13:00','15:00'],false,false],
 ['INCAPACIDAD_ANULADA','incapacidad',false,hoy,null,null,[],false,true],
]
const ctx={esquema,empresa,usuario:{id:'fixture-local'}}
try{
 for(const [codigo,tipo,descontar,inicio,hi,hf,marcas,libre,anulado] of casos){
  const id='fixture-permisos-v1-'+hoy+'-'+codigo
  const previo=await conEmpresa(esquema,async db=>{
   await db.query("insert into empleados(id,nombre,cedula,entrada_esperada,salida_esperada,almuerzo_min,jornada_dias,salario_mensual,activo) values($1,$2,$1,'08:00','17:00',60,$3,2100000,true) on conflict(id) do nothing",[id,'PRUEBA NOV '+codigo,JSON.stringify(libre?{}:Object.fromEntries([0,1,2,3,4,5,6].map(d=>[d,franja])))])
   return (await db.query('select id from permisos where empleado_id=$1',[id])).rowCount>0
  })
  if(previo){console.log('Conservado:',codigo);continue}
  const soporte=tipo==='incapacidad'?new File(['%PDF-1.4\nSoporte ficticio de prueba, sin validez medica.'],'soporte_prueba.pdf',{type:'application/pdf'}):null
  // El caso de día libre se registra primero con turno; luego se simula el cambio de horario.
  if(libre)await conEmpresa(esquema,db=>db.query('update empleados set jornada_dias=$2 where id=$1',[id,JSON.stringify(Object.fromEntries([0,1,2,3,4,5,6].map(d=>[d,franja])))]))
  const fin=codigo==='INCAPACIDAD_DIAS'?mover(inicio,3):inicio
  const p=await guardarPermiso(ctx,id,{tipo,inicio,fin,hora_inicio:hi,hora_fin:hf,motivo:'DATOS DE PRUEBA: '+codigo,descontar},soporte)
  await conEmpresa(esquema,async db=>{
   for(const [i,h] of marcas.entries())await db.query('insert into marcaciones(id,empleado_id,tipo,ts,origen) values($1,$2,$3,$4,$5) on conflict(id) do nothing',[id+'-marca-'+i,id,i%2?'salida':'entrada',inicio+'T'+h+':00-05:00','manual'])
   if(libre)await db.query("update empleados set jornada_dias='{}' where id=$1",[id])
  })
  if(anulado)await anularPermiso(ctx,p.id)
  console.log('Creado:',codigo,inicio,fin,hi??'día completo')
 }
 const registros=(await registrosPermisos(esquema)).filter(p=>p.empleado_id.startsWith('fixture-permisos-v1-'+hoy+'-'))
 if(registros.length!==casos.length)throw Error('Faltan casos de prueba')
 console.log('Verificados '+registros.length+' registros. Buscar PRUEBA NOV en Asistencia. Hoy: '+hoy+'; parciales: '+ayer)
}finally{await globalThis.__arriveControlPool?.end()}
