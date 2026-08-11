/**
 * lib/guardaPlataforma.js — La guarda de las rutas /api/plataforma.
 *
 * Distinta a `estadoAcceso` a propósito: esa exige pertenecer a una empresa, y
 * el superadmin no tiene ninguna (la base lo impone con un check). Aquí lo que
 * se verifica es el rol, nada más.
 */
import { NextResponse } from 'next/server'
import { obtenerSesion } from './sesion.js'
import { esSuperadmin } from './roles.js'

/** @returns {Promise<{usuario: object}|{error: Response}>} */
export async function soloSuperadmin() {
  const usuario = await obtenerSesion()
  if (!usuario) {
    return { error: NextResponse.json({ ok: false, error: 'Sin sesión.' }, { status: 401 }) }
  }
  if (!usuario.activo || !esSuperadmin(usuario)) {
    // 404 y no 403: a quien no es superadmin no se le confirma que esta
    // superficie exista.
    return { error: NextResponse.json({ ok: false, error: 'No existe.' }, { status: 404 }) }
  }
  return { usuario }
}
