/**
 * lib/configLaboral.js — Jornada, festivos y parámetros de pago de una empresa.
 *
 * ArriveControl es un producto independiente: cada empresa define aquí sus
 * propias reglas, en su propio esquema. No hay ninguna fuente externa que
 * mande sobre esto.
 *
 * Dos cosas se juntan en la misma respuesta:
 *   · la fila `config_laboral` de la empresa (jornada, gracia, factores…);
 *   · el calendario oficial de festivos de Colombia, que se calcula solo.
 */
import { getHolidaysForYear } from 'colombian-holidays'
import { conEmpresa } from './db.js'
import { vigenciasDeHorasSemana } from './jornada.js'
import { DIVISOR_DEFECTO, NOCTURNO_DEFECTO, normalizarFactores } from './tiposHora.js'

/** 'HH:MM[:SS]' de Postgres → minutos desde medianoche. */
const aMinutos = (hora, porDefecto) => {
  const m = /^(\d{1,2}):(\d{2})/.exec(String(hora ?? ''))
  return m ? Number(m[1]) * 60 + Number(m[2]) : porDefecto
}

/**
 * Parámetros de PAGO: factores por tipo de hora, divisor del salario y franja
 * nocturna. Se editan en Ajustes → Valorización de horas extra.
 */
export async function parametrosPago(esquema) {
  const { rows } = await conEmpresa(esquema, (db) => db.query(
    `select divisor_horas_mes, factores_hora, nocturno_inicio, nocturno_fin
       from config_laboral where id`,
  ))
  const r = rows[0] ?? {}
  return {
    divisor: Number(r.divisor_horas_mes) || DIVISOR_DEFECTO,
    factores: normalizarFactores(r.factores_hora),
    nocturno: {
      inicio: aMinutos(r.nocturno_inicio, NOCTURNO_DEFECTO.inicio),
      fin: aMinutos(r.nocturno_fin, NOCTURNO_DEFECTO.fin),
    },
  }
}

/**
 * TODAS las vigencias de parámetros de pago, más reciente primero.
 *
 * Cada fila dice qué factores, divisor y franja nocturna rigen DESDE una fecha.
 * Con esto un tramo de marzo se valoriza con las reglas de marzo aunque los
 * factores hayan cambiado en julio — un reporte viejo debe decir siempre lo
 * mismo, se consulte cuando se consulte.
 */
export async function vigenciasPago(esquema) {
  const { rows } = await conEmpresa(esquema, (db) => db.query(
    `select to_char(desde, 'YYYY-MM-DD') as desde,
            factores_hora, divisor_horas_mes, nocturno_inicio, nocturno_fin
       from valorizacion_vigencias order by desde desc`,
  ))
  return rows.map((r) => ({
    desde: r.desde,
    factores: normalizarFactores(r.factores_hora),
    divisor: Number(r.divisor_horas_mes) || DIVISOR_DEFECTO,
    nocturno: {
      inicio: aMinutos(r.nocturno_inicio, NOCTURNO_DEFECTO.inicio),
      fin: aMinutos(r.nocturno_fin, NOCTURNO_DEFECTO.fin),
    },
  }))
}

/**
 * La vigencia que rige en una fecha: la de `desde` más reciente que no sea
 * posterior. Con la lista vacía (esquema anterior a la migración 002) cae a
 * los parámetros actuales de config_laboral, que es el comportamiento viejo.
 */
export const pagoVigenteEn = (vigencias, fechaISO, actual) =>
  vigencias.find((v) => v.desde <= fechaISO) ?? vigencias[vigencias.length - 1] ?? actual

/**
 * Configuración laboral vigente de una empresa.
 *
 * `festivos` mezcla el calendario OFICIAL de Colombia (Ley 51 de 1983, con el
 * traslado al lunes de la Ley Emiliani) —que se calcula, no se carga a mano—
 * con los días que la empresa haya agregado aparte.
 *
 * @param {string} esquema
 * @returns {Promise<{festivos: Set<string>, vigencias: Array, sabadoHabil: boolean,
 *   factores: object, divisor: number, nocturno: {inicio: number, fin: number}}>}
 */
export async function configLaboral(esquema) {
  const pago = await parametrosPago(esquema)

  const { rows } = await conEmpresa(esquema, (db) => db.query(
    `select horas_semana, festivos from config_laboral where id`,
  ))
  const cfg = rows[0] ?? { horas_semana: 42, festivos: [] }

  const anio = new Date().getFullYear()
  const festivos = new Set()
  for (let a = anio - 1; a <= anio + 1; a++) {
    for (const h of getHolidaysForYear(a)) festivos.add(h.celebrationDate)
  }
  for (const f of cfg.festivos ?? []) {
    festivos.add(f instanceof Date ? f.toISOString().slice(0, 10) : String(f).slice(0, 10))
  }

  return {
    festivos,
    vigencias: vigenciasDeHorasSemana(cfg.horas_semana),
    sabadoHabil: true,
    ...pago,
  }
}

// Re-exportados por compatibilidad con quien ya los importaba de aquí.
export { horasDiaEn, horasSemanaEn } from './jornada.js'
