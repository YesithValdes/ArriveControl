/**
 * lib/planes.js — Qué se vende y a qué precio.
 *
 * El catálogo vive AQUÍ, en el servidor, y nunca se acepta del navegador: si
 * el cliente pudiera mandar el precio o los meses, pediría tres meses por un
 * dólar. Lo único que elige es CUÁL paquete quiere; cuánto cuesta y cuánto
 * dura lo decide este archivo.
 *
 * El modelo es una oferta de entrada muy barata que sirve de filtro: quien
 * pone un dólar tiene medio de pago y voluntad real de usar el producto, algo
 * que una prueba gratuita no demuestra. Después de esa entrada, el precio es
 * el normal.
 *
 * Precios en DÓLARES. Bold los convierte a pesos con la TRM del momento y el
 * comercio recibe en COP. Ojo: cobrando en USD, Bold solo acepta tarjeta —
 * quedan fuera PSE y Nequi.
 */

/** Precio mensual normal, una vez agotada la oferta de entrada. */
const MENSUAL_POR_DEFECTO = 15

const mensual = () => Number(process.env.PRECIO_MENSUAL_USD) || MENSUAL_POR_DEFECTO

/**
 * Los paquetes que se pueden comprar.
 *
 * `oferta: true` marca los de entrada: solo se pueden usar UNA VEZ por
 * empresa. Sin ese límite alguien compraría tres meses por tres dólares para
 * siempre y nunca llegaría al precio real.
 */
export function catalogoDePlanes() {
  return {
    entrada_1: { meses: 1, precio: 1, oferta: true, etiqueta: '1 mes' },
    entrada_2: { meses: 2, precio: 2, oferta: true, etiqueta: '2 meses' },
    entrada_3: { meses: 3, precio: 3, oferta: true, etiqueta: '3 meses' },
    mensual: { meses: 1, precio: mensual(), oferta: false, etiqueta: '1 mes' },
  }
}

export const planPorId = (id) => catalogoDePlanes()[id] ?? null

/** Moneda de cobro. Bold admite COP y USD; con USD solo se paga con tarjeta. */
export const MONEDA = 'USD'

/**
 * Qué puede comprar esta empresa.
 *
 * La oferta de entrada se ofrece solo si NUNCA pagó: no hace falta una
 * columna que lo marque, basta con que no exista un pago aprobado suyo. Un
 * dato derivado no se puede desincronizar del hecho que representa.
 *
 * @param {boolean} yaPago  ¿tiene algún pago aprobado en su historial?
 */
export function planesDisponibles(yaPago) {
  const catalogo = catalogoDePlanes()
  return Object.entries(catalogo)
    .filter(([, p]) => (yaPago ? !p.oferta : true))
    .map(([id, p]) => ({ id, ...p }))
}

/** Texto del precio para la pantalla: 1 → "US$1". */
export const enDolares = (valor) => `US$${valor}`
