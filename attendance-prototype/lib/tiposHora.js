/**
 * lib/tiposHora.js — CATÁLOGO de tipos de hora extra y su valorización.
 *
 * Es la única lista de códigos del producto. Antes vivía implícita dentro del
 * cálculo ('HED' y 'HEDD' escritos a mano); ahora está aquí para que el motor,
 * la API, los Ajustes y los reportes hablen exactamente del mismo conjunto.
 *
 * Dos ideas que conviene no mezclar:
 *
 *  · FACTOR (no recargo). El número que se guarda es el multiplicador TOTAL
 *    sobre la hora ordinaria, no el sobrecosto: la extra diurna es 1.25, que
 *    ya incluye la hora misma. Se guarda así porque es como lo dice la tabla
 *    del reglamento y porque valorizar queda en una sola multiplicación —
 *    nadie tiene que acordarse de sumarle 1.
 *
 *  · Los factores son PARÁMETROS, no ley escrita en el código. Los edita
 *    cualquiera desde Ajustes → Valorización de horas extra, porque cambian
 *    con la reforma laboral y con lo que pacte cada empresa. Los valores de
 *    aquí abajo son solo el punto de partida de una instalación nueva.
 *
 * Sin base de datos ni red: se puede probar (ver tests/run-tests.mjs).
 */

/**
 * Los cuatro tipos de hora extra que emite ArriveControl.
 *
 * El código sale de cruzar dos ejes: si el tramo cae en franja nocturna y si
 * el día es dominical o festivo. No hay más combinaciones posibles.
 */
export const TIPOS_HORA = [
  { codigo: 'HED', nombre: 'Hora extra diurna', factor: 1.25, nocturna: false, dominical: false },
  { codigo: 'HEN', nombre: 'Hora extra nocturna', factor: 1.75, nocturna: true, dominical: false },
  { codigo: 'HEDDF', nombre: 'Hora extra diurna dominical o festiva', factor: 2.15, nocturna: false, dominical: true },
  { codigo: 'HENDF', nombre: 'Hora extra nocturna dominical o festiva', factor: 2.65, nocturna: true, dominical: true },
]

/** Códigos válidos, en el orden en que se muestran. */
export const CODIGOS_HORA = TIPOS_HORA.map((t) => t.codigo)

/** Factores de fábrica: `{ HED: 1.25, HEN: 1.75, … }`. */
export const FACTORES_DEFECTO = Object.fromEntries(TIPOS_HORA.map((t) => [t.codigo, t.factor]))

/** Nombre legible de un código (para reportes y pantallas). */
export const nombreTipo = (codigo) =>
  TIPOS_HORA.find((t) => t.codigo === codigo)?.nombre ?? codigo

/**
 * Código que corresponde a un tramo.
 * @param {{nocturna: boolean, dominical: boolean}} tramo
 */
export function codigoDeTramo({ nocturna, dominical }) {
  const t = TIPOS_HORA.find((x) => x.nocturna === Boolean(nocturna) && x.dominical === Boolean(dominical))
  return t.codigo // las cuatro combinaciones existen: nunca es undefined
}

// ── Franja nocturna ───────────────────────────────────────────────────

/**
 * Franja nocturna de fábrica, en minutos desde medianoche: 21:00 → 06:00
 * (CST art. 160, reformado por la Ley 789 de 2002). Es un parámetro editable
 * porque las empresas con turnos propios a veces pactan otro corte.
 */
export const NOCTURNO_DEFECTO = { inicio: 21 * 60, fin: 6 * 60 }

/**
 * Divisor de fábrica para pasar de salario mensual a valor hora.
 * Se DERIVA de la jornada reglamentaria: horas_semana × 5 (42 → 210). Ya no es
 * un parámetro suelto — cambiar la jornada en Reglamento lo recalcula.
 */
export const DIVISOR_DEFECTO = 42 * 5

/**
 * ¿Ese minuto del día cae en franja nocturna?
 * Acepta minutos ABSOLUTOS (un turno que cruza medianoche llega con 1560) y
 * soporta franjas que dan la vuelta al reloj (21:00 → 06:00) y las que no.
 */
export function esNocturno(minutoAbsoluto, { inicio, fin } = NOCTURNO_DEFECTO) {
  const m = ((Math.floor(minutoAbsoluto) % 1440) + 1440) % 1440
  return inicio < fin ? m >= inicio && m < fin : m >= inicio || m < fin
}

/**
 * Parte un rango [desde, hasta] (minutos absolutos desde las 0:00 del día de
 * entrada) en tramos homogéneos: cada uno cae entero en franja diurna o entera
 * en nocturna.
 *
 * Se hace por FRONTERAS y no minuto a minuto para no perder los segundos al
 * redondear: un tramo 20:40 → 21:50 sale como 20:40–21:00 diurno y
 * 21:00–21:50 nocturno, exacto.
 *
 * @returns {Array<{desde: number, hasta: number, nocturna: boolean}>}
 */
export function partirPorNocturno(desde, hasta, franja = NOCTURNO_DEFECTO) {
  if (!(hasta > desde)) return []

  // Fronteras candidatas: los cortes de la franja en cada día que toca el
  // rango. Se recorren los días desde el de `desde` hasta el de `hasta`.
  const cortes = new Set()
  const diaIni = Math.floor(desde / 1440)
  const diaFin = Math.floor(hasta / 1440)
  for (let d = diaIni; d <= diaFin; d++) {
    for (const corte of [d * 1440 + franja.inicio, d * 1440 + franja.fin]) {
      if (corte > desde && corte < hasta) cortes.add(corte)
    }
  }

  const puntos = [desde, ...[...cortes].sort((a, b) => a - b), hasta]
  const tramos = []
  for (let i = 0; i < puntos.length - 1; i++) {
    const ini = puntos[i]
    const fin = puntos[i + 1]
    if (fin <= ini) continue
    // Se clasifica por el punto MEDIO: así el resultado no depende de si la
    // frontera se considera abierta o cerrada.
    const nocturna = esNocturno((ini + fin) / 2, franja)
    const ultimo = tramos[tramos.length - 1]
    if (ultimo && ultimo.nocturna === nocturna) ultimo.hasta = fin // une contiguos
    else tramos.push({ desde: ini, hasta: fin, nocturna })
  }
  return tramos
}

// ── Valorización ──────────────────────────────────────────────────────

/**
 * Valor de la hora ORDINARIA a partir del salario mensual.
 *
 * El divisor es configurable (Ajustes → Valorización) porque no hay una sola
 * lectura: 240 es el uso extendido (30 días × 8 h) y quien siga la Ley 2101
 * al pie de la letra prefiere derivarlo de la jornada vigente. ArriveControl
 * no elige por el cliente: expone el número y lo deja decidir.
 *
 * @returns {number|null} null si no hay salario — no se inventa un valor.
 */
export function valorHoraOrdinaria(salarioMensual, divisor = DIVISOR_DEFECTO) {
  const s = Number(salarioMensual)
  const d = Number(divisor)
  if (!Number.isFinite(s) || s <= 0 || !Number.isFinite(d) || d <= 0) return null
  return s / d
}

/**
 * Agrega el valor en pesos a un tramo ya calculado.
 *
 * Un empleado SIN salario registrado sale con `valorHora`, `factor` y `valor`
 * en null: el reporte lo muestra como "sin salario" en vez de fabricar una
 * cifra que alguien podría terminar pagando.
 *
 * @param {{tipoHora: string, horas: number}} registro
 * @param {{salarioMensual: number|null, factores: object, divisor: number}} cfg
 */
export function valorizarRegistro(registro, { salarioMensual, factores = FACTORES_DEFECTO, divisor = DIVISOR_DEFECTO }) {
  const valorHora = valorHoraOrdinaria(salarioMensual, divisor)
  const factor = Number(factores?.[registro.tipoHora] ?? FACTORES_DEFECTO[registro.tipoHora])
  if (valorHora == null || !Number.isFinite(factor)) {
    return { ...registro, factor: Number.isFinite(factor) ? factor : null, valorHora: null, valor: null }
  }
  return {
    ...registro,
    factor,
    // Redondeado al peso: el peso colombiano no tiene centavos y una cifra
    // con decimales en un reporte de nómina solo genera desconfianza.
    valorHora: Math.round(valorHora),
    valor: Math.round(valorHora * factor * registro.horas),
  }
}

/**
 * Rango aceptable de un factor. El piso es 1 porque por debajo se estaría
 * pagando la hora extra a menos que una ordinaria; el techo de 10 atrapa el
 * error más probable de todos: teclear el PORCENTAJE (125) donde va el factor
 * (1.25), que multiplicaría la nómina por cien.
 */
const FACTOR_MIN = 1
const FACTOR_MAX = 10

/** ¿Es un factor de pago creíble? */
export const factorValido = (v) => Number.isFinite(v) && v >= FACTOR_MIN && v <= FACTOR_MAX

/**
 * Normaliza un mapa de factores venido de la base o del navegador: se queda
 * solo con los códigos conocidos y cae al de fábrica si el valor no sirve.
 *
 * La API ya valida lo que entra, pero esto se ejecuta sobre lo que SALE de la
 * base — una fila editada a mano o migrada desde otra instalación no puede
 * terminar liquidando con un factor absurdo.
 */
export function normalizarFactores(crudos) {
  const salida = {}
  for (const t of TIPOS_HORA) {
    const v = Number(crudos?.[t.codigo])
    salida[t.codigo] = factorValido(v) ? v : t.factor
  }
  return salida
}
