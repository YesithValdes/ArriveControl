import { NextResponse } from 'next/server'
import { estadoAcceso, estadoAHttp, estadoAMensaje, tienePermiso } from '../../../lib/sesion'
import { registrosPermisos, guardarPermiso } from '../../../lib/permisosDb.js'
import { historialPermisos } from '../../../lib/permisos.js'
export const runtime='nodejs'
export async function GET() {
 const ctx=await estadoAcceso('ver', { permisoInvitado: 'panel:ver' })
 if(ctx.estado!=='OK') return NextResponse.json({ok:false,error:estadoAMensaje(ctx.estado)},{status:estadoAHttp(ctx.estado)})
 const registros=await registrosPermisos(ctx.esquema)
 return NextResponse.json({ok:true,permisos:registros.filter(p=>!p.anulado_en),registros,historial:historialPermisos(registros)})
}
export async function POST(req) {
 const ctx=await estadoAcceso('empleados', { permisoInvitado: 'novedades:crear' })
 if(ctx.estado!=='OK') return NextResponse.json({ok:false,error:estadoAMensaje(ctx.estado)},{status:estadoAHttp(ctx.estado)})
 if(Number(req.headers.get('content-length')??0)>9*1024*1024) return NextResponse.json({ok:false,error:'El soporte es demasiado grande.'},{status:413})
 try {
  const f=await req.formData()
  const archivo=f.get('soporte')
  const datos={tipo:f.get('tipo'),inicio:f.get('inicio'),fin:f.get('fin'),hora_inicio:f.get('hora_inicio')||null,hora_fin:f.get('hora_fin')||null,motivo:f.get('motivo'),descontar:f.get('descontar')==='true'?true:f.get('descontar')==='false'?false:null}
  const soporte=archivo && typeof archivo.arrayBuffer==='function' && archivo.size ? archivo:null
  // Adjuntar un soporte o decidir si se descuentan horas son permisos aparte
  // del Invitado (a los demás roles no les cambia nada).
  if(soporte && !tienePermiso(ctx.usuario,'empleados',ctx.empresa,'novedades:soportes')) return NextResponse.json({ok:false,error:'No tienes permiso para adjuntar soportes.'},{status:403})
  if(datos.descontar===true && !tienePermiso(ctx.usuario,'empleados',ctx.empresa,'novedades:descontar')) return NextResponse.json({ok:false,error:'No tienes permiso para descontar horas no trabajadas.'},{status:403})
  const permiso=await guardarPermiso(ctx,f.get('empleado_id'),datos,soporte)
  return NextResponse.json({ok:true,permiso},{status:201})
 } catch(e) {
  if(!e.status) console.error('Guardar permiso:',e.message)
  return NextResponse.json({ok:false,error:e.status?e.message:'No se pudo guardar la novedad.'},{status:e.status??500})
 }
}
