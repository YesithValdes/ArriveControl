'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { hoyBogota, rangoJornada, moverPeriodo } from '../lib/detalleJornada.js';

const colores = { ordinaria: '#2b70b5', diurna: '#2cbe96', nocturna: '#7058da', domingo: '#e9a536', almuerzo: 'repeating-linear-gradient(135deg,#dce4f0 0 3px,#edf1f8 3px 6px)' };
const nombres = { ordinaria: 'Ordinaria', diurna: 'Extra diurna', nocturna: 'Extra nocturna', domingo: 'Dominical', almuerzo: 'Almuerzo' };
const h = n => Number(n).toLocaleString('es-CO', { maximumFractionDigits: 1 }) + ' h';
const fecha = iso => new Date(iso + 'T12:00:00Z').toLocaleDateString('es-CO', { day: 'numeric', month: 'long', timeZone: 'UTC' });
const hora = min => {
  if (min == null) return '—';
  const n = Math.round(min), m = ((n % 1440) + 1440) % 1440;
  return String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0') + (n >= 1440 ? ' +1' : '');
};
function Barra({ valor, limite, label }) {
  if (limite == null) return <p className="dj-meter-label">{label}: {h(valor)} · Tope semanal sin configurar</p>;
  const porcentaje = limite > 0 ? Math.min(100, valor / limite * 100) : valor > 0 ? 100 : 0;
  return <><div className="dj-meter" role="meter" aria-label={label} aria-valuemin={0} aria-valuemax={limite || 1} aria-valuenow={Math.min(valor, limite || 1)} aria-valuetext={`${h(valor)} de ${h(limite)}`}><span style={{ width: porcentaje + '%' }} /></div><p className="dj-meter-label">{label}: {h(valor)} de {h(limite)} permitidas por semana{valor > limite ? ' · Tope superado' : ''}</p></>;
}
export default function DetalleJornada({ persona, revision, onVolver }) {
  const dialog = useRef(null), cerrarRef = useRef(onVolver);
  cerrarRef.current = onVolver;
  useEffect(() => {
    const previo = document.activeElement;
    dialog.current?.focus();
    const teclado = e => {
      if (e.key === 'Escape') { e.preventDefault(); cerrarRef.current(); }
      if (e.key !== 'Tab') return;
      const elementos = [...dialog.current.querySelectorAll('button,select,[tabindex="0"]')].filter(n => !n.disabled && n.offsetParent !== null);
      const primero = elementos[0], ultimo = elementos.at(-1);
      if (!primero) { e.preventDefault(); return; }
      if (e.shiftKey && (document.activeElement === primero || document.activeElement === dialog.current)) { e.preventDefault(); ultimo.focus(); }
      else if (!e.shiftKey && (document.activeElement === ultimo || document.activeElement === dialog.current)) { e.preventDefault(); primero.focus(); }
    };
    document.addEventListener('keydown', teclado);
    return () => { document.removeEventListener('keydown', teclado); previo?.focus(); };
  }, []);
  const [periodo, setPeriodo] = useState({ fecha: hoyBogota(), modo: 'semana' });
  const [datos, setDatos] = useState(null), [cargando, setCargando] = useState(true), [error, setError] = useState('');
  const [seleccion, setSeleccion] = useState(''), [foto, setFoto] = useState(null), [fallidas, setFallidas] = useState({});
  const rango = useMemo(() => rangoJornada(periodo.fecha, periodo.modo), [periodo]);
  const consultaPrevia = useRef('');
  useEffect(() => {
    const abort = new AbortController();
    // Los refrescos automáticos (solo cambia revision) recargan en silencio.
    const consulta = persona.id + '|' + rango.desde + '|' + rango.hasta;
    if (consulta !== consultaPrevia.current) { consultaPrevia.current = consulta; setCargando(true); setFoto(null); }
    setError('');
    fetch('/api/empleados/' + encodeURIComponent(persona.id) + '/jornada?' + new URLSearchParams(rango), { signal: abort.signal, cache: 'no-store' })
      .then(async r => { const d = await r.json(); if (!r.ok || !d.ok) throw new Error(d.error || 'No se pudo cargar la jornada'); return d; })
      .then(d => { if (!abort.signal.aborted) { setDatos(d); setSeleccion(anterior => d.semanas.some(s => s.lunes === anterior) ? anterior : d.semanas[0]?.lunes || ''); } })
      .catch(e => { if (!abort.signal.aborted) { setError(e.message); setDatos(null); } })
      .finally(() => { if (!abort.signal.aborted) setCargando(false); });
    return () => abort.abort();
  }, [persona.id, rango.desde, rango.hasta, revision]);
  const semana = datos?.semanas.find(s => s.lunes === seleccion) ?? datos?.semanas[0];
  const segmentos = semana?.dias.flatMap(d => d.segmentos) || [];
  const inicio = Math.min(360, ...segmentos.map(s => Math.floor(s.desde / 120) * 120));
  const fin = Math.max(1320, ...segmentos.map(s => Math.ceil(s.hasta / 120) * 120));
  const pos = min => (min - inicio) / (fin - inicio) * 100;
  const ticks = Array.from({ length: Math.floor((fin - inicio) / 120) + 1 }, (_, i) => inicio + i * 120);
  const mostrarFoto = (d, e) => {
    const rect = e.currentTarget.getBoundingClientRect();
    setFoto({ dia: d, style: { left: Math.max(12, Math.min(rect.right - 400, window.innerWidth - 412)), top: Math.max(12, Math.min(rect.bottom + 6, window.innerHeight - 185)) } });
  };
  const navegar = paso => { setPeriodo(p => moverPeriodo(p.fecha, p.modo, paso)); setSeleccion(''); };
  return <section className="dialog dj-view" role="dialog" aria-modal="true" aria-labelledby="dj-title" tabIndex={-1} ref={dialog}>
    <style>{CSS}</style>
    <header className="dj-header">
      <div><h2 id="dj-title">Detalle de jornada · {datos?.nombre || persona.name}</h2><nav aria-label="Ruta de navegación"><span>Horas extra › Detalle del colaborador{semana ? ` · semana del ${fecha(semana.lunes)} al ${fecha(semana.domingo)}` : ''}</span></nav></div>
      <div className="dj-controls"><button onClick={() => navegar(-1)}>‹ Anterior</button>{[['semana','Semana'], ['a','1–15'], ['b','16–31'], ['mes','Mes']].map(([modo, texto]) => <button key={modo} aria-pressed={periodo.modo === modo} onClick={() => { setPeriodo(p => ({ ...p, modo })); setSeleccion(''); }}>{texto}</button>)}<button onClick={() => navegar(1)}>Siguiente ›</button>{semana?.enCurso && <span className="dj-current">Semana en curso</span>}</div>
    </header>
    <div className="dj-subnav"><button className="btn small" onClick={onVolver}>Cerrar</button>{datos?.semanas.length > 1 && <label>Semana seleccionada <select className="sede-select" value={seleccion} onChange={e => { setSeleccion(e.target.value); setFoto(null); }}>{datos.semanas.map(s => <option key={s.lunes} value={s.lunes}>{fecha(s.lunes)} – {fecha(s.domingo)}</option>)}</select></label>}{periodo.modo !== 'semana' && <small>Período: {fecha(rango.desde)} – {fecha(rango.hasta)} · Los totales corresponden a la semana seleccionada.</small>}</div>
    {error && <p role="alert">{error}</p>}{cargando && <p role="status" className="dj-muted">Cargando jornada…</p>}
    {semana && !error && <div className="dj-layout" aria-busy={cargando} style={{ opacity: cargando ? .55 : 1 }}>
      <article className="dj-chart-card">
        <div className="dj-chart-title"><h3>Jornada de la semana</h3><span>Pasa el mouse sobre un día para ver la foto de la marcación</span></div>
        <div className="dj-chart-scroll"><div className="dj-chart">
          <div className="dj-axis"><span /><div>{ticks.map(min => <span key={min} style={{ left: pos(min) + '%' }}>{hora(min)}</span>)}</div><span>Entrada – salida</span><span>Total</span></div>
          {semana.dias.map(d => <div className="dj-row" key={d.fecha} tabIndex={0} onMouseEnter={e => mostrarFoto(d, e)} onMouseLeave={() => setFoto(null)} onFocus={e => mostrarFoto(d, e)} onBlur={() => setFoto(null)} onKeyDown={e => { if (e.key === 'Escape') setFoto(null); }} aria-describedby={foto?.dia.fecha === d.fecha ? 'dj-photo-tooltip' : undefined}>
            <b className="dj-day">{new Date(d.fecha + 'T12:00:00Z').toLocaleDateString('es-CO', { weekday: 'long', timeZone: 'UTC' })}</b>
            <div className="dj-track">
              {d.segmentos.map((s, i) => <span key={i} className="dj-segment" style={{ left: pos(s.desde) + '%', width: (s.hasta - s.desde) / (fin - inicio) * 100 + '%', background: colores[s.tipo] }} title={`${nombres[s.tipo]} · ${hora(s.desde)}–${hora(s.hasta)}`} />)}
              {[datos.nocturno.inicio, datos.nocturno.inicio + 1440].filter(min => min >= inicio && min <= fin).map(min => <i key={min} className="dj-night" style={{ left: pos(min) + '%' }} />)}
            </div>
            <span className="dj-entry">{d.entrada == null ? 'Descanso' : `${hora(d.entrada)}–${d.abierta ? 'En curso' : hora(d.salida)}`}{d.automatico ? ' *' : ''}</span><b className="dj-total">{d.horas > 0 ? h(d.horas) : '—'}</b>
          </div>)}
        </div></div>
        <div className="dj-legend">{Object.entries(nombres).map(([tipo, texto]) => <span key={tipo}><i style={{ background: colores[tipo] }} />{texto}</span>)}<span><i className="dj-night-key" />Inicio del horario nocturno ({hora(datos.nocturno.inicio)})</span></div>
        {semana.dias.some(d => d.automatico) && <p className="dj-note">* Salida calculada según el horario asignado.</p>}
        {semana.enCurso && datos.modoExtra === 'semana' && <p className="dj-note">Las extras de lunes a sábado se definen al cerrar el domingo.</p>}
        {segmentos.some(s => s.tipo === 'almuerzo') && <p className="dj-note">Almuerzo: pausa registrada entre salida y regreso. No se suma al tiempo trabajado.</p>}
      </article>
      <aside className="dj-sidebar">
        <article className="dj-summary"><span>Total trabajado en la semana</span><strong>{h(semana.trabajado)}</strong><Barra valor={semana.extras} limite={semana.limiteExtras} label="Extras" /></article>
        <div className="dj-metrics"><article><strong>{h(semana.ordinarias)}</strong><span>ordinarias</span><div className="dj-meter" role="meter" aria-label="Ordinarias contra el límite semanal" aria-valuemin={0} aria-valuemax={semana.limiteOrdinarias} aria-valuenow={Math.min(semana.ordinarias, semana.limiteOrdinarias)} aria-valuetext={`${h(semana.ordinarias)} de ${h(semana.limiteOrdinarias)}`} title={`Límite semanal: ${h(semana.limiteOrdinarias)}`}><span style={{ width: Math.min(100, semana.ordinarias / semana.limiteOrdinarias * 100) + '%' }} /></div></article><article><strong>{h(semana.diurnas)}</strong><span>extra diurnas</span></article><article><strong>{h(semana.nocturnas)}</strong><span>extra nocturnas</span></article><article><strong>{h(semana.dominicales)}</strong><span>en domingo / festivo</span></article></div>
      </aside>
    </div>}
    {foto && createPortal(<div id="dj-photo-tooltip" className="dj-photo-tooltip" role="tooltip" style={foto.style}><b>{fecha(foto.dia.fecha)}</b>{!datos.verFotos ? <span>Sin permiso para ver fotos</span> : !foto.dia.fotos.length ? <span>Sin foto de marcación</span> : <div className="dj-photo-list">{foto.dia.fotos.map(f => <figure key={f.id}>{fallidas[f.id] ? <span>Foto no disponible</span> : <img src={'/api/marcaciones/' + encodeURIComponent(f.id) + '/foto'} alt={`${f.tipo} de ${datos.nombre} a las ${hora(f.minutos)}`} onError={() => setFallidas(p => ({ ...p, [f.id]: true }))} />}<figcaption>{f.tipo} · {hora(f.minutos)}</figcaption></figure>)}</div>}</div>, document.body)}
  </section>;
}
const CSS = `
.dialog.dj-view { overflow: auto; padding: 18px; color: var(--ink); width: 100%; max-width: 1040px; max-height: 80vh; }
.dj-header { display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 18px; margin-bottom: 12px; }
.dj-header h2 { margin: 0 0 6px; font-size: 20px; letter-spacing: -.5px; }
.dj-header nav { display: flex; align-items: center; flex-wrap: wrap; gap: 3px; font-size: 12px; color: var(--muted); }
.dj-header nav button { border: 0; background: transparent; padding: 0; font: inherit; color: inherit; cursor: pointer; }
.dj-controls { display: flex; align-items: center; gap: 7px; flex-wrap: wrap; }
.dj-controls button { min-height: 36px; border: 1px solid var(--border); background: var(--surface); color: var(--ink); padding: 0 10px; border-radius: 9px; font: inherit; font-size: 12px; cursor: pointer; }
.dj-controls button[aria-pressed=true] { background: #17243f; color: white; font-weight: 700; }
.dj-current { background: #fff4d6; color: #956000; border-radius: 20px; padding: 7px 12px; font-size: 11px; font-weight: 600; }
.dj-subnav { display: flex; flex-wrap: wrap; align-items: center; gap: 12px; margin-bottom: 16px; }
.dj-subnav label { display: flex; gap: 8px; align-items: center; font-size: 12px; }
.dj-subnav .sede-select { width: auto; }
.dj-subnav small, .dj-muted { color: var(--muted); }
.dj-layout { display: grid; grid-template-columns: minmax(0, 1fr) 260px; gap: 14px; align-items: start; }
.dj-chart-card { background: var(--surface); border: 1px solid var(--border); border-radius: 16px; padding: 16px; box-shadow: 0 3px 12px #17243f06; }
.dj-chart-title { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 8px; margin-bottom: 18px; }
.dj-chart-title h3 { margin: 0; font-size: 15px; }
.dj-chart-title > span { font-size: 11px; color: var(--muted); }
.dj-chart-scroll { overflow-x: auto; }
.dj-chart { min-width: 540px; padding-top: 4px; }
.dj-row, .dj-axis { display: grid; grid-template-columns: 65px minmax(230px, 1fr) 105px 40px; gap: 8px; align-items: center; }
.dj-axis { color: var(--muted); font-size: 10px; margin-bottom: 12px; }
.dj-axis > div { position: relative; height: 17px; }
.dj-axis > div > span { position: absolute; transform: translateX(-50%); white-space: nowrap; }
.dj-row { min-height: 36px; outline-offset: -2px; }
.dj-day { text-transform: capitalize; font-size: 12px; }
.dj-track { height: 27px; border-radius: 8px; background: #eaf0f8; position: relative; overflow: hidden; }
.dj-segment { position: absolute; height: 100%; }
.dj-night { position: absolute; height: 100%; border-left: 2px dashed #8b99b5; z-index: 1; }
.dj-entry { color: var(--muted); font-size: 11px; text-align: right; font-variant-numeric: tabular-nums; }
.dj-total { text-align: right; font-size: 12px; white-space: nowrap; }
.dj-legend { display: flex; flex-wrap: wrap; gap: 14px; font-size: 11px; margin-top: 22px; }
.dj-legend > span { display: inline-flex; align-items: center; gap: 6px; }
.dj-legend i { width: 12px; height: 12px; border-radius: 4px; }
.dj-legend .dj-night-key { width: 2px; border-left: 2px dashed #8b99b5; border-radius: 0; }
.dj-note { font-size: 11px; color: var(--muted); margin: 12px 0 0; }
.dj-summary { border-radius: 16px; background: #17243f; color: white; padding: 16px; }
.dj-summary > span { font-size: 12px; opacity: .8; }
.dj-summary > strong { display: block; font-size: 29px; margin: 3px 0 10px; font-family: var(--f-data); }
.dj-meter { height: 8px; border-radius: 20px; background: #eaf0f8; overflow: hidden; }
.dj-meter > span { display: block; height: 100%; background: #2b70b5; }
.dj-summary .dj-meter { background: #ffffff33; }
.dj-summary .dj-meter > span { background: #2cbe96; }
.dj-meter-label { font-size: 11px; margin: 8px 0 0; opacity: .8; }
.dj-metrics { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-top: 12px; }
.dj-metrics article { background: var(--surface); border: 1px solid var(--border); border-radius: 12px; padding: 12px; min-height: 85px; }
.dj-metrics strong { display: block; font-size: 23px; font-family: var(--f-data); }
.dj-metrics article > span { display: block; font-size: 12px; color: var(--muted); margin: 4px 0 12px; }
.dj-photo-tooltip { position: fixed; z-index: 1000; display: flex; flex-direction: column; gap: 8px; padding: 12px; max-width: min(400px, calc(100vw - 24px)); border: 1px solid var(--border); border-radius: 12px; background: var(--surface); color: var(--ink); box-shadow: 0 8px 28px #17243f33; font-size: 11px; pointer-events: none; }
.dj-photo-list { display: flex; gap: 8px; overflow: hidden; }
.dj-photo-list figure { margin: 0; }
.dj-photo-list img { width: 100px; height: 100px; object-fit: cover; border-radius: 6px; }
@media(max-width: 900px) { .dj-layout { grid-template-columns: minmax(0, 1fr); } .dj-sidebar { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; } .dj-metrics { margin-top: 0; } }
@media(max-width: 650px) { .dj-sidebar { display: block; } .dj-metrics { margin-top: 12px; } .dj-chart-card { padding: 16px; } .dj-header h2 { font-size: 19px; } }
`;
