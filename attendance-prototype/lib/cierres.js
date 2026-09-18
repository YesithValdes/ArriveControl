/**
 * lib/cierres.js — Cerrar (y reabrir) períodos de horas extra.
 *
 * Un período abierto se calcula en vivo con la configuración de hoy. Al
 * CERRARLO, lo liquidado de cada persona queda congelado en `cierres` tal
 * como se pagó, y Reportes/API lo muestran desde ahí; un cambio posterior en
 * Ajustes ya no lo toca. Cerrar también anota sus tramos como pagados.
 *
 * Se cierra por persona o el período completo, desde el panel (Reportes) o
 * desde el sistema de nómina (POST /api/horas/cierre). Reabrir deshace las
 * dos cosas: borra el cierre y quita la anotación de pago.
 */
import { conEmpresa } from './db.js'
import { construirLote, resumirLote } from './nomina.js'
import { CODIGOS_HORA } from './tiposHora.js'

/** Los cierres de un período: documento → cierre. */
export async function cierresDe(esquema, { desde, hasta }) {
  const { rows } = await conEmpresa(esquema, (db) => db.query(
    `select documento, nombre, cerrado_en, cerrado_por, horas, horas_extra, valor, tramos
       from cierres where desde = $1::date and hasta = $2::date`,
    [desde, hasta],
  ))
  return new Map(rows.map((r) => [r.documento, {
    documento: r.documento,
    nombre: r.nombre,
    cerradoEn: r.cerrado_en,
    cerradoPor: r.cerrado_por,
    horas: r.horas,
    horasExtra: Number(r.horas_extra),
    valor: r.valor == null ? null : Number(r.valor),
    tramos: r.tramos,
  }]))
}

/**
 * El lote de un período con los cierres aplicados: los tramos de cada persona
 * CERRADA se reemplazan por los que se guardaron al cerrar (marcados
 * `cerrado`), y los de las abiertas quedan como los calculó el motor.
 * @returns {Promise<{registros: Array, porEmpleado: Map, cierres: Map}>}
 */
export async function loteConCierres(esquema, rango) {
  const [lote, cierres] = await Promise.all([construirLote(esquema, rango), cierresDe(esquema, rango)])
  if (cierres.size === 0) return { ...lote, cierres }
  const abiertos = lote.registros.filter((r) => !cierres.has(r.documento))
  const congelados = []
  for (const c of cierres.values()) {
    // El id interno del empleado, para el nombre y la sede del resumen.
    const empId = [...lote.porEmpleado.entries()].find(([, e]) => e.cedula === c.documento)?.[0] ?? null
    for (const t of c.tramos) {
      congelados.push({ ...t, pagado: true, cerrado: true, cerradoEn: c.cerradoEn, cerradoPor: c.cerradoPor, _empleadoId: empId, _semana: t._semana ?? null })
    }
  }
  return { registros: [...abiertos, ...congelados], porEmpleado: lote.porEmpleado, cierres }
}

/**
 * El resumen por empleado de un período, con lo cerrado congelado y lo
 * abierto en vivo. Cada fila dice `cerrado` (y cuándo, por quién).
 */
export async function resumenConCierres(esquema, rango) {
  const lote = await loteConCierres(esquema, rango)
  const { empleados, totales } = resumirLote(lote)
  const filas = empleados.map((e) => {
    const c = lote.cierres.get(e.documento)
    return c
      ? { ...e, nombre: e.nombre ?? c.nombre, cerrado: true, cerradoEn: c.cerradoEn, cerradoPor: c.cerradoPor, pago: 'pagado' }
      : { ...e, cerrado: false, cerradoEn: null, cerradoPor: null }
  })
  // Una persona cerrada SIN tramos (se cerró con cero extra) no sale de los
  // registros: se agrega desde el cierre para que el historial la muestre.
  for (const c of lote.cierres.values()) {
    if (filas.some((f) => f.documento === c.documento)) continue
    filas.push({
      documento: c.documento, nombre: c.nombre, sede: null,
      horas: c.horas, horasExtra: c.horasExtra, valor: c.valor, sinSalario: c.valor == null,
      referencias: c.tramos.map((t) => t.referenciaExterna), referenciasPendientes: [],
      pago: 'pagado', cerrado: true, cerradoEn: c.cerradoEn, cerradoPor: c.cerradoPor,
    })
  }
  const cerrados = filas.filter((f) => f.cerrado).length
  return {
    empleados: filas,
    totales: { ...totales, cerrados, abiertos: filas.length - cerrados },
    cerradoCompleto: filas.length > 0 && cerrados === filas.length,
  }
}

/**
 * Cierra el período para las personas indicadas (o para TODAS las que tengan
 * extras en él, si `documentos` viene vacío). Quien ya estaba cerrada no se
 * toca: lo congelado no se vuelve a congelar con cifras de hoy.
 * @returns {Promise<{cerrados: string[], yaCerrados: string[], sinExtras: string[]}>}
 */
export async function cerrarPeriodo(esquema, { desde, hasta, documentos = null, quien = 'api' }) {
  const lote = await construirLote(esquema, { desde, hasta })
  const { empleados } = resumirLote(lote)
  const yaCerrados = await cierresDe(esquema, { desde, hasta })
  const objetivo = documentos?.length ? new Set(documentos.map(String)) : null
  const resultado = { cerrados: [], yaCerrados: [], sinExtras: [] }

  const porDocumento = new Map(empleados.map((e) => [e.documento, e]))
  const candidatos = objetivo ? [...objetivo] : empleados.map((e) => e.documento)
  for (const documento of candidatos) {
    if (yaCerrados.has(documento)) { resultado.yaCerrados.push(documento); continue }
    let e = porDocumento.get(documento)
    if (!e) {
      // Pedida por cédula pero sin extras en el período: se cierra en cero
      // (quedó liquidada) si la persona existe; si no existe, no es de aquí.
      const { rows } = await conEmpresa(esquema, (db) => db.query(`select nombre from empleados where cedula = $1 limit 1`, [documento]))
      if (!rows[0]) { resultado.sinExtras.push(documento); continue }
      e = { documento, nombre: rows[0].nombre, horas: horasEnCero(), horasExtra: 0, valor: null, referencias: [] }
    }
    const tramos = lote.registros
      .filter((r) => r.documento === documento)
      .map(({ _empleadoId, _semana, pagado, ...t }) => t)
    await conEmpresa(esquema, async (db) => {
      await db.query(
        `insert into cierres (desde, hasta, documento, nombre, cerrado_por, horas, horas_extra, valor, tramos)
         values ($1::date, $2::date, $3, $4, $5, $6::jsonb, $7, $8, $9::jsonb)
         on conflict (desde, hasta, documento) do nothing`,
        [desde, hasta, documento, e.nombre, quien, JSON.stringify(e.horas), e.horasExtra, e.valor, JSON.stringify(tramos)],
      )
      // Cerrar es pagar: los tramos quedan anotados como pagados.
      if (e.referencias.length) {
        await db.query(
          `insert into horas_pagadas (referencia_externa, documento, pagado_por)
           select * from unnest($1::text[], $2::text[], $3::text[])
           on conflict (referencia_externa) do nothing`,
          [e.referencias, e.referencias.map(() => documento), e.referencias.map(() => quien)],
        )
      }
    })
    resultado.cerrados.push(documento)
  }
  return resultado
}

/**
 * Reabre el período para las personas indicadas (o para todas): borra el
 * cierre y la anotación de pago de sus tramos, y vuelve al cálculo en vivo.
 * @returns {Promise<{reabiertos: string[]}>}
 */
export async function reabrirPeriodo(esquema, { desde, hasta, documentos = null }) {
  const cierres = await cierresDe(esquema, { desde, hasta })
  const objetivo = documentos?.length ? documentos.map(String).filter((d) => cierres.has(d)) : [...cierres.keys()]
  for (const documento of objetivo) {
    const c = cierres.get(documento)
    await conEmpresa(esquema, async (db) => {
      await db.query(`delete from cierres where desde = $1::date and hasta = $2::date and documento = $3`, [desde, hasta, documento])
      const refs = c.tramos.map((t) => t.referenciaExterna).filter(Boolean)
      if (refs.length) await db.query(`delete from horas_pagadas where referencia_externa = any($1::text[])`, [refs])
    })
  }
  return { reabiertos: objetivo }
}

/** Horas por tipo en cero, para un cierre sin extras. */
export const horasEnCero = () => Object.fromEntries(CODIGOS_HORA.map((c) => [c, 0]))
