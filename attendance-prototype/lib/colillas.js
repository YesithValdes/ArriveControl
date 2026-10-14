/**
 * lib/colillas.js — Colilla de pago (desprendible) de HORAS por colaborador.
 *
 * Todo se calcula aquí, en el servidor, con la misma fuente que Reportes
 * (lib/cierres.js: lo cerrado congelado, lo abierto en vivo). El navegador
 * solo dice de quién y qué período: nunca manda las cifras.
 *
 * La colilla se guarda congelada en `colillas.datos`; consultarla después
 * muestra exactamente lo que se generó.
 */
import { conEmpresa } from './db.js'
import { loteConCierres } from './cierres.js'
import { TIPOS_HORA } from './tiposHora.js'

const redondear = (h) => Math.round(h * 100) / 100

/** Día calendario en Bogotá (UTC-5 fijo). */
const diaBogota = (d) => new Date(new Date(d).getTime() - 5 * 3600000).toISOString().slice(0, 10)

/**
 * Días y horas trabajadas en el rango: pares entrada→salida del mismo día
 * (Bogotá). Una entrada sin salida cuenta el día pero no suma horas.
 */
function trabajado(marcaciones) {
  const dias = new Set()
  let segundos = 0
  let abierta = null
  for (const m of marcaciones) {
    if (m.tipo === 'entrada') { abierta = m; dias.add(diaBogota(m.ts)); continue }
    if (abierta && diaBogota(abierta.ts) === diaBogota(m.ts)) segundos += (new Date(m.ts) - new Date(abierta.ts)) / 1000
    abierta = null
  }
  return { dias: dias.size, horas: redondear(segundos / 3600) }
}

/**
 * Genera y GUARDA la colilla de un colaborador (por cédula) en [desde, hasta].
 * @returns {Promise<object|null>} la colilla, o null si no existe el colaborador
 */
export async function generarColilla(esquema, { documento, desde, hasta, quien }) {
  const emp = await conEmpresa(esquema, (db) => db.query(
    `select e.id, e.nombre, e.cedula, s.nombre as sede
       from empleados e left join sedes s on s.id = e.sede_id
      where e.cedula = $1 limit 1`, [documento],
  ))
  const persona = emp.rows[0]
  if (!persona) return null

  const [lote, marc] = await Promise.all([
    loteConCierres(esquema, { desde, hasta }),
    conEmpresa(esquema, (db) => db.query(
      `select tipo, ts from marcaciones
        where empleado_id = $1 and not eliminada
          and (ts at time zone 'America/Bogota')::date between $2::date and $3::date
        order by ts`, [persona.id, desde, hasta],
    )),
  ])

  // Horas extra y recargos por tipo, con su valor (suma de los tramos).
  const tramos = lote.registros.filter((r) => r.documento === persona.cedula)
  const sinSalario = tramos.some((r) => r.valor == null)
  const tipos = TIPOS_HORA.map((t) => {
    const suyos = tramos.filter((r) => r.tipoHora === t.codigo)
    return {
      codigo: t.codigo, nombre: t.nombre,
      horas: redondear(suyos.reduce((s, r) => s + r.horas, 0)),
      valor: sinSalario ? null : Math.round(suyos.reduce((s, r) => s + (r.valor ?? 0), 0)),
    }
  })
  const cierre = lote.cierres.get(persona.cedula) ?? null
  const datos = {
    sede: persona.sede ?? null,
    trabajado: trabajado(marc.rows),
    tipos,
    horasExtra: redondear(tipos.reduce((s, t) => s + t.horas, 0)),
    valorExtra: sinSalario ? null : tipos.reduce((s, t) => s + t.valor, 0),
    sinSalario,
    cierre: cierre ? { cerradoEn: cierre.cerradoEn, cerradoPor: cierre.cerradoPor } : null,
  }

  const { rows } = await conEmpresa(esquema, (db) => db.query(
    `insert into colillas (empleado_id, documento, nombre, desde, hasta, datos, generada_por)
     values ($1, $2, $3, $4::date, $5::date, $6, $7)
     returning ${COLUMNAS}`,
    [persona.id, persona.cedula, persona.nombre, desde, hasta, datos, quien ?? null],
  ))
  return rows[0]
}

const COLUMNAS = `id, documento, nombre, to_char(desde, 'YYYY-MM-DD') as desde, to_char(hasta, 'YYYY-MM-DD') as hasta,
  datos, generada_en as "generadaEn", generada_por as "generadaPor"`

/** Colillas guardadas de un colaborador (por cédula), la más reciente primero. */
export async function colillasDe(esquema, documento) {
  const { rows } = await conEmpresa(esquema, (db) => db.query(
    `select ${COLUMNAS} from colillas where documento = $1 order by generada_en desc limit 100`, [documento],
  ))
  return rows
}
