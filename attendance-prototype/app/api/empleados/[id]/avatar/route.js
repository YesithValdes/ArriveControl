/**
 * app/api/empleados/[id]/avatar/route.js
 * La FOTO DE PERFIL de un empleado (avatar): una imagen cualquiera que lo
 * identifique en las listas. No es el rostro ni sirve para reconocerlo.
 *
 * `[id]` es el id interno (lo usa el panel) o la CÉDULA (lo usa el sistema
 * de gestión por la API): se acepta cualquiera de los dos.
 *
 * GET    — la imagen (JPEG). Panel con sesión, kiosco con su clave, o API.
 * PUT    — { imagen: "data:image/…;base64,…" | "<base64>" } reemplaza la foto.
 *          Sesión con permiso `empleados` o clave de API (X-API-Key).
 * DELETE — la quita. Mismo acceso que PUT.
 */
import { NextResponse } from 'next/server'
import { conEmpresa } from '../../../../../lib/db.js'
import { estadoAcceso, estadoAHttp, estadoAMensaje, empresaDeLaPeticion } from '../../../../../lib/sesion'
import { empresaPorApiKey } from '../../../../../lib/empresas.js'
import { decodificarImagen, prepararAvatar } from '../../../../../lib/avatar.js'

export const runtime = 'nodejs'

/** Quién escribe: la clave de API de la empresa, o una sesión con permiso. */
async function accesoEscritura(req) {
  const clave = req.headers.get('x-api-key')
  if (clave) {
    const empresa = await empresaPorApiKey(clave)
    if (!empresa) return { error: NextResponse.json({ ok: false, error: 'Clave de API inválida.' }, { status: 401 }) }
    return { esquema: empresa.esquema }
  }
  const { estado, esquema } = await estadoAcceso('empleados')
  if (estado !== 'OK') return { error: NextResponse.json({ ok: false, error: estadoAMensaje(estado) }, { status: estadoAHttp(estado) }) }
  return { esquema }
}

/** Quién lee: además de los de arriba, el kiosco con su clave de aparato. */
async function accesoLectura(req) {
  const clave = req.headers.get('x-api-key')
  if (clave) {
    const empresa = await empresaPorApiKey(clave)
    return empresa ? { esquema: empresa.esquema } : { error: NextResponse.json({ ok: false, error: 'Clave de API inválida.' }, { status: 401 }) }
  }
  const ctx = await empresaDeLaPeticion(req)
  if (!ctx) return { error: NextResponse.json({ ok: false, error: 'Sin acceso.' }, { status: 401 }) }
  return { esquema: ctx.esquema }
}

/** El empleado por id interno o por cédula (sin puntos), dentro de la empresa. */
const SQL_QUIEN = `(id = $1 or cedula = $1)`

export async function GET(req, { params }) {
  const acc = await accesoLectura(req)
  if (acc.error) return acc.error
  const { id } = await params
  const { rows } = await conEmpresa(acc.esquema, (db) => db.query(
    `select avatar, avatar_en from empleados where ${SQL_QUIEN} limit 1`, [id],
  ))
  const e = rows[0]
  if (!e?.avatar) return new NextResponse(null, { status: 404 })
  const etag = `"${new Date(e.avatar_en).getTime()}"`
  if (req.headers.get('if-none-match') === etag) return new NextResponse(null, { status: 304 })
  return new NextResponse(e.avatar, {
    headers: {
      'Content-Type': 'image/jpeg',
      'Cache-Control': 'private, max-age=86400',
      ETag: etag,
    },
  })
}

export async function PUT(req, { params }) {
  const acc = await accesoEscritura(req)
  if (acc.error) return acc.error
  const { id } = await params
  let c
  try { c = await req.json() } catch { return NextResponse.json({ ok: false, error: 'JSON inválido.' }, { status: 400 }) }
  const { bytes, error } = decodificarImagen(c?.imagen)
  if (error) return NextResponse.json({ ok: false, error }, { status: 400 })
  let avatar
  try { avatar = await prepararAvatar(bytes) } catch {
    return NextResponse.json({ ok: false, error: 'No se pudo leer la imagen (¿es JPG, PNG o WebP?).' }, { status: 400 })
  }
  const { rows } = await conEmpresa(acc.esquema, (db) => db.query(
    `update empleados set avatar = $2, avatar_en = now() where ${SQL_QUIEN} returning id, cedula, avatar_en`,
    [id, avatar],
  ))
  if (!rows[0]) return NextResponse.json({ ok: false, error: 'Empleado no encontrado.' }, { status: 404 })
  return NextResponse.json({ ok: true, empleado: { id: rows[0].id, cedula: rows[0].cedula }, avatar_en: rows[0].avatar_en, bytes: avatar.length })
}

export async function DELETE(req, { params }) {
  const acc = await accesoEscritura(req)
  if (acc.error) return acc.error
  const { id } = await params
  const { rowCount } = await conEmpresa(acc.esquema, (db) => db.query(
    `update empleados set avatar = null, avatar_en = null where ${SQL_QUIEN}`, [id],
  ))
  if (!rowCount) return NextResponse.json({ ok: false, error: 'Empleado no encontrado.' }, { status: 404 })
  return NextResponse.json({ ok: true })
}
