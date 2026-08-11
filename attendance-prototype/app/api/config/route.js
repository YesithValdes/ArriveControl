/**
 * app/api/config/route.js
 * GET   — configuración laboral de la empresa.
 * PATCH — la edita.
 *
 * Todo se edita aquí: ArriveControl es un producto independiente y cada
 * empresa define sus propias reglas en su propio esquema.
 */
import { NextResponse } from 'next/server'
import { conEmpresa } from '../../../lib/db.js'
import { configLaboral } from '../../../lib/configLaboral.js'
import { horasSemanaEn } from '../../../lib/jornada.js'
import { CODIGOS_HORA, factorValido } from '../../../lib/tiposHora.js'
import { estadoAcceso, estadoAHttp, estadoAMensaje } from '../../../lib/sesion'

export const runtime = 'nodejs'

/** Minutos desde medianoche → 'HH:MM' (lo que espera un <input type="time">). */
const aHHMM = (min) => `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`

export async function GET() {
  const { estado, esquema } = await estadoAcceso('ver')
  if (estado !== 'OK') return NextResponse.json({ ok: false, error: estadoAMensaje(estado) }, { status: estadoAHttp(estado) })

  const { rows } = await conEmpresa(esquema, (db) => db.query(
    `select gracia_min from config_laboral where id`,
  ))
  const laboral = await configLaboral(esquema)
  const hoy = new Date().toISOString().slice(0, 10)

  return NextResponse.json({
    ok: true,
    config: {
      gracia_min: rows[0].gracia_min,
      horas_semana: horasSemanaEn(laboral.vigencias, hoy),
      festivos: [...laboral.festivos].sort(),
      divisor_horas_mes: laboral.divisor,
      factores_hora: laboral.factores,
      nocturno_inicio: aHHMM(laboral.nocturno.inicio),
      nocturno_fin: aHHMM(laboral.nocturno.fin),
    },
  })
}

export async function PATCH(req) {
  const { estado, esquema } = await estadoAcceso('config')
  if (estado !== 'OK') return NextResponse.json({ ok: false, error: estadoAMensaje(estado) }, { status: estadoAHttp(estado) })

  let c
  try { c = await req.json() } catch { return NextResponse.json({ ok: false, error: 'JSON inválido.' }, { status: 400 }) }

  const sets = []
  const args = []

  if ('gracia_min' in c) {
    const v = Number(c.gracia_min)
    if (!Number.isInteger(v) || v < 0 || v > 240) return NextResponse.json({ ok: false, error: 'La gracia debe ser un número entre 0 y 240 minutos.' }, { status: 400 })
    args.push(v); sets.push(`gracia_min = $${args.length}`)
  }

  if ('horas_semana' in c) {
    const v = Number(c.horas_semana)
    if (!Number.isInteger(v) || v < 1 || v > 84) return NextResponse.json({ ok: false, error: 'La jornada semanal debe estar entre 1 y 84 horas.' }, { status: 400 })
    args.push(v); sets.push(`horas_semana = $${args.length}`)
    // El divisor del valor hora SE DERIVA de la jornada (semana × 5): cambiar
    // el 42 mueve las dos cosas a la vez y abre su vigencia de pago.
    args.push(v * 5); sets.push(`divisor_horas_mes = $${args.length}`)
  }

  if ('festivos' in c) {
    // Solo los festivos EXTRA de la empresa: el calendario oficial de Colombia
    // se calcula solo, no hay que cargarlo a mano.
    if (!Array.isArray(c.festivos) || c.festivos.some((f) => !/^\d{4}-\d{2}-\d{2}$/.test(f))) {
      return NextResponse.json({ ok: false, error: 'Los festivos deben ser una lista de fechas AAAA-MM-DD.' }, { status: 400 })
    }
    args.push(c.festivos); sets.push(`festivos = $${args.length}`)
  }

  if ('divisor_horas_mes' in c) {
    // Ya no se edita suelto: se deriva de la jornada (horas_semana × 5). Se
    // rechaza en vez de ignorarse para que un cliente viejo no crea que guardó.
    return NextResponse.json(
      { ok: false, error: 'El divisor ya no se edita: es la jornada semanal × 5. Cambia la jornada en Reglamento.' },
      { status: 400 },
    )
  }

  if ('factores_hora' in c) {
    const f = c.factores_hora
    if (!f || typeof f !== 'object' || Array.isArray(f)) {
      return NextResponse.json({ ok: false, error: 'Los factores deben venir como objeto {código: factor}.' }, { status: 400 })
    }
    const desconocido = Object.keys(f).find((k) => !CODIGOS_HORA.includes(k))
    if (desconocido) {
      return NextResponse.json({ ok: false, error: `Tipo de hora desconocido: ${desconocido}.` }, { status: 400 })
    }
    // Un factor por debajo de 1 pagaría la extra a menos que una ordinaria; el
    // tope atrapa el error más común, teclear 125 donde va 1.25.
    for (const [k, v] of Object.entries(f)) {
      if (!factorValido(Number(v))) {
        return NextResponse.json({ ok: false, error: `El factor de ${k} debe estar entre 1 y 10 (1.25 = 125 %).` }, { status: 400 })
      }
    }
    // Fusionado con lo que ya había: un PATCH con un solo código no debe
    // borrar los otros tres.
    args.push(JSON.stringify(f)); sets.push(`factores_hora = factores_hora || $${args.length}::jsonb`)
  }

  for (const campo of ['nocturno_inicio', 'nocturno_fin']) {
    if (!(campo in c)) continue
    if (!/^\d{2}:\d{2}$/.test(String(c[campo] ?? ''))) {
      return NextResponse.json({ ok: false, error: 'La franja nocturna debe venir en formato HH:MM.' }, { status: 400 })
    }
    args.push(c[campo]); sets.push(`${campo} = $${args.length}::time`)
  }

  if (sets.length === 0) return NextResponse.json({ ok: false, error: 'Nada que actualizar.' }, { status: 400 })

  // `horas_semana` cuenta como cambio de pago: arrastra el divisor (× 5).
  const tocaPago = ['horas_semana', 'factores_hora', 'nocturno_inicio', 'nocturno_fin']
    .some((campo) => campo in c)

  const { rows } = await conEmpresa(esquema, async (db) => {
    const r = await db.query(
      `update config_laboral set ${sets.join(', ')} where id
       returning gracia_min, horas_semana, festivos,
                 divisor_horas_mes, factores_hora,
                 to_char(nocturno_inicio, 'HH24:MI') as nocturno_inicio,
                 to_char(nocturno_fin, 'HH24:MI') as nocturno_fin`,
      args,
    )
    // Los parámetros de PAGO llevan historia: el cambio abre una vigencia que
    // rige DESDE HOY, y lo anterior queda intacto para los tramos viejos.
    // Editar dos veces el mismo día pisa la vigencia de hoy (es una
    // corrección, no una regla nueva). El estado completo sale de la fila ya
    // actualizada, así una vigencia siempre trae los cuatro parámetros aunque
    // el PATCH haya tocado uno.
    if (tocaPago) {
      const cfg = r.rows[0]
      await db.query(
        `insert into valorizacion_vigencias
           (desde, factores_hora, divisor_horas_mes, nocturno_inicio, nocturno_fin)
         values ((now() at time zone 'America/Bogota')::date, $1, $2, $3::time, $4::time)
         on conflict (desde) do update set
           factores_hora = excluded.factores_hora,
           divisor_horas_mes = excluded.divisor_horas_mes,
           nocturno_inicio = excluded.nocturno_inicio,
           nocturno_fin = excluded.nocturno_fin`,
        [JSON.stringify(cfg.factores_hora), cfg.divisor_horas_mes, cfg.nocturno_inicio, cfg.nocturno_fin],
      )
    }
    return r
  })
  return NextResponse.json({ ok: true, config: rows[0] })
}
