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
 *   2. PRECIO DE ENTRADA, una sola vez: el PRIMER mes de la suscripción cuesta
 *      PRECIO_ENTRADA dólares (a quien nunca ha pagado). Sirve de filtro —
 *      quien pone un dólar tiene medio de pago y voluntad real.
 *   3. PRECIO NORMAL del plan, cobrado cada mes con débito automático.
 *
 * Los precios están en DÓLARES. Mercado Pago cobra en PESOS: se convierten
 * con la TRM oficial del día (lib/trm.js) y el cobro mensual se reajusta con
 * ella (lib/suscripciones.js).
 */

/** Días de prueba al registrarse, sin tarjeta. */
export const DIAS_PRUEBA = 3

/** Precio en dólares del PRIMER mes, para quien nunca ha pagado. */
export const PRECIO_ENTRADA = 1

/**
 * Los planes, por tamaño de empresa.
 *
 * `empleados` es el tope incluido; `null` significa sin tope. El precio es
 * mensual y en dólares. Para cambiarlos basta editar esta tabla: el resto del
 * sistema (pantallas, cobro, límites) sale de aquí.
 */
export const PLANES = {
  // `usuarios`: cuántas personas pueden entrar al panel (incluido el dueño).
  // Los roles (administrador, consulta) se venden así: más accesos, plan mayor.
  esencial: { nombre: 'Esencial', empleados: 10, usuarios: 1, precio: 15, para: 'Negocios pequeños' },
  equipo: { nombre: 'Equipo', empleados: 30, usuarios: 3, precio: 29, para: 'Equipos que crecen' },
  empresa: { nombre: 'Empresa', empleados: 100, usuarios: 10, precio: 49, para: 'Varias sedes y turnos' },
}

/** Por encima del plan más grande se negocia; no se vende por autoservicio. */
export const CONTACTO_DESDE = 100

export const planPorId = (id) => (id && PLANES[id] ? { id, ...PLANES[id] } : null)

/** Moneda en que están los PRECIOS (el cobro va en COP con la TRM). */
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

/** Cuánto se cobra el PRIMER mes y los siguientes, en dólares. */
export function cotizar(plan, conEntrada) {
  return { primerMes: conEntrada ? PRECIO_ENTRADA : plan.precio, mensual: plan.precio }
}

/**
 * El catálogo tal como debe verse en pantalla, ya resuelto para ESTA empresa.
 * Los precios en pesos los agrega quien llama (necesitan la TRM).
 *
 * @param {{yaPago: boolean, empleados: number}} ctx
 */
export function catalogoPara({ yaPago, empleados = 0 }) {
  const sugerido = planSugerido(empleados)
  return {
    conEntrada: !yaPago,
    precioEntrada: PRECIO_ENTRADA,
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
