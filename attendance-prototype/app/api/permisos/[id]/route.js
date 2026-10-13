import { NextResponse } from 'next/server'
import { estadoAcceso, estadoAHttp, estadoAMensaje } from '../../../../lib/sesion'
import { anularPermiso } from '../../../../lib/permisosDb.js'
export async function DELETE(req,{params}) {
 const ctx=await estadoAcceso('empleados', { permisoInvitado: 'novedades:eliminar' })
 if(ctx.estado!=='OK') return NextResponse.json({ok:false,error:estadoAMensaje(ctx.estado)},{status:estadoAHttp(ctx.estado)})
 try { await anularPermiso(ctx,(await params).id); return NextResponse.json({ok:true}) }
 catch(e) { return NextResponse.json({ok:false,error:e.status?e.message:'No se pudo anular la novedad.'},{status:e.status??500}) }
}
