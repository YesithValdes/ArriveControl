import { descansoDelHorario } from './descanso.js'
export const fechaValida = f => typeof f === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(f) && Number.isFinite(Date.parse(f + 'T12:00:00Z')) && new Date(f + 'T12:00:00Z').toISOString().slice(0,10) === f
export function validarPermiso(p) {
 if (!['permiso','incapacidad'].includes(p?.tipo)) return 'Selecciona permiso o incapacidad.'
 if (!fechaValida(p.inicio) || !fechaValida(p.fin)) return 'Las fechas no son válidas.'
 if (p.fin < p.inicio) return 'La fecha fin debe ser igual o posterior a la fecha inicio.'
 const hi=p.hora_inicio||null,hf=p.hora_fin||null
 if (hi||hf) {
  if(!hi||!hf) return 'Completa la hora inicio y la hora fin, o deja ambas vacías.'
  if(!/^([01]\d|2[0-3]):[0-5]\d$/.test(hi)||!/^([01]\d|2[0-3]):[0-5]\d$/.test(hf)) return 'Las horas no son válidas.'
  if(p.inicio===p.fin&&hf<=hi) return 'La hora fin debe ser posterior a la hora inicio. Si cruza medianoche, cambia la fecha fin.'
 }
 if ((Date.parse(p.fin)-Date.parse(p.inicio))/86400000 > 366) return 'El período no puede superar 367 días.'
 if (typeof p.motivo !== 'string' || !p.motivo.trim() || p.motivo.trim().length > 2000) return 'Escribe un motivo de hasta 2000 caracteres.'
 if (typeof p.descontar !== 'boolean') return 'Indica si se descuentan las horas no trabajadas.'
 if (p.tipo === 'incapacidad' && !p.soporte) return 'El soporte es obligatorio para una incapacidad.'
 return null
}
const limitesPermiso = p => [Date.parse(p.inicio+'T'+(p.hora_inicio||'00:00')+':00-05:00'),p.hora_fin?Date.parse(p.fin+'T'+p.hora_fin+':00-05:00'):Date.parse(p.fin+'T00:00:00-05:00')+86400000]
export const cruzanFechas = (a,b) => {const [ai,af]=limitesPermiso(a),[bi,bf]=limitesPermiso(b);return ai<bf&&bi<af}
export function diasEntre(inicio,fin) {
 if (!fechaValida(inicio) || !fechaValida(fin) || inicio > fin) return []
 const dias = []
 for (let ms = Date.parse(inicio+'T12:00:00Z'); ms <= Date.parse(fin+'T12:00:00Z'); ms += 86400000) dias.push(new Date(ms).toISOString().slice(0,10))
 return dias
}
export function franjaPermiso(persona,fecha) {
 const dias = persona?.jornadaDias ?? persona?.jornada_dias
 if (dias != null) return dias[String(new Date(fecha+'T12:00:00Z').getUTCDay())] ?? null
 const entrada = persona?.expectedEntry ?? persona?.entradaEsperada ?? persona?.entrada_esperada
 const salida = persona?.expectedExit ?? persona?.salidaEsperada ?? persona?.salida_esperada
 return entrada && salida ? {entrada:String(entrada).slice(0,5),salida:String(salida).slice(0,5),almuerzoMin:persona.breakMinutes ?? persona.almuerzoMin ?? persona.almuerzo_min ?? 0} : null
}
export function horasTurnoPermiso(persona,fecha) {
 const f=franjaPermiso(persona,fecha)
 if (!f) return 0
 const [eh,em]=f.entrada.split(':').map(Number), [sh,sm]=f.salida.split(':').map(Number)
 const inicio=eh*60+em, fin=sh*60+sm
 return Math.max(0, (fin-inicio+(fin<=inicio?1440:0)-descansoDelHorario(f))/60)
}
export function permisoDelDia(persona,fecha) {
 if (!franjaPermiso(persona,fecha)) return null
 return (persona?.permisos ?? []).find(p=>!p.anulado_en && horasPermiso(persona,fecha,p)>0) ?? null
}
// El registro se muestra durante todo su período, aunque ese día sea libre.
export function registroPermisoDelDia(persona,fecha) {
 return (persona?.permisos ?? []).find(p=>!p.anulado_en && (p.inicio<=fecha && p.fin>=fecha || horasPermiso(persona,fecha,p)>0)) ?? null
}
function intervalosTurno(persona,fecha) {
 const f=franjaPermiso(persona,fecha)
 if(!f) return []
 const min=h=>{const[a,b]=String(h).split(':').map(Number);return a*60+b}
 const base=Date.parse(fecha+'T00:00:00-05:00'),inicio=min(f.entrada),fin0=min(f.salida),fin=fin0+(fin0<=inicio?1440:0)
 const desde=f.almuerzoDesde??f.almuerzo_desde,hasta=f.almuerzoHasta??f.almuerzo_hasta
 if(desde&&hasta) {
  let a=min(desde),b=min(hasta)
  if(a<inicio)a+=1440
  if(b<a)b+=1440
  if(a>=inicio&&b<=fin&&b>a)return [[base+inicio*60000,base+a*60000],[base+b*60000,base+fin*60000]]
 }
 return [[base+inicio*60000,base+fin*60000]]
}
export function horasPermiso(persona,fecha,p) {
 if(!p||p.anulado_en) return 0
 if(!p.hora_inicio&&!p.hora_fin) return p.inicio<=fecha&&p.fin>=fecha?horasTurnoPermiso(persona,fecha):0
 const [inicio,fin]=limitesPermiso(p)
 return Math.min(horasTurnoPermiso(persona,fecha),intervalosTurno(persona,fecha).reduce((s,[a,b])=>s+Math.max(0,Math.min(b,fin)-Math.max(a,inicio))/3600000,0))
}
export function horasJustificadasPermiso(persona,fecha,trabajadas=0,pares=[]) {
 const base=Date.parse(fecha+'T00:00:00-05:00')
 const horas=(persona?.permisos??[]).filter(p=>!p.anulado_en).reduce((s,p)=>{
  let cubiertas=horasPermiso(persona,fecha,p)
  if(p.hora_inicio&&p.hora_fin) {
   const [ini,fin]=limitesPermiso(p)
   for(const par of pares.filter(par=>par.fecha===fecha)) {
    for(const [a,b] of intervalosTurno(persona,fecha)) cubiertas-=Math.max(0,Math.min(base+par.hasta*60000,fin,b)-Math.max(base+par.desde*60000,ini,a))/3600000
   }
  }
  return s+Math.max(0,cubiertas)
 },0)
 return Math.max(0,Math.min(horasTurnoPermiso(persona,fecha)-trabajadas,horas))
}
export function horasReconocidas(persona,fecha,trabajadas=0,pares=[]) {
 return horasJustificadasPermiso({...persona,permisos:(persona?.permisos??[]).filter(p=>!p.descontar)},fecha,trabajadas,pares)
}
export const permisoCubreDia = (persona,fecha) => horasJustificadasPermiso(persona,fecha)>=horasTurnoPermiso(persona,fecha)&&horasTurnoPermiso(persona,fecha)>0
export function permisoCubreTramo(persona,fecha,desde,hasta) {
 let requerido=0,cubierto=0
 for(const [a,b] of intervalosTurno(persona,fecha)) {
  const ini=Math.max(a,desde),fin=Math.min(b,hasta)
  if(fin<=ini)continue
  requerido+=fin-ini
  for(const p of persona?.permisos??[]) {
   if(p.anulado_en)continue
   if(!p.hora_inicio&&!p.hora_fin) {if(p.inicio<=fecha&&p.fin>=fecha)cubierto+=fin-ini;continue}
   const [pi,pf]=limitesPermiso(p)
   cubierto+=Math.max(0,Math.min(fin,pf)-Math.max(ini,pi))
  }
 }
 return requerido>0&&cubierto>=requerido
}
export const etiquetaPermiso = p => p ? (p.tipo === 'incapacidad' ? 'Incapacidad' : 'Permiso') + (p.descontar ? ' · con descuento' : ' · sin descuento') + (p.hora_inicio&&p.hora_fin?` · ${p.hora_inicio}–${p.hora_fin}`:'') : ''
export function historialPermisos(registros) {
 return registros.flatMap(p => {
  const comun = { empleado_id:p.empleado_id, empleado_nombre:p.empleado_nombre, motivo:p.motivo, valor_nuevo:p }
  const eventos = [{...comun,id:'permiso-'+p.id+'-crear',accion:'crear_permiso',ts:p.creado_en,admin_user_id:p.creado_por,admin_nombre:p.creado_nombre}]
  if(p.anulado_en) eventos.push({...comun,id:'permiso-'+p.id+'-anular',accion:'anular_permiso',ts:p.anulado_en,admin_user_id:p.anulado_por,admin_nombre:p.anulado_nombre})
  return eventos
 }).sort((a,b)=>new Date(b.ts).getTime()-new Date(a.ts).getTime())
}
export function filasReportePermisos(registros, personaDe, desde = null, hasta = null) {
 const encabezado=['Colaborador','Tipo','Fecha inicio','Fecha fin','Días con turno','Descontar horas no trabajadas','Motivo','Soporte','Estado','Fecha registro','Registrado por','Fecha anulación','Anulado por','Hora inicio','Hora fin']
 const filas=registros.filter(p=>(!desde||p.fin>=desde)&&(!hasta||p.inicio<=hasta)).map(p=>{
  const persona=personaDe(p.empleado_id)
  const inicio=desde&&desde>p.inicio?desde:p.inicio, fin=hasta&&hasta<p.fin?hasta:p.fin
  return [p.empleado_nombre??persona?.name??'',p.tipo==='incapacidad'?'Incapacidad':'Permiso',p.inicio,p.fin,diasEntre(inicio,fin).filter(d=>horasPermiso(persona,d,{...p,anulado_en:null})>0).length,p.descontar?'Sí':'No',p.motivo,p.soporte_nombre??'',p.anulado_en?'Anulado':'Vigente',p.creado_en,p.creado_nombre??p.creado_por,p.anulado_en??'',p.anulado_nombre??p.anulado_por??'',p.hora_inicio??'',p.hora_fin??'']
 })
 return [encabezado,...filas]
}
export function csvPermisos(filas) {
 return '\uFEFF'+filas.map(f=>f.map(v=>{
  let texto=String(v??'')
  if(/^[=+@\-\t\r]/.test(texto)) texto="'"+texto
  return '"'+texto.replaceAll('"','""')+'"'
 }).join(';')).join('\r\n')
}
export function validarSoporte(bytes,tipo) {
 if (!bytes?.length || bytes.length > 8*1024*1024) return 'El soporte debe pesar entre 1 byte y 8 MB.'
 const b=bytes
 const valido = tipo==='application/pdf' ? String.fromCharCode(...b.slice(0,5))==='%PDF-'
 : tipo==='image/png' ? [137,80,78,71,13,10,26,10].every((v,i)=>b[i]===v)
 : tipo==='image/jpeg' ? b[0]===255 && b[1]===216 && b[2]===255
 : tipo==='image/webp' ? String.fromCharCode(...b.slice(0,4))==='RIFF' && String.fromCharCode(...b.slice(8,12))==='WEBP' : false
 return valido ? null : 'Adjunta un PDF o una imagen JPG, PNG o WebP válida.'
}

export function turnoPermisoTerminado(persona,fecha,nowMs) {
 const f=franjaPermiso(persona,fecha)
 if(!f) return false
 const [eh,em]=f.entrada.split(':').map(Number),[sh,sm]=f.salida.split(':').map(Number)
 const inicio=eh*60+em, fin=sh*60+sm
 const cierre=Math.max(1440,fin+(fin<=inicio?1440:0))
 return Date.parse(fecha+'T00:00:00-05:00')+cierre*60000 <= nowMs
}
