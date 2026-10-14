import { NextResponse } from 'next/server'
import { estadoAcceso, estadoAHttp, estadoAMensaje, tienePermiso } from '../../../lib/sesion'
import { conEmpresa } from '../../../lib/db.js'
import { guardarEquipo } from '../../../lib/equipos.js'
export const runtime = 'nodejs'

export async function GET() {
  const { estado, esquema, usuario, empresa } = await estadoAcceso('ver', { permisoInvitado: 'equipos:ver' })
  if (estado !== 'OK') return NextResponse.json({ ok:false,error:estadoAMensaje(estado) }, { status:estadoAHttp(estado) })
  const datos = await conEmpresa(esquema, async db => {
    const equipos = (await db.query(`select g.id,g.nombre,g.descripcion,g.responsable_id,r.nombre as responsable_nombre,g.activa,g.color,coalesce(json_agg(json_build_object('id',e.id,'nombre',e.nombre,'activo',e.activo,'sede_id',e.sede_id,'sede',s.nombre) order by e.nombre) filter(where e.id is not null),'[]'::json) as miembros from equipos g left join empleados r on r.id=g.responsable_id left join equipo_miembros m on m.equipo_id=g.id left join empleados e on e.id=m.empleado_id left join sedes s on s.id=e.sede_id group by g.id,r.nombre order by lower(g.nombre)`)).rows
    const colaboradores = (await db.query('select e.id,e.nombre,e.sede_id,s.nombre as sede from empleados e left join sedes s on s.id=e.sede_id where e.activo order by e.nombre')).rows
    const sedes = (await db.query('select id,nombre from sedes order by nombre')).rows
    return { equipos, colaboradores, sedes }
  })
  // El registro de colaboradores muestra el campo de áreas solo a quien puede asignarlas.
  return NextResponse.json({ ok:true,...datos,puedeAsignar:tienePermiso(usuario,'config',empresa,'equipos:editar') }, { headers:{'Cache-Control':'no-store'} })
}

export async function POST(req) {
  const { estado, esquema } = await estadoAcceso('config', { permisoInvitado: 'equipos:crear' })
  if (estado !== 'OK') return NextResponse.json({ ok:false,error:estadoAMensaje(estado) }, { status:estadoAHttp(estado) })
  let c
  try { c=await req.json() } catch { return NextResponse.json({ok:false,error:'JSON inválido.'},{status:400}) }
  try { return NextResponse.json({ok:true,equipo:await conEmpresa(esquema,db=>guardarEquipo(db,null,c))},{status:201}) }
  catch(e) { if(e.status || e.code==='23505') return NextResponse.json({ok:false,error:e.code==='23505'?'Ya existe un área con ese nombre.':e.message},{status:e.status || 409}); throw e }
}
