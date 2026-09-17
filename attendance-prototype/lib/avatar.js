/**
 * lib/avatar.js — La foto de perfil del empleado (avatar), NO el rostro.
 *
 * Es una imagen cualquiera que lo identifique en las listas: una foto, un
 * dibujo, un símbolo. No participa en el reconocimiento facial y no se
 * compara con nada. Se guarda normalizada —JPEG 256×256, recortada al
 * centro— para que pese poco y se vea igual venga de donde venga.
 */

/** Tope de lo que se acepta de entrada (antes de normalizar). */
export const MAX_ENTRADA_BYTES = 6 * 1024 * 1024
export const LADO_AVATAR = 256

/**
 * De lo que manda un cliente (data URL `data:image/…;base64,…` o base64 a
 * secas) a bytes. Sin sharp ni red: se prueba solo.
 * @returns {{bytes: Buffer, error: null} | {bytes: null, error: string}}
 */
export function decodificarImagen(entrada) {
  const texto = String(entrada ?? '').trim()
  if (!texto) return { bytes: null, error: 'Falta la imagen.' }
  const m = /^data:([\w/+.-]+);base64,(.*)$/s.exec(texto)
  const mime = m ? m[1].toLowerCase() : null
  if (mime && !mime.startsWith('image/')) return { bytes: null, error: `No es una imagen (${mime}).` }
  const b64 = (m ? m[2] : texto).replace(/\s+/g, '')
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(b64)) return { bytes: null, error: 'La imagen debe venir en base64.' }
  // 4 caracteres base64 → 3 bytes: se estima antes de decodificar.
  if ((b64.length * 3) / 4 > MAX_ENTRADA_BYTES) return { bytes: null, error: 'La imagen pesa más de 6 MB.' }
  const bytes = Buffer.from(b64, 'base64')
  if (bytes.length < 64) return { bytes: null, error: 'La imagen está vacía o truncada.' }
  return { bytes, error: null }
}

/**
 * Normaliza a JPEG 256×256: respeta la orientación EXIF, recorta al centro
 * y comprime. Lanza si los bytes no son una imagen que sharp entienda.
 * @returns {Promise<Buffer>}
 */
export async function prepararAvatar(bytes) {
  const { default: sharp } = await import('sharp')
  return sharp(bytes, { failOn: 'error' })
    .rotate()
    .resize(LADO_AVATAR, LADO_AVATAR, { fit: 'cover', position: 'attention' })
    .jpeg({ quality: 82, mozjpeg: true })
    .toBuffer()
}
