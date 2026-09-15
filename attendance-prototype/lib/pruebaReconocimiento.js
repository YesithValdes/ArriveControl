/**
 * lib/pruebaReconocimiento.js — Enlace FIRMADO para el modo prueba del kiosco.
 *
 * «Probar reconocimiento» (Ajustes) abre el kiosco en modo ensayo: reconoce
 * la cara y dice quién es, sin registrar nada. Para reconocer necesita el
 * roster con los descriptores faciales, y ese roster solo se entrega a un
 * aparato activado o a una sesión del panel — es dato biométrico (Ley 1581)
 * y no puede bajarlo cualquiera que conozca la URL.
 *
 * Para que la prueba se pueda abrir en cualquier celular SIN iniciar sesión,
 * el administrador genera desde el panel un enlace con un token firmado por
 * el servidor: dice de qué empresa es y hasta cuándo vale. Con él solo se
 * puede bajar el roster; ninguna otra API lo acepta, así que nunca sirve
 * para marcar ni para tocar datos.
 *
 * Se firma con el mismo secreto de la sesión (BETTER_AUTH_SECRET): si ese
 * secreto cambia, los enlaces viejos dejan de valer junto con las sesiones.
 */
import { createHmac, timingSafeEqual } from 'node:crypto'

/** Cuánto vale un enlace. Un día: suficiente para una ronda de pruebas. */
export const VIGENCIA_PRUEBA_H = 24

const secreto = () => {
  const s = process.env.BETTER_AUTH_SECRET
  if (!s) throw new Error('Falta BETTER_AUTH_SECRET para firmar el enlace de prueba.')
  return s
}
const firma = (cuerpo) => createHmac('sha256', secreto()).update(cuerpo).digest('base64url')

/**
 * @param {string} empresaId  uuid de control.empresas
 * @param {number} [horas]    vigencia
 * @returns {{token: string, vence: string}}  `vence` en ISO
 */
export function firmarEnlacePrueba(empresaId, horas = VIGENCIA_PRUEBA_H) {
  const vence = new Date(Date.now() + horas * 3600000)
  const cuerpo = Buffer.from(JSON.stringify({ e: empresaId, x: vence.getTime() })).toString('base64url')
  return { token: `${cuerpo}.${firma(cuerpo)}`, vence: vence.toISOString() }
}

/**
 * Empresa (uuid) a la que da acceso un token, o null si no es válido o ya
 * venció. Nunca lanza: un token malformado es simplemente inválido.
 */
export function empresaDelEnlacePrueba(token) {
  try {
    const [cuerpo, sello] = String(token ?? '').split('.')
    if (!cuerpo || !sello) return null
    const esperado = Buffer.from(firma(cuerpo))
    const recibido = Buffer.from(sello)
    if (esperado.length !== recibido.length || !timingSafeEqual(esperado, recibido)) return null
    const { e, x } = JSON.parse(Buffer.from(cuerpo, 'base64url').toString('utf8'))
    if (typeof e !== 'string' || typeof x !== 'number' || x < Date.now()) return null
    return e
  } catch {
    return null
  }
}
