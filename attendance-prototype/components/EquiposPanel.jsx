'use client';
// Áreas de trabajo (Marketing, Ventas, Soporte…). Internamente siguen siendo
// «equipos» (tablas, permisos y API); en pantalla todo dice «área».
import { Fragment, useEffect, useRef, useState } from 'react';
import { COLORES_AREA } from '../lib/equipos.js';

const iniciales = nombre => String(nombre || '').trim().split(/\s+/).slice(0, 2).map(p => p[0] || '').join('').toUpperCase();
const minus = t => String(t || '').toLocaleLowerCase('es');
const sedesDe = area => [...new Set(area.miembros.map(m => m.sede).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'es'));
const cuerpo = (area, cambios = {}) => ({
  nombre: area.nombre, descripcion: area.descripcion, responsable_id: area.responsable_id, activa: area.activa, color: area.color,
  miembros: area.miembros.map(m => m.id), ...cambios,
});

const ICONOS = {
  editar: <path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />,
  eliminar: <path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6M10 11v6M14 11v6" />,
};
const Ico = ({ n }) => <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{ICONOS[n]}</svg>;

/** Diálogo modal con foco atrapado y Escape para cerrar. */
function Dialogo({ titulo, onCerrar, ocupado, children, ancho = 580 }) {
  const ref = useRef(null), ocupadoRef = useRef(ocupado);
  ocupadoRef.current = ocupado;
  useEffect(() => {
    const previo = document.activeElement;
    ref.current?.focus();
    const teclado = e => {
      if (e.key === 'Escape' && !ocupadoRef.current) onCerrar();
      if (e.key !== 'Tab') return;
      const elementos = [...ref.current.querySelectorAll('button,input,textarea,select')].filter(n => !n.disabled);
      const primero = elementos[0], ultimo = elementos.at(-1);
      if (e.shiftKey && (document.activeElement === primero || document.activeElement === ref.current)) { e.preventDefault(); ultimo?.focus(); }
      else if (!e.shiftKey && (document.activeElement === ultimo || document.activeElement === ref.current)) { e.preventDefault(); primero?.focus(); }
    };
    document.addEventListener('keydown', teclado);
    return () => { document.removeEventListener('keydown', teclado); previo?.focus(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return <div className="overlay" onClick={e => { if (e.target === e.currentTarget && !ocupado) onCerrar(); }}>
    <div className="dialog area-dialog" style={{ maxWidth: ancho }} ref={ref} tabIndex={-1} role="dialog" aria-modal="true" aria-label={titulo}>
      <h3>{titulo}</h3>{children}
    </div>
  </div>;
}

/** Lista con buscador y casillas para elegir colaboradores. */
function SelectorPersonas({ opciones, elegidos, onCambiar }) {
  const [buscar, setBuscar] = useState('');
  const visibles = opciones.filter(p => minus(p.nombre + ' ' + (p.sede || '')).includes(minus(buscar)));
  return <>
    <input type="search" aria-label="Buscar colaborador" placeholder="Buscar colaborador…" value={buscar} onChange={e => setBuscar(e.target.value)} />
    <div className="area-personas">
      {visibles.map(p => <label key={p.id} className="area-persona">
        <input type="checkbox" checked={elegidos.includes(p.id)} onChange={e => onCambiar(e.target.checked ? [...elegidos, p.id] : elegidos.filter(id => id !== p.id))} />
        <span>{p.nombre}{p.sede ? <small> · {p.sede}</small> : null}{p.activo === false ? ' · inactivo (quítalo para guardar)' : ''}</span>
      </label>)}
      {!visibles.length && <p className="hint">No hay colaboradores disponibles.</p>}
    </div>
  </>;
}

export default function EquiposPanel({ permisos, revision, avisar }) {
  const puede = accion => permisos.lista ? permisos.lista.includes('equipos:' + accion) : Boolean(permisos.config);
  const [datos, setDatos] = useState({ equipos: [], colaboradores: [], sedes: [] });
  const [cargando, setCargando] = useState(true), [error, setError] = useState(''), [recarga, setRecarga] = useState(0);
  const [busqueda, setBusqueda] = useState(''), [sede, setSede] = useState(''), [estado, setEstado] = useState('');
  const [abierta, setAbierta] = useState(null); // área con la fila de integrantes desplegada
  const [form, setForm] = useState(null), [agregar, setAgregar] = useState(null), [asignar, setAsignar] = useState(false);
  const [ocupado, setOcupado] = useState(false), [errorForm, setErrorForm] = useState('');

  useEffect(() => {
    const abort = new AbortController();
    setError(''); // sin «Cargando…» en los refrescos: solo la primera carga lo muestra
    fetch('/api/equipos', { signal: abort.signal, cache: 'no-store' })
      .then(async r => { const d = await r.json(); if (!r.ok || !d.ok) throw new Error(d.error || 'No se pudieron cargar las áreas.'); return d; })
      .then(d => { if (!abort.signal.aborted) setDatos({ sedes: [], ...d }); })
      .catch(e => { if (!abort.signal.aborted) setError(e.message); })
      .finally(() => { if (!abort.signal.aborted) setCargando(false); });
    return () => abort.abort();
  }, [revision, recarga]);

  /** Guarda un área (nueva si no trae id). Devuelve true si salió bien. */
  const enviar = async (id, payload, mensaje) => {
    setOcupado(true); setErrorForm('');
    try {
      const r = await fetch('/api/equipos' + (id ? '/' + encodeURIComponent(id) : ''), { method: id ? 'PATCH' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      const d = await r.json();
      if (!r.ok || !d.ok) throw new Error(d.error || 'No se pudo guardar.');
      setRecarga(n => n + 1); avisar(mensaje);
      return true;
    } catch (e) { setErrorForm(e.message); avisar(e.message); return false; }
    finally { setOcupado(false); }
  };

  const editar = area => {
    setErrorForm('');
    setForm(area
      ? { id: area.id, ...cuerpo(area), responsable_id: area.responsable_id || '' }
      : { nombre: '', descripcion: '', responsable_id: '', activa: true, color: COLORES_AREA[datos.equipos.length % COLORES_AREA.length], miembros: [] });
  };
  const guardar = async e => {
    e.preventDefault(); if (ocupado) return;
    const { id, ...payload } = form;
    if (await enviar(id, payload, id ? 'Área actualizada' : 'Área creada')) setForm(null);
  };
  const eliminar = async area => {
    if (ocupado || !window.confirm(`¿Eliminar el área «${area.nombre}»? Los colaboradores se conservarán.`)) return;
    setOcupado(true);
    try {
      const r = await fetch('/api/equipos/' + encodeURIComponent(area.id), { method: 'DELETE' });
      const d = await r.json(); if (!r.ok || !d.ok) throw new Error(d.error || 'No se pudo eliminar.');
      setRecarga(n => n + 1); avisar('Área eliminada');
    } catch (e) { avisar(e.message); }
    finally { setOcupado(false); }
  };
  const quitar = (area, persona) => {
    if (ocupado) return;
    enviar(area.id, cuerpo(area, { miembros: area.miembros.filter(m => m.id !== persona.id).map(m => m.id) }), `${persona.nombre} salió de ${area.nombre}`);
  };

  // Resumen
  const conArea = new Set(datos.equipos.flatMap(a => a.miembros.filter(m => m.activo !== false).map(m => m.id)));
  const sinArea = datos.colaboradores.filter(p => !conArea.has(p.id));
  const activas = datos.equipos.filter(a => a.activa !== false).length;

  // Filtros: el buscador mira el área y también a sus integrantes.
  const q = minus(busqueda.trim());
  const areas = datos.equipos.filter(a =>
    (!q || minus(a.nombre + ' ' + a.descripcion).includes(q) || a.miembros.some(m => minus(m.nombre).includes(q)))
    && (!sede || a.miembros.some(m => m.sede_id === sede))
    && (!estado || (estado === 'activas') === (a.activa !== false)));
  const filtrando = Boolean(q || sede || estado);

  const opcionesDe = area => {
    const lista = [...datos.colaboradores];
    for (const m of area?.miembros || []) if (!lista.some(p => p.id === m.id)) lista.push(m);
    return lista;
  };

  return <section className="card grow areas-panel">
    <style>{CSS}</style>
    <nav className="areas-migas" aria-label="Ruta">Sedes y equipos › Áreas</nav>
    <header className="areas-cabecera">
      <div>
        <h2>Áreas <span className="muted-count">{datos.equipos.length}</span></h2>
        <p className="hint">Agrupa a tus colaboradores por área de trabajo (Marketing, Ventas, Soporte…). Una persona puede estar en varias áreas, y su sede no cambia.</p>
      </div>
      {puede('crear') && <button className="btn primary" onClick={() => editar(null)}>+ Nueva área</button>}
    </header>

    <div className="areas-resumen">
      <div className="area-kpi"><b>{activas}</b><span>área{activas === 1 ? '' : 's'} activa{activas === 1 ? '' : 's'}</span></div>
      <div className="area-kpi"><b>{conArea.size}</b><span>colaboradores con área</span></div>
      <div className="area-kpi"><b>{sinArea.length}</b><span>colaboradores sin área{sinArea.length > 0 && puede('editar') && datos.equipos.length > 0 && <> · <button className="area-link" onClick={() => setAsignar(true)}>Asignar</button></>}</span></div>
    </div>

    <div className="areas-tabla card-plana">
      <div className="areas-filtros">
        <input type="search" placeholder="Buscar área o colaborador…" aria-label="Buscar área o colaborador" value={busqueda} onChange={e => setBusqueda(e.target.value)} />
        <select aria-label="Filtrar por sede" value={sede} onChange={e => setSede(e.target.value)}>
          <option value="">Todas las sedes</option>
          {datos.sedes.map(s => <option key={s.id} value={s.id}>{s.nombre}</option>)}
        </select>
        <select aria-label="Filtrar por estado" value={estado} onChange={e => setEstado(e.target.value)}>
          <option value="">Todas</option><option value="activas">Activas</option><option value="inactivas">Inactivas</option>
        </select>
      </div>
      {error && <p role="alert" className="areas-vacio">{error}</p>}
      {cargando && <p className="hint areas-vacio" role="status">Cargando áreas…</p>}
      {!cargando && !error && !areas.length && <p className="empty areas-vacio">{filtrando ? 'Ninguna área coincide con los filtros.' : 'Aún no hay áreas. Crea una y selecciona sus integrantes.'}</p>}
      {areas.length > 0 && <div className="areas-scroll"><table className="areas-table">
        <thead><tr><th>Área</th><th>Responsable</th><th>Sedes</th><th>Integrantes</th><th>Estado</th><th>Acciones</th></tr></thead>
        <tbody>{areas.map(a => {
          const desplegada = abierta === a.id, sedes = sedesDe(a);
          return <Fragment key={a.id}>
            <tr className={desplegada ? 'abierta' : ''}>
              <td><div className="area-nombre"><span className="area-punto" style={{ background: a.color }} aria-hidden="true" /><b>{a.nombre}</b></div>{a.descripcion && <div className="area-desc">{a.descripcion}</div>}</td>
              <td className={a.responsable_nombre ? '' : 'area-tenue'}>{a.responsable_nombre || 'Sin responsable'}</td>
              <td><div className="area-chips">{sedes.length ? sedes.map(s => <span key={s} className="area-chip">{s}</span>) : <span className="area-tenue">—</span>}</div></td>
              <td>
                <button className="area-integrantes" aria-expanded={desplegada} aria-label={`${a.miembros.length} integrantes de ${a.nombre}`} onClick={() => setAbierta(desplegada ? null : a.id)}>
                  <span className="area-avatares">{a.miembros.slice(0, 3).map(m => <span key={m.id} className="area-avatar" title={m.nombre}>{iniciales(m.nombre)}</span>)}{a.miembros.length > 3 && <span className="area-avatar">+{a.miembros.length - 3}</span>}</span>
                  <span>{a.miembros.length}</span>{desplegada && <span aria-hidden="true">▾</span>}
                </button>
              </td>
              <td><span className={`area-estado${a.activa !== false ? ' activa' : ''}`}>{a.activa !== false ? 'Activa' : 'Inactiva'}</span></td>
              <td><span className="area-acciones">
                {puede('editar') && <button className="btn-ico-area" title="Editar área" aria-label={`Editar área ${a.nombre}`} disabled={ocupado} onClick={() => editar(a)}><Ico n="editar" /></button>}
                {puede('eliminar') && <button className="btn-ico-area" title="Eliminar área" aria-label={`Eliminar área ${a.nombre}`} disabled={ocupado} onClick={() => eliminar(a)}><Ico n="eliminar" /></button>}
              </span></td>
            </tr>
            {desplegada && <tr className="area-detalle"><td colSpan={6}>
              <h4>Integrantes de {a.nombre}</h4>
              <div className="area-chips">
                {a.miembros.map(m => <span key={m.id} className="area-chip persona">{m.nombre}{m.sede ? ` · ${m.sede}` : ''}{m.activo === false ? ' · inactivo' : ''}
                  {puede('editar') && <button aria-label={`Quitar a ${m.nombre} de ${a.nombre}`} title="Quitar del área" disabled={ocupado} onClick={() => quitar(a, m)}>×</button>}
                </span>)}
                {!a.miembros.length && <span className="area-tenue">Sin integrantes.</span>}
                {puede('editar') && <button className="btn small" disabled={ocupado} onClick={() => { setErrorForm(''); setAgregar({ area: a, miembros: a.miembros.map(m => m.id) }); }}>+ Agregar integrantes</button>}
              </div>
            </td></tr>}
          </Fragment>;
        })}</tbody>
      </table></div>}
    </div>

    {form && <Dialogo titulo={form.id ? 'Editar área' : 'Nueva área'} ocupado={ocupado} onCerrar={() => setForm(null)}>
      <form onSubmit={guardar}><fieldset disabled={ocupado}>
        <label>Nombre<input required maxLength={100} value={form.nombre} onChange={e => setForm(f => ({ ...f, nombre: e.target.value }))} /></label>
        <label>Descripción <small>opcional</small><textarea maxLength={500} rows={2} value={form.descripcion} onChange={e => setForm(f => ({ ...f, descripcion: e.target.value }))} /></label>
        <div className="area-fila">
          <label>Responsable <small>opcional</small><select value={form.responsable_id} onChange={e => setForm(f => ({ ...f, responsable_id: e.target.value }))}>
            <option value="">Sin responsable</option>
            {opcionesDe(datos.equipos.find(a => a.id === form.id)).filter(p => p.activo !== false || p.id === form.responsable_id).map(p => <option key={p.id} value={p.id}>{p.nombre}</option>)}
          </select></label>
          <label>Estado<select value={form.activa ? 'activa' : 'inactiva'} onChange={e => setForm(f => ({ ...f, activa: e.target.value === 'activa' }))}>
            <option value="activa">Activa</option><option value="inactiva">Inactiva</option>
          </select></label>
        </div>
        <div className="area-colores" role="radiogroup" aria-label="Color del área">
          <span>Color</span>
          {COLORES_AREA.map(c => <button type="button" key={c} role="radio" aria-checked={form.color === c} aria-label={`Color ${c}`} className={form.color === c ? 'elegido' : ''} style={{ background: c }} onClick={() => setForm(f => ({ ...f, color: c }))} />)}
        </div>
        <h4>Integrantes · {form.miembros.length}</h4>
        <SelectorPersonas opciones={opcionesDe(datos.equipos.find(a => a.id === form.id))} elegidos={form.miembros} onCambiar={miembros => setForm(f => ({ ...f, miembros }))} />
        {errorForm && <p role="alert">{errorForm}</p>}
        <div className="dialog-actions"><button type="button" className="btn" onClick={() => setForm(null)}>Cancelar</button><button className="btn primary" type="submit" disabled={!form.nombre.trim()}>{ocupado ? 'Guardando…' : 'Guardar'}</button></div>
      </fieldset></form>
    </Dialogo>}

    {agregar && <Dialogo titulo={`Integrantes de ${agregar.area.nombre}`} ocupado={ocupado} onCerrar={() => setAgregar(null)}>
      <SelectorPersonas opciones={opcionesDe(agregar.area)} elegidos={agregar.miembros} onCambiar={miembros => setAgregar(s => ({ ...s, miembros }))} />
      {errorForm && <p role="alert">{errorForm}</p>}
      <div className="dialog-actions"><button type="button" className="btn" disabled={ocupado} onClick={() => setAgregar(null)}>Cancelar</button>
        <button className="btn primary" disabled={ocupado} onClick={async () => { if (await enviar(agregar.area.id, cuerpo(agregar.area, { miembros: agregar.miembros }), 'Integrantes actualizados')) setAgregar(null); }}>{ocupado ? 'Guardando…' : `Guardar · ${agregar.miembros.length}`}</button></div>
    </Dialogo>}

    {asignar && <Dialogo titulo="Colaboradores sin área" ocupado={ocupado} onCerrar={() => setAsignar(false)} ancho={520}>
      <p className="hint">Elige el área de cada persona. Su sede no cambia.</p>
      <div className="area-personas">
        {sinArea.map(p => <div key={p.id} className="area-persona asignar">
          <span>{p.nombre}{p.sede ? <small> · {p.sede}</small> : null}</span>
          <select aria-label={`Área para ${p.nombre}`} disabled={ocupado} value="" onChange={e => {
            const area = datos.equipos.find(a => a.id === e.target.value);
            if (area) enviar(area.id, cuerpo(area, { miembros: [...area.miembros.map(m => m.id), p.id] }), `${p.nombre} ahora está en ${area.nombre}`);
          }}>
            <option value="">Asignar a…</option>
            {datos.equipos.map(a => <option key={a.id} value={a.id}>{a.nombre}{a.activa === false ? ' (inactiva)' : ''}</option>)}
          </select>
        </div>)}
        {!sinArea.length && <p className="hint">Todos los colaboradores tienen área.</p>}
      </div>
      <div className="dialog-actions"><button type="button" className="btn" disabled={ocupado} onClick={() => setAsignar(false)}>Cerrar</button></div>
    </Dialogo>}
  </section>;
}

const CSS = `
.areas-panel { display: flex; flex-direction: column; gap: 16px; }
/* En el celular crece con el contenido y hace scroll la página, como el resto
   del panel: un scroll interno aquí atrapaba el dedo. */
/* En PC la tarjeta vive en un contenedor de alto fijo y el scroll es suyo; el
   segundo selector le gana a «.screen > .card.grow { overflow: hidden }». */
@media (min-width: 900px) {
  .areas-panel, .screen > .card.grow.areas-panel { overflow-y: auto; overscroll-behavior: contain; }
}
.areas-panel > * { flex: none; }
.areas-migas { font-size: 12px; color: var(--muted); }
.areas-cabecera { display: flex; justify-content: space-between; align-items: flex-start; gap: 16px; flex-wrap: wrap; }
.areas-cabecera h2 { margin: 0 0 4px; }
.areas-cabecera .hint { margin: 0; max-width: 520px; }
.areas-resumen { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 12px; }
.area-kpi { background: var(--surface-blanca, var(--surface)); border: 1px solid var(--border); border-radius: 14px; padding: 16px 18px; box-shadow: var(--elev-1); display: flex; flex-direction: column; gap: 4px; }
.area-kpi b { font-size: 26px; line-height: 1.1; color: var(--ink); }
.area-kpi span { font-size: 13px; color: var(--ink-2); }
.area-link { background: none; border: 0; padding: 0; color: var(--accent); font: inherit; font-weight: 600; text-decoration: underline; cursor: pointer; }
.card-plana { background: var(--surface-blanca, var(--surface)); border: 1px solid var(--border); border-radius: 14px; box-shadow: var(--elev-1); overflow: hidden; }
.areas-filtros { display: flex; gap: 10px; padding: 14px; flex-wrap: wrap; }
.areas-filtros input { flex: 1 1 240px; min-width: 0; }
.areas-filtros input, .areas-filtros select { padding: 9px 12px; border: 1px solid var(--border); border-radius: 8px; background: var(--surface-blanca, var(--surface)); color: var(--ink); font: inherit; }
.areas-vacio { padding: 0 16px 16px; }
.areas-scroll { overflow-x: auto; }
.areas-table { width: 100%; border-collapse: collapse; font-size: 13px; min-width: 760px; }
.areas-table th { text-align: left; font-size: 11px; letter-spacing: .04em; text-transform: uppercase; color: var(--ink-2); padding: 10px 16px; border-top: 1px solid var(--grid); border-bottom: 1px solid var(--grid); }
.areas-table td { padding: 12px 16px; border-bottom: 1px solid var(--grid); vertical-align: middle; color: var(--ink); }
.areas-table tbody tr:last-child td { border-bottom: 0; }
.area-nombre { display: flex; align-items: center; gap: 8px; font-size: 14px; }
.area-punto { width: 8px; height: 8px; border-radius: 50%; flex: none; }
.area-desc { color: var(--ink-2); font-size: 12px; margin: 2px 0 0 16px; }
.area-tenue { color: var(--muted); }
.area-chips { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
.area-chip { display: inline-flex; align-items: center; gap: 4px; background: var(--accent-soft); color: var(--ink); border-radius: 999px; padding: 3px 10px; font-size: 12px; font-weight: 600; }
.area-chip.persona button { border: 0; background: none; color: var(--ink-2); cursor: pointer; font-size: 14px; line-height: 1; padding: 0 0 0 2px; }
.area-integrantes { display: inline-flex; align-items: center; gap: 8px; background: none; border: 0; padding: 0; cursor: pointer; color: var(--ink); font: inherit; }
.area-avatares { display: inline-flex; }
.area-avatar { width: 26px; height: 26px; border-radius: 50%; background: var(--accent-soft); border: 2px solid var(--surface-blanca, var(--surface)); display: inline-grid; place-items: center; font-size: 10px; font-weight: 700; color: var(--ink); margin-left: -6px; }
.area-avatar:first-child { margin-left: 0; }
.area-estado { display: inline-block; padding: 3px 10px; border-radius: 999px; font-size: 12px; font-weight: 600; background: var(--grid); color: var(--ink-2); }
.area-estado.activa { background: var(--good-soft); color: var(--good-text); }
.area-acciones { display: inline-flex; gap: 6px; }
.btn-ico-area { width: 34px; height: 34px; display: inline-grid; place-items: center; border: 1px solid var(--border); border-radius: 9px; background: var(--surface-blanca, var(--surface)); color: var(--ink-2); cursor: pointer; }
.btn-ico-area:hover:not(:disabled) { background: var(--accent-soft); color: var(--ink); }
.btn-ico-area:disabled { opacity: .5; cursor: default; }
.area-detalle td { background: var(--surface); }
.area-detalle h4 { margin: 0 0 8px; font-size: 12px; color: var(--ink-2); }
.area-dialog.dialog { max-height: 85vh; overflow: auto; width: 100%; }
.area-dialog fieldset { border: 0; padding: 0; margin: 0; min-width: 0; }
.area-dialog label { display: flex; flex-direction: column; gap: 5px; margin: 12px 0; font-size: 13px; flex: 1; }
.area-dialog input:not([type=checkbox]), .area-dialog textarea, .area-dialog select { width: 100%; box-sizing: border-box; padding: 9px 10px; border: 1px solid var(--border); border-radius: 8px; color: var(--ink); background: var(--surface); font: inherit; }
.area-fila { display: flex; gap: 12px; flex-wrap: wrap; }
.area-colores { display: flex; align-items: center; gap: 8px; font-size: 13px; margin: 4px 0 8px; flex-wrap: wrap; }
.area-colores button { width: 22px; height: 22px; border-radius: 50%; border: 2px solid transparent; cursor: pointer; padding: 0; }
.area-colores button.elegido { outline: 2px solid var(--ink); outline-offset: 2px; }
.area-dialog .area-persona { flex-direction: row; align-items: center; gap: 10px; padding: 8px; margin: 0; border-bottom: 1px solid var(--grid); cursor: pointer; }
.area-persona.asignar { display: flex; justify-content: space-between; cursor: default; }
.area-persona.asignar select { width: auto; max-width: 55%; }
.area-persona small { color: var(--muted); }
.area-personas { max-height: 280px; overflow: auto; margin: 10px 0 16px; border: 1px solid var(--border); border-radius: 8px; }
@media (max-width: 600px) { .areas-cabecera .btn { width: 100%; } }
`;
