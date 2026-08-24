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
import { validarDias } from '../../../lib/horariosDias.js'

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
    // TODOS los rostros de cada empleado, no solo el principal: el kiosco
    // compara contra el más parecido de los suyos, que es lo que absorbe los
    // cambios de luz y de ángulo sin diluir la identidad.
    const { rows } = await conEmpresa(ctx.esquema, (db) => db.query(
      `select e.id, e.nombre, e.cedula, e.sede_id, e.validar_sede, e.descriptor_facial,
              coalesce(
                (select array_agg(r.descriptor) from rostros r where r.empleado_id = e.id),
                case when e.descriptor_facial is null then '{}' else array[e.descriptor_facial] end
              ) as descriptores
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
    `select e.id, e.nombre, e.cedula, e.correo, e.sede_id, s.nombre as sede_nombre, e.validar_sede, e.validar_ubicacion,
            e.entrada_esperada, e.salida_esperada, e.almuerzo_min, e.jornada_dias, e.jornada_semanal,
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

  const esDescriptor = (d) => Array.isArray(d) && d.length === 128 && d.every((n) => typeof n === 'number' && Number.isFinite(n))
  const descriptor = esDescriptor(c?.descriptor_facial) ? c.descriptor_facial : null
  // Varias fotos por persona: la primera es el rostro principal y todas se
  // guardan en `rostros` para comparar al más parecido.
  const descriptores = (Array.isArray(c?.descriptores) ? c.descriptores : []).filter(esDescriptor)
  const listaRostros = descriptores.length > 0 ? descriptores : (descriptor ? [descriptor] : [])
  const principal = listaRostros[0] ?? null

  // Correo del comprobante de marcación. OPCIONAL: sin correo no se envía
  // nada. Validación mínima: si viene algo, que al menos parezca un correo.
  const correo = String(c?.correo ?? '').trim().toLowerCase() || null
  if (correo && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(correo)) {
    return NextResponse.json({ ok: false, error: 'El correo no parece válido. Corrígelo o déjalo vacío.' }, { status: 400 })
  }

  // Jornada distribuida (opcional): [lun..sáb], 6 horas-por-día entre 0 y 12.
  const jornada = Array.isArray(c?.jornada_semanal)
    && c.jornada_semanal.length === 6
    && c.jornada_semanal.every((h) => typeof h === 'number' && h >= 0 && h <= 12)
    ? c.jornada_semanal : null

  // Jornada POR DÍAS (opcional): copia del horario asignado, día por día.
  let jornadaDias = null
  if (c?.jornada_dias != null) {
    const v = validarDias(c.jornada_dias)
    if (v.error) return NextResponse.json({ ok: false, error: v.error }, { status: 400 })
    jornadaDias = v.dias
  }

  // Salario mensual: OPCIONAL. Registrar a alguien no debe exigir saber su
  // sueldo; sin él sus horas se cuentan igual, solo que no se valorizan.
  const salario = c?.salario_mensual == null || c.salario_mensual === '' ? null : Number(c.salario_mensual)
  if (salario !== null && (!Number.isFinite(salario) || salario <= 0)) {
    return NextResponse.json({ ok: false, error: 'El salario mensual debe ser un número mayor que cero, o quedar vacío.' }, { status: 400 })
  }

  try {
    const empleado = await conEmpresa(esquema, async (db) => {
      const { rows } = await db.query(
        `insert into empleados
           (nombre, cedula, correo, sede_id, validar_sede, validar_ubicacion, entrada_esperada, salida_esperada, almuerzo_min, jornada_dias, jornada_semanal, salario_mensual, descriptor_facial)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
         returning id, nombre, cedula, correo, sede_id, validar_sede, validar_ubicacion, entrada_esperada, salida_esperada, almuerzo_min, jornada_dias, jornada_semanal, salario_mensual, activo, creado_en`,
        [nombre, cedula, correo, c.sede_id ?? null, c.validar_sede === true, c.validar_ubicacion === true, c.entrada_esperada ?? null, c.salida_esperada ?? null,
         c.almuerzo_min ?? 60, jornadaDias == null ? null : JSON.stringify(jornadaDias), jornada, salario, principal],
      )
      // Misma transacción: un empleado sin sus rostros no podría marcar.
      for (const d of listaRostros) {
        await db.query(`insert into rostros (empleado_id, descriptor) values ($1,$2)`, [rows[0].id, d])
      }
      return { ...rows[0], rostros: listaRostros.length }
    })
    return NextResponse.json({ ok: true, empleado })
  } catch (e) {
    if (e.code === '23505') {
      return NextResponse.json({ ok: false, error: 'Ya hay un empleado con esa cédula.' }, { status: 409 })
    }
    throw e
  }
}
