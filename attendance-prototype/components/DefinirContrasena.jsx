'use client';

/**
 * components/DefinirContrasena.jsx — El último paso del registro.
 *
 * Se ve una sola vez, justo después de entrar con Google por primera vez.
 *
 * Por qué es obligatorio y no un ajuste escondido: Google NO permite iniciar
 * sesión dentro de la ventana de una app de Android. Sin una contraseña de
 * esta app, esa persona NO va a poder abrir el panel desde su celular — y lo
 * va a descubrir el día que lo necesite, lejos del computador, sin entender
 * por qué. Mejor pedirla ahora, que está sentada y atenta.
 *
 * Google sigue siendo la puerta principal: es quien verifica el correo. Esto
 * es una segunda llave para los sitios donde Google no funciona.
 */
import { useState } from 'react';

/**
 * @param {{correo: string, alTerminar?: () => void}} props
 *   Sin `alTerminar` recarga la página: quien la monta desde un componente de
 *   servidor no puede pasarle una función, y al recargar el servidor vuelve a
 *   comprobar la contraseña y esta vez deja pasar al panel.
 */
export default function DefinirContrasena({ correo, alTerminar }) {
  const [clave, setClave] = useState('');
  const [repetida, setRepetida] = useState('');
  const [verla, setVerla] = useState(false);
  const [error, setError] = useState(null);
  const [guardando, setGuardando] = useState(false);

  const corta = clave.length > 0 && clave.length < 8;
  const noCoinciden = repetida.length > 0 && clave !== repetida;
  const lista = clave.length >= 8 && clave === repetida;

  const guardar = async (e) => {
    e.preventDefault();
    setError(null);
    setGuardando(true);
    try {
      const r = await fetch('/api/cuenta/contrasena', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contrasena: clave }),
      });
      const d = await r.json().catch(() => null);
      if (!r.ok || !d?.ok) { setError(d?.error ?? `El servidor respondió ${r.status}.`); return; }
      if (alTerminar) alTerminar(); else window.location.reload();
    } catch (err) {
      setError(`Sin conexión con el servidor: ${err.message}`);
    } finally {
      setGuardando(false);
    }
  };

  return (
    <main className="dc-page">
      <style>{CSS}</style>

      <form className="dc-card" onSubmit={guardar}>
        <p className="dc-brand">ARRIVE<span>CONTROL</span></p>
        <h1>Crea tu contraseña</h1>
        <p className="dc-sub">
          Ya entraste con Google. Ponle ahora una contraseña a ArriveControl para poder
          entrar <b>desde el celular</b>, donde Google no funciona.
        </p>

        <div className="dc-correo">{correo}</div>

        <label className="dc-campo">
          <span>Contraseña</span>
          <input
            type={verla ? 'text' : 'password'}
            autoFocus
            autoComplete="new-password"
            value={clave}
            onChange={(e) => setClave(e.target.value)}
            aria-invalid={corta || undefined}
          />
        </label>

        <label className="dc-campo">
          <span>Repítela</span>
          <input
            type={verla ? 'text' : 'password'}
            autoComplete="new-password"
            value={repetida}
            onChange={(e) => setRepetida(e.target.value)}
            aria-invalid={noCoinciden || undefined}
          />
        </label>

        <label className="dc-ver">
          <input type="checkbox" checked={verla} onChange={(e) => setVerla(e.target.checked)} />
          <span>Mostrar lo que escribo</span>
        </label>

        {/* Un solo aviso a la vez, y solo cuando ya hay algo escrito: avisar de
            «muy corta» mientras alguien teclea la primera letra es ruido. */}
        {corta && <p className="dc-aviso">Debe tener al menos 8 caracteres.</p>}
        {!corta && noCoinciden && <p className="dc-aviso">Las dos no coinciden.</p>}
        {error && <p className="dc-aviso dc-error">{error}</p>}

        <button className="dc-btn" type="submit" disabled={!lista || guardando}>
          {guardando ? 'Guardando…' : 'Guardar y continuar'}
        </button>

        <p className="dc-nota">
          ¿La olvidas? Entra con Google desde el computador y ponte otra. No hay correos
          de recuperación que esperar.
        </p>
      </form>
    </main>
  );
}

const CSS = `
.dc-page {
  min-height: 100dvh; display: grid; place-items: center; padding: 24px;
  background: var(--page); color: var(--ink); font-family: var(--f-body); font-weight: 300;
}
.dc-page * { box-sizing: border-box; margin: 0; }
.dc-card {
  width: 100%; max-width: 400px; display: flex; flex-direction: column; gap: 14px;
  background: var(--surface); border: 1px solid var(--border);
  border-radius: var(--r-lg); box-shadow: var(--elev-2); padding: 30px 26px;
}
.dc-brand {
  font-family: var(--f-display); font-size: 10.5px; letter-spacing: .16em;
  font-weight: 700; color: var(--muted);
}
.dc-brand span { color: var(--accent); }
.dc-card h1 { font-family: var(--f-display); font-size: 23px; font-weight: 700; letter-spacing: -.015em; }
.dc-sub { font-size: 14px; line-height: 1.55; color: var(--ink-2); }
.dc-correo {
  font-family: var(--f-data); font-size: 13px; color: var(--ink-2);
  background: var(--accent-soft); border-radius: var(--r-sm); padding: 9px 12px;
}
.dc-campo { display: flex; flex-direction: column; gap: 5px; }
.dc-campo span { font-size: 12.5px; font-weight: 600; color: var(--ink-2); }
.dc-campo input {
  font: inherit; font-size: 16px; padding: 11px 13px; border-radius: var(--r-sm);
  border: 1px solid var(--border); background: var(--page); color: var(--ink);
}
.dc-campo input:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }
.dc-campo input[aria-invalid="true"] { border-color: var(--crit); }
.dc-ver { display: flex; align-items: center; gap: 8px; font-size: 13px; color: var(--ink-2); cursor: pointer; }
.dc-ver input { accent-color: var(--accent); cursor: pointer; }
.dc-aviso { font-size: 13px; color: var(--warn-text); }
.dc-aviso.dc-error { color: var(--crit-text); }
.dc-btn {
  font: inherit; font-size: 15px; font-weight: 600; padding: 12px;
  border: 0; border-radius: var(--r-sm); background: var(--btn-primary); color: var(--accent-ink);
  cursor: pointer; margin-top: 4px;
}
.dc-btn:hover:not(:disabled) { background: var(--btn-primary-hover); }
.dc-btn:disabled { opacity: .45; cursor: not-allowed; }
.dc-nota { font-size: 12.5px; line-height: 1.5; color: var(--muted); }
`;
