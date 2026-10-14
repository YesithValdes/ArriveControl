import { NextResponse } from 'next/server'
import { estadoAcceso, estadoAHttp, estadoAMensaje, tienePermiso } from '../../../../../lib/sesion'
import { conEmpresa } from '../../../../../lib/db.js'
import { configLaboral } from '../../../../../lib/configLaboral.js'
import { rangoPedido } from '../../../../../lib/periodoHoras.js'
import { lunesDe, domingoDe, sumarDias } from '../../../../../lib/semanaLaboral.js'
import { calcularDetalleJornada } from '../../../../../lib/detalleJornada.js'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req, { params }) {
  const ctx = await estadoAcceso('ver', { permisoInvitado: 'colaboradores:ver' })
  if (ctx.estado !== 'OK') return NextResponse.json({ ok: false, error: estadoAMensaje(ctx.estado) }, { status: estadoAHttp(ctx.estado) })
  for (const permiso of ['marcaciones:ver', 'asistencia:reportes']) if (!tienePermiso(ctx.usuario, 'ver', ctx.empresa, permiso)) return NextResponse.json({ ok: false, error: 'No tienes permiso para ver el detalle de jornada.' }, { status: 403 })
  const rango = rangoPedido(new URL(req.url).searchParams)
  if (!rango || rango.error || Date.parse(rango.hasta) - Date.parse(rango.desde) > 31 * 86400000) return NextResponse.json({ ok: false, error: rango?.error || 'Selecciona un período de hasta 31 días.' }, { status: 400 })
  const { id } = await params
  const verFotos = tienePermiso(ctx.usuario, 'ver', ctx.empresa, 'marcaciones:ver_foto')
  const datos = await conEmpresa(ctx.esquema, async db => {
    const empleado = (await db.query(`select id, nombre, cedula, jornada_dias as "jornadaDias", entrada_esperada as "entradaEsperada", salida_esperada as "salidaEsperada", almuerzo_min as "almuerzoMin" from empleados where id = $1`, [id])).rows[0]
    if (!empleado) return null
    empleado.marcas = (await db.query(`select id, tipo, to_char(ts at time zone 'America/Bogota', 'YYYY-MM-DD') as fecha,
      (extract(hour from ts at time zone 'America/Bogota') * 60 + extract(minute from ts at time zone 'America/Bogota') + extract(second from ts at time zone 'America/Bogota') / 60)::float as minutos,
      extract(epoch from ts)::float as epoch, extract(dow from ts at time zone 'America/Bogota')::int as dow, coalesce(octet_length(foto), 0) > 0 as "tieneFoto"
      from marcaciones where empleado_id = $1 and not eliminada and (ts at time zone 'America/Bogota')::date between $2::date and $3::date order by ts`, [id, sumarDias(lunesDe(rango.desde), -1), sumarDias(domingoDe(rango.hasta), 1)])).rows
    empleado.permisos = (await db.query(`select to_char(inicio,'YYYY-MM-DD') as inicio, to_char(fin,'YYYY-MM-DD') as fin, tipo, descontar, to_char(hora_inicio,'HH24:MI') as hora_inicio, to_char(hora_fin,'HH24:MI') as hora_fin from permisos where empleado_id = $1 and anulado_en is null and inicio <= $3::date and fin >= $2::date`, [id, lunesDe(rango.desde), domingoDe(rango.hasta)])).rows
    // Leer un eventual tope del reglamento sin inventar uno si no está configurado.
    const tope = (await db.query(`select to_jsonb(c)->>'tope_extra_semanal' as tope from config_laboral c where id`)).rows[0]?.tope
    return { empleado, tope: tope == null ? null : Number(tope) }
  })
  if (!datos) return NextResponse.json({ ok: false, error: 'Colaborador no encontrado.' }, { status: 404 })
  const cfg = await configLaboral(ctx.esquema)
  return NextResponse.json({ ok: true, ...calcularDetalleJornada(datos.empleado, { ...cfg, topeExtraSemanal: datos.tope }, rango, undefined, verFotos) }, { headers: { 'Cache-Control': 'no-store' } })
}
