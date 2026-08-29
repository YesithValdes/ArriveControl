/**
 * lib/planes.js — Qué se vende, a qué precio y para qué tamaño de empresa.
 *
 * El catálogo vive AQUÍ, en el servidor, y nunca se acepta del navegador: si
 * el cliente pudiera mandar el precio o el tope, pediría el plan grande por un
 * dólar. Lo único que elige es CUÁL plan quiere.
 *
 * El recorrido comercial tiene tres tramos:
 *
 *   1. PRUEBA de 3 días al registrarse. Sin tarjeta. Es para ver el producto
 *      por dentro con datos propios, no para operar un mes entero.
 *   2. PRECIO DE ENTRADA: US$1 por mes durante los primeros meses, una sola
 *      vez. Sirve de filtro — quien pone un dólar tiene medio de pago y
 *      voluntad real, algo que una prueba gratuita no demuestra.
 *   3. PRECIO NORMAL del plan que le corresponda por tamaño.
 *
 * Los precios están en DÓLARES. Bold convierte a pesos con la TRM del momento
 * y el comercio recibe en COP; la contrapartida es que en USD solo se puede
 * pagar con tarjeta (sin PSE ni Nequi).
 */

/** Días de prueba al registrarse, sin tarjeta. */
export const DIAS_PRUEBA = 3

/** Lo que cuesta cada mes durante la oferta de entrada. */
export const PRECIO_ENTRADA = 1

/** Hasta cuántos meses se pueden adelantar con el precio de entrada. */
export const MAX_MESES_ENTRADA = 3

/**
 * Los planes, por tamaño de empresa.
 *
 * `empleados` es el tope incluido; `null` significa sin tope. El precio es
 * mensual y en dólares. Para cambiarlos basta editar esta tabla: el resto del
 * sistema (pantallas, cobro, límites) sale de aquí.
 */
export const PLANES = {
  esencial: { nombre: 'Esencial', empleados: 10, precio: 15, para: 'Negocios pequeños' },
  equipo: { nombre: 'Equipo', empleados: 30, precio: 29, para: 'Equipos que crecen' },
  empresa: { nombre: 'Empresa', empleados: 100, precio: 49, para: 'Varias sedes y turnos' },
}

/** Por encima del plan más grande se negocia; no se vende por autoservicio. */
export const CONTACTO_DESDE = 100

export const planPorId = (id) => (id && PLANES[id] ? { id, ...PLANES[id] } : null)

/** Moneda de cobro. Bold admite COP y USD; con USD solo se paga con tarjeta. */
export const MONEDA = 'USD'

/**
 * El plan más pequeño que le sirve a una empresa con N empleados.
 * Se usa para sugerir, no para imponer: alguien puede querer uno más grande.
 */
export function planSugerido(empleados) {
  const orden = Object.entries(PLANES).sort((a, b) => a[1].precio - b[1].precio)
  const cabe = orden.find(([, p]) => p.empleados == null || empleados <= p.empleados)
  return cabe ? { id: cabe[0], ...cabe[1] } : null
}

/**
 * Cuánto cuesta contratar un plan por N meses.
 *
 * Con la oferta de entrada disponible, cada mes vale US$1 sin importar el
 * plan: es exactamente el gancho de «pruébalo por un dólar». Sin ella, se
 * paga el precio del plan por cada mes.
 *
 * @param {object} plan  el del catálogo
 * @param {number} meses
 * @param {boolean} conEntrada  ¿le corresponde el precio de entrada?
 */
export function cotizar(plan, meses, conEntrada) {
  const m = Math.max(1, Math.min(Number(meses) || 1, conEntrada ? MAX_MESES_ENTRADA : 12))
  const porMes = conEntrada ? PRECIO_ENTRADA : plan.precio
  return { meses: m, porMes, total: porMes * m }
}

/**
 * El catálogo tal como debe verse en pantalla, ya resuelto para ESTA empresa.
 *
 * @param {{yaPago: boolean, empleados: number}} ctx
 */
export function catalogoPara({ yaPago, empleados = 0 }) {
  const sugerido = planSugerido(empleados)
  return {
    conEntrada: !yaPago,
    precioEntrada: PRECIO_ENTRADA,
    maxMesesEntrada: MAX_MESES_ENTRADA,
    contactoDesde: CONTACTO_DESDE,
    moneda: MONEDA,
    planes: Object.entries(PLANES).map(([id, p]) => ({
      id,
      ...p,
      // Cuál le queda corto hoy: la pantalla lo marca como no disponible en
      // vez de dejar que pague un plan donde su gente no cabe.
      alcanza: p.empleados == null || empleados <= p.empleados,
      sugerido: sugerido?.id === id,
    })),
  }
}
