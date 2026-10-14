/**
 * Prueba local del guardado real, cruces concurrentes, soportes y anulaciones.
 * Solo crea un colaborador desechable y elimina únicamente sus propias filas.
 * node --env-file=.env.local db/probar-permisos.mjs
 */
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
const u=new URL(process.env.DATABASE_URL??'postgresql://invalid')
if(!['localhost','127.0.0.1','[::1]'].includes(u.hostname)) throw new Error('Solo base local.')
const { conEmpresa, control }=await import('../lib/db.js')
const { guardarPermiso, listarPermisos, soportePermiso, anularPermiso, registrosPermisos }=await import('../lib/permisosDb.js')
const { historialPermisos, filasReportePermisos, csvPermisos }=await import('../lib/permisos.js')
const esquemaArg=process.argv.find(a=>a.startsWith('--esquema='))?.slice(10)
const empresas=(await control('select id, esquema from control.empresas')).rows
const empresa=esquemaArg?empresas.find(e=>e.esquema===esquemaArg):empresas.length===1?empresas[0]:null
if(!empresa) throw new Error('Indica una empresa con --esquema=...')
const ctx={esquema:empresa.esquema,empresa,usuario:{id:'prueba-permisos'}}
const id='prueba-permisos-'+randomUUID(), documento=id
const base={tipo:'permiso',inicio:'2026-09-28',fin:'2026-09-28',motivo:'Prueba de permiso',descontar:false}
let pruebas=0
const test=async(nombre,fn)=>{await fn();pruebas++;console.log('OK:',nombre)}
try{
 await conEmpresa(ctx.esquema,db=>db.query("insert into empleados (id,nombre,cedula,entrada_esperada,salida_esperada,almuerzo_min) values ($1,'PRUEBA TEMPORAL PERMISOS',$2,'08:00','17:00',60)",[id,documento]))
 let p
 await test('guarda permiso y devuelve fechas en formato calendario',async()=>{
  p=await guardarPermiso(ctx,id,base,null)
  assert.equal(p.inicio,base.inicio)
  assert.ok((await listarPermisos(ctx.esquema)).some(r=>r.id===p.id))
 })
 await test('rechaza cruces y fechas inválidas',async()=>{
  await assert.rejects(guardarPermiso(ctx,id,base,null),e=>e.status===409)
  await assert.rejects(guardarPermiso(ctx,id,{...base,inicio:'2026-02-30'},null),e=>e.status===400)
 })
 await test('incapacidad sin soporte se rechaza',async()=>{
  await assert.rejects(guardarPermiso(ctx,id,{...base,tipo:'incapacidad',inicio:'2026-09-29',fin:'2026-09-29'},null),e=>e.status===400)
 })
 await test('anulación libera el período y queda auditada',async()=>{
  await anularPermiso(ctx,p.id)
  assert.ok(!(await listarPermisos(ctx.esquema)).some(r=>r.id===p.id))
  const a=await conEmpresa(ctx.esquema,db=>db.query('select anulado_por from permisos where id=$1',[p.id]))
  assert.equal(a.rows[0].anulado_por,ctx.usuario.id)
 })
 await test('historial conserva creación y anulación; reporte incluye estado y motivo',async()=>{
  const registros=(await registrosPermisos(ctx.esquema)).filter(r=>r.id===p.id)
  assert.equal(registros.length,1)
  const historial=historialPermisos(registros)
  assert.equal(historial.length,2)
  assert.deepEqual(new Set(historial.map(h=>h.accion)),new Set(['crear_permiso','anular_permiso']))
  const reporte=filasReportePermisos(registros,()=>({expectedEntry:'08:00',expectedExit:'17:00',breakMinutes:60}))
  assert.equal(reporte[1][4],1)
  assert.equal(reporte[1][8],'Anulado')
  assert.ok(csvPermisos(reporte).includes('Prueba de permiso'))
 })
 await test('dos guardados concurrentes: uno se guarda y el otro recibe conflicto',async()=>{
  const resultado=await Promise.allSettled([guardarPermiso(ctx,id,base,null),guardarPermiso(ctx,id,base,null)])
  assert.equal(resultado.filter(r=>r.status==='fulfilled').length,1)
  assert.equal(resultado.find(r=>r.status==='rejected').reason.status,409)
 })
 await test('soporte almacenado y descargado conserva el archivo',async()=>{
  const archivo=new File(['%PDF-1.7\nsoporte de prueba'],'soporte.pdf',{type:'application/pdf'})
  const inc=await guardarPermiso(ctx,id,{...base,tipo:'incapacidad',inicio:'2026-09-29',fin:'2026-09-29',descontar:true},archivo)
  const descargado=await soportePermiso(ctx,inc.id)
  assert.equal(descargado.bytes.toString(),await archivo.text())
  assert.equal(descargado.soporte_nombre,'soporte.pdf')
 })
 await test('rechaza cambiar períodos ya cerrados',async()=>{
  await conEmpresa(ctx.esquema,db=>db.query("insert into cierres (desde,hasta,documento,horas,horas_extra,tramos) values ('2026-09-30','2026-09-30',$1,'{}',0,'[]')",[documento]))
  await assert.rejects(guardarPermiso(ctx,id,{...base,inicio:'2026-09-30',fin:'2026-09-30'},null),e=>e.status===409)
 })
 await test('guarda horas, admite tramos consecutivos y rechaza solapamientos',async()=>{
  const horario={...base,inicio:'2026-10-01',fin:'2026-10-01',hora_inicio:'09:00',hora_fin:'10:00'};
  const guardado=await guardarPermiso(ctx,id,horario,null);
  assert.equal(guardado.hora_inicio,'09:00');
  assert.equal(guardado.hora_fin,'10:00');
  await guardarPermiso(ctx,id,{...horario,hora_inicio:'10:00',hora_fin:'11:00'},null);
  await assert.rejects(guardarPermiso(ctx,id,{...horario,hora_inicio:'09:30',hora_fin:'10:30'},null),e=>e.status===409);
  assert.equal((await registrosPermisos(ctx.esquema)).find(p=>p.id===guardado.id).hora_inicio,'09:00');
 });
 console.log(pruebas+' pruebas de base de datos pasaron.')
}finally{
 await conEmpresa(ctx.esquema,async db=>{
  await db.query('delete from permisos where empleado_id=$1',[id])
  await db.query('delete from cierres where documento=$1',[documento])
  await db.query('delete from empleados where id=$1',[id])
 })
 await globalThis.__arriveControlPool?.end()
}
