/**
 * lib/periodoHoras.js — El rango de fechas que pide una petición de horas.
 *
 * Sin dependencias (ni Next ni base de datos) para poder probarlo solo. Dos
 * formas equivalentes de pedirlo:
 *   · por PERÍODO DE PAGO: `mes=YYYY-MM` y, opcional, `quincena=1|2`
 *     (sin quincena, el mes entero) — es como liquida nómina;
 *   · por fechas sueltas: `desde=YYYY-MM-DD&hasta=YYYY-MM-DD`.
 */

/** ¿Es una fecha YYYY-MM-DD real? (2026-02-30 no lo es.) */
export const fechaValida = (s) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(s ?? ''))) return false
  const d = new Date(`${s}T12:00:00Z`)
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s
}

/**
 * @param {URLSearchParams} searchParams
 * @returns {{desde: string, hasta: string}|null|{error: string}}
 *          null si no pidió rango; {error} si lo pidió mal.
 */
export function rangoPedido(searchParams) {
  const mes = searchParams.get('mes')
  const quincena = searchParams.get('quincena')
  const desde = searchParams.get('desde')
  const hasta = searchParams.get('hasta')
  if (mes != null) {
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(mes)) return { error: 'mes debe ser YYYY-MM (por ejemplo 2026-09).' }
    if (quincena != null && quincena !== '1' && quincena !== '2') return { error: 'quincena debe ser 1 (del 1 al 15) o 2 (del 16 al fin de mes).' }
    const ultimo = new Date(Number(mes.slice(0, 4)), Number(mes.slice(5, 7)), 0).getDate()
    return {
      desde: `${mes}-${quincena === '2' ? '16' : '01'}`,
      hasta: `${mes}-${String(quincena === '1' ? 15 : ultimo).padStart(2, '0')}`,
    }
  }
  if (desde == null && hasta == null) return null
  if (!(fechaValida(desde) && fechaValida(hasta) && desde <= hasta)) {
    return { error: 'desde y hasta deben ser fechas YYYY-MM-DD, con desde ≤ hasta (o usa mes=YYYY-MM y quincena=1|2).' }
  }
  return { desde, hasta }
}
