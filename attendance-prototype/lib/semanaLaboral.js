/**
 * lib/semanaLaboral.js — La SEMANA como unidad de la hora extra.
 *
 * Sin base de datos ni red: es la regla, y se prueba en tests/run-tests.mjs.
 *
 * REGLA (definida por la empresa, 2026-09-13): la jornada se controla POR
 * SEMANA, no por día. Es la jornada flexible del art. 161-d del CST (Ley
 * 2101): las 42 h se reparten entre lunes y sábado como haga falta, y un día
 * largo compensa uno corto.
 *
 *  · Durante la semana solo se ACUMULA. No existe «hora extra» hasta que la
 *    semana cierra (termina el domingo). Estimarla a mitad de semana da un
 *    número que luego no se cumple, así que no se muestra ninguno.
 *  · Al cerrar: lo que pase de las horas de la semana (42 de fábrica,
 *    Ajustes → Reglamento) es extra. Si no llega, no hay extra: los días
 *    largos compensaron los cortos.
 *  · Domingo y festivo NO entran en esa cuenta. Lo que se trabaje esos días
 *    lleva recargo siempre, se cumplan o no las 42 (art. 179 CST): se lleva
 *    aparte como «dominical».
 *  · Un festivo entre semana es día que no se trabaja, pero la semana no se
 *    acorta: se ACREDITAN las horas del horario de ese día a la cuenta, con
 *    aviso de que el cálculo lo tuvo en cuenta. Si además marcó, lo marcado
 *    es dominical Y el horario se acredita igual.
 *
 * Qué pedazo de la semana es la extra —y por tanto de qué tipo (diurna,
 * nocturna)— no se decide aquí: este módulo dice CUÁNTO, y lo hace con el
 * total de horas por día, que es lo que el panel ya tiene.
 */

const DIA_MS = 86400000

/**
 * Mínimo de hora extra que se liquida, en horas, DE FÁBRICA (30 min). Una
 * extra por debajo se descarta entera; por encima, entra completa. Cada
 * empresa fija el suyo en Ajustes → Reglamento (`extra_minima_min`, con
 * vigencia); esto es lo que rige cuando no lo ha tocado. Vive aquí para que
 * el panel y el motor de nómina partan del MISMO corte.
 */
export const EXTRA_MINIMA_H = 0.5

/** Suma días a una fecha YYYY-MM-DD, sin zona horaria de por medio. */
export const sumarDias = (iso, n) =>
  new Date(Date.parse(`${iso}T12:00:00Z`) + n * DIA_MS).toISOString().slice(0, 10)

/** 0=dom … 6=sáb de una fecha YYYY-MM-DD. */
export const diaSemana = (iso) => new Date(`${iso}T12:00:00Z`).getUTCDay()

/** Lunes de la semana a la que pertenece una fecha. */
export const lunesDe = (iso) => sumarDias(iso, -((diaSemana(iso) + 6) % 7))

/** Domingo de la semana a la que pertenece una fecha. */
export const domingoDe = (iso) => sumarDias(lunesDe(iso), 6)

/**
 * Cierra las cuentas de UNA semana.
 *
 * @param {object} p
 * @param {string} p.lunes              YYYY-MM-DD, lunes de la semana
 * @param {Map<string, number>} p.horasPorDia  fecha → horas trabajadas ese día
 *        (ya emparejadas y con los cierres por horario aplicados)
 * @param {Set<string>} p.festivos       fechas festivas (legales + de la empresa)
 * @param {(fecha: string) => number|null} p.horasHorario
 *        horas del HORARIO de la persona ese día (salida − entrada −
 *        almuerzo), o null si ese día no tiene horario. Con esto se acredita
 *        el festivo.
 * @param {number} [p.horasSemana=42]   jornada semanal de la empresa
 * @param {string} p.hoy                YYYY-MM-DD en Bogotá
 * @returns {{
 *   lunes: string, domingo: string, cerrada: boolean,
 *   trabajado: number, ordinarias: number, dominicales: number,
 *   acreditadas: number, festivosAcreditados: Array<{fecha: string, horas: number}>,
 *   cuenta: number, extra: number|null, faltante: number|null,
 * }}
 *   `ordinarias`: lunes a sábado sin festivo. `dominicales`: domingo y
 *   festivos. `cuenta` = ordinarias + acreditadas, lo que se compara con la
 *   jornada semanal. `extra`/`faltante` son null mientras la semana está en
 *   curso: todavía no se sabe.
 */
export function resumenSemana({ lunes, horasPorDia, festivos, horasHorario, horasSemana = 42, hoy }) {
  const domingo = sumarDias(lunes, 6)
  // Cerrada cuando el domingo ya terminó: hoy es, como mínimo, el lunes siguiente.
  const cerrada = domingo < hoy

  let ordinarias = 0
  let dominicales = 0
  let acreditadas = 0
  const festivosAcreditados = []

  for (let i = 0; i < 7; i++) {
    const fecha = sumarDias(lunes, i)
    const horas = horasPorDia.get(fecha) ?? 0
    const esDomingo = i === 6
    const esFestivo = festivos.has(fecha)

    if (esDomingo || esFestivo) {
      dominicales += horas
    } else {
      ordinarias += horas
    }

    // El festivo entre semana se acredita HAYA O NO marcado: el día no se
    // trabaja y la semana no se acorta por eso. Un festivo en domingo no
    // acredita nada, porque el domingo nunca fue día de horario.
    if (esFestivo && !esDomingo) {
      const h = horasHorario(fecha) ?? 0
      if (h > 0) {
        acreditadas += h
        festivosAcreditados.push({ fecha, horas: h })
      }
    }
  }

  const cuenta = ordinarias + acreditadas
  return {
    lunes,
    domingo,
    cerrada,
    trabajado: ordinarias + dominicales,
    ordinarias,
    dominicales,
    acreditadas,
    festivosAcreditados,
    cuenta,
    extra: cerrada ? Math.max(0, cuenta - horasSemana) : null,
    faltante: cerrada ? Math.max(0, horasSemana - cuenta) : null,
  }
}
