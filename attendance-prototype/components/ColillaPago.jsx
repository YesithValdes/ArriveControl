'use client';
/**
 * components/ColillaPago.jsx — Colilla de pago (desprendible de HORAS) de un
 * colaborador: generar la del período que se está viendo en Reportes y
 * consultar las guardadas. Las cifras las calcula y congela el servidor
 * (POST /api/colillas); aquí solo se muestran y se imprimen.
 *
 * Imprimir usa un iframe oculto con la colilla sola, así el PDF sale limpio
 * (sin el panel alrededor) y sin abrir otra pestaña.
 */
import { useEffect, useState } from 'react';

const fmtCOP = (v) => (v == null ? '—' : v.toLocaleString('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }));
const fmtH = (h) => `${Number(h ?? 0).toLocaleString('es-CO', { maximumFractionDigits: 2 })} h`;
const fmtFecha = (iso) => new Date(`${iso}T12:00:00`).toLocaleDateString('es-CO', { day: 'numeric', month: 'short', year: 'numeric' });
const fmtMomento = (ts) => new Date(ts).toLocaleString('es-CO', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' });
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/** La colilla como documento HTML suelto, para imprimir o guardar en PDF. */
function htmlColilla(c, empresa) {
  const d = c.datos;
  const filas = d.tipos.map((t) => `<tr><td>${esc(t.nombre)} <small>(${esc(t.codigo)})</small></td><td class="n">${fmtH(t.horas)}</td><td class="n">${t.horas > 0 ? fmtCOP(t.valor) : '—'}</td></tr>`).join('');
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Colilla de pago ${esc(c.nombre)} ${c.desde} a ${c.hasta}</title>
<style>
  body { font: 13px/1.45 system-ui, -apple-system, Segoe UI, Roboto, sans-serif; color: #111; margin: 32px; }
  h1 { font-size: 16px; margin: 0 0 2px; } .sub { color: #555; margin: 0 0 16px; }
  .cab { display: flex; justify-content: space-between; gap: 16px; border-bottom: 2px solid #111; padding-bottom: 10px; margin-bottom: 14px; }
  table { width: 100%; border-collapse: collapse; margin: 8px 0 14px; }
  th, td { padding: 6px 4px; border-bottom: 1px solid #ddd; text-align: left; } .n { text-align: right; white-space: nowrap; }
  th { font-size: 11px; text-transform: uppercase; letter-spacing: .04em; color: #555; }
  tfoot td { font-weight: 700; border-top: 2px solid #111; border-bottom: 0; }
  small { color: #666; } .nota { color: #555; font-size: 11.5px; margin-top: 18px; }
</style></head><body>
<div class="cab"><div><h1>Colilla de pago · horas</h1><p class="sub">${esc(empresa ?? '')}</p></div>
<div style="text-align:right"><b>${fmtFecha(c.desde)} – ${fmtFecha(c.hasta)}</b><br><small>Generada el ${fmtMomento(c.generadaEn)}</small></div></div>
<p><b>${esc(c.nombre)}</b><br>CC ${esc(c.documento ?? '—')}${d.sede ? ` · ${esc(d.sede)}` : ''}</p>
<table><tbody>
<tr><td>Días trabajados</td><td class="n">${d.trabajado.dias}</td></tr>
<tr><td>Horas trabajadas</td><td class="n">${fmtH(d.trabajado.horas)}</td></tr>
</tbody></table>
<table><thead><tr><th>Horas extra y recargos</th><th class="n">Horas</th><th class="n">Valor</th></tr></thead>
<tbody>${filas}</tbody>
<tfoot><tr><td>Total</td><td class="n">${fmtH(d.horasExtra)}</td><td class="n">${d.sinSalario ? 'Sin salario registrado' : fmtCOP(d.valorExtra)}</td></tr></tfoot></table>
<p>Estado del período: <b>${d.cierre ? `Cerrado${d.cierre.cerradoEn ? ` el ${fmtMomento(d.cierre.cerradoEn)}` : ''}` : 'Abierto (calculado en vivo al generar)'}</b></p>
<p class="nota">Comprobante de las horas registradas en el control de asistencia. No incluye salario básico, auxilio de transporte ni deducciones de nómina.</p>
</body></html>`;
}

export default function ColillaPago({ persona, desde, hasta, empresa, onCerrar, avisar }) {
  const [colillas, setColillas] = useState(null); // null = cargando
  const [error, setError] = useState(null);
  const [elegida, setElegida] = useState(null);
  const [generando, setGenerando] = useState(false);

  useEffect(() => {
    let vigente = true;
    fetch('/api/colillas?' + new URLSearchParams({ documento: persona.cedula }))
      .then((r) => r.json())
      .then((d) => {
        if (!vigente) return;
        if (!d.ok) { setError(d.error); setColillas([]); return; }
        setColillas(d.colillas);
        // Abre la de este período, si ya hay una.
        setElegida(d.colillas.find((c) => c.desde === desde && c.hasta === hasta) ?? null);
      })
      .catch((e) => { if (vigente) { setError(e.message); setColillas([]); } });
    return () => { vigente = false; };
  }, [persona.cedula, desde, hasta]);

  useEffect(() => {
    const tecla = (e) => { if (e.key === 'Escape') onCerrar(); };
    window.addEventListener('keydown', tecla);
    return () => window.removeEventListener('keydown', tecla);
  }, [onCerrar]);

  const generar = async () => {
    setGenerando(true);
    try {
      const r = await fetch('/api/colillas', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ documento: persona.cedula, desde, hasta }),
      });
      const d = await r.json();
      if (!r.ok || !d.ok) throw new Error(d.error || `El servidor respondió ${r.status}`);
      setColillas((cs) => [d.colilla, ...(cs ?? [])]);
      setElegida(d.colilla);
      avisar?.('Colilla de pago generada y guardada');
    } catch (e) { avisar?.('No se pudo generar la colilla de pago: ' + e.message); }
    finally { setGenerando(false); }
  };

  const imprimir = () => {
    const marco = document.createElement('iframe');
    marco.style.cssText = 'position:fixed;width:0;height:0;border:0;right:0;bottom:0';
    document.body.appendChild(marco);
    const doc = marco.contentDocument;
    doc.open(); doc.write(htmlColilla(elegida, empresa)); doc.close();
    marco.contentWindow.focus();
    marco.contentWindow.print();
    setTimeout(() => marco.remove(), 1000);
  };

  const d = elegida?.datos;
  return (
    <div className="overlay" onClick={(e) => e.target === e.currentTarget && onCerrar()}>
      <div className="dialog colilla" role="dialog" aria-modal="true" aria-labelledby="colilla-titulo">
        <style>{CSS}</style>
        <h3 id="colilla-titulo">Colilla de pago · {persona.name}</h3>
        <p className="hint">Comprobante de horas del colaborador. Al generarla se guarda tal cual: después se consulta igual aunque cambien salarios o reglas.</p>

        <div className="colilla-acciones">
          <button className="btn primary" onClick={generar} disabled={generando}>
            {generando ? 'Generando…' : `Generar ${fmtFecha(desde)} – ${fmtFecha(hasta)}`}
          </button>
          {colillas?.length > 0 && (
            <select className="sede-select" aria-label="Colillas de pago guardadas" value={elegida?.id ?? ''}
              onChange={(e) => setElegida(colillas.find((c) => c.id === e.target.value) ?? null)}>
              <option value="">Consultar una guardada…</option>
              {colillas.map((c) => (
                <option key={c.id} value={c.id}>{fmtFecha(c.desde)} – {fmtFecha(c.hasta)} · {fmtMomento(c.generadaEn)}</option>
              ))}
            </select>
          )}
        </div>

        {colillas === null && <p className="empty">Cargando…</p>}
        {error && <p className="empty">⚠ {error}</p>}
        {colillas?.length === 0 && !error && !elegida && <p className="empty">Todavía no hay colillas de pago guardadas de esta persona.</p>}

        {elegida && (
          <div className="colilla-doc">
            <div className="colilla-cab">
              <div><b>{elegida.nombre}</b><br /><small>CC {elegida.documento ?? '—'}{d.sede ? ` · ${d.sede}` : ''}</small></div>
              <div className="colilla-periodo"><b>{fmtFecha(elegida.desde)} – {fmtFecha(elegida.hasta)}</b><br /><small>Generada el {fmtMomento(elegida.generadaEn)}</small></div>
            </div>
            <div className="colilla-resumen">
              <div><small>Días trabajados</small><b>{d.trabajado.dias}</b></div>
              <div><small>Horas trabajadas</small><b>{fmtH(d.trabajado.horas)}</b></div>
              <div><small>Horas extra</small><b>{fmtH(d.horasExtra)}</b></div>
              <div><small>Valor extras</small><b>{d.sinSalario ? 'sin salario' : fmtCOP(d.valorExtra)}</b></div>
            </div>
            <table className="colilla-tabla">
              <thead><tr><th>Horas extra y recargos</th><th className="n">Horas</th><th className="n">Valor</th></tr></thead>
              <tbody>
                {d.tipos.map((t) => (
                  <tr key={t.codigo} className={t.horas > 0 ? '' : 'cero'}>
                    <td>{t.nombre} <small>({t.codigo})</small></td>
                    <td className="n">{fmtH(t.horas)}</td>
                    <td className="n">{t.horas > 0 ? fmtCOP(t.valor) : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="colilla-estado">
              {d.cierre
                ? <span className="chip good">Cerrado{d.cierre.cerradoEn ? ` el ${fmtMomento(d.cierre.cerradoEn)}` : ''}</span>
                : <span className="chip warn">Abierto al generarla: cifras de ese momento</span>}
            </p>
          </div>
        )}

        <div className="dialog-actions" style={{ marginTop: 12 }}>
          {elegida && <button className="btn" onClick={imprimir}>Imprimir / PDF</button>}
          <button className="btn" onClick={onCerrar}>Cerrar</button>
        </div>
      </div>
    </div>
  );
}

const CSS = `
.dialog.colilla { max-width: 560px; max-height: calc(100dvh - 32px); overflow-y: auto; }
.colilla-acciones { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; margin-bottom: 12px; }
.colilla-acciones .sede-select { flex: 1; min-width: 200px; }
.colilla-doc { border: 1px solid var(--grid); border-radius: 8px; padding: 12px 14px; }
.colilla-cab { display: flex; justify-content: space-between; gap: 12px; padding-bottom: 10px; border-bottom: 1px solid var(--grid); }
.colilla-cab small { color: var(--muted); }
.colilla-periodo { text-align: right; }
.colilla-resumen { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; margin: 12px 0; }
.colilla-resumen div { display: flex; flex-direction: column; gap: 2px; }
.colilla-resumen small { color: var(--muted); font-size: 11.5px; }
.colilla-tabla { width: 100%; border-collapse: collapse; font-size: 13px; }
.colilla-tabla th { text-align: left; font-size: 11px; text-transform: uppercase; letter-spacing: .04em; color: var(--muted); padding: 6px 4px; }
.colilla-tabla td { padding: 6px 4px; border-top: 1px solid var(--grid); }
.colilla-tabla .n { text-align: right; white-space: nowrap; }
.colilla-tabla tr.cero td { color: var(--muted); }
.colilla-tabla small { color: var(--muted); }
.colilla-estado { margin: 10px 0 0; }
/* La etiqueta del estado puede ser larga: en celular se parte en líneas. */
.colilla-estado .chip { white-space: normal; align-items: flex-start; max-width: 100%; }
.colilla-estado .chip::before { flex: 0 0 auto; margin-top: 5px; }
@media (max-width: 520px) {
  .colilla-resumen { grid-template-columns: repeat(2, 1fr); }
  .colilla-cab { flex-direction: column; }
  .colilla-periodo { text-align: left; }
}
`;
