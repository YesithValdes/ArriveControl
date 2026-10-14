import { NextResponse } from 'next/server'
import { estadoAcceso, estadoAHttp, estadoAMensaje } from '../../../../../lib/sesion'
import { soportePermiso } from '../../../../../lib/permisosDb.js'
export const runtime='nodejs'
export async function GET(req,{params}) {
 const ctx=await estadoAcceso('empleados', { permisoInvitado: 'novedades:soportes' })
 if(ctx.estado!=='OK') return NextResponse.json({ok:false,error:estadoAMensaje(ctx.estado)},{status:estadoAHttp(ctx.estado)})
 try {
  const r=await soportePermiso(ctx,(await params).id)
  return new NextResponse(r.bytes,{headers:{'Content-Type':r.soporte_tipo,'Content-Disposition':"attachment; filename*=UTF-8''"+encodeURIComponent(r.soporte_nombre),'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'}})
 }catch(e) { return NextResponse.json({ok:false,error:e.status?e.message:'No se pudo descargar el soporte.'},{status:e.status??500}) }
}
