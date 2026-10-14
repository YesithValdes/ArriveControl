import { conEmpresa } from './db.js'
import { cifrarDato, descifrarDato, cifradoConfigurado } from './llaves.js'
import { validarPermiso, diasEntre, horasPermiso, cruzanFechas, validarSoporte } from './permisos.js'
export const CAMPOS_PERMISO = "id, empleado_id, tipo, to_char(inicio,'YYYY-MM-DD') as inicio, to_char(fin,'YYYY-MM-DD') as fin, to_char(hora_inicio,'HH24:MI') as hora_inicio, to_char(hora_fin,'HH24:MI') as hora_fin, motivo, descontar, soporte_nombre, creado_en"
const falla = (error,status=400) => { const e=new Error(error); e.status=status; throw e }
export async function listarPermisos(esquema) {
 return conEmpresa(esquema,async db=>(await db.query('select '+CAMPOS_PERMISO+' from permisos where anulado_en is null order by inicio desc')).rows)
}
export async function registrosPermisos(esquema) {
 return conEmpresa(esquema,async db=>(await db.query(`select p.id,p.empleado_id,p.tipo,to_char(p.inicio,'YYYY-MM-DD') as inicio,to_char(p.fin,'YYYY-MM-DD') as fin,to_char(p.hora_inicio,'HH24:MI') as hora_inicio,to_char(p.hora_fin,'HH24:MI') as hora_fin,p.motivo,p.descontar,p.soporte_nombre,p.creado_en,p.creado_por,p.anulado_en,p.anulado_por,e.nombre as empleado_nombre,uc.name as creado_nombre,ua.name as anulado_nombre
 from permisos p join empleados e on e.id=p.empleado_id
 left join control."user" uc on uc.id=p.creado_por
 left join control."user" ua on ua.id=p.anulado_por
 order by p.creado_en desc`)).rows)
}
export async function guardarPermiso({esquema,empresa,usuario}, empleadoId, datos, archivo) {
 if (archivo?.size > 8*1024*1024) falla('El soporte no puede superar 8 MB.',413)
 const bytes=archivo ? Buffer.from(await archivo.arrayBuffer()) : null
 const error=validarPermiso({...datos,soporte:bytes?.length>0}) ?? (bytes ? validarSoporte(bytes,archivo.type):null)
 if(error) falla(error)
 const soporte=bytes ? (cifradoConfigurado() ? await cifrarDato(empresa,'permisos.soporte',bytes) : bytes.toString('base64')) : null
 return conEmpresa(esquema,async db=>{
  // Serializa altas y anulaciones del mismo empleado: dos peticiones concurrentes no pueden cruzarse.
  const e=(await db.query('select * from empleados where id=$1 for update',[empleadoId])).rows[0]
  if(!e) falla('Colaborador no encontrado.',404)
  const desde=datos.hora_inicio?new Date(Date.parse(datos.inicio+'T12:00:00Z')-86400000).toISOString().slice(0,10):datos.inicio
  if(!diasEntre(desde,datos.fin).some(d=>horasPermiso(e,d,datos)>0)) falla('El período no coincide con un turno asignado.')
  const existentes=(await db.query('select '+CAMPOS_PERMISO+' from permisos where empleado_id=$1 and anulado_en is null',[empleadoId])).rows
  if(existentes.some(p=>cruzanFechas(p,datos))) falla('Las fechas y horas se cruzan con un permiso o incapacidad existente.',409)
  if((await db.query('select 1 from cierres where documento=$1 and desde <= $3::date and hasta >= $2::date',[e.cedula,datos.inicio,datos.fin])).rowCount) falla('Hay un período cerrado en estas fechas. Reábrelo antes de registrar la novedad.',409)
  const rows=(await db.query('insert into permisos (empleado_id,tipo,inicio,fin,motivo,descontar,soporte,soporte_nombre,soporte_tipo,creado_por,hora_inicio,hora_fin) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) returning '+CAMPOS_PERMISO,
  [empleadoId,datos.tipo,datos.inicio,datos.fin,datos.motivo.trim(),datos.descontar,soporte,archivo?.name.slice(0,180)??null,archivo?.type??null,usuario.id,datos.hora_inicio||null,datos.hora_fin||null])).rows
  return rows[0]
 })
}
export async function anularPermiso(ctx,id) {
 return conEmpresa(ctx.esquema,async db=>{
  const p=(await db.query('select empleado_id from permisos where id=$1',[id])).rows[0]
  if(!p) falla('Novedad no encontrada.',404)
  const e=(await db.query('select cedula from empleados where id=$1 for update',[p.empleado_id])).rows[0]
  const actual=(await db.query('select '+CAMPOS_PERMISO+' from permisos where id=$1 and anulado_en is null',[id])).rows[0]
  if(!actual) return
  if((await db.query('select 1 from cierres where documento=$1 and desde <= $3::date and hasta >= $2::date',[e.cedula,actual.inicio,actual.fin])).rowCount) falla('Reabre el período cerrado antes de anular la novedad.',409)
  await db.query('update permisos set anulado_en=now(),anulado_por=$2 where id=$1',[id,ctx.usuario.id])
 })
}
export async function soportePermiso(ctx,id) {
 const r=await conEmpresa(ctx.esquema,async db=>(await db.query('select soporte,soporte_nombre,soporte_tipo from permisos where id=$1',[id])).rows[0])
 if(!r?.soporte) falla('Soporte no encontrado.',404)
 const contenido=await descifrarDato(ctx.empresa,'permisos.soporte',r.soporte,{binario:true})
 return {...r,bytes:Buffer.isBuffer(contenido)?contenido:Buffer.from(contenido,'base64')}
}
