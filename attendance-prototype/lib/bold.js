/**
 * lib/bold.js — Cobro de la suscripción con Bold (solo servidor).
 *
 * Bold es la pasarela colombiana con la que se cobra el plan de pago. Aquí
 * vive lo que toca dinero, y por eso está aparte del resto: dos operaciones
 * criptográficas y una regla de idempotencia.
 *
 * Configuración por variables de entorno:
 *   BOLD_API_KEY         llave de identidad (viaja al navegador, no es secreta)
 *   BOLD_SECRET_KEY      llave secreta, para firmar el monto del checkout
 *   BOLD_WEBHOOK_SECRET  secreto de los webhooks. En PRUEBAS Bold firma con
 *                        cadena vacía, así que se admite '' como valor válido
 *                        y por eso se distingue de "no configurado".
 *   BOLD_ENTORNO         'test' (por defecto) o 'prod'
 *   PRECIO_MENSUAL_CENTAVOS  cuánto se cobra al mes, en centavos de peso
 *
 * Sin llaves el módulo queda APAGADO y el panel no ofrece pagar: es preferible
 * a mostrar un botón que lleva a un checkout roto.
 *
 * SOBRE EL SANDBOX: Bold decide el resultado por el MONTO, no por la tarjeta.
 * Entre $1.000 y $2.000.000 aprueba; hay montos exactos que fuerzan cada tipo
 * de rechazo (ver MONTOS_DE_PRUEBA). El precio provisional de $1.000 cae en el
 * rango aprobado, así que sirve para el camino feliz sin tocar nada.
 */
import { createHash, createHmac } from 'node:crypto'

/** Precio provisional mientras se define el definitivo: $1.000 COP. */
const PRECIO_POR_DEFECTO = 100000

/** Montos que el sandbox de Bold usa para forzar cada desenlace. */
export const MONTOS_DE_PRUEBA = {
  111111: 'fondos insuficientes',
  222222: 'PIN inválido',
  333333: 'tarjeta vencida',
  444444: 'falla de red',
  999999: 'rechazo general',
}

export const configBold = () => {
  const { BOLD_API_KEY, BOLD_SECRET_KEY, BOLD_WEBHOOK_SECRET, BOLD_ENTORNO } = process.env
  if (!BOLD_API_KEY || !BOLD_SECRET_KEY) return null
  const entorno = BOLD_ENTORNO === 'prod' ? 'prod' : 'test'
  return {
    apiKey: BOLD_API_KEY,
    secreto: BOLD_SECRET_KEY,
    // En PRUEBAS Bold firma con la cadena vacía. Se admite '' como valor
    // válido —de ahí el `??` en vez de `||`— y además se asume vacío cuando
    // la variable ni siquiera existe, porque algunos paneles (Vercel entre
    // ellos) no dejan guardar una variable con valor vacío.
    //
    // En PRODUCCIÓN no se asume nada: sin secreto queda `null` y el webhook
    // rechaza todo. Ante la duda, mejor no cobrar que aceptar un evento falso.
    secretoWebhook: BOLD_WEBHOOK_SECRET ?? (entorno === 'test' ? '' : null),
    entorno,
    montoCentavos: Number(process.env.PRECIO_MENSUAL_CENTAVOS) || PRECIO_POR_DEFECTO,
    moneda: 'COP',
  }
}

export const boldActivo = () => configBold() !== null

/**
 * Identificador único de la orden. Lleva la empresa y el instante, así que al
 * volver el evento se sabe a quién abonarle sin consultar nada más, y dos
 * intentos del mismo cliente nunca chocan.
 */
export const ordenDePago = (empresaId) => `cr-${empresaId}-${Date.now().toString(36)}`

/**
 * Firma de integridad del checkout: SHA256 de
 * `<orderId><monto><moneda><llaveSecreta>`.
 *
 * Es lo que impide que alguien cambie el monto antes de pagar. Se calcula
 * SIEMPRE en el servidor: si la llave secreta llegara al navegador, la firma
 * dejaría de significar nada. Bold lo dice explícitamente en su documentación.
 */
export function firmaIntegridad({ orderId, montoCentavos, moneda, secreto }) {
  return createHash('sha256')
    .update(`${orderId}${montoCentavos}${moneda}${secreto}`)
    .digest('hex')
}

/**
 * Verifica que un webhook venga de verdad de Bold.
 *
 * La cabecera `x-bold-signature` trae un HMAC-SHA256, en hexadecimal, del
 * cuerpo CRUDO codificado en Base64, usando la llave secreta del webhook.
 *
 * Importa que sea el cuerpo crudo y no el JSON re-serializado: cualquier
 * diferencia de espacios o de orden de claves cambiaría el hash y haría
 * fallar la verificación de eventos legítimos.
 *
 * @param {string} cuerpoCrudo  el texto exacto que llegó en la petición
 * @param {string} firmaRecibida  valor de la cabecera x-bold-signature
 * @param {string} secreto  BOLD_WEBHOOK_SECRET ('' en pruebas)
 */
export function eventoAutentico(cuerpoCrudo, firmaRecibida, secreto) {
  if (typeof secreto !== 'string' || !firmaRecibida) return false
  const enBase64 = Buffer.from(cuerpoCrudo, 'utf8').toString('base64')
  const calculada = createHmac('sha256', secreto).update(enBase64).digest('hex')
  return calculada.toLowerCase() === String(firmaRecibida).trim().toLowerCase()
}

/** Datos que el navegador necesita para abrir el checkout, ya firmados. */
export function datosDeCheckout({ empresaId, urlRetorno, descripcion }) {
  const cfg = configBold()
  if (!cfg) return null
  const orderId = ordenDePago(empresaId)
  return {
    orderId,
    montoCentavos: cfg.montoCentavos,
    entorno: cfg.entorno,
    // Tal cual los espera `new BoldCheckout({...})` en el navegador.
    checkout: {
      orderId,
      currency: cfg.moneda,
      amount: String(cfg.montoCentavos),
      apiKey: cfg.apiKey,
      integritySignature: firmaIntegridad({
        orderId,
        montoCentavos: cfg.montoCentavos,
        moneda: cfg.moneda,
        secreto: cfg.secreto,
      }),
      description: descripcion ?? 'Plan Empresa · Control Registro',
      ...(urlRetorno ? { redirectionUrl: urlRetorno } : {}),
    },
  }
}

/** El monto en pesos, para mostrarlo. */
export const precioEnPesos = () => (configBold()?.montoCentavos ?? PRECIO_POR_DEFECTO) / 100
