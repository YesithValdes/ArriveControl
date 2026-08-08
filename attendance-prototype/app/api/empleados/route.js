/**
 * app/api/empleados/route.js
 * GET  — roster de empleados activos.
 *        · Con X-Device-Key (kiosco): INCLUYE descriptor facial (lo necesita
 *          para la comparación 1:N local).
 *        · Con sesión del gestor (panel): SIN descriptores (no los necesita
 *          y son el 95% del peso).
 * POST — alta de empleado (registro por foto). Sesión + permiso CREAR.
 */
import { NextResponse } from 'next/server'
import { pool } from '../../../lib/db.js'
import { estadoAcceso } from '../../../lib/sesion'
import { dispositivoDeLaPeticion } from '../../../lib/dispositivos.js'
import { modoConectado } from '../../../lib/configLaboral.js'
import { colaboradorPorId, estadosDeColaboradores } from '../../../lib/gestor.js'

export const runtime = 'nodejs'

export async function GET(req) {
  // ?rostros=1 → modo KIOSCO: id + nombre + descriptor para la comparación 1:N.
  // Los descriptores son DATO BIOMÉTRICO (Ley 1581): solo los baja un
  // dispositivo activado (o la clave compartida de compatibilidad, o una
  // sesión). En desarrollo sin KIOSCO_DEVICE_KEY se permite para probar.
  if (new URL(req.url).searchParams.get('rostros') === '1') {
    const claveEnviada = req.headers.get('x-device-key')
    const claveEnv = process.env.KIOSCO_DEVICE_KEY
    const conClaveEnv = !!claveEnv && claveEnviada === claveEnv
    const dispositivo = claveEnviada && !conClaveEnv ? await dispositivoDeLaPeticion(req) : null
    if (!conClaveEnv && !dispositivo && (process.env.NODE_ENV === 'production' || claveEnv)) {
      const { estado } = await estadoAcceso('ver')
      if (estado !== 'OK') {
        return NextResponse.json(
          { ok: false, error: 'DISPOSITIVO_NO_ACTIVADO', detalle: 'Solo un dispositivo activado puede descargar el roster facial.' },
          { status: 401 },
        )
      }
    }
    const { rows } = await pool.query(
      `select e.id, e.nombre, e.cedula, e.sede_id, e.descriptor_facial
         from asistencia.empleados e
        where e.activo
        order by e.nombre`,
    )

    // En modo CONECTADO se le pregunta al gestor por HTTP quién sigue activo:
    // un colaborador RETIRADO no debe poder marcar. Si el gestor no responde
    // se deja pasar a todos — preferimos que el kiosco siga funcionando a que
    // la gente no pueda registrar su entrada por una caída de la nómina.
    const estados = await estadosDeColaboradores(rows.map((e) => e.cedula).filter(Boolean))
    const empleados = estados
      ? rows.filter((e) => !e.cedula || estados.get(e.cedula) !== false)
      : rows

    return NextResponse.json({
      ok: true,
      empleados: empleados.map(({ cedula, ...e }) => e), // la cédula no baja al kiosco
    })
  }

  const { estado } = await estadoAcceso('ver')
  if (estado !== 'OK') return NextResponse.json({ ok: false, error: 'Sin acceso.' }, { status: estado === 'SIN_SESION' ? 401 : 403 })

  const { searchParams } = new URL(req.url)
  const incluirInactivos = searchParams.get('inactivos') === '1'
  // `retirado_gestor` avisa al panel que el colaborador ya no está activo en
  // el gestor (retiro laboral): se muestra pero no puede marcar en el kiosco.
  // Sin gestor esa columna no aplica y sale siempre en falso.
  const { rows } = await pool.query(
    `select e.id, e.nombre, e.cedula, e.colaborador_id, e.sede_id, s.nombre as sede_nombre,
            e.entrada_esperada, e.salida_esperada, e.almuerzo_min, e.jornada_semanal, e.activo, e.creado_en,
            (e.descriptor_facial is not null) as tiene_rostro
       from asistencia.empleados e
       left join asistencia.sedes s on s.id = e.sede_id
      ${incluirInactivos ? '' : 'where e.activo'}
      order by e.nombre`,
  )

  // `retirado_gestor` avisa al panel que la persona ya no está activa en la
  // nómina: se muestra pero no puede marcar. Sin gestor, siempre falso.
  const estados = await estadosDeColaboradores(rows.map((e) => e.cedula).filter(Boolean))
  const empleados = rows.map((e) => ({
    ...e,
    retirado_gestor: Boolean(e.colaborador_id) && estados?.get(e.cedula) === false,
  }))
  return NextResponse.json({ ok: true, empleados })
}

export async function POST(req) {
  const { estado } = await estadoAcceso('empleados')
  if (estado !== 'OK') return NextResponse.json({ ok: false, error: 'Sin permiso para registrar empleados.' }, { status: estado === 'SIN_SESION' ? 401 : 403 })

  let c
  try { c = await req.json() } catch { return NextResponse.json({ ok: false, error: 'JSON inválido.' }, { status: 400 }) }

  // De dónde sale la identidad de la persona, según el modo:
  //  · CONECTADO (hay gestor): se exige elegir un colaborador ACTIVO de allá y
  //    nombre/cédula se toman de su base — lo que mande el navegador se ignora,
  //    para que la cédula siempre cruce con nómina.
  //  · AUTÓNOMO (sin gestor): ArriveControl es la fuente, y el nombre y la
  //    cédula se digitan aquí.
  let nombre
  let cedula
  let colaboradorId = null

  if (modoConectado()) {
    colaboradorId = String(c?.colaborador_id ?? '').trim()
    if (!colaboradorId) {
      return NextResponse.json(
        { ok: false, error: 'Elige el colaborador desde el gestor de empleados.' },
        { status: 400 },
      )
    }
    let colab
    try {
      colab = await colaboradorPorId(colaboradorId)
    } catch (e) {
      return NextResponse.json(
        { ok: false, error: `No se pudo consultar el gestor de nómina: ${e.message}` },
        { status: 502 },
      )
    }
    if (!colab) {
      return NextResponse.json(
        { ok: false, error: 'Ese colaborador no existe o no está activo en el gestor de nómina.' },
        { status: 404 },
      )
    }
    nombre = `${colab.nombres} ${colab.apellidos}`
    cedula = colab.cedula
  } else {
    nombre = String(c?.nombre ?? '').trim()
    cedula = String(c?.cedula ?? '').replace(/\D/g, '')
    if (!nombre) return NextResponse.json({ ok: false, error: 'El nombre es obligatorio.' }, { status: 400 })
    // La cédula identifica a la persona en los reportes de horas: sin ella no
    // hay a quién abonarle lo trabajado.
    if (cedula.length < 5) return NextResponse.json({ ok: false, error: 'La cédula es obligatoria (solo números).' }, { status: 400 })
  }
  const descriptor = Array.isArray(c?.descriptor_facial) && c.descriptor_facial.length === 128 ? c.descriptor_facial : null
  // Jornada distribuida (opcional): [lun..sáb], 6 horas-por-día entre 0 y 12.
  const jornada = Array.isArray(c?.jornada_semanal)
    && c.jornada_semanal.length === 6
    && c.jornada_semanal.every((h) => typeof h === 'number' && h >= 0 && h <= 12)
    ? c.jornada_semanal : null

  try {
    const { rows } = await pool.query(
      `insert into asistencia.empleados
         (nombre, cedula, colaborador_id, sede_id, entrada_esperada, salida_esperada, almuerzo_min, jornada_semanal, descriptor_facial)
       values ($1,$2,$3::uuid,$4,$5,$6,$7,$8,$9)
       returning id, nombre, cedula, colaborador_id, sede_id, entrada_esperada, salida_esperada, almuerzo_min, jornada_semanal, activo, creado_en`,
      [nombre, cedula, colaboradorId, c.sede_id ?? null, c.entrada_esperada ?? null, c.salida_esperada ?? null,
       c.almuerzo_min ?? 60, jornada, descriptor],
    )
    return NextResponse.json({ ok: true, empleado: rows[0] })
  } catch (e) {
    if (e.code === '23505') {
      return NextResponse.json(
        { ok: false, error: modoConectado() ? 'Ese colaborador ya está registrado en asistencia.' : 'Ya hay un empleado con esa cédula.' },
        { status: 409 },
      )
    }
    throw e
  }
}
