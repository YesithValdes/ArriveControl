/**
 * lib/jornada.js — Jornada legal colombiana, sin base de datos ni red.
 *
 * Vive aparte de configLaboral.js para que el cálculo de horas
 * (lib/calculoHoras.js) se pueda probar sin conexión: esa es la regla que
 * decide cuánto se le paga a la gente.
 *
 * Ley 2101 de 2021: la jornada máxima baja por etapas de 48 a 42 h/semana.
 * `horasDia` asume semana de 6 días, que es la de esta empresa.
 */

/**
 * Salario mínimo mensual legal vigente, en pesos.
 *
 * Se usa como valor POR DEFECTO al registrar a alguien: es lo que gana la
 * mayoría en las empresas que usan esto, y evita dejar el campo vacío —sin
 * salario las horas extra no se valorizan— o teclear siete dígitos cada vez.
 *
 * OJO: cambia cada enero por decreto. Actualízalo aquí y punto: es el único
 * sitio donde vive.
 */
export const SALARIO_MINIMO = 1_759_905

/** Vigencias de la jornada máxima legal, de la más reciente a la más antigua. */
export const VIGENCIAS_LEY_2101 = [
  { desde: '2026-07-15', horasSemana: 42, horasDia: 7 },
  { desde: '2025-07-15', horasSemana: 44, horasDia: 44 / 6 },
  { desde: '2024-07-15', horasSemana: 46, horasDia: 46 / 6 },
  { desde: '2023-07-15', horasSemana: 47, horasDia: 47 / 6 },
  { desde: '1950-01-01', horasSemana: 48, horasDia: 8 },
]

/** Horas de jornada del DÍA vigentes en una fecha (YYYY-MM-DD). */
export function horasDiaEn(vigencias, fechaISO) {
  const v = vigencias.find((x) => fechaISO >= x.desde) ?? vigencias[vigencias.length - 1]
  return v?.horasDia ?? 7
}

/** Horas de jornada SEMANAL vigentes en una fecha (YYYY-MM-DD). */
export function horasSemanaEn(vigencias, fechaISO) {
  const v = vigencias.find((x) => fechaISO >= x.desde) ?? vigencias[vigencias.length - 1]
  return v?.horasSemana ?? 42
}

/**
 * Vigencias derivadas de una jornada semanal fija elegida por la empresa
 * elegida por la empresa.
 */
export function vigenciasDeHorasSemana(horasSemana) {
  const h = Number(horasSemana) || 42
  return [{ desde: '1950-01-01', horasSemana: h, horasDia: h / 6 }]
}
