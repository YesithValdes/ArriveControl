'use client';
/**
 * components/EvaluacionSface.jsx — Pantalla de la evaluación de modelos
 * faciales (SFace y, si se elige, AuraFace).
 *
 * La maneja el SUPERADMIN, empresa por empresa (/plataforma/evaluacion/[id]):
 * decide si la empresa está habilitada, CUÁNDO y CON QUÉ modelos se evalúa.
 * Nada corre solo.
 *   · Inscripción: cada marcación confirmada en el kiosco web guarda vectores
 *     de cada modelo activo (hasta 3 por modelo). Basta con marcar 2 veces.
 *   · Medición: cada marcación se compara también con cada modelo activo.
 *   · Apagada: el kiosco no baja modelos ni vectores.
 * El modelo actual sigue decidiendo quién marca en todas las fases.
 */
import { useCallback, useEffect, useState } from 'react';
import { MODELOS, IDS_MODELOS, SFACE_MAX_POR_PERSONA, acepta } from '../utils/evaluacionSface.js';

const FASE_TXT = { apagada: 'Apagada', inscripcion: 'Inscripción', medicion: 'Medición' };
const pct = (n, total) => (total > 0 ? `${Math.round((n / total) * 100)} %` : '—');
const fecha = (iso) => (iso ? new Date(iso).toLocaleString('es-CO', { dateStyle: 'short', timeStyle: 'short' }) : '—');
// datetime-local en hora local, a N días desde ahora, a las 23:59.
const finDeDia = (dias) => {
  const d = new Date(Date.now() + dias * 86400000);
  const z = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}T23:59`;
};

export default function EvaluacionSface({ api, volver = '/plataforma' }) {
  const [d, setD] = useState(null);
  const [error, setError] = useState(null);
  const [ocupado, setOcupado] = useState(false);
  const [hasta, setHasta] = useState(finDeDia(0));

  const cargar = useCallback(async () => {
    const r = await fetch(api, { cache: 'no-store' });
    const j = await r.json().catch(() => null);
    if (!r.ok || !j?.ok) { setError(j?.error || `Error ${r.status}`); return; }
    setError(null);
    setD(j);
  }, []);
  useEffect(() => { cargar(); const id = setInterval(cargar, 30000); return () => clearInterval(id); }, [cargar]);

  const patch = async (cuerpo) => {
    setOcupado(true);
    const r = await fetch(api, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(cuerpo),
    });
    const j = await r.json().catch(() => null);
    setOcupado(false);
    if (!r.ok || !j?.ok) { alert(j?.error || 'No se pudo guardar el cambio.'); return false; }
    cargar();
    return true;
  };
  const cambiarFase = (estado) => patch({ estado, hasta: estado === 'apagada' ? null : new Date(hasta).toISOString() });

  const alternarModelo = (id, activos) => {
    const nuevos = activos.includes(id) ? activos.filter((m) => m !== id) : [...activos, id];
    if (nuevos.length === 0) { alert('Debe quedar al menos un modelo.'); return; }
    if (id === 'auraface' && !activos.includes(id) && !confirm(
      'AuraFace pesa 260 MB. Cada kiosco web lo descargará una vez (se guarda en el aparato) y es más lento por '
      + 'persona; en celulares de gama media o baja puede ir lento o cerrar el navegador.\n\n'
      + 'Recomendado: probarlo solo con un kiosco potente (PC o tablet buena).\n\n¿Activarlo?',
    )) return;
    patch({ modelos: IDS_MODELOS.filter((m) => nuevos.includes(m)) });
  };

  const borrar = async (empleadoId, nombre) => {
    const todo = !empleadoId;
    const msg = todo
      ? '¿Borrar TODAS las inscripciones y resultados de la evaluación? No se puede deshacer.'
      : `¿Borrar las inscripciones de ${nombre} en todos los modelos?`;
    if (!confirm(msg)) return;
    const q = todo ? 'todo=1' : `empleado_id=${encodeURIComponent(empleadoId)}`;
    const r = await fetch(`${api}?${q}`, { method: 'DELETE' });
    if (!r.ok) alert('No se pudo borrar.');
    cargar();
  };

  if (error) {
    return (
      <main className="ev"><style>{CSS}</style>
        <a href={volver} className="ev-volver">← Volver a la consola</a>
        <h1>Evaluación de modelos faciales</h1>
        <p className="ev-error">{error}</p>
      </main>
    );
  }
  if (!d) return <main className="ev"><style>{CSS}</style><p>Cargando…</p></main>;

  const { config, personas, reportes, empresa } = d;
  const fase = config.fase;
  const activos = config.modelos ?? ['sface'];
  const contar = (m, min) => personas.filter((p) => (p.vectores?.[m] ?? 0) >= min).length;
  // Para medir, cada modelo activo necesita al menos 2 personas inscritas.
  const puedeMedir = activos.every((m) => contar(m, 1) >= 2);

  return (
    <main className="ev">
      <style>{CSS}</style>
      <a href={volver} className="ev-volver">← Volver a la consola</a>
      <h1>Evaluación de modelos · {empresa.nombre}</h1>
      <section className={empresa.habilitada ? 'ev-card' : 'ev-card ev-off'}>
        <h2>{empresa.habilitada ? 'Habilitada para esta empresa' : 'No habilitada para esta empresa'}</h2>
        <p className="ev-nota">{empresa.habilitada
          ? 'Sus kioscos web consultan la evaluación cada 2 minutos. Si quitas el permiso, la evaluación se apaga.'
          : 'Mientras no esté habilitada, sus kioscos no descargan nada y no se inscribe ni se mide a nadie.'}</p>
        <button className={empresa.habilitada ? 'ev-btn ev-apagar' : 'ev-btn'} disabled={ocupado}
          onClick={() => patch({ habilitada: !empresa.habilitada })}>
          {empresa.habilitada ? 'Quitar el permiso' : 'Habilitar para esta empresa'}
        </button>
      </section>
      <p className="ev-nota">
        Los modelos se miden <b>en sombra</b> en el kiosco web: el modelo actual sigue decidiendo quién marca, y nada
        de esto toca los rostros ni las marcaciones. Los vectores son datos biométricos: inscribe solo a personas que
        lo hayan autorizado y bórralos al terminar.
      </p>

      <section className="ev-card">
        <h2>Modelos a evaluar</h2>
        {IDS_MODELOS.map((id) => {
          const m = MODELOS[id];
          return (
            <label key={id} className="ev-modelo">
              <input type="checkbox" checked={activos.includes(id)} disabled={ocupado} onChange={() => alternarModelo(id, activos)} />
              <span>
                <b>{m.nombre}</b> · {m.mb} MB · licencia {m.licencia}
                {id === 'auraface' && <small className="ev-aviso">Pesado: recomendado solo en un kiosco potente (PC o tablet buena).</small>}
              </span>
            </label>
          );
        })}
        <p className="ev-nota">Los kioscos se enteran del cambio en máximo 2 minutos.</p>
      </section>

      <section className="ev-card">
        <h2>Fase: <span className={`ev-fase ${fase}`}>{FASE_TXT[fase]}</span></h2>
        {fase !== 'apagada' && <p>Se apaga sola: {fecha(config.hasta)}. Los kioscos se enteran en máx. 2 min.</p>}
        <div className="ev-fila">
          <label>Hasta <input type="datetime-local" value={hasta} onChange={(e) => setHasta(e.target.value)} /></label>
          <button className="ev-sec" disabled={ocupado} onClick={() => setHasta(finDeDia(0))}>Hoy</button>
          <button className="ev-sec" disabled={ocupado} onClick={() => setHasta(finDeDia(7))}>7 días</button>
        </div>
        <div className="ev-fila">
          <button className="ev-btn" disabled={ocupado || !empresa.habilitada || fase === 'inscripcion'} onClick={() => cambiarFase('inscripcion')}>Iniciar inscripción</button>
          <button className="ev-btn" disabled={ocupado || !empresa.habilitada || fase === 'medicion' || !puedeMedir} onClick={() => cambiarFase('medicion')}
            title={!puedeMedir ? 'Cada modelo activo necesita al menos 2 personas inscritas' : ''}>Iniciar medición</button>
          <button className="ev-btn ev-apagar" disabled={ocupado || fase === 'apagada'} onClick={() => cambiarFase('apagada')}>Apagar</button>
        </div>
        <ol className="ev-pasos">
          <li><b>Inscripción</b>: cada persona marca 2 o 3 veces en el kiosco web (por ejemplo, salida y regreso del almuerzo). Queda lista con {SFACE_MAX_POR_PERSONA}/{SFACE_MAX_POR_PERSONA} en cada modelo.</li>
          <li><b>Medición</b>: unos días marcando normal. Cada marcación se compara también con cada modelo.</li>
          <li><b>Apagar</b> y revisar el reporte. Luego borra los datos si ya no los necesitas.</li>
        </ol>
      </section>

      {Object.entries(reportes).map(([id, { resumen: s, desacuerdos }]) => {
        const m = MODELOS[id];
        const medidos = s.total - s.errores;
        return (
          <section className="ev-card" key={id}>
            <h2>Reporte {m.nombre} ({medidos} mediciones){!activos.includes(id) && ' · inactivo'}</h2>
            <p className="ev-nota">Comparado contra lo que decidió el modelo actual (no es una verdad verificada). {m.nombre} acepta con similitud ≥ {m.umbral} y {m.margen} de ventaja sobre el segundo (umbral provisional).</p>
            <div className="ev-kpis">
              <div><b>{pct(s.coinciden, medidos)}</b><small>Coinciden ({s.coinciden})</small></div>
              <div><b>{pct(s.sfaceRechaza, medidos)}</b><small>{m.nombre} no reconoce y el actual sí ({s.sfaceRechaza})</small></div>
              <div className={s.confunde > 0 ? 'mal' : ''}><b>{s.confunde}</b><small>{m.nombre} elige a OTRA persona</small></div>
              <div><b>{s.sfaceSolo}</b><small>Solo {m.nombre} acepta (revisar)</small></div>
              <div><b>{s.msMediana != null ? `${Math.round(s.msMediana)} ms` : '—'}</b><small>Tiempo típico (p95 {s.msP95 != null ? `${Math.round(s.msP95)} ms` : '—'})</small></div>
              <div><b>{s.errores}</b><small>Fallos del modelo</small></div>
            </div>
            {desacuerdos.length > 0 && (
              <table className="ev-tabla">
                <thead><tr><th>Cuándo</th><th>Modelo actual</th><th>{m.nombre} eligió</th><th>Sim. 1º / 2º</th></tr></thead>
                <tbody>
                  {desacuerdos.map((i) => (
                    <tr key={i.id}>
                      <td>{fecha(i.ts)}</td>
                      <td>{i.aceptado_actual ? i.referencia_nombre ?? '—' : 'Rechazó'}</td>
                      <td>{acepta(id, i.sface_sim1, i.sface_sim2) ? i.sface_nombre ?? '—' : `No reconoce (${i.sface_nombre ?? '—'})`}</td>
                      <td>{i.sface_sim1 != null ? i.sface_sim1.toFixed(3) : '—'} / {i.sface_sim2 != null ? i.sface_sim2.toFixed(3) : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>
        );
      })}

      <section className="ev-card">
        <h2>Inscritos</h2>
        <p className="ev-nota">
          {activos.map((m) => `${MODELOS[m].nombre}: ${contar(m, SFACE_MAX_POR_PERSONA)} completos de ${personas.length}`).join(' · ')}
        </p>
        <table className="ev-tabla">
          <thead><tr><th>Colaborador</th>{activos.map((m) => <th key={m}>{MODELOS[m].nombre}</th>)}<th /></tr></thead>
          <tbody>
            {personas.map((p) => {
              const alguno = IDS_MODELOS.some((m) => (p.vectores?.[m] ?? 0) > 0);
              return (
                <tr key={p.id}>
                  <td>{p.nombre}</td>
                  {activos.map((m) => {
                    const n = p.vectores?.[m] ?? 0;
                    return <td key={m} className={n >= SFACE_MAX_POR_PERSONA ? 'ok' : ''}>{n}/{SFACE_MAX_POR_PERSONA}</td>;
                  })}
                  <td>{alguno && <button className="ev-link" onClick={() => borrar(p.id, p.nombre)}>Borrar</button>}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <button className="ev-btn ev-apagar" onClick={() => borrar(null)}>Borrar todas las inscripciones y resultados</button>
      </section>
    </main>
  );
}

const CSS = `
.ev { max-width: 880px; margin: 0 auto; padding: 20px 16px 60px; font-family: Montserrat, system-ui, sans-serif; color: #14233a; }
.ev h1 { font-size: 24px; margin: 10px 0 6px; }
.ev h2 { font-size: 17px; margin: 0 0 10px; }
.ev-volver { color: #2b6cb0; text-decoration: none; font-size: 14px; }
.ev-nota { color: #45566c; font-size: 14px; line-height: 1.5; }
.ev-error { color: #b3403a; font-weight: 600; }
.ev-off { border-color: #e7c9a5; background: #fffaf3; }
.ev-card { background: #fff; border: 1px solid #dde6f1; border-radius: 12px; padding: 16px; margin: 14px 0; }
.ev-modelo { display: flex; gap: 10px; align-items: flex-start; padding: 8px 0; cursor: pointer; font-size: 15px; }
.ev-modelo input { margin-top: 4px; }
.ev-aviso { display: block; color: #9a4b12; font-size: 13px; margin-top: 2px; }
.ev-fila { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; margin: 8px 0; }
.ev-fila input { font: inherit; padding: 6px 8px; border: 1px solid #dde6f1; border-radius: 8px; }
.ev-btn, .ev-sec { font: inherit; padding: 8px 14px; border-radius: 10px; border: 1px solid #13294b; background: #13294b; color: #fff; cursor: pointer; }
.ev-sec { background: #fff; color: #13294b; }
.ev-btn:disabled, .ev-sec:disabled { opacity: .45; cursor: default; }
.ev-apagar { background: #fff; color: #b3403a; border-color: #b3403a; }
.ev-fase.inscripcion { color: #2b6cb0; } .ev-fase.medicion { color: #1b6b4f; } .ev-fase.apagada { color: #7a8aa0; }
.ev-pasos { font-size: 14px; color: #45566c; padding-left: 18px; }
.ev-kpis { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 10px; margin: 12px 0; }
.ev-kpis div { background: #f2f6fc; border-radius: 10px; padding: 10px; }
.ev-kpis b { display: block; font-size: 20px; } .ev-kpis small { color: #45566c; }
.ev-kpis .mal { background: #fbe9e7; }
.ev-tabla { width: 100%; border-collapse: collapse; font-size: 14px; margin: 8px 0 12px; }
.ev-tabla td, .ev-tabla th { border-bottom: 1px solid #eef2f7; padding: 6px 4px; text-align: left; }
.ev-tabla td.ok { color: #1b6b4f; font-weight: 700; }
.ev-link { background: none; border: none; color: #b3403a; cursor: pointer; font: inherit; }
`;
