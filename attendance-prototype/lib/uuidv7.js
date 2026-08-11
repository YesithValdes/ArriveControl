/**
 * lib/uuidv7.js — Generador de UUID versión 7 (RFC 9562).
 *
 * Por qué existe: el esquema compartido declara las PK como `@default(uuid(7))`
 * de Prisma, que las genera en el CLIENTE, no en PostgreSQL — las columnas no
 * tienen DEFAULT. Como esta app habla con la base por `pg` (sin Prisma), tiene
 * que generar el id ella misma, y en el mismo formato para no mezclar v4 y v7
 * en las mismas tablas (el v7 es ordenable por tiempo, que es justo la razón
 * por la que se eligió aquí).
 *
 * Estructura: 48 bits de milisegundos Unix + versión 7 + 74 bits aleatorios.
 */
import { randomBytes } from 'node:crypto'

export function uuidv7() {
  const bytes = randomBytes(16)
  const ms = Date.now()

  // 48 bits de timestamp (big-endian) en los bytes 0..5
  bytes[0] = (ms / 2 ** 40) & 0xff
  bytes[1] = (ms / 2 ** 32) & 0xff
  bytes[2] = (ms / 2 ** 24) & 0xff
  bytes[3] = (ms / 2 ** 16) & 0xff
  bytes[4] = (ms / 2 ** 8) & 0xff
  bytes[5] = ms & 0xff

  bytes[6] = (bytes[6] & 0x0f) | 0x70 // versión 7
  bytes[8] = (bytes[8] & 0x3f) | 0x80 // variante RFC 4122

  const hex = bytes.toString('hex')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}
