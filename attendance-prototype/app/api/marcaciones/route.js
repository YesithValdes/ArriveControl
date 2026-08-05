/**
 * app/api/marcaciones/route.js
 *
 * POST — el KIOSCO registra un paso. El servidor decide entrada/salida y pone
 *        la hora; el kiosco solo dice quién y en qué sede. Autenticado con la
 *        clave de dispositivo (X-Device-Key = KIOSCO_DEVICE_KEY), nunca sesión:
 *        la tablet no tiene usuario.
 * GET  — el PANEL lista marcaciones por rango/empleado. Requiere sesión del
 *        gestor con permiso VER sobre `asistencia`.
 */
import { NextResponse, after } from 'next/server'
import { registrarPaso, listarMarcaciones } from '../../../lib/marcaciones'
import { estadoAcceso } from '../../../lib/sesion'
import { sincronizar, fechasAfectadas } from '../../../lib/sincronizarNomina.js'

export const runtime = 'nodejs'

export async function POST(req) {
  // Autenticación en dos vías (una basta):
  //  a) Clave de dispositivo (X-Device-Key = KIOSCO_DEVICE_KEY): para tablets
  //     dedicadas sin usuario. Se guarda en el dispositivo, no en el código.
  //  b) Sesión con permiso `asistencia` (VER): el celular del administrador de
  //     la sede, que ya inició sesión — la cookie viaja sola.
  // Sin ninguna de las dos se rechaza: una marcación falsa se convierte en
  // horas extra pagadas (la sincronización con nómina es automática).
  // En desarrollo, si KIOSCO_DEVICE_KEY no está configurada, se permite sin
  // credencial para poder probar el kiosco local.
  const claveDispositivo = process.env.KIOSCO_DEVICE_KEY
  const claveEnviada = req.headers.get('x-device-key')
  const conClave = !!claveDispositivo && claveEnviada === claveDispositivo
  if (!conClave && (process.env.NODE_ENV === 'production' || claveDispositivo)) {
    const { estado } = await estadoAcceso('VER')
    if (estado !== 'OK') {
      return NextResponse.json(
        { ok: false, error: 'Kiosco no autorizado: inicia sesión o configura la clave del dispositivo.' },
        { status: 401 },
      )
    }
  }

  let cuerpo
  try {
    cuerpo = await req.json()
  } catch {
    return NextResponse.json({ ok: false, error: 'Cuerpo JSON inválido.' }, { status: 400 })
  }
  const { empleado_id: empleadoId, sede_id: sedeId, ts_dispositivo: tsDispositivo, diferido } = cuerpo ?? {}
  if (!empleadoId || !sedeId) {
    return NextResponse.json({ ok: false, error: 'Faltan empleado_id o sede_id.' }, { status: 400 })
  }
  if (diferido && !tsDispositivo) {
    return NextResponse.json({ ok: false, error: 'Un envío diferido necesita ts_dispositivo.' }, { status: 400 })
  }

  const r = await registrarPaso({ empleadoId, sedeId, tsDispositivo: tsDispositivo ?? null, diferido: !!diferido })
  if (r.error) return NextResponse.json({ ok: false, error: r.error }, { status: 404 })
  if (r.duplicado) return NextResponse.json({ ok: true, duplicado: true, ultima: r.ultima })
  // Nómina al día: una salida cierra un par entrada→salida y puede generar
  // (o corregir) horas extra. Corre tras responder; no bloquea al kiosco.
  after(() => sincronizar(fechasAfectadas(r.marcacion.ts)))
  return NextResponse.json({ ok: true, tipo: r.tipo, marcacion: r.marcacion })
}

export async function GET(req) {
  const { estado } = await estadoAcceso('VER')
  if (estado !== 'OK') {
    return NextResponse.json({ ok: false, error: 'Sin acceso.' }, { status: estado === 'SIN_SESION' ? 401 : 403 })
  }
  const { searchParams } = new URL(req.url)
  const rows = await listarMarcaciones({
    desde: searchParams.get('desde') ?? undefined,
    hasta: searchParams.get('hasta') ?? undefined,
    empleadoId: searchParams.get('empleado_id') ?? undefined,
  })
  return NextResponse.json({ ok: true, total: rows.length, marcaciones: rows })
}
