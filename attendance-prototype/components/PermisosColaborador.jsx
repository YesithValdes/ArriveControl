'use client'
import { useEffect, useRef, useState } from 'react'
import { validarPermiso, validarSoporte, diasEntre, horasPermiso, etiquetaPermiso, filasReportePermisos, csvPermisos } from '../lib/permisos.js'
import { guardarPermiso, anularPermiso } from '../services/panelStore.js'
export default function PermisosColaborador({persona,onClose,onSaved}) {
 const [form,setForm]=useState({tipo:'permiso',inicio:'',fin:'',hora_inicio:'',hora_fin:'',motivo:'',descontar:false})
 const [archivo,setArchivo]=useState(null), [error,setError]=useState(''), [ocupado,setOcupado]=useState(false)
 const dialog=useRef(null)
 useEffect(()=>{
  const previo=document.activeElement
  dialog.current?.focus()
  const teclado=e=>{
   if(e.key==='Escape'&&!ocupado) onClose()
   if(e.key==='Tab') {
    const el=[...dialog.current.querySelectorAll('button,input,select,textarea,a[href]')].filter(n=>!n.disabled)
    if(!el.length) return
    const primero=el[0],ultimo=el.at(-1)
    if(e.shiftKey&&(document.activeElement===primero||document.activeElement===dialog.current)){e.preventDefault();ultimo.focus()}
    else if(!e.shiftKey&&document.activeElement===ultimo){e.preventDefault();primero.focus()}
   }
  }
  document.addEventListener('keydown',teclado)
  return ()=>{document.removeEventListener('keydown',teclado);previo?.focus()}
 },[onClose,ocupado])
 const campo=(nombre,valor)=>setForm(f=>({...f,[nombre]:valor}))
 const guardar=async e=>{
  e.preventDefault()
  const mensaje=validarPermiso({...form,soporte:archivo?.size>0})
  if(mensaje){setError(mensaje);return}
  setOcupado(true);setError('')
  try{
   if(archivo){const err=validarSoporte(new Uint8Array(await archivo.arrayBuffer()),archivo.type);if(err)throw new Error(err)}
   const registro=await guardarPermiso(persona.id,form,archivo)
   if(registro.tipo==='incapacidad') descargarRegistros([registro],`incapacidad_${persona.id}_${registro.inicio}_${registro.id}.csv`)
   await onSaved()
  }catch(e){setError(e.message)}finally{setOcupado(false)}
 }
 const dias=diasEntre(form.inicio,form.fin).filter(d=>horasPermiso(persona,d,form)>0)
 const historial=persona.permisosHistorial??persona.permisos??[]
 const descargarRegistros=(registros,nombre)=>{
  const filas=filasReportePermisos(registros,()=>persona)
  const url=URL.createObjectURL(new Blob([csvPermisos(filas)],{type:'text/csv;charset=utf-8;'}))
  const enlace=document.createElement('a');enlace.href=url;enlace.download=nombre;enlace.click()
  setTimeout(()=>URL.revokeObjectURL(url),1000)
 }
 const descargarReporte=()=>descargarRegistros(historial,'permisos_incapacidades_'+persona.id+'.csv')
 return <div className="permiso-overlay">
  <section className="permiso-modal" role="dialog" aria-modal="true" aria-labelledby="permiso-titulo" ref={dialog} tabIndex={-1}>
   <header><div><h3 id="permiso-titulo">Permisos e incapacidades</h3><p>{persona.name}</p></div><button type="button" onClick={onClose} disabled={ocupado} aria-label="Cerrar">✕</button></header>
   <form onSubmit={guardar}>
    <fieldset disabled={ocupado}>
     <label>Tipo<select value={form.tipo} onChange={e=>campo('tipo',e.target.value)}><option value="permiso">Permiso</option><option value="incapacidad">Incapacidad</option></select></label>
     <div className="permiso-fechas"><label>Fecha inicio<input required type="date" value={form.inicio} onChange={e=>campo('inicio',e.target.value)}/></label><label>Fecha fin<input required type="date" min={form.inicio||undefined} value={form.fin} onChange={e=>campo('fin',e.target.value)}/></label></div>
     <div className="permiso-fechas"><label>Hora inicio (opcional)<input type="time" value={form.hora_inicio} required={!!form.hora_fin} onChange={e=>campo('hora_inicio',e.target.value)}/></label><label>Hora fin (opcional)<input type="time" value={form.hora_fin} required={!!form.hora_inicio} onChange={e=>campo('hora_fin',e.target.value)}/></label></div>
     <p>Sin horas, cubre días completos. La hora inicio corresponde a la fecha inicio y la hora fin a la fecha fin.</p>
     <label>Motivo<textarea required maxLength={2000} value={form.motivo} onChange={e=>campo('motivo',e.target.value)}/></label>
     <label>Soporte {form.tipo==='incapacidad'?'(obligatorio)':'(opcional)'}<input type="file" accept=".pdf,.jpg,.jpeg,.png,.webp" required={form.tipo==='incapacidad'} onChange={e=>setArchivo(e.target.files?.[0]??null)}/></label>
     <small>PDF o imagen, máximo 8 MB.</small>
     <label className="permiso-check"><input type="checkbox" checked={form.descontar} onChange={e=>campo('descontar',e.target.checked)}/>¿Descontar horas no trabajadas?</label>
     <p>{form.descontar?'Contarán solo las horas registradas.':'Se reconocerán las horas del turno que no se trabajaron, sin generar horas extra por la novedad.'}</p>
     {form.inicio&&form.fin&&<p>{dias.length} día(s) con turno. Las fechas incluyen el día de inicio y fin.</p>}
    </fieldset>
    {error&&<p role="alert" className="permiso-error">{error}</p>}
    <footer><button type="button" onClick={onClose} disabled={ocupado}>Cancelar</button><button type="submit" disabled={ocupado}>{ocupado?'Guardando…':'Guardar'}</button></footer>
   </form>
   {historial.length>0&&<div className="permiso-lista"><h4>Historial de novedades</h4><button type="button" onClick={descargarReporte}>Descargar reporte (CSV)</button>{historial.map(p=><article key={p.id}><b>{etiquetaPermiso(p)}{p.anulado_en?' · Anulado':''}</b><span>{p.inicio} — {p.fin}</span><p>{p.motivo}</p><small>Registrado: {new Date(p.creado_en).toLocaleString('es-CO',{timeZone:'America/Bogota'})} · {p.creado_nombre??p.creado_por??'admin'}</small>{p.anulado_en&&<small>Anulado: {new Date(p.anulado_en).toLocaleString('es-CO',{timeZone:'America/Bogota'})} · {p.anulado_nombre??p.anulado_por}</small>}{p.soporte_nombre&&<a href={'/api/permisos/'+encodeURIComponent(p.id)+'/soporte'}>Descargar soporte</a>}{!p.anulado_en&&<button type="button" disabled={ocupado} onClick={async()=>{if(!confirm('¿Anular esta novedad? Se volverán a calcular sus horas y anomalías.'))return;setOcupado(true);try{await anularPermiso(p.id);await onSaved()}catch(e){setError(e.message)}finally{setOcupado(false)}}}>Anular</button>}</article>)}</div>}
  </section>
  <style jsx>{`
   .permiso-overlay{position:fixed;inset:0;z-index:1000;background:#0006;display:flex;align-items:center;justify-content:center;padding:16px}
   .permiso-modal{background:var(--surface,#fff);color:var(--ink,#17212b);border-radius:16px;padding:24px;width:min(540px,100%);max-height:90dvh;overflow:auto;box-shadow:0 12px 48px #0003}
   header,footer,.permiso-fechas{display:flex;gap:16px;justify-content:space-between}header h3{margin:0}header p{color:var(--muted);margin:8px 0 20px}header button{align-self:flex-start}
   fieldset{border:0;padding:0;margin:0}label{display:flex;flex-direction:column;gap:6px;margin-bottom:14px;font-size:13px}input,select,textarea{border:1px solid var(--border,#ccd);border-radius:8px;padding:10px;font:inherit;background:var(--surface,#fff);color:inherit}textarea{min-height:75px;resize:vertical}
   .permiso-fechas label{flex:1;min-width:0}.permiso-check{flex-direction:row;align-items:center;margin-top:16px}.permiso-check input{margin:0}p,small{font-size:12px}footer{justify-content:flex-end;margin-top:20px}button{cursor:pointer;padding:8px 12px;border:1px solid var(--border,#ccd);border-radius:8px;background:var(--surface,#fff);color:inherit}button[type=submit]{background:var(--btn-primary,#2563eb);color:white}button:disabled{opacity:.55;cursor:default}.permiso-error{color:var(--crit-text,#b91c1c)}.permiso-lista{margin-top:24px}.permiso-lista article{border-top:1px solid var(--border,#ccd);padding:12px 0;display:grid;gap:6px}.permiso-lista button{justify-self:start}.permiso-lista span{font-size:12px}
  `}</style>
 </div>
}
