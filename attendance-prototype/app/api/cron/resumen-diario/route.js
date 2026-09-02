/**
 * app/api/cron/resumen-diario/route.js
 *
 * GET — envía a cada empleado el resumen de su jornada. Lo llama la tarea
 *       programada de las 11:59 p. m. hora Colombia: lo último del día, para
 *       que hasta el último turno de la tarde alcance a quedar dentro.
 *
 * El horario vive en vercel.json como `59 4 * * *`, y ese 4 es UTC: las 04:59
 * UTC son las 11:59 p. m. del día ANTERIOR en Bogotá (UTC-5). Cuadra solo con
 * el resto: a esa hora `hoyEnBogota()` devuelve justamente el día que termina,
 * que es el que hay que resumir. JSON no admite comentarios, así que la
 * explicación vive aquí.
 *
 * PROTEGIDO. No exige sesión —quien llama es un programador de tareas, no una
 * persona— así que la puerta es un secreto compartido: sin él, cualquiera
 * podría dispararle correos a todos los empleados de todas las empresas
 * llamando a esta dirección.
 *
 * Vercel firma sus propias llamadas con `Authorization: Bearer $CRON_SECRET`.
 * Se acepta eso y, para poder probar a mano, la misma clave por `?clave=`.
 *
 * Acepta `?fecha=YYYY-MM-DD` para reenviar un día concreto: si una noche falla
 * el envío, se repite sin esperar 24 horas.
 */
import { NextResponse } from 'next/server'
import { enviarResumenesDelDia, hoyEnBogota } from '../../../../lib/enviosDiarios.js'
import { control } from '../../../../lib/db.js'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
// Recorrer todas las empresas y hablar con el servidor de correo no cabe en
// los 10 s por defecto.
export const maxDuration = 300

export async function GET(req) {
  const secreto = process.env.CRON_SECRET
  if (!secreto) {
    // Sin secreto configurado se queda CERRADO. Abrirlo «mientras tanto»
    // sería dejar el disparador de correos masivos a la vista de cualquiera.
    console.error('Resumen diario: falta CRON_SECRET, no se ejecuta.')
    return NextResponse.json({ ok: false, error: 'Tarea no configurada.' }, { status: 503 })
  }

  const { searchParams } = new URL(req.url)
  const autorizado = req.headers.get('authorization') === `Bearer ${secreto}`
    || searchParams.get('clave') === secreto
  if (!autorizado) {
    return NextResponse.json({ ok: false, error: 'No autorizado.' }, { status: 401 })
  }

  const fecha = searchParams.get('fecha') || hoyEnBogota()
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) {
    return NextResponse.json({ ok: false, error: 'La fecha debe ser YYYY-MM-DD.' }, { status: 400 })
  }

  const t0 = Date.now()
  let r
  let fallo = null
  try {
    r = await enviarResumenesDelDia(fecha)
  } catch (e) {
    fallo = e?.message || String(e)
  }
  const duracion = Date.now() - t0

  // Queda BITÁCORA en la base, no solo en los registros del servidor: los de
  // Vercel se borran, y cuando una noche no llegaron los correos no hubo
  // forma de saber si la tarea no corrió, corrió y falló, o corrió y no tenía
  // a quién escribirle. Guardar el rastro es la diferencia entre revisar y
  // adivinar.
  //
  // Si anotar falla, la tarea NO falla: ya hizo su trabajo y perder la
  // bitácora es menos grave que perder los correos.
  await control(
    `insert into control.tareas (tarea, sobre, estado, detalle, duracion_ms)
     values ('resumen-diario', $1::date, $2, $3::jsonb, $4)`,
    [fecha, fallo ? 'error' : 'ok', JSON.stringify(fallo ? { error: fallo } : r), duracion],
  ).catch((e) => console.error('No se pudo anotar la tarea en la bitácora:', e?.message || e))

  if (fallo) {
    console.error(`Resumen diario ${fecha} FALLÓ tras ${duracion} ms:`, fallo)
    return NextResponse.json({ ok: false, error: fallo }, { status: 500 })
  }
  console.log(`Resumen diario ${fecha}: ${r.enviados} enviados, ${r.fallidos} fallidos, ${r.sinCorreo} sin correo (${duracion} ms)`)
  return NextResponse.json({ ok: true, ...r })
}
