/**
 * Aviso de horas incompletas. No interviene en la liquidación de horas extra.
 * Se agrupan pares reales por el día de su entrada (Bogotá), incluyendo
 * salidas al día siguiente. Una marcación incompleta o incoherente invalida
 * el día: nunca se usan cierres automáticos para generar este aviso.
 */
import { descansoDelHorario } from './descanso.js'

const diaDe = ts => new Date(Date.parse(ts) - 5 * 3600000).toISOString().slice(0, 10)
const minutosHora = valor => {
  const match = /^(\d{2}):(\d{2})(?::\d{2})?$/.exec(String(valor ?? ''))
  if (!match) return null
  const h = Number(match[1]), m = Number(match[2])
  return h < 24 && m < 60 ? h * 60 + m : null
}

export function horasIncompletas({ eventos, franjaDe, nowMs = Date.now() }) {
  const dias = new Map()
  const grupo = fecha => {
    if (!dias.has(fecha)) dias.set(fecha, { fecha, trabajadoMin: 0, invalido: false, event: null })
    return dias.get(fecha)
  }
  let abierta = null
  for (const e of [...eventos].filter(e => !e.eliminada).sort((a, b) => a.ts.localeCompare(b.ts))) {
    if (!Number.isFinite(Date.parse(e.ts))) continue
    if (e.type === 'in') {
      if (abierta) grupo(diaDe(abierta.ts)).invalido = true
      abierta = e
      grupo(diaDe(e.ts))
    } else if (e.type === 'out') {
      if (!abierta) { grupo(diaDe(e.ts)).invalido = true; continue }
      const fecha = diaDe(abierta.ts)
      const g = grupo(fecha)
      const f = franjaDe(fecha)
      const inicio = minutosHora(f?.entrada), fin = minutosHora(f?.salida)
      const fechaSalida = diaDe(e.ts)
      const siguiente = new Date(Date.parse(fecha + 'T12:00:00Z') + 86400000).toISOString().slice(0, 10)
      const cruza = inicio != null && fin != null && fin <= inicio
      if (fechaSalida !== fecha && !(cruza && fechaSalida === siguiente)) {
        g.invalido = true
        grupo(fechaSalida).invalido = true
      }
      const duracion = (Date.parse(e.ts) - Date.parse(abierta.ts)) / 60000
      if (duracion <= 0 || Date.parse(e.ts) > nowMs) g.invalido = true
      else g.trabajadoMin += duracion
      g.event = e
      abierta = null
    }
  }
  if (abierta) grupo(diaDe(abierta.ts)).invalido = true

  const casos = []
  for (const g of dias.values()) {
    if (g.invalido || !g.event) continue
    const f = franjaDe(g.fecha)
    const inicio = minutosHora(f?.entrada), fin = minutosHora(f?.salida)
    if (inicio == null || fin == null) continue
    const finReal = fin + (fin <= inicio ? 1440 : 0)
    const previstoMin = finReal - inicio - descansoDelHorario(f)
    const base = Date.parse(g.fecha + 'T00:00:00-05:00')
    // Un día normal se evalúa al terminar el día; uno nocturno, al terminar
    // su horario del día siguiente.
    const cierre = base + Math.max(1440, finReal) * 60000
    if (nowMs < cierre || previstoMin <= 0) continue
    const faltanteMin = previstoMin - g.trabajadoMin
    if (faltanteMin > 1e-6) casos.push({ ...g, previstoMin, faltanteMin })
  }
  return casos
}

/** Duración legible sin redondear un faltante de segundos a cero minutos. */
export function duracionHoras(minutos) {
  const total = Math.max(0, Math.round(minutos * 60))
  const h = Math.floor(total / 3600), m = Math.floor(total % 3600 / 60), s = total % 60
  return [h ? h + ' h' : '', m ? m + ' min' : '', s ? s + ' s' : ''].filter(Boolean).join(' ') || '0 min'
}

export const textoHorasIncompletas = a =>
  'Trabajó ' + duracionHoras(a.trabajadoMin) + ' de ' + duracionHoras(a.previstoMin) + ' (faltan ' + duracionHoras(a.faltanteMin) + ')'
