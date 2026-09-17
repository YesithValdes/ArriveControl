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

/**
 * El rango que pide una petición, de dos formas equivalentes:
 *   · por PERÍODO DE PAGO: `mes=YYYY-MM` y, opcional, `quincena=1|2`
 *     (sin quincena, el mes entero) — es como liquida nómina;
 *   · por fechas sueltas: `desde=YYYY-MM-DD&hasta=YYYY-MM-DD`.
 * @returns {{desde: string, hasta: string}|null|{error: string}}
 *          null si no pidió rango; {error} si lo pidió mal.
 */
export function rangoPedido(searchParams) {
  const mes = searchParams.get('mes')
  const quincena = searchParams.get('quincena')
  const desde = searchParams.get('desde')
  const hasta = searchParams.get('hasta')
  if (mes != null) {
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(mes)) return { error: 'mes debe ser YYYY-MM (por ejemplo 2026-09).' }
    if (quincena != null && quincena !== '1' && quincena !== '2') return { error: 'quincena debe ser 1 (del 1 al 15) o 2 (del 16 al fin de mes).' }
    const ultimo = new Date(Number(mes.slice(0, 4)), Number(mes.slice(5, 7)), 0).getDate()
    return {
      desde: `${mes}-${quincena === '2' ? '16' : '01'}`,
      hasta: `${mes}-${String(quincena === '1' ? 15 : ultimo).padStart(2, '0')}`,
    }
  }
  if (desde == null && hasta == null) return null
  if (!(fechaValida(desde) && fechaValida(hasta) && desde <= hasta)) {
    return { error: 'desde y hasta deben ser fechas YYYY-MM-DD, con desde ≤ hasta (o usa mes=YYYY-MM y quincena=1|2).' }
  }
  return { desde, hasta }
}

/** ¿Es una fecha YYYY-MM-DD real? (2026-02-30 no lo es.) */
export const fechaValida = (s) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(s ?? ''))) return false
  const d = new Date(`${s}T12:00:00Z`)
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s
}
