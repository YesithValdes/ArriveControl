/**
 * lib/trm.js — TRM oficial (pesos por dólar) para cobrar en COP los precios
 * que el catálogo fija en USD.
 *
 * Fuente: Superintendencia Financiera, publicada en datos.gov.co (conjunto
 * 32sa-8pi3). Se guarda en control.trm, una por día: así el panel no consulta
 * afuera en cada visita y, si la fuente falla, se usa la última conocida
 * (de hasta MAX_DIAS_VIEJA días). Si no hay ninguna confiable, se FALLA: un
 * precio inventado es peor que no poder cobrar un rato.
 */
import { control } from './db.js'

const FUENTE = 'https://www.datos.gov.co/resource/32sa-8pi3.json?$order=vigenciadesde%20DESC&$limit=1'
const MAX_DIAS_VIEJA = 5
// Rango sano: un valor fuera de esto es un error de la fuente, no una TRM.
const MIN_TRM = 1500
const MAX_TRM = 10000

const hoyBogota = () => new Date(Date.now() - 5 * 3600000).toISOString().slice(0, 10)

/** Consulta la fuente oficial. @returns {Promise<{fecha: string, valor: number}>} */
async function consultarFuente() {
  const r = await fetch(FUENTE, { signal: AbortSignal.timeout(8000), cache: 'no-store' })
  if (!r.ok) throw new Error(`TRM: HTTP ${r.status}`)
  const [fila] = await r.json()
  const valor = Number(fila?.valor)
  if (!Number.isFinite(valor) || valor < MIN_TRM || valor > MAX_TRM) throw new Error('TRM: valor fuera de rango')
  return { fecha: hoyBogota(), valor }
}

/**
 * La TRM vigente. Una consulta a la fuente por día; el resto, de la base.
 * @returns {Promise<{valor: number, fecha: string}>}
 */
export async function trmVigente() {
  const hoy = hoyBogota()
  const { rows: [deHoy] } = await control('select fecha::text, valor::float as valor from control.trm where fecha = $1', [hoy])
  if (deHoy) return { valor: deHoy.valor, fecha: deHoy.fecha }
  try {
    const t = await consultarFuente()
    await control(
      `insert into control.trm (fecha, valor) values ($1, $2)
       on conflict (fecha) do update set valor = excluded.valor, obtenida_en = now()`,
      [t.fecha, t.valor],
    )
    return t
  } catch (e) {
    const { rows: [ultima] } = await control(
      `select fecha::text, valor::float as valor from control.trm
        where fecha >= $1::date - $2::int order by fecha desc limit 1`,
      [hoy, MAX_DIAS_VIEJA],
    )
    if (ultima) {
      console.warn(`TRM: la fuente falló (${e?.message || e}); se usa la del ${ultima.fecha}.`)
      return { valor: ultima.valor, fecha: ultima.fecha }
    }
    throw new Error('No se pudo obtener la TRM oficial. Intenta de nuevo en unos minutos.')
  }
}

/**
 * Dólares → pesos, REDONDEADO HACIA ARRIBA a la centena: el cobro nunca queda
 * por debajo de lo que vale en dólares.
 */
export function aPesos(usd, trm) {
  const n = Number(usd) * Number(trm)
  if (!(n > 0)) throw new Error('Monto inválido para convertir a pesos.')
  return Math.ceil(Math.round(n * 100) / 100 / 100) * 100
}
