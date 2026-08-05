/**
 * app/api/enviar-horas/route.js
 * Envío REAL del lote de horas con recargo a la plataforma de Gestión Humana.
 *
 * Por qué existe este intermediario en vez de llamar al gestor desde el
 * navegador: la clave de integración (X-API-Key) no puede viajar al cliente —
 * cualquiera la leería en las DevTools y podría inyectar horas extra en la
 * nómina. Aquí vive solo en el servidor.
 *
 * Además:
 *  - Exige sesión y permiso `asistencia` (los mismos usuarios del gestor).
 *  - Reconstruye el lote en el servidor a partir de las marcaciones, en vez de
 *    confiar en lo que mande el navegador.
 */
import { NextResponse } from 'next/server'
import { construirLote, registrarEnvio } from '../../../lib/nomina.js'
import { estadoAcceso } from '../../../lib/sesion'

export const runtime = 'nodejs'

/**
 * Vista previa del lote SIN enviarlo. Útil para revisar qué se va a mandar
 * (y para depurar duplicados de `referenciaExterna`) sin tocar la nómina.
 */
export async function GET(req) {
  const { estado } = await estadoAcceso('VER')
  if (estado !== 'OK') return NextResponse.json({ ok: false, error: 'Sin acceso.' }, { status: 403 })

  const { searchParams } = new URL(req.url)
  const desde = searchParams.get('desde')
  const hasta = searchParams.get('hasta')
  const rango = desde && hasta ? { desde, hasta } : null

  // Desde POSTGRES (asistencia.marcaciones), ya no desde data/db.json.
  const { registros } = await construirLote(rango)

  // Referencias repetidas dentro del MISMO lote: el gestor las contaría como
  // duplicadas y descartaría la segunda, perdiendo horas de verdad.
  const vistas = new Map()
  const colisiones = []
  for (const r of registros) {
    const clave = `${r.referenciaExterna}|${r.tipoHora}`
    if (vistas.has(clave)) colisiones.push({ clave, primera: vistas.get(clave), segunda: r })
    else vistas.set(clave, r)
  }

  return NextResponse.json({
    total: registros.length,
    colisiones,
    registros: registros.map(({ _empleadoId, _semana, ...r }) => r),
  })
}

export async function POST(req) {
  const { estado, usuario } = await estadoAcceso('CREAR')
  if (estado !== 'OK') {
    return NextResponse.json(
      { ok: false, error: estado === 'SIN_SESION' ? 'Inicia sesión.' : 'No tienes permiso para enviar horas a nómina.' },
      { status: estado === 'SIN_SESION' ? 401 : 403 },
    )
  }

  let rango = null
  try {
    const cuerpo = await req.json()
    if (cuerpo?.desde && cuerpo?.hasta) rango = { desde: cuerpo.desde, hasta: cuerpo.hasta }
  } catch {
    // Sin cuerpo: se envía todo el rango disponible.
  }

  // El lote se arma aquí, desde Postgres — no en el navegador.
  const { registros } = await construirLote(rango)
  if (registros.length === 0) {
    return NextResponse.json({ ok: true, recibidos: 0, aplicados: 0, duplicados: 0, rechazados: [], vacio: true })
  }
  // Los campos internos (_empleadoId, _semana) no viajan al gestor.
  const registrosParaGestor = registros.map(({ _empleadoId, _semana, ...r }) => r)

  const url = `${process.env.GESTOR_URL || 'http://localhost:3000'}/api/integraciones/horas`
  let respuesta
  try {
    respuesta = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': process.env.INTEGRACION_HORAS_API_KEY ?? '',
      },
      body: JSON.stringify({ registros: registrosParaGestor }),
    })
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: `No se pudo conectar con el gestor en ${url}. ¿Está corriendo?`, detalle: String(e) },
      { status: 502 },
    )
  }

  const texto = await respuesta.text()
  let datos
  try {
    datos = JSON.parse(texto)
  } catch {
    return NextResponse.json(
      { ok: false, error: `El gestor respondió ${respuesta.status} con algo que no es JSON.`, detalle: texto.slice(0, 300) },
      { status: 502 },
    )
  }

  if (!respuesta.ok) {
    return NextResponse.json({ ok: false, error: 'El gestor rechazó el lote.', ...datos }, { status: respuesta.status })
  }

  // Bitácora: qué se envió y qué respondió el gestor (reintentos seguros +
  // bandeja de rechazos como PERIODO_CERRADO).
  await registrarEnvio(registros, datos, usuario.email)

  // Se devuelve tal cual lo que dijo el gestor, más quién lo envió (trazabilidad).
  return NextResponse.json({ ...datos, enviadoPor: usuario.email, registrosEnviados: registros.length })
}
