'use client';
/**
 * components/EvaluacionSface.jsx — Pantalla de la evaluación de SFace.
 *
 * El administrador decide CUÁNDO se evalúa: nada corre solo. Tres fases:
 *   · Inscripción: cada marcación confirmada en el kiosco web guarda vectores
 *     SFace de esa persona (hasta 3). Basta con que marque 2 o 3 veces.
 *   · Medición: cada marcación se compara también con SFace y se anota.
 *   · Apagada: el kiosco no baja el modelo ni los vectores.
 * El modelo actual sigue decidiendo quién marca en todas las fases.
 */
import { useCallback, useEffect, useState } from 'react';
import { SFACE_MAX_POR_PERSONA, SFACE_UMBRAL, SFACE_MARGEN, aceptaSface } from '../utils/evaluacionSface.js';

const FASE_TXT = { apagada: 'Apagada', inscripcion: 'Inscripción', medicion: 'Medición' };
const pct = (n, total) => (total > 0 ? `${Math.round((n / total) * 100)} %` : '—');
const fecha = (iso) => (iso ? new Date(iso).toLocaleString('es-CO', { dateStyle: 'short', timeStyle: 'short' }) : '—');
// datetime-local en hora local, a N días desde ahora, a las 23:59.
const finDeDia = (dias) => {
  const d = new Date(Date.now() + dias * 86400000);
  d.setHours(23, 59, 0, 0);
  const z = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}T23:59`;
};

export default function EvaluacionSface() {
  const [d, setD] = useState(null);
  const [error, setError] = useState(null);
  const [ocupado, setOcupado] = useState(false);
  const [hasta, setHasta] = useState(finDeDia(0));

  const cargar = useCallback(async () => {
    const r = await fetch('/api/evaluacion-sface');
    const j = await r.json().catch(() => null);
    if (!r.ok || !j?.ok) { setError(j?.error || `Error ${r.status}`); return; }
    setError(null);
    setD(j);
  }, []);
  useEffect(() => { cargar(); const id = setInterval(cargar, 30000); return () => clearInterval(id); }, [cargar]);

  const cambiarFase = async (estado) => {
    setOcupado(true);
    const r = await fetch('/api/evaluacion-sface', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ estado, hasta: estado === 'apagada' ? null : new Date(hasta).toISOString() }),
    });
    const j = await r.json().catch(() => null);
    setOcupado(false);
    if (!r.ok || !j?.ok) { alert(j?.error || 'No se pudo cambiar la fase.'); return; }
    cargar();
  };

  const borrar = async (empleadoId, nombre) => {
    const todo = !empleadoId;
    const msg = todo
      ? '¿Borrar TODAS las inscripciones y resultados de la evaluación? No se puede deshacer.'
      : `¿Borrar la inscripción SFace de ${nombre}?`;
    if (!confirm(msg)) return;
    const q = todo ? 'todo=1' : `empleado_id=${encodeURIComponent(empleadoId)}`;
    const r = await fetch(`/api/evaluacion-sface?${q}`, { method: 'DELETE' });
    if (!r.ok) alert('No se pudo borrar.');
    cargar();
  };

  if (error) {
    return (
      <main className="ev"><style>{CSS}</style>
        <a href="/admin/ajustes" className="ev-volver">← Volver al panel</a>
        <h1>Evaluación de modelos faciales</h1>
        <p className="ev-error">{error}</p>
      </main>
    );
  }
  if (!d) return <main className="ev"><style>{CSS}</style><p>Cargando…</p></main>;

  const { config, personas, resumen: s, desacuerdos } = d;
  const fase = config.fase;
  const inscritos = personas.filter((p) => p.vectores > 0).length;
  const completos = personas.filter((p) => p.vectores >= SFACE_MAX_POR_PERSONA).length;
  const medidos = s.total - s.errores;

  return (
    <main className="ev">
      <style>{CSS}</style>
      <a href="/admin/ajustes" className="ev-volver">← Volver al panel</a>
      <h1>Evaluación de SFace</h1>
      <p className="ev-nota">
        SFace se mide <b>en sombra</b> en el kiosco web: el modelo actual sigue decidiendo quién marca, y nada de
        esto toca los rostros ni las marcaciones. Los vectores SFace son datos biométricos: inscribe solo a personas
        que lo hayan autorizado y bórralos al terminar.
      </p>

      <section className="ev-card">
        <h2>Fase: <span className={`ev-fase ${fase}`}>{FASE_TXT[fase]}</span></h2>
        {fase !== 'apagada' && <p>Se apaga sola: {fecha(config.hasta)}. Los kioscos se enteran en máx. 2 min.</p>}
        <div className="ev-fila">
          <label>Hasta <input type="datetime-local" value={hasta} onChange={(e) => setHasta(e.target.value)} /></label>
          <button disabled={ocupado} onClick={() => setHasta(finDeDia(0))}>Hoy</button>
          <button disabled={ocupado} onClick={() => setHasta(finDeDia(7))}>7 días</button>
        </div>
        <div className="ev-fila">
          <button className="ev-btn" disabled={ocupado || fase === 'inscripcion'} onClick={() => cambiarFase('inscripcion')}>Iniciar inscripción</button>
          <button className="ev-btn" disabled={ocupado || fase === 'medicion' || inscritos < 2} onClick={() => cambiarFase('medicion')}
            title={inscritos < 2 ? 'Se necesitan al menos 2 personas inscritas' : ''}>Iniciar medición</button>
          <button className="ev-btn ev-apagar" disabled={ocupado || fase === 'apagada'} onClick={() => cambiarFase('apagada')}>Apagar</button>
        </div>
        <ol className="ev-pasos">
          <li><b>Inscripción</b>: cada persona marca 2 o 3 veces en el kiosco web (por ejemplo, salida y regreso del almuerzo). Queda lista con {SFACE_MAX_POR_PERSONA}/{SFACE_MAX_POR_PERSONA}.</li>
          <li><b>Medición</b>: unos días marcando normal. Cada marcación se compara también con SFace.</li>
          <li><b>Apagar</b> y revisar el reporte. Luego borra los datos si ya no los necesitas.</li>
        </ol>
      </section>

      <section className="ev-card">
        <h2>Reporte ({medidos} mediciones)</h2>
        <p className="ev-nota">Comparado contra lo que decidió el modelo actual (no es una verdad verificada). SFace acepta con similitud ≥ {SFACE_UMBRAL} y {SFACE_MARGEN} de ventaja sobre el segundo (umbral provisional).</p>
        <div className="ev-kpis">
          <div><b>{pct(s.coinciden, medidos)}</b><small>Coinciden ({s.coinciden})</small></div>
          <div><b>{pct(s.sfaceRechaza, medidos)}</b><small>SFace no reconoce y el actual sí ({s.sfaceRechaza})</small></div>
          <div className={s.confunde > 0 ? 'mal' : ''}><b>{s.confunde}</b><small>SFace elige a OTRA persona</small></div>
          <div><b>{s.sfaceSolo}</b><small>Solo SFace acepta (revisar)</small></div>
          <div><b>{s.msMediana != null ? `${Math.round(s.msMediana)} ms` : '—'}</b><small>Tiempo típico (p95 {s.msP95 != null ? `${Math.round(s.msP95)} ms` : '—'})</small></div>
          <div><b>{s.errores}</b><small>Fallos de SFace</small></div>
        </div>
        {desacuerdos.length > 0 && (
          <table className="ev-tabla">
            <thead><tr><th>Cuándo</th><th>Modelo actual</th><th>SFace eligió</th><th>Sim. 1º / 2º</th></tr></thead>
            <tbody>
              {desacuerdos.map((i) => (
                <tr key={i.id}>
                  <td>{fecha(i.ts)}</td>
                  <td>{i.aceptado_actual ? i.referencia_nombre ?? '—' : 'Rechazó'}</td>
                  <td>{aceptaSface(i.sface_sim1, i.sface_sim2) ? i.sface_nombre ?? '—' : `No reconoce (${i.sface_nombre ?? '—'})`}</td>
                  <td>{i.sface_sim1 != null ? i.sface_sim1.toFixed(3) : '—'} / {i.sface_sim2 != null ? i.sface_sim2.toFixed(3) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="ev-card">
        <h2>Inscritos: {completos} completos de {personas.length} ({inscritos} con al menos un vector)</h2>
        <table className="ev-tabla">
          <tbody>
            {personas.map((p) => (
              <tr key={p.id}>
                <td>{p.nombre}</td>
                <td className={p.vectores >= SFACE_MAX_POR_PERSONA ? 'ok' : ''}>{p.vectores}/{SFACE_MAX_POR_PERSONA}</td>
                <td>{p.vectores > 0 && <button className="ev-link" onClick={() => borrar(p.id, p.nombre)}>Borrar</button>}</td>
              </tr>
            ))}
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
.ev-card { background: #fff; border: 1px solid #dde6f1; border-radius: 12px; padding: 16px; margin: 14px 0; }
.ev-fila { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; margin: 8px 0; }
.ev-fila input { font: inherit; padding: 6px 8px; border: 1px solid #dde6f1; border-radius: 8px; }
.ev-fila button, .ev-btn { font: inherit; padding: 8px 14px; border-radius: 10px; border: 1px solid #13294b; background: #13294b; color: #fff; cursor: pointer; }
.ev-fila label + button, .ev-fila label ~ button { background: #fff; color: #13294b; }
.ev-btn:disabled, .ev-fila button:disabled { opacity: .45; cursor: default; }
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
