import { NextResponse } from 'next/server'
import { estadoAcceso, estadoAHttp, estadoAMensaje } from '../../../../lib/sesion'
import { conEmpresa } from '../../../../lib/db.js'
import { guardarEquipo } from '../../../../lib/equipos.js'
export const runtime = 'nodejs'
export async function PATCH(req,{params}) {
  const {estado,esquema}=await estadoAcceso('config',{permisoInvitado:'equipos:editar'})
  if(estado!=='OK') return NextResponse.json({ok:false,error:estadoAMensaje(estado)},{status:estadoAHttp(estado)})
  const {id}=await params
  let c
  try{c=await req.json()}catch{return NextResponse.json({ok:false,error:'JSON inválido.'},{status:400})}
  try{return NextResponse.json({ok:true,equipo:await conEmpresa(esquema,db=>guardarEquipo(db,id,c))})}
  catch(e){if(e.status || e.code==='23505')return NextResponse.json({ok:false,error:e.code==='23505'?'Ya existe un área con ese nombre.':e.message},{status:e.status || 409});throw e}
}
export async function DELETE(_req,{params}) {
  const {estado,esquema}=await estadoAcceso('config',{permisoInvitado:'equipos:eliminar'})
  if(estado!=='OK') return NextResponse.json({ok:false,error:estadoAMensaje(estado)},{status:estadoAHttp(estado)})
  const {id}=await params
  const resultado=await conEmpresa(esquema,db=>db.query('delete from equipos where id=$1',[id]))
  if(!resultado.rowCount)return NextResponse.json({ok:false,error:'Área no encontrada.'},{status:404})
  return NextResponse.json({ok:true})
}
