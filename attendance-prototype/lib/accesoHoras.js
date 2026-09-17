/**
 * lib/accesoHoras.js — Quién pide las horas: un SISTEMA (clave de API) o una
 * PERSONA (sesión del panel).
 *
 * Las rutas de /api/horas se consumen de dos maneras y las dos valen:
 *  a) `X-API-Key`: la clave de la empresa (Ajustes → Mi empresa), para que
 *     nómina o el sistema de gestión las lean y anoten servidor-a-servidor.
 *     Se responde 401 sin mirar la sesión: es un sistema, no una persona.
 *  b) Sesión con el permiso que pida cada ruta (`ver` para leer, `liquidar`
 *     para anotar pagos): el panel de administración.
 */
import { NextResponse } from 'next/server'
import { empresaPorApiKey } from './empresas.js'
import { estadoAcceso, estadoAHttp, estadoAMensaje } from './sesion'

/**
 * @param {Request} req
 * @param {'ver'|'liquidar'} accion  permiso exigido a una sesión
 * @returns {Promise<{esquema: string, quien: string, error: null}
 *                  |{esquema: null, quien: null, error: Response}>}
 *          `quien`: con quién se firma lo que se anote (correo, o «api»).
 */
export async function accesoHoras(req, accion) {
  const clave = req.headers.get('x-api-key')
  if (clave) {
    const empresa = await empresaPorApiKey(clave)
    if (!empresa) {
      return { esquema: null, quien: null, error: NextResponse.json({ ok: false, error: 'Clave de API inválida.' }, { status: 401 }) }
    }
    return { esquema: empresa.esquema, quien: 'api', error: null }
  }
  const acceso = await estadoAcceso(accion)
  if (acceso.estado !== 'OK') {
    return {
      esquema: null, quien: null,
      error: NextResponse.json({ ok: false, error: estadoAMensaje(acceso.estado) }, { status: estadoAHttp(acceso.estado) }),
    }
  }
  return { esquema: acceso.esquema, quien: acceso.usuario?.email ?? acceso.usuario?.nombre ?? 'admin', error: null }
}

/** ¿Es una fecha YYYY-MM-DD real? (2026-02-30 no lo es.) */
export const fechaValida = (s) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(s ?? ''))) return false
  const d = new Date(`${s}T12:00:00Z`)
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s
}
