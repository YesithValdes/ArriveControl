/**
 * lib/salidasAutomaticas.js — Cierra las salidas que nadie marcó.
 *
 * Cuando una persona entra y no marca su salida, el día queda con la anomalía
 * «Salida faltante». Cada noche (dentro del cron del resumen diario) se le
 * crea una SALIDA en la hora en que termina su jornada de ese día, como
 * marcación manual con su fila en `correcciones` (motivo y autor «Cierre
 * automático»): queda a la vista en el historial y se puede corregir.
 *
 * No se cierra:
 *  · un día sin horario (no hay hora pactada con qué cerrar);
 *  · una entrada hecha DESPUÉS de su hora de salida (no abre jornada);
 *  · si la siguiente marcación de esa persona es antes de esa hora.
 *
 * Solo desde DESDE: las anomalías anteriores se dejaron como estaban, a
 * pedido de la empresa.
 */
import { conEmpresa } from './db.js'
import { finDeJornada } from './calculoHoras.js'

/** Primer día al que se le cierran salidas solas. */
export const DESDE = '2026-10-06'
/** Cuántos días hacia atrás revisa cada noche (por si una noche no corrió). */
const DIAS_ATRAS = 7
export const MOTIVO = 'Salida no marcada: se registró sola en la hora de fin de su horario.'

const restarDias = (fechaISO, n) => new Date(Date.parse(`${fechaISO}T12:00:00Z`) - n * 86400000).toISOString().slice(0, 10)

/**
 * Cierra las salidas faltantes de una empresa en los días ya terminados hasta
 * `hastaFecha` (inclusive). Todo en una transacción. Devuelve las creadas.
 */
export async function cerrarSalidasFaltantes(esquema, hastaFecha) {
  const desde = [DESDE, restarDias(hastaFecha, DIAS_ATRAS - 1)].sort().at(-1)
  if (desde > hastaFecha) return []
  return conEmpresa(esquema, async (db) => {
    // Cada entrada del rango con la marcación SIGUIENTE de esa persona.
    const { rows } = await db.query(
      `with m as (
         select m.id, m.empleado_id, m.tipo, m.ts, m.sede_id,
                lead(m.tipo) over w as sig_tipo, lead(m.ts) over w as sig_ts
           from marcaciones m
          where not m.eliminada
         window w as (partition by m.empleado_id order by m.ts)
       )
       select m.id, m.empleado_id, m.ts, m.sig_ts, m.sede_id,
              e.jornada_dias, e.entrada_esperada, e.salida_esperada,
              to_char(m.ts at time zone 'America/Bogota', 'YYYY-MM-DD') as fecha,
              extract(dow from m.ts at time zone 'America/Bogota')::int as dow,
              extract(hour from m.ts at time zone 'America/Bogota')::int * 60
                + extract(minute from m.ts at time zone 'America/Bogota')::int as minutos
         from m join empleados e on e.id = m.empleado_id
        where m.tipo = 'entrada'
          and m.sig_tipo is distinct from 'salida'
          and (m.ts at time zone 'America/Bogota')::date between $1::date and $2::date
        order by m.ts`,
      [desde, hastaFecha],
    )
    const creadas = []
    for (const r of rows) {
      const fin = finDeJornada({
        jornadaDias: r.jornada_dias, entradaEsperada: r.entrada_esperada, salidaEsperada: r.salida_esperada,
      }, r.dow)
      if (fin == null || fin <= r.minutos) continue
      const salida = new Date(Date.parse(`${r.fecha}T00:00:00-05:00`) + fin * 60000)
      if (r.sig_ts && salida >= new Date(r.sig_ts)) continue
      const ins = await db.query(
        `insert into marcaciones (empleado_id, tipo, ts, sede_id, origen)
         values ($1, 'salida', $2, $3, 'manual') returning id`,
        [r.empleado_id, salida.toISOString(), r.sede_id],
      )
      await db.query(
        `insert into correcciones (marcacion_id, admin_user_id, admin_email, accion, valor_nuevo, motivo)
         values ($1, 'sistema', 'Cierre automático', 'crear', $2, $3)`,
        [ins.rows[0].id, JSON.stringify({ tipo: 'salida', ts: salida.toISOString() }), MOTIVO],
      )
      creadas.push({ empleadoId: r.empleado_id, entrada: r.ts, salida: salida.toISOString() })
    }
    return creadas
  })
}
