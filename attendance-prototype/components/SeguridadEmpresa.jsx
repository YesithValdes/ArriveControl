'use client';
/**
 * components/SeguridadEmpresa.jsx — Ajustes → Seguridad (solo el dueño).
 *
 * Dos cosas que son de la EMPRESA y no de la plataforma:
 *   · su llave de recuperación — con la que la DEK de sus datos se puede
 *     recuperar aunque la plataforma pierda su llave maestra;
 *   · el acceso del soporte — que solo existe si ella lo autoriza, por 72 h
 *     como máximo, con cada consulta anotada en una bitácora que ve aquí.
 *
 * Se monta dentro de AdminPanel y usa sus clases (card, btn, ev-form,
 * att-table…). Habla solo con /api/empresa/llaves y /api/soporte.
 */
import { useCallback, useEffect, useState } from 'react';

const HORAS = [1, 4, 8, 24, 48, 72];

const fecha = (v) => (v ? new Date(v).toLocaleString('es-CO', { dateStyle: 'medium', timeStyle: 'short' }) : '—');

function restante(hasta) {
  const ms = new Date(hasta).getTime() - Date.now();
  if (ms <= 0) return 'vencida';
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  return h > 0 ? `${h} h ${m} min` : `${m} min`;
}

const ACCION = {
  entrar: ['Entró', 'neutral'],
  ver: ['Consultó', 'good'],
  denegado: ['Intento negado', 'crit'],
  salir: ['Salió', 'neutral'],
};

async function pedir(url, opciones) {
  const r = await fetch(url, { cache: 'no-store', ...opciones, headers: { 'Content-Type': 'application/json', ...(opciones?.headers ?? {}) } });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.ok === false) throw new Error(j.error || `Error ${r.status}`);
  return j;
}

export default function SeguridadEmpresa({ alVolver, soloLectura = false }) {
  const [llaves, setLlaves] = useState(null);
  const [soporte, setSoporte] = useState(null);
  const [error, setError] = useState(null);
  const [ocupado, setOcupado] = useState(false);

  // La llave recién generada vive SOLO en este estado: no se guarda en el
  // navegador, y al cerrar el recuadro desaparece para siempre.
  const [llaveNueva, setLlaveNueva] = useState(null);
  const [guardada, setGuardada] = useState(false);
  const [aVerificar, setAVerificar] = useState('');
  const [verificacion, setVerificacion] = useState(null);

  const [form, setForm] = useState(null); // { horas, motivo }

  const cargar = useCallback(async () => {
    setError(null);
    try {
      const [l, s] = await Promise.all([pedir('/api/empresa/llaves'), pedir('/api/soporte')]);
      setLlaves(l);
      setSoporte(s);
    } catch (e) {
      setError(e.message);
    }
  }, []);
  useEffect(() => { cargar(); }, [cargar]);

  const generar = async (reemplazar) => {
    if (reemplazar && !window.confirm('La llave de recuperación actual dejará de servir. ¿Generar una nueva?')) return;
    setOcupado(true); setError(null);
    try {
      const r = await pedir('/api/empresa/llaves', { method: 'POST', body: JSON.stringify({ accion: reemplazar ? 'reemplazar' : 'generar' }) });
      setLlaveNueva(r.llave); setGuardada(false); setVerificacion(null);
      await cargar();
    } catch (e) { setError(e.message); } finally { setOcupado(false); }
  };

  const verificar = async () => {
    setOcupado(true); setVerificacion(null);
    try {
      const r = await pedir('/api/empresa/llaves', { method: 'POST', body: JSON.stringify({ accion: 'verificar', llave: aVerificar }) });
      setVerificacion(r.coincide);
    } catch (e) { setError(e.message); } finally { setOcupado(false); }
  };

  const descargar = () => {
    const texto = [
      'ArriveControl — Llave de recuperación',
      '',
      llaveNueva,
      '',
      `Generada: ${new Date().toLocaleString('es-CO')}`,
      'Guárdala fuera del computador (impresa o en un gestor de contraseñas).',
      'Con ella se recuperan los datos cifrados de la empresa. Nadie más la tiene.',
    ].join('\n');
    const url = URL.createObjectURL(new Blob([texto], { type: 'text/plain' }));
    const a = document.createElement('a');
    a.href = url; a.download = 'arrivecontrol-llave-de-recuperacion.txt'; a.click();
    URL.revokeObjectURL(url);
  };

  const autorizar = async () => {
    setOcupado(true); setError(null);
    try {
      await pedir('/api/soporte', { method: 'POST', body: JSON.stringify(form) });
      setForm(null);
      await cargar();
    } catch (e) { setError(e.message); } finally { setOcupado(false); }
  };

  const revocar = async (id) => {
    if (!window.confirm('El soporte pierde el acceso de inmediato. ¿Revocar?')) return;
    setOcupado(true); setError(null);
    try {
      await pedir(`/api/soporte/${id}`, { method: 'DELETE' });
      await cargar();
    } catch (e) { setError(e.message); } finally { setOcupado(false); }
  };

  const vigente = soporte?.autorizaciones?.find((a) => a.vigente) ?? null;
  const historicas = soporte?.autorizaciones?.filter((a) => !a.vigente) ?? [];

  return (
    <section className="card grow">
      <style>{CSS}</style>
      {alVolver && <button className="btn back-btn" onClick={alVolver}>‹ Ajustes</button>}
      <h2>Seguridad</h2>
      {error && <p className="empty">⚠ {error}</p>}

      <div className="scrollable seg">
        {/* ── Llave de recuperación ───────────────────────────────── */}
        <div className="seg-bloque">
          <h3>Llave de recuperación</h3>
          <p className="hint">
            Los datos sensibles de tu empresa se cifran con una llave propia. Esta llave de recuperación
            la protege: con ella se pueden recuperar tus datos aunque la plataforma perdiera la suya.
            Solo la tienes tú — nosotros no la guardamos y no podemos volver a mostrártela.
          </p>

          {llaves && !llaves.configurado && (
            <p className="seg-aviso warn">El cifrado todavía no está activo en el servidor. Podrás generar tu llave en cuanto lo esté.</p>
          )}

          {llaveNueva ? (
            <div className="seg-llave" role="status">
              <b>Tu llave de recuperación. Guárdala ahora: no se volverá a mostrar.</b>
              <code>{llaveNueva}</code>
              <div className="dialog-actions" style={{ justifyContent: 'flex-start', flexWrap: 'wrap' }}>
                <button className="btn small" onClick={() => navigator.clipboard?.writeText(llaveNueva)}>Copiar</button>
                <button className="btn small" onClick={descargar}>Descargar .txt</button>
              </div>
              <label className="seg-check">
                <input type="checkbox" checked={guardada} onChange={(e) => setGuardada(e.target.checked)} />
                La guardé en un lugar seguro, fuera de este computador.
              </label>
              <div className="dialog-actions">
                <button className="btn primary" disabled={!guardada} onClick={() => setLlaveNueva(null)}>Listo</button>
              </div>
            </div>
          ) : llaves?.configurado && (
            llaves.recuperacion ? (
              <>
                <p className="seg-ok">
                  <span className="chip good">Activa</span> Generada el {fecha(llaves.recuperacion.creadaEn)}
                  {llaves.recuperacion.creadaPor ? ` por ${llaves.recuperacion.creadaPor}` : ''}.
                </p>
                {soloLectura ? <p className="hint">Generar, reemplazar o verificar la llave es solo del Propietario.</p> : <div className="ev-form">
                  <h4>¿Es esta la llave que tengo guardada?</h4>
                  <label>Llave
                    <input
                      value={aVerificar} placeholder="XXXX-XXXX-XXXX-…" autoComplete="off" spellCheck={false}
                      onChange={(e) => { setAVerificar(e.target.value); setVerificacion(null); }}
                    />
                  </label>
                  {verificacion === true && <span className="chip good">Coincide: con esta llave se recuperan tus datos.</span>}
                  {verificacion === false && <span className="chip crit">No coincide con la llave vigente.</span>}
                  <div className="dialog-actions">
                    <button className="btn" disabled={ocupado} onClick={() => generar(true)}>Reemplazar llave</button>
                    <button className="btn primary" disabled={ocupado || aVerificar.trim().length < 20} onClick={verificar}>Verificar</button>
                  </div>
                </div>}
              </>
            ) : (
              <>
                <p className="seg-aviso warn">Tu empresa todavía no tiene llave de recuperación. Genérala y guárdala.</p>
                {soloLectura
                  ? <p className="hint">Solo el Propietario puede generarla.</p>
                  : <button className="btn primary" disabled={ocupado} onClick={() => generar(false)}>Generar llave de recuperación</button>}
              </>
            )
          )}
        </div>

        {/* ── Acceso de soporte ───────────────────────────────────── */}
        <div className="seg-bloque">
          <h3>Acceso del soporte</h3>
          <p className="hint">
            El equipo de ArriveControl no puede ver los datos de tu empresa. Si necesitas que te ayude,
            autorízalo aquí: verá tu panel en <b>solo lectura</b>, durante el tiempo que elijas
            (máximo {soporte?.horasMaximas ?? 72} horas), y cada cosa que consulte queda anotada abajo.
            Puedes cortar el acceso cuando quieras.
          </p>

          {vigente ? (
            <div className="seg-vigente">
              <div>
                <span className="chip warn">Autorizado</span>{' '}
                Vence en <b>{restante(vigente.hasta)}</b> ({fecha(vigente.hasta)}).
                <br /><small>Motivo: {vigente.motivo} · por {vigente.autorizada_por_email ?? '—'}</small>
              </div>
              {!soloLectura && <button className="btn" disabled={ocupado} onClick={() => revocar(vigente.id)}>Revocar ahora</button>}
            </div>
          ) : soloLectura ? (
            <p className="hint">Autorizar o cortar el acceso del soporte es solo del Propietario.</p>
          ) : form ? (
            <div className="ev-form">
              <h4>Autorizar al soporte</h4>
              <div className="ev-form-row">
                <label>Durante
                  <select className="sede-select" value={form.horas} onChange={(e) => setForm({ ...form, horas: Number(e.target.value) })}>
                    {HORAS.map((h) => <option key={h} value={h}>{h === 1 ? '1 hora' : `${h} horas`}</option>)}
                  </select>
                </label>
              </div>
              <label>Para qué
                <input
                  value={form.motivo} maxLength={500} autoFocus
                  placeholder="Ej.: revisar por qué no cuadran las horas extra de octubre"
                  onChange={(e) => setForm({ ...form, motivo: e.target.value })}
                />
              </label>
              <div className="dialog-actions">
                <button className="btn" onClick={() => setForm(null)}>Cancelar</button>
                <button className="btn primary" disabled={ocupado || form.motivo.trim().length < 5} onClick={autorizar}>Autorizar</button>
              </div>
            </div>
          ) : (
            <button className="btn primary" onClick={() => setForm({ horas: 24, motivo: '' })}>Autorizar al soporte</button>
          )}

          <h4 className="seg-sub">Qué hizo el soporte</h4>
          {soporte && soporte.accesos.length === 0 && <p className="empty">El soporte nunca ha entrado a tu empresa.</p>}
          {soporte && soporte.accesos.length > 0 && (
            <div className="att-tablewrap">
              <table className="att-table">
                <thead><tr><th>Cuándo</th><th>Quién</th><th>Qué</th><th>Dónde</th></tr></thead>
                <tbody>
                  {soporte.accesos.map((a) => (
                    <tr key={a.id} className="static">
                      <td>{fecha(a.ts)}</td>
                      <td>{a.usuario_email ?? '—'}</td>
                      <td><span className={`chip ${ACCION[a.accion]?.[1] ?? 'neutral'}`}>{ACCION[a.accion]?.[0] ?? a.accion}</span>{a.detalle ? <small> {a.detalle}</small> : null}</td>
                      <td><small>{a.metodo ? `${a.metodo} ` : ''}{a.ruta ?? ''}</small></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {historicas.length > 0 && (
            <>
              <h4 className="seg-sub">Autorizaciones anteriores</h4>
              <ul className="seg-lista">
                {historicas.map((a) => (
                  <li key={a.id}>
                    {fecha(a.desde)} → {fecha(a.hasta)} · {a.motivo}
                    {a.revocada_en ? <small> · revocada {fecha(a.revocada_en)}{a.revocada_por ? ` por ${a.revocada_por}` : ''}</small> : <small> · vencida</small>}
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      </div>
    </section>
  );
}

const CSS = `
.seg { display: flex; flex-direction: column; gap: 22px; }
.seg-bloque { display: flex; flex-direction: column; gap: 10px; }
.seg-bloque h3 { font-size: 15px; font-weight: 700; color: var(--ink); }
.seg-sub { font-size: 13px; font-weight: 700; margin-top: 6px; color: var(--ink-2); }
.seg-aviso { padding: 9px 12px; border-radius: 10px; font-size: 13px; font-weight: 600; }
.seg-aviso.warn { background: var(--warn-soft); color: var(--warn-text); }
.seg-ok { font-size: 13px; display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.seg-llave { display: flex; flex-direction: column; gap: 10px; padding: 14px; border: 2px solid var(--accent); border-radius: 10px; background: var(--accent-soft); }
.seg-llave code { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 15px; letter-spacing: .04em; word-break: break-all; background: var(--surface-blanca); padding: 10px 12px; border-radius: 8px; user-select: all; }
.seg-check { display: flex; align-items: center; gap: 8px; font-size: 13px; }
.seg-vigente { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; padding: 12px; border: 1px solid var(--warn-text); border-radius: 10px; background: var(--warn-soft); font-size: 13px; }
.seg-lista { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 6px; font-size: 12.5px; color: var(--ink-2); }
`;
