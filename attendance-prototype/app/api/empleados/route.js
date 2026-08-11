/**
 * app/api/empleados/route.js
 * GET  — roster de empleados de la empresa.
 *        · Con X-Device-Key (kiosco): INCLUYE descriptor facial (lo necesita
 *          para la comparación 1:N local).
 *        · Con sesión (panel): SIN descriptores (no los necesita y son el 95%
 *          del peso).
 * POST — alta de empleado (registro por foto). Sesión + permiso `empleados`.
 */
import { NextResponse } from 'next/server'
import { conEmpresa } from '../../../lib/db.js'
import { estadoAcceso, estadoAHttp, estadoAMensaje, empresaDeLaPeticion } from '../../../lib/sesion'
import { cabeOtroEmpleado } from '../../../lib/empresas.js'

export const runtime = 'nodejs'

export async function GET(req) {
  // ?rostros=1 → modo KIOSCO: id + nombre + descriptor para la comparación 1:N.
  // Los descriptores son DATO BIOMÉTRICO (Ley 1581): solo los baja un
  // dispositivo activado o una sesión del panel.
  if (new URL(req.url).searchParams.get('rostros') === '1') {
    // La empresa sale de la clave del dispositivo, o de la sesión cuando es el
    // administrador. Es doblemente importante aquí: bajar el roster de la
    // empresa equivocada entregaría los rostros de otro cliente.
    const ctx = await empresaDeLaPeticion(req)
    if (!ctx) {
      return NextResponse.json(
        { ok: false, error: 'DISPOSITIVO_NO_ACTIVADO', detalle: 'Solo un dispositivo activado puede descargar el roster facial.' },
        { status: 401 },
      )
    }
    const { rows } = await conEmpresa(ctx.esquema, (db) => db.query(
      `select e.id, e.nombre, e.cedula, e.sede_id, e.descriptor_facial
         from empleados e
        where e.activo
        order by e.nombre`,
    ))
    return NextResponse.json({
      ok: true,
      empleados: rows.map(({ cedula, ...e }) => e), // la cédula no baja al kiosco
    })
  }

  const { estado, esquema } = await estadoAcceso('ver')
  if (estado !== 'OK') return NextResponse.json({ ok: false, error: estadoAMensaje(estado) }, { status: estadoAHttp(estado) })

  const { searchParams } = new URL(req.url)
  const incluirInactivos = searchParams.get('inactivos') === '1'
  const { rows: empleados } = await conEmpresa(esquema, (db) => db.query(
    `select e.id, e.nombre, e.cedula, e.sede_id, s.nombre as sede_nombre,
            e.entrada_esperada, e.salida_esperada, e.almuerzo_min, e.jornada_semanal,
            e.salario_mensual, e.activo, e.creado_en,
            (e.descriptor_facial is not null) as tiene_rostro
       from empleados e
       left join sedes s on s.id = e.sede_id
      ${incluirInactivos ? '' : 'where e.activo'}
      order by e.nombre`,
  ))
  return NextResponse.json({ ok: true, empleados })
}

export async function POST(req) {
  const { estado, esquema, empresa } = await estadoAcceso('empleados')
  if (estado !== 'OK') return NextResponse.json({ ok: false, error: estadoAMensaje(estado) }, { status: estadoAHttp(estado) })

  // Tope del plan gratuito. Se comprueba en el SERVIDOR, no en la pantalla, y
  // bloquea SOLO esta acción: el resto del panel sigue funcionando igual.
  const cupo = await cabeOtroEmpleado(empresa)
  if (!cupo.cabe) {
    return NextResponse.json({
      ok: false,
      error: `El plan gratuito llega hasta ${cupo.limite} empleados y ya tienes ${cupo.actuales}. Pasa a plan de pago para registrar más.`,
      limite: cupo.limite,
      actuales: cupo.actuales,
    }, { status: 402 })
  }

  let c
  try { c = await req.json() } catch { return NextResponse.json({ ok: false, error: 'JSON inválido.' }, { status: 400 }) }

  const nombre = String(c?.nombre ?? '').trim()
  const cedula = String(c?.cedula ?? '').replace(/\D/g, '')
  if (!nombre) return NextResponse.json({ ok: false, error: 'El nombre es obligatorio.' }, { status: 400 })
  // La cédula identifica a la persona en los reportes de horas: sin ella no hay
  // a quién abonarle lo trabajado. Es única DENTRO de la empresa, así que la
  // misma persona puede estar en dos empresas clientes sin chocar.
  if (cedula.length < 5) return NextResponse.json({ ok: false, error: 'La cédula es obligatoria (solo números).' }, { status: 400 })

  const descriptor = Array.isArray(c?.descriptor_facial) && c.descriptor_facial.length === 128 ? c.descriptor_facial : null

  // Jornada distribuida (opcional): [lun..sáb], 6 horas-por-día entre 0 y 12.
  const jornada = Array.isArray(c?.jornada_semanal)
    && c.jornada_semanal.length === 6
    && c.jornada_semanal.every((h) => typeof h === 'number' && h >= 0 && h <= 12)
    ? c.jornada_semanal : null

  // Salario mensual: OPCIONAL. Registrar a alguien no debe exigir saber su
  // sueldo; sin él sus horas se cuentan igual, solo que no se valorizan.
  const salario = c?.salario_mensual == null || c.salario_mensual === '' ? null : Number(c.salario_mensual)
  if (salario !== null && (!Number.isFinite(salario) || salario <= 0)) {
    return NextResponse.json({ ok: false, error: 'El salario mensual debe ser un número mayor que cero, o quedar vacío.' }, { status: 400 })
  }

  try {
    const { rows } = await conEmpresa(esquema, (db) => db.query(
      `insert into empleados
         (nombre, cedula, sede_id, entrada_esperada, salida_esperada, almuerzo_min, jornada_semanal, salario_mensual, descriptor_facial)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       returning id, nombre, cedula, sede_id, entrada_esperada, salida_esperada, almuerzo_min, jornada_semanal, salario_mensual, activo, creado_en`,
      [nombre, cedula, c.sede_id ?? null, c.entrada_esperada ?? null, c.salida_esperada ?? null,
       c.almuerzo_min ?? 60, jornada, salario, descriptor],
    ))
    return NextResponse.json({ ok: true, empleado: rows[0] })
  } catch (e) {
    if (e.code === '23505') {
      return NextResponse.json({ ok: false, error: 'Ya hay un empleado con esa cédula.' }, { status: 409 })
    }
    throw e
  }
}
