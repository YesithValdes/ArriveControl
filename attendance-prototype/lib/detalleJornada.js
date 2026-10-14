import { emparejarMarcas, calcularRegistros } from './calculoHoras.js'
import { horasSemanaEn } from './jornada.js'
import { lunesDe, domingoDe, sumarDias } from './semanaLaboral.js'

export const hoyBogota = () => new Date(Date.now() - 5 * 3600000).toISOString().slice(0, 10)
export function rangoJornada(fecha, modo) {
  if (modo === 'semana') return { desde: lunesDe(fecha), hasta: domingoDe(fecha) }
  const mes = fecha.slice(0, 7), fin = new Date(mes + '-01T12:00:00Z')
  fin.setUTCMonth(fin.getUTCMonth() + 1, 0)
  return { desde: mes + (modo === 'b' ? '-16' : '-01'), hasta: modo === 'a' ? mes + '-15' : fin.toISOString().slice(0, 10) }
}
export function moverPeriodo(fecha, modo, paso) {
  if (modo === 'semana') return { fecha: sumarDias(fecha, paso * 7), modo }
  const mes = new Date(fecha.slice(0, 7) + '-01T12:00:00Z')
  if (modo === 'mes') mes.setUTCMonth(mes.getUTCMonth() + paso)
  else {
    if (modo === 'a' && paso < 0 || modo === 'b' && paso > 0) mes.setUTCMonth(mes.getUTCMonth() + paso)
    modo = modo === 'a' ? 'b' : 'a'
  }
  return { fecha: mes.toISOString().slice(0, 10), modo }
}

/** Comparte el motor de nómina: misma jornada, mínimos, franja y cierre semanal. */
export function calcularDetalleJornada(e, cfg, rango, hoy = hoyBogota(), verFotos = false) {
  const pares = emparejarMarcas(e, { festivos: cfg.festivos, hoy })
  const extras = calcularRegistros(new Map([[e.id, e]]), { ...cfg, hoy, extraMinima: cfg.extraMinimaH })
  const semanas = []
  for (let lunes = lunesDe(rango.desde); lunes <= rango.hasta; lunes = sumarDias(lunes, 7)) {
    const dias = Array.from({ length: 7 }, (_, i) => {
      const fecha = sumarDias(lunes, i), ps = pares.filter(p => p.fecha === fecha).sort((a, b) => a.desde - b.desde), segmentos = []
      for (const p of ps) {
        const ts = extras.filter(t => t.fecha === fecha).flatMap(t => {
          const [h, m] = t.horaInicio.split(':').map(Number)
          let desde = h * 60 + m
          while (desde + t.horas * 60 <= p.desde) desde += 1440
          const hasta = desde + t.horas * 60
          return desde < p.hasta && hasta > p.desde ? [{ desde: Math.max(desde, p.desde), hasta: Math.min(hasta, p.hasta), tipo: t.tipoHora }] : []
        })
        const cortes = [...new Set([p.desde, p.hasta, ...ts.flatMap(t => [t.desde, t.hasta])])].sort((a, b) => a - b)
        for (let j = 1; j < cortes.length; j++) {
          const desde = cortes[j - 1], hasta = cortes[j], t = ts.find(t => (desde + hasta) / 2 >= t.desde && (desde + hasta) / 2 < t.hasta)
          segmentos.push({ desde, hasta, tipo: p.dominical ? 'domingo' : t?.tipo === 'HEN' ? 'nocturna' : t?.tipo === 'HED' ? 'diurna' : 'ordinaria' })
        }
      }
      for (let j = 1; j < ps.length; j++) if (ps[j].desde > ps[j - 1].hasta) segmentos.push({ desde: ps[j - 1].hasta, hasta: ps[j].desde, tipo: 'almuerzo' })
      const marcas = e.marcas.filter(m => m.fecha === fecha)
      return { fecha, segmentos, horas: ps.reduce((n, p) => n + p.horas, 0), entrada: ps[0]?.desde ?? marcas.find(m => m.tipo === 'entrada')?.minutos ?? null, salida: ps.at(-1)?.hasta ?? null, abierta: marcas.at(-1)?.tipo === 'entrada', automatico: ps.some(p => p.automatico), fotos: verFotos ? marcas.filter(m => m.tieneFoto).map(m => ({ id: m.id, tipo: m.tipo, minutos: m.minutos })) : [] }
    })
    const suma = tipo => dias.flatMap(d => d.segmentos).filter(s => s.tipo === tipo).reduce((n, s) => n + (s.hasta - s.desde) / 60, 0)
    semanas.push({ lunes, domingo: domingoDe(lunes), enCurso: lunes <= hoy && domingoDe(lunes) >= hoy, dias, trabajado: dias.reduce((n, d) => n + d.horas, 0), ordinarias: suma('ordinaria'), diurnas: suma('diurna'), nocturnas: suma('nocturna'), dominicales: suma('domingo'), extras: extras.filter(t => t._semana === lunes).reduce((n, t) => n + t.horas, 0), limiteOrdinarias: horasSemanaEn(cfg.vigencias, lunes), limiteExtras: cfg.topeExtraSemanal ?? null })
  }
  return { nombre: e.nombre, semanas, nocturno: cfg.nocturno, modoExtra: cfg.modoExtra, verFotos }
}
