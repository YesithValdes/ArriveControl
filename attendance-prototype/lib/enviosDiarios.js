/**
 * lib/enviosDiarios.js — Manda a cada empleado el resumen de su jornada.
 *
 * Lo dispara la tarea programada de las 11 p. m. (app/api/cron/resumen-diario).
 * Recorre TODAS las empresas con acceso vigente, arma el día de cada persona
 * que haya marcado y le envía un correo.
 *
 * Dos decisiones que valen la pena explicar:
 *
 *  · Quien NO marcó ese día no recibe nada. Un correo diario diciendo «no
 *    marcaste» es ruido, y el ruido termina en la carpeta de spam junto con
 *    los que sí importan.
 *
 *  · Una empresa que falla no detiene a las demás. Se anota y se sigue: es
 *    una tarea nocturna sin nadie mirando, y quedarse a medias sin avisar es
 *    peor que entregar lo que sí se pudo.
 */
import { control, conEmpresa } from './db.js'
import { tieneAcceso } from './empresas.js'
import { resumenDelDia } from './resumenDiario.js'
import { enviarResumenDiario } from './correo.js'

/** Fecha de HOY en Bogotá (UTC-5 fijo, sin horario de verano). */
export const hoyEnBogota = () => new Date(Date.now() - 5 * 3600000).toISOString().slice(0, 10)

/**
 * Envía los resúmenes de un día.
 *
 * @param {string=} fechaISO  día a resumir (YYYY-MM-DD). Por defecto, hoy.
 * @returns {Promise<{fecha, empresas, enviados, sinCorreo, fallidos, detalle}>}
 */
export async function enviarResumenesDelDia(fechaISO = hoyEnBogota()) {
  const { rows: empresas } = await control(
    `select id, nombre, esquema, estado, vence_en, prueba_hasta from control.empresas`,
  )

  const salida = { fecha: fechaISO, empresas: 0, enviados: 0, sinCorreo: 0, fallidos: 0, detalle: [] }

  for (const empresa of empresas) {
    // Sin suscripción ni prueba no se le presta el servicio, y mandar correos
    // a nombre de una cuenta vencida sería prestárselo igual.
    if (!tieneAcceso(empresa)) continue

    try {
      const filas = await conEmpresa(empresa.esquema, async (db) => (await db.query(
        `select m.empleado_id,
                e.nombre, e.correo, e.jornada_dias, e.entrada_esperada, e.salida_esperada,
                m.tipo, s.nombre as sede,
                -- Minutos del día en hora Bogotá, con los segundos: el mismo
                -- criterio con el que se calculan las horas de nómina.
                (extract(hour from m.ts at time zone 'America/Bogota') * 60
                 + extract(minute from m.ts at time zone 'America/Bogota')
                 + extract(second from m.ts at time zone 'America/Bogota') / 60)::float as minutos
           from marcaciones m
           join empleados e on e.id = m.empleado_id
           left join sedes s on s.id = m.sede_id
          where not m.eliminada
            and e.activo
            and (m.ts at time zone 'America/Bogota')::date = $1::date
          order by m.empleado_id, m.ts`,
        [fechaISO],
      )).rows)

      if (filas.length === 0) continue
      salida.empresas++

      const porEmpleado = new Map()
      for (const f of filas) {
        if (!porEmpleado.has(f.empleado_id)) porEmpleado.set(f.empleado_id, { empleado: f, marcas: [] })
        porEmpleado.get(f.empleado_id).marcas.push({ tipo: f.tipo, minutos: f.minutos, sede: f.sede })
      }

      const dow = new Date(`${fechaISO}T12:00:00Z`).getUTCDay()
      for (const { empleado, marcas } of porEmpleado.values()) {
        if (!empleado.correo) { salida.sinCorreo++; continue }
        const resumen = resumenDelDia(empleado, marcas, dow)
        if (!resumen) continue
        const ok = await enviarResumenDiario({
          para: empleado.correo,
          nombre: empleado.nombre,
          fechaISO,
          resumen,
          empresa: empresa.nombre,
        })
        if (ok) salida.enviados++
        else salida.fallidos++
      }
    } catch (e) {
      salida.detalle.push({ empresa: empresa.nombre, error: e?.message || String(e) })
    }
  }

  return salida
}
