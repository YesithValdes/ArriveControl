/**
 * app/api/dispositivos/yo/route.js
 * GET — Lo que un kiosco sabe de SÍ MISMO: nombre, sede y si muestra el
 *       acceso al panel. Entra solo con la clave del dispositivo
 *       (X-Device-Key): es el aparato preguntando por su configuración.
 */
import { NextResponse } from 'next/server'
import { control } from '../../../../lib/db.js'
import { empresaDelDispositivo } from '../../../../lib/empresas.js'

export const runtime = 'nodejs'

export async function GET(req) {
  const r = await empresaDelDispositivo(req.headers.get('x-device-key'))
  if (!r) return NextResponse.json({ ok: false, error: 'Dispositivo no activado.' }, { status: 401 })
  const { rows } = await control(
    `select nombre, sede_id, acceso_panel from control.dispositivos where id = $1`,
    [r.dispositivo.id],
  )
  const d = rows[0]
  if (!d) return NextResponse.json({ ok: false, error: 'Dispositivo no encontrado.' }, { status: 404 })
  return NextResponse.json({ ok: true, dispositivo: { nombre: d.nombre, sede_id: d.sede_id, acceso_panel: Boolean(d.acceso_panel) } })
}
