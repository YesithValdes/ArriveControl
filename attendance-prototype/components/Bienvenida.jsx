'use client';

/**
 * components/Bienvenida.jsx — La pantalla de suscripción del primer acceso.
 *
 * Dos mitades: a la izquierda lo que va a pasar (los días de prueba, cuándo y
 * cuánto se cobra, que se puede cancelar), y a la derecha los planes. Arriba a
 * la derecha, «Omitir» — visible, porque quien todavía no sabe si le sirve
 * tiene derecho a mirar primero.
 *
 * El precio y los planes vienen del SERVIDOR ya resueltos para esta empresa;
 * aquí no se calcula nada de dinero.
 */

import { useState } from 'react';

export default function Bienvenida({ empresa, plan, catalogo }) {
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState('');
  // Cuántos meses adelantar al precio de entrada.
  const [meses, setMeses] = useState(catalogo?.maxMesesEntrada ?? 1);

  const alPanel = () => { window.location.href = '/admin'; };

  const omitir = async () => {
    setOcupado(true);
    try {
      await fetch('/api/pago/omitir', { method: 'POST' });
    } catch { /* si falla, igual se entra: no vale la pena atascarlo aquí */ }
    alPanel();
  };

  /** Carga la librería de Bold una sola vez, cuando de verdad hace falta. */
  const cargarBold = () => new Promise((resolver, rechazar) => {
    if (window.BoldCheckout) { resolver(); return; }
    const s = document.createElement('script');
    s.src = 'https://checkout.bold.co/library/boldPaymentButton.js';
    s.async = true;
    s.onload = () => resolver();
    s.onerror = () => rechazar(new Error('no se pudo cargar la pasarela'));
    document.head.appendChild(s);
  });

  const pagar = async (planId) => {
    setError('');
    setOcupado(true);
    try {
      const r = await fetch('/api/pago/iniciar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ plan: planId, meses: catalogo.conEntrada ? meses : 1 }),
      });
      const d = await r.json().catch(() => null);
      if (!r.ok || !d?.ok) { setError(d?.error || 'No se pudo iniciar el pago.'); setOcupado(false); return; }
      // La pantalla queda resuelta pase lo que pase en la pasarela: si vuelve
      // sin pagar, entra al panel con su prueba en vez de toparse otra vez
      // con esto.
      await fetch('/api/pago/omitir', { method: 'POST' }).catch(() => {});
      await cargarBold();
      if (!window.BoldCheckout) throw new Error('la pasarela no quedó disponible');
      new window.BoldCheckout(d.checkout).open();
    } catch (e) {
      setError(`No se pudo abrir el pago: ${e.message}`);
      setOcupado(false);
    }
  };

  const dias = plan?.diasPrueba ?? 0;
  const hayPlanes = catalogo?.disponible && catalogo.planes?.length > 0;

  return (
    <main className="bv-page">
      <style>{CSS}</style>

      <header className="bv-top">
        <span className="bv-marca">CONTROL <span>REGISTRO</span></span>
        <button className="bv-omitir" onClick={omitir} disabled={ocupado}>Omitir</button>
      </header>

      <div className="bv-tarjeta">
        <section className="bv-izq">
          <h1>
            {catalogo?.conEntrada
              ? <>Empieza gratis,<br />sigue por US${catalogo.precioEntrada}</>
              : <>Elige tu plan</>}
          </h1>

          <dl className="bv-linea">
            <div>
              <dt>Hoy</dt>
              <dd>{dias} día{dias === 1 ? '' : 's'} gratis</dd>
            </div>
            {catalogo?.conEntrada && (
              <div>
                <dt>Al terminar</dt>
                <dd>US${catalogo.precioEntrada} al mes durante {catalogo.maxMesesEntrada} meses</dd>
              </div>
            )}
            <div>
              <dt>Siempre</dt>
              <dd>Cancela cuando quieras</dd>
            </div>
          </dl>

          <p className="bv-nota">
            {empresa} está en prueba. Si prefieres mirar primero, omite este paso: podrás
            suscribirte cuando quieras desde Ajustes → Plan.
          </p>
        </section>

        <section className="bv-der">
          {!hayPlanes && (
            <p className="bv-vacio">
              Los pagos en línea todavía no están habilitados. Entra al panel y escríbenos
              cuando quieras activar tu plan.
            </p>
          )}

          {hayPlanes && (
            <>
              <p className="bv-titulo">
                Tienes {catalogo.empleados} empleado{catalogo.empleados === 1 ? '' : 's'} registrado{catalogo.empleados === 1 ? '' : 's'}
              </p>

              {catalogo.conEntrada && (
                <div className="bv-meses" role="group" aria-label="Meses">
                  {Array.from({ length: catalogo.maxMesesEntrada }, (_, i) => i + 1).map((m) => (
                    <button
                      key={m}
                      className={`bv-mes${meses === m ? ' on' : ''}`}
                      onClick={() => setMeses(m)}
                      disabled={ocupado}
                    >
                      {m} mes{m === 1 ? '' : 'es'}
                      <em>US${catalogo.precioEntrada * m}</em>
                    </button>
                  ))}
                </div>
              )}

              <div className="bv-planes">
                {catalogo.planes.map((p) => (
                  <div key={p.id} className={`bv-plan${p.sugerido ? ' sugerido' : ''}${!p.alcanza ? ' corto' : ''}`}>
                    <div className="bv-plan-datos">
                      <b>{p.nombre}</b>
                      <span>Hasta {p.empleados} empleados</span>
                    </div>
                    <button
                      className={`bv-btn${p.sugerido ? ' primario' : ''}`}
                      disabled={ocupado || !p.alcanza}
                      onClick={() => pagar(p.id)}
                      title={!p.alcanza ? `Tienes ${catalogo.empleados} empleados y este plan cubre ${p.empleados}` : undefined}
                    >
                      {!p.alcanza
                        ? 'No alcanza'
                        : `US$${catalogo.conEntrada ? catalogo.precioEntrada * meses : p.precio}`}
                    </button>
                  </div>
                ))}
              </div>

              {error && <p className="bv-error" role="alert">{error}</p>}

              <p className="bv-pie">
                {catalogo.conEntrada
                  ? `Después de los ${catalogo.maxMesesEntrada} meses se renueva al precio del plan. `
                  : 'Se cobra por mes. '}
                Se paga en dólares con tarjeta. Sin permanencia.
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

.bv-meses { display: flex; gap: 8px; margin-bottom: 20px; }
.bv-mes {
  flex: 1; font: inherit; cursor: pointer; padding: 10px 6px; border-radius: 10px;
  background: #f7fafd; border: 1px solid #d8e2ee; color: #46586a;
  display: flex; flex-direction: column; align-items: center; gap: 2px; font-size: 12.5px; font-weight: 600;
}
.bv-mes em { font-style: normal; font-size: 15px; font-weight: 800; color: #233240; }
.bv-mes.on { border-color: #3a5570; background: #eaf1f8; }
.bv-mes:disabled { opacity: .6; cursor: default; }

.bv-planes { display: flex; flex-direction: column; gap: 10px; }
.bv-plan {
  display: flex; align-items: center; justify-content: space-between; gap: 14px;
  padding: 14px 16px; border-radius: 12px; border: 1px solid #d8e2ee; background: #fff;
}
.bv-plan.sugerido { border-color: #3a5570; border-width: 2px; }
.bv-plan.corto { opacity: .55; }
.bv-plan-datos b { display: block; font-size: 15px; font-weight: 800; }
.bv-plan-datos span { font-size: 12.5px; color: #7b8ca0; }
.bv-btn {
  font: inherit; font-size: 14px; font-weight: 700; cursor: pointer; white-space: nowrap;
  padding: 10px 18px; border-radius: 9px; border: 1px solid #d8e2ee; background: #fff; color: #233240;
}
.bv-btn.primario { background: #3a5570; border-color: #3a5570; color: #fff; }
.bv-btn:hover:not(:disabled) { border-color: #6e96b8; }
.bv-btn:disabled { opacity: .5; cursor: default; }

.bv-error { margin: 14px 0 0; font-size: 13px; color: #b3403a; }
.bv-pie { margin: 18px 0 0; font-size: 12px; line-height: 1.55; color: #7b8ca0; }
.bv-luego {
  margin-top: auto; padding-top: 20px; font: inherit; font-size: 13.5px; font-weight: 600;
  background: none; border: none; color: #557d9e; cursor: pointer; text-align: center;
}
.bv-luego:hover:not(:disabled) { text-decoration: underline; }
.bv-luego:disabled { opacity: .6; cursor: default; }
`;
