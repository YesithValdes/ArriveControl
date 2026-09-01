/**
 * app/api/marcaciones/route.js
 *
 * POST — el KIOSCO registra un paso. El servidor decide entrada/salida y pone
 *        la hora; el kiosco solo dice quién y en qué sede. Autenticado con la
 *        clave de dispositivo (X-Device-Key = KIOSCO_DEVICE_KEY), nunca sesión:
 *        la tablet no tiene usuario.
 * GET  — el PANEL lista marcaciones por rango/empleado. Requiere sesión con
 *        permiso VER.
 */
import { NextResponse, after } from 'next/server'
import { registrarPaso, listarMarcaciones, guardarDireccion } from '../../../lib/marcaciones'
import { direccionDesdeCoordenadas } from '../../../lib/geocodificar.js'
import { estadoAcceso, estadoAHttp, estadoAMensaje, empresaDeLaPeticion } from '../../../lib/sesion'
import { puedeEscribir } from '../../../lib/empresas.js'

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
  // De qué empresa es esta marcación. Sale de la clave del dispositivo, o de
  // la sesión cuando marca el administrador desde su celular. Sin empresa no
  // hay dónde escribirla: ya no existe una única tabla de marcaciones.
  const ctx = await empresaDeLaPeticion(req)
  if (!ctx) {
    return NextResponse.json(
      { ok: false, error: 'DISPOSITIVO_NO_ACTIVADO', detalle: 'Este dispositivo no está activado. Actívalo desde la pantalla del kiosco con una sesión de administrador.' },
      { status: 401 },
    )
  }
  // Suscripción vencida: el kiosco deja de registrar, pero el panel sigue
  // pudiendo consultar y exportar. Este candado va aparte porque el kiosco no
  // pasa por `estadoAcceso`.
  if (!puedeEscribir(ctx.empresa)) {
    return NextResponse.json(
      { ok: false, error: 'SUSCRIPCION_VENCIDA', detalle: 'La suscripción de la empresa venció: el kiosco no puede registrar marcaciones.' },
      { status: 402 },
    )
  }

  let cuerpo
  try {
    cuerpo = await req.json()
  } catch {
    return NextResponse.json({ ok: false, error: 'Cuerpo JSON inválido.' }, { status: 400 })
  }
  // sede_id es OPCIONAL: un dispositivo móvil (sin sede) marca con sede nula.
  const { empleado_id: empleadoId, sede_id: sedeId, ts_dispositivo: tsDispositivo, diferido } = cuerpo ?? {}
  // Ubicación GPS del dispositivo (opcional): números o nada.
  const lat = Number.isFinite(cuerpo?.lat) ? cuerpo.lat : null
  const lon = Number.isFinite(cuerpo?.lon) ? cuerpo.lon : null
  const precisionM = Number.isFinite(cuerpo?.precision_m) ? cuerpo.precision_m : null
  if (!empleadoId) {
    return NextResponse.json({ ok: false, error: 'Falta empleado_id.' }, { status: 400 })
  }
  if (diferido && !tsDispositivo) {
    return NextResponse.json({ ok: false, error: 'Un envío diferido necesita ts_dispositivo.' }, { status: 400 })
  }

  // sede_id "" (dispositivo sin sede, o colas viejas del kiosco) se vuelve
  // null: la columna es uuid y la cadena vacía revienta el insert con 500.
  const r = await registrarPaso({ esquema: ctx.esquema, empleadoId, sedeId: sedeId || null, tsDispositivo: tsDispositivo ?? null, diferido: !!diferido, lat, lon, precisionM })
  if (r.error) return NextResponse.json({ ok: false, error: r.error }, { status: 404 })
  // Fuera del rango de su sede (limitar ubicación): 400 con la causa — el
  // kiosco lo muestra tal cual y NO lo encola (reintentar daría lo mismo).
  if (r.rechazo) return NextResponse.json({ ok: false, error: r.rechazo }, { status: 400 })
  if (r.duplicado) return NextResponse.json({ ok: true, duplicado: true, ultima: r.ultima })

  // DESPUÉS de responder (after), mejor esfuerzo: resolver la dirección
  // legible del punto GPS, que queda guardada para el panel. La marcación ya
  // está guardada; esto no toca al kiosco.
  //
  // Aquí ya NO se manda correo. Antes salía un comprobante por cada
  // marcación: con la salida a almorzar son cuatro al día por persona, y a
  // ese ritmo la gente los filtra o los ignora — que anula la razón de
  // mandarlos. Ahora sale UNO al terminar el día, con la jornada completa y
  // lo que haya quedado raro (lib/enviosDiarios.js, disparado por la tarea
  // de las 11 p. m.).
  after(async () => {
    if (r.marcacion.lat != null && r.marcacion.lon != null) {
      const direccion = await direccionDesdeCoordenadas(r.marcacion.lat, r.marcacion.lon)
      await guardarDireccion(ctx.esquema, r.marcacion.id, direccion).catch(() => {})
    }
  })
  return NextResponse.json({ ok: true, tipo: r.tipo, marcacion: r.marcacion })
}

export async function GET(req) {
  const { estado, esquema } = await estadoAcceso('ver')
  if (estado !== 'OK') {
    return NextResponse.json({ ok: false, error: estadoAMensaje(estado) }, { status: estadoAHttp(estado) })
  }
  const { searchParams } = new URL(req.url)
  const rows = await listarMarcaciones(esquema, {
    desde: searchParams.get('desde') ?? undefined,
    hasta: searchParams.get('hasta') ?? undefined,
    empleadoId: searchParams.get('empleado_id') ?? undefined,
  })
  return NextResponse.json({ ok: true, total: rows.length, marcaciones: rows })
}
