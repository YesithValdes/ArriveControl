'use client';
/**
 * components/SoportePlataforma.jsx — Consola del superadmin → Soporte.
 *
 * Lista las autorizaciones de soporte VIGENTES: las que alguna empresa dio,
 * con su motivo y cuándo vencen. Desde aquí se entra a una (POST
 * /api/plataforma/soporte) y el navegador va a /admin, donde el panel de esa
 * empresa se ve en solo lectura mientras la autorización siga vigente.
 *
 * Sin autorización no hay botón: el superadmin no tiene otra puerta a los
 * datos de una empresa.
 */
import { useCallback, useEffect, useState } from 'react';

const fecha = (v) => (v ? new Date(v).toLocaleString('es-CO', { dateStyle: 'medium', timeStyle: 'short' }) : '—');

export default function SoportePlataforma() {
  const [datos, setDatos] = useState(null);
  const [error, setError] = useState(null);
  const [entrando, setEntrando] = useState(null);

  const cargar = useCallback(async () => {
    setError(null);
    try {
      const r = await fetch('/api/plataforma/soporte', { cache: 'no-store' });
      const j = await r.json();
      if (!r.ok || !j.ok) throw new Error(j.error || `Error ${r.status}`);
      setDatos(j);
    } catch (e) { setError(e.message); }
  }, []);
  useEffect(() => { cargar(); }, [cargar]);

  const entrar = async (id) => {
    setEntrando(id); setError(null);
    try {
      const r = await fetch('/api/plataforma/soporte', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ autorizacionId: id }),
      });
      const j = await r.json();
      if (!r.ok || !j.ok) throw new Error(j.error || `Error ${r.status}`);
      window.location.href = j.destino;
    } catch (e) { setError(e.message); setEntrando(null); cargar(); }
  };

  return (
    <section className="card grow">
      <h2>Soporte</h2>
      <p className="hint">
        No hay acceso permanente a los datos de ninguna empresa. Solo puedes entrar a la que te haya
        autorizado desde su panel (Ajustes → Seguridad), durante la ventana que eligió — máximo 72 horas —
        y en solo lectura. Cada consulta queda en una bitácora que la empresa ve.
      </p>
      {error && <p className="aviso crit">{error}</p>}
      {datos === null && !error && <p className="aviso">Cargando…</p>}
      {datos && datos.vigentes.length === 0 && <p className="empty">Ninguna empresa tiene una autorización vigente.</p>}
      {datos && datos.vigentes.length > 0 && (
        <div className="atencion">
          {datos.vigentes.map((a) => (
            <div className="aten" key={a.id}>
              <span className="chip warn">Hasta {fecha(a.hasta)}</span>
              <div className="aten-texto">
                <b>{a.empresa_nombre}</b>
                <span>{a.motivo} · autorizó {a.autorizada_por_email ?? '—'}{a.ultimo_acceso ? ` · último acceso ${fecha(a.ultimo_acceso)}` : ''}</span>
              </div>
              <button className="btn small" disabled={entrando !== null} onClick={() => entrar(a.id)}>
                {entrando === a.id ? 'Entrando…' : datos.dentroDe === a.id ? 'Volver a entrar' : 'Entrar'}
              </button>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
