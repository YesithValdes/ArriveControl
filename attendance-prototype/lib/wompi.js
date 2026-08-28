/**
 * lib/wompi.js — Cobro de la suscripción con Wompi (solo servidor).
 *
 * Wompi es la pasarela de Bancolombia: acepta PSE, tarjetas, Nequi y cuentas
 * Bancolombia. Aquí vive lo que toca dinero, y por eso está aparte del resto:
 * dos operaciones criptográficas y una regla de idempotencia.
 *
 * Configuración por variables de entorno:
 *   WOMPI_PUBLIC_KEY      llave pública (viaja al navegador, no es secreta)
 *   WOMPI_INTEGRITY_SECRET secreto para firmar el monto del checkout
 *   WOMPI_EVENTS_SECRET   secreto para verificar los eventos entrantes
 *   WOMPI_ENTORNO         'test' (por defecto) o 'prod'
 *   PRECIO_MENSUAL_CENTAVOS  cuánto se cobra al mes, en centavos de peso
 *
 * Sin estas variables el módulo queda APAGADO y el panel no ofrece pagar: es
 * preferible a mostrar un botón que lleva a un checkout roto.
 */
import { createHash } from 'node:crypto'

/** Precio provisional mientras se define el definitivo: $1.000 COP. */
const PRECIO_POR_DEFECTO = 100000

export const configWompi = () => {
  const { WOMPI_PUBLIC_KEY, WOMPI_INTEGRITY_SECRET, WOMPI_EVENTS_SECRET, WOMPI_ENTORNO } = process.env
  if (!WOMPI_PUBLIC_KEY || !WOMPI_INTEGRITY_SECRET) return null
  return {
    llavePublica: WOMPI_PUBLIC_KEY,
    secretoIntegridad: WOMPI_INTEGRITY_SECRET,
    secretoEventos: WOMPI_EVENTS_SECRET ?? null,
    entorno: WOMPI_ENTORNO === 'prod' ? 'prod' : 'test',
    // El checkout es el mismo host en ambos entornos; lo que separa pruebas de
    // producción son las llaves (las de prueba empiezan por `pub_test_`).
    urlCheckout: 'https://checkout.wompi.co/p/',
    montoCentavos: Number(process.env.PRECIO_MENSUAL_CENTAVOS) || PRECIO_POR_DEFECTO,
    moneda: 'COP',
  }
}

export const wompiActivo = () => configWompi() !== null

/**
 * Referencia única de un pago. Lleva la empresa y el instante, así que al
 * volver de la pasarela se sabe a quién abonarle sin consultar nada más, y
 * dos intentos del mismo cliente nunca chocan.
 */
export const referenciaDePago = (empresaId) =>
  `cr-${empresaId}-${Date.now().toString(36)}`

/**
 * Firma de integridad del checkout: SHA256 de
 * `<referencia><montoEnCentavos><moneda><secretoDeIntegridad>`.
 *
 * Es lo que impide que alguien cambie el monto en la URL y pague $1 por un
 * plan de $100.000. Se calcula SIEMPRE en el servidor: si el secreto llegara
 * al navegador, la firma dejaría de significar nada.
 */
export function firmaIntegridad({ referencia, montoCentavos, moneda, secreto }) {
  return createHash('sha256')
    .update(`${referencia}${montoCentavos}${moneda}${secreto}`)
    .digest('hex')
}

/**
 * Verifica que un evento venga de verdad de Wompi.
 *
 * El evento trae `signature.properties`: la lista de campos que entraron en el
 * hash. Se leen ESOS campos del propio evento (en su orden), se les concatena
 * el `timestamp` y el secreto de eventos, y el SHA256 debe coincidir con el
 * checksum recibido.
 *
 * Sin esta verificación cualquiera podría activarse el plan de pago con una
 * petición inventada: es la única prueba de que el dinero existió.
 */
export function eventoAutentico(evento, secreto) {
  if (!secreto || !evento?.signature?.checksum || !Array.isArray(evento.signature.properties)) return false
  const valor = (ruta) => ruta.split('.').reduce((o, k) => (o == null ? undefined : o[k]), evento.data)
  const concatenado = evento.signature.properties.map((p) => String(valor(p) ?? '')).join('')
  const calculado = createHash('sha256')
    .update(`${concatenado}${evento.timestamp}${secreto}`)
    .digest('hex')
  // Comparación simple: ambos son hex de la misma longitud y el atacante no
  // controla el tiempo de respuesta de forma útil aquí.
  return calculado.toLowerCase() === String(evento.signature.checksum).toLowerCase()
}

/** Datos que el navegador necesita para abrir el checkout, ya firmados. */
export function datosDeCheckout({ empresaId, correo, urlRetorno }) {
  const cfg = configWompi()
  if (!cfg) return null
  const referencia = referenciaDePago(empresaId)
  return {
    referencia,
    url: cfg.urlCheckout,
    entorno: cfg.entorno,
    campos: {
      'public-key': cfg.llavePublica,
      currency: cfg.moneda,
      'amount-in-cents': String(cfg.montoCentavos),
      reference: referencia,
      'signature:integrity': firmaIntegridad({
        referencia,
        montoCentavos: cfg.montoCentavos,
        moneda: cfg.moneda,
        secreto: cfg.secretoIntegridad,
      }),
      ...(urlRetorno ? { 'redirect-url': urlRetorno } : {}),
      ...(correo ? { 'customer-data:email': correo } : {}),
    },
    montoCentavos: cfg.montoCentavos,
  }
}

/** El monto en pesos, para mostrarlo. */
export const precioEnPesos = () => (configWompi()?.montoCentavos ?? PRECIO_POR_DEFECTO) / 100
