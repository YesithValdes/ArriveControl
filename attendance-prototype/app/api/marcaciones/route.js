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
import { NextResponse } from 'next/server'
import { registrarPaso, listarMarcaciones } from '../../../lib/marcaciones'
import { estadoAcceso } from '../../../lib/sesion'
import { dispositivoDeLaPeticion } from '../../../lib/dispositivos.js'

export const runtime = 'nodejs'

export async function POST(req) {
  // Autenticación en tres vías (una basta):
  //  a) Dispositivo ACTIVADO (X-Device-Key registrada en asistencia.dispositivos):
  //     la vía normal — cada tablet se activa una vez con sesión de admin y su
  //     clave propia se puede revocar individualmente desde el panel.
  //  b) KIOSCO_DEVICE_KEY (env, clave compartida): compatibilidad con
  //     dispositivos configurados a mano antes de la activación por aparato.
  //  c) Sesión con permiso `asistencia` (VER): el celular del administrador.
  // Sin ninguna se rechaza: una marcación falsa se convierte en horas extra
  // pagadas (la sincronización con nómina es automática).
  // En desarrollo, sin KIOSCO_DEVICE_KEY configurada, se permite sin credencial.
  const claveEnviada = req.headers.get('x-device-key')
  const claveEnv = process.env.KIOSCO_DEVICE_KEY
  const conClaveEnv = !!claveEnv && claveEnviada === claveEnv
  const dispositivo = claveEnviada && !conClaveEnv ? await dispositivoDeLaPeticion(req) : null
  if (!conClaveEnv && !dispositivo && (process.env.NODE_ENV === 'production' || claveEnv)) {
    const { estado } = await estadoAcceso('VER')
    if (estado !== 'OK') {
      return NextResponse.json(
        { ok: false, error: 'DISPOSITIVO_NO_ACTIVADO', detalle: 'Este dispositivo no está activado. Actívalo desde la pantalla del kiosco con una sesión de administrador.' },
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
