'use client';

/**
 * components/Bienvenida.jsx — La pantalla de suscripción del primer acceso.
 *
 * Dos mitades: a la izquierda lo que va a pasar (los días de prueba, cuándo y
 * cuánto se cobra, que se puede cancelar), y a la derecha los planes. Arriba a
 * la derecha, «Omitir» — visible, porque quien todavía no sabe si le sirve
 * tiene derecho a mirar primero.
 *
 * El precio y los planes vienen del SERVIDOR ya resueltos para esta empresa
 * (dólares y su equivalente en pesos con la TRM del día); aquí no se calcula
 * nada de dinero. El pago es una suscripción de Mercado Pago con débito
 * automático: se autoriza en la página de Mercado Pago.
 */

import { useState } from 'react';

const cop = (n) => `$${Number(n).toLocaleString('es-CO')}`;

export default function Bienvenida({ empresa, plan, catalogo, correo = '' }) {
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState('');
  const [email, setEmail] = useState(correo);

  const alPanel = () => { window.location.href = '/admin'; };

  const omitir = async () => {
    setOcupado(true);
    try {
      await fetch('/api/pago/omitir', { method: 'POST' });
    } catch { /* si falla, igual se entra: no vale la pena atascarlo aquí */ }
    alPanel();
  };

  const suscribir = async (planId) => {
    setError('');
    setOcupado(true);
    try {
      const r = await fetch('/api/pago/suscribir', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ plan: planId, email }),
      });
      const d = await r.json().catch(() => null);
      if (!r.ok || !d?.ok) { setError(d?.error || 'No se pudo iniciar el pago.'); setOcupado(false); return; }
      // La pantalla queda resuelta pase lo que pase en Mercado Pago: si vuelve
      // sin autorizar, entra al panel con su prueba.
      await fetch('/api/pago/omitir', { method: 'POST' }).catch(() => {});
      // El servidor ya verificó que es una página de Mercado Pago.
      window.location.href = d.initPoint;
    } catch (e) {
      setError(`No se pudo abrir el pago: ${e.message}`);
      setOcupado(false);
    }
  };

  const dias = plan?.diasPrueba ?? 0;
  const pesos = catalogo?.pesos;
  const hayPlanes = catalogo?.disponible && catalogo.planes?.length > 0 && pesos;

  return (
    <main className="bv-page">
      <style>{CSS}</style>

      <header className="bv-top">
        <span className="bv-marca">ASISTENC<span>IA</span></span>
        <button className="bv-omitir" onClick={omitir} disabled={ocupado}>Omitir</button>
      </header>

      <div className="bv-tarjeta">
        <section className="bv-izq">
          <h1>
            {catalogo?.conEntrada
              ? <>Empieza gratis,<br />tu primer mes a US${catalogo.precioEntrada}</>
              : <>Elige tu plan</>}
          </h1>

          <dl className="bv-linea">
            <div>
              <dt>Hoy</dt>
              <dd>{dias} día{dias === 1 ? '' : 's'} gratis</dd>
            </div>
            {catalogo?.conEntrada && (
              <div>
                <dt>Primer mes</dt>
                <dd>US${catalogo.precioEntrada}{pesos?.entrada ? ` (≈ ${cop(pesos.entrada.cop)})` : ''}</dd>
              </div>
            )}
            <div>
              <dt>Después</dt>
              <dd>Débito automático cada mes</dd>
            </div>
            <div>
              <dt>Siempre</dt>
              <dd>Cancela cuando quieras</dd>
            </div>
          </dl>

          <p className="bv-nota">
            {empresa} está en prueba. Puedes omitir esto y suscribirte luego desde Ajustes → Plan.
          </p>
        </section>

        <section className="bv-der">
          {!hayPlanes && (
            <p className="bv-vacio">Pagos en línea aún no habilitados. Entra al panel y escríbenos para activar tu plan.</p>
          )}

          {hayPlanes && (
            <>
              <p className="bv-titulo">
                Tienes {catalogo.empleados} empleado{catalogo.empleados === 1 ? '' : 's'} registrado{catalogo.empleados === 1 ? '' : 's'}
              </p>

              <label className="bv-correo">
                Correo de tu cuenta de Mercado Pago
                <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} disabled={ocupado} autoComplete="email" />
              </label>

              <div className="bv-planes">
                {catalogo.planes.map((p) => {
                  const enPesos = pesos.planes[p.id]?.cop;
                  return (
                    <div key={p.id} className={`bv-plan${p.sugerido ? ' sugerido' : ''}${!p.alcanza ? ' corto' : ''}`}>
                      <div className="bv-plan-datos">
                        <b>{p.nombre}</b>
                        <span>Hasta {p.empleados} empleados · US${p.precio}/mes (≈ {cop(enPesos)})</span>
                      </div>
                      <button
                        className={`bv-btn${p.sugerido ? ' primario' : ''}`}
                        disabled={ocupado || !p.alcanza}
                        onClick={() => suscribir(p.id)}
                        title={!p.alcanza ? `Tienes ${catalogo.empleados} empleados y este plan cubre ${p.empleados}` : undefined}
                      >
                        {!p.alcanza ? 'No alcanza' : 'Suscribirme'}
                      </button>
                    </div>
                  );
                })}
              </div>

              {error && <p className="bv-error" role="alert">{error}</p>}

              <p className="bv-pie">
                {catalogo.conEntrada
                  ? `El primer cobro es de US$${catalogo.precioEntrada}; desde el segundo mes, el precio del plan. `
                  : 'Se cobra cada mes. '}
                Precios en dólares; Mercado Pago cobra en pesos con la TRM del día
                ({cop(pesos.trm)} por dólar). Sin permanencia.
              </p>
            </>
          )}

          <button className="bv-luego" onClick={omitir} disabled={ocupado}>
            {ocupado ? 'Un momento…' : `Mirar primero · me quedan ${dias} día${dias === 1 ? '' : 's'}`}
          </button>
        </section>
      </div>
    </main>
  );
}

const CSS = `
.bv-page {
  min-height: 100dvh; background: #0f172a; color: #e6edf5;
  font-family: var(--f-body, Montserrat), system-ui, sans-serif;
  display: flex; flex-direction: column; padding: 20px;
}
.bv-top { display: flex; align-items: center; justify-content: space-between; margin-bottom: 28px; }
.bv-marca { font-size: 13px; font-weight: 800; letter-spacing: .12em; color: #fff; }
.bv-marca span { color: #7ba6c9; }
.bv-omitir {
  font: inherit; font-size: 14px; font-weight: 700; color: #e6edf5; cursor: pointer;
  background: #1e293b; border: 1px solid #334155; border-radius: 10px; padding: 9px 20px;
}
.bv-omitir:hover:not(:disabled) { background: #293548; }
.bv-omitir:disabled { opacity: .5; cursor: default; }

.bv-tarjeta {
  width: 100%; max-width: 1000px; margin: auto;
  display: grid; grid-template-columns: 1fr 1fr; gap: 0;
  border-radius: 20px; overflow: hidden; box-shadow: 0 24px 60px rgba(0,0,0,.45);
}
@media (max-width: 860px) { .bv-tarjeta { grid-template-columns: 1fr; } }

.bv-izq { background: #16202c; padding: 44px 40px; display: flex; flex-direction: column; }
.bv-izq h1 { margin: 0 0 32px; font-size: clamp(28px, 4vw, 40px); line-height: 1.15; letter-spacing: -.03em; font-weight: 800; }
.bv-linea { margin: 0; display: flex; flex-direction: column; gap: 0; }
.bv-linea > div { display: flex; justify-content: space-between; gap: 16px; padding: 14px 0; border-bottom: 1px solid #263445; }
.bv-linea > div:last-child { border-bottom: none; }
.bv-linea dt { color: #8698ab; font-size: 14px; }
.bv-linea dd { margin: 0; font-size: 14px; font-weight: 600; text-align: right; }
.bv-nota { margin: 28px 0 0; font-size: 13px; line-height: 1.6; color: #8698ab; }

.bv-der { background: #fff; color: #233240; padding: 36px 32px; display: flex; flex-direction: column; }
.bv-titulo { margin: 0 0 16px; font-size: 13.5px; color: #7b8ca0; }
.bv-vacio { margin: 0 0 20px; font-size: 14px; line-height: 1.6; color: #46586a; }

.bv-correo { display: flex; flex-direction: column; gap: 6px; font-size: 12.5px; color: #46586a; margin-bottom: 16px; }
.bv-correo input { font: inherit; font-size: 14px; padding: 9px 11px; border: 1px solid #d8e2ee; border-radius: 9px; color: #233240; }

.bv-planes { display: flex; flex-direction: column; gap: 10px; }
.bv-plan {
  display: flex; align-items: center; justify-content: space-between; gap: 14px;
  padding: 14px 16px; border-radius: 12px; border: 1px solid #d8e2ee; background: #fff;
}
.bv-plan.sugerido { border-color: #1e3a5f; border-width: 2px; }
.bv-plan.corto { opacity: .55; }
.bv-plan-datos b { display: block; font-size: 15px; font-weight: 800; }
.bv-plan-datos span { font-size: 12.5px; color: #7b8ca0; }
.bv-btn {
  font: inherit; font-size: 14px; font-weight: 700; cursor: pointer; white-space: nowrap;
  padding: 10px 18px; border-radius: 9px; border: 1px solid #d8e2ee; background: #fff; color: #233240;
}
.bv-btn.primario { background: #1e3a5f; border-color: #1e3a5f; color: #fff; }
.bv-btn:hover:not(:disabled) { border-color: #2b6cb0; }
.bv-btn:disabled { opacity: .5; cursor: default; }

.bv-error { margin: 14px 0 0; font-size: 13px; color: #b3403a; }
.bv-pie { margin: 18px 0 0; font-size: 12px; line-height: 1.55; color: #7b8ca0; }
.bv-luego {
  margin-top: auto; padding-top: 20px; font: inherit; font-size: 13.5px; font-weight: 600;
  background: none; border: none; color: #1f5a99; cursor: pointer; text-align: center;
}
.bv-luego:hover:not(:disabled) { text-decoration: underline; }
.bv-luego:disabled { opacity: .6; cursor: default; }
`;
