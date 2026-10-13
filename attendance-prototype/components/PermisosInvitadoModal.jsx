'use client';
/**
 * components/PermisosInvitadoModal.jsx — Permisos de UNA persona Invitada.
 *
 * El catálogo (secciones, módulos, acciones, perfiles) viene del servidor
 * (GET /api/roles/invitado ← lib/roles.js), así que esta pantalla no repite
 * reglas: solo las muestra y arma el borrador. Las reglas de verdad las
 * aplica el servidor al guardar (normalizar) y en cada endpoint.
 *
 * Reglas del borrador, las mismas que normaliza el servidor:
 *  · las `vista` (pantallas del panel) se apagan, pero siempre queda una:
 *    sin ninguna la persona no podría entrar;
 *  · lo `soloPropietario` se ve, pero apagado y bloqueado;
 *  · apagar «Ver» de un módulo apaga sus demás acciones; encender cualquier
 *    otra acción enciende lo que requiere («Ver», o p. ej. «Ver reportes»).
 */
import { useEffect, useMemo, useState } from 'react';

const clave = (m, a) => `${m.clave}:${a.clave}`;

/**
 * Ayuda «?» del modal. Mismo aspecto que la del panel (.q-ico/.q-tip), pero
 * el globo va con position: fixed calculado desde el ícono: la lista tiene
 * su propio scroll y un globo absolute quedaba recortado por ella. Se ubica
 * arriba (o abajo si no cabe) y nunca se sale de la pantalla.
 */
function AyudaModal({ texto }) {
  const [pos, setPos] = useState(null);
  const ANCHO = 260, MARGEN = 8;
  const mostrar = (e) => {
    const r = e.currentTarget.getBoundingClientRect();
    const left = Math.min(Math.max(r.left + r.width / 2 - ANCHO / 2, MARGEN), window.innerWidth - ANCHO - MARGEN);
    const arriba = r.top > 140; // si no hay espacio arriba, se abre hacia abajo
    // Los dos lados explícitos: .q-tip trae `bottom` puesto y top + bottom lo estiraba.
    setPos(arriba
      ? { left, top: 'auto', bottom: window.innerHeight - r.top + 8 }
      : { left, top: r.bottom + 8, bottom: 'auto' });
  };
  return (
    <span className="q-ico" tabIndex={0} aria-label={texto}
      onMouseEnter={mostrar} onFocus={mostrar} onMouseLeave={() => setPos(null)} onBlur={() => setPos(null)}>
      ?
      {pos && (
        <span className="q-tip pinv-tip" role="tooltip"
          style={{ display: 'block', position: 'fixed', transform: 'none', width: ANCHO, zIndex: 1000, ...pos }}>
          {texto}
        </span>
      )}
    </span>
  );
}
const mismoConjunto = (a, b) => a.size === b.size && [...a].every((k) => b.has(k));

export default function PermisosInvitadoModal({ persona, datos, guardando = false, onCancelar, onGuardar, Ayuda }) {
  const { secciones = [], modulos = [], perfiles = [] } = datos;
  const original = useMemo(() => new Set(datos.permisos), [datos.permisos]);
  const [borrador, setBorrador] = useState(() => new Set(datos.permisos));
  const [abiertos, setAbiertos] = useState({}); // módulo → desplegado

  // Lo que se le puede dar (sin lo del Propietario): base del contador.
  const asignables = useMemo(
    () => modulos.flatMap((m) => m.acciones.filter((a) => !a.soloPropietario).map((a) => clave(m, a))),
    [modulos],
  );
  // Vistas del panel: se apagan, pero debe quedar al menos una.
  const vistas = useMemo(() => modulos.flatMap((m) => m.acciones.filter((a) => a.vista).map((a) => clave(m, a))), [modulos]);
  const vistasActivas = vistas.filter((k) => borrador.has(k));
  const activos = asignables.filter((k) => borrador.has(k)).length;
  const hayCambios = !mismoConjunto(borrador, original);
  // «Personalizado» se elige a mano (despliega los módulos) o queda solo
  // cuando la combinación no coincide con ningún perfil.
  const [manual, setManual] = useState(false);
  const perfilActivo = manual ? 'personalizado'
    : perfiles.find((p) => mismoConjunto(new Set(p.permisos), borrador))?.clave ?? 'personalizado';
  const personalizar = () => {
    setManual(true);
    setAbiertos(Object.fromEntries(modulos.map((m) => [m.clave, true])));
  };

  // Esc = Cancelar.
  useEffect(() => {
    const tecla = (e) => { if (e.key === 'Escape' && !guardando) { e.preventDefault(); onCancelar(); } };
    window.addEventListener('keydown', tecla);
    return () => window.removeEventListener('keydown', tecla);
  }, [guardando, onCancelar]);

  /** Lo que una acción necesita encendido: su «Ver», o lo que diga `requiere`. */
  const requisito = (a) => (a.clave === 'ver' || a.vista ? null : a.requiere ?? 'ver');

  /** Cambia acciones respetando dependencias, vistas y lo del Propietario. */
  const cambiar = (m, acciones, encender) => setBorrador((antes) => {
    const s = new Set(antes);
    const apagadas = [];
    for (const a of acciones) {
      if (a.soloPropietario) continue;
      const k = clave(m, a);
      if (encender) {
        s.add(k);
        if (requisito(a)) s.add(`${m.clave}:${requisito(a)}`);
      } else {
        s.delete(k);
        if (a.vista) apagadas.push(k);
        // Lo que dependía de esta acción se apaga con ella.
        for (const o of m.acciones) if (requisito(o) === a.clave) s.delete(clave(m, o));
      }
    }
    // Sin ninguna vista no se puede entrar al panel: se conserva la primera apagada.
    if (!vistas.some((k) => s.has(k))) s.add(apagadas[0] ?? vistas[0]);
    return s;
  });

  const aplicarPerfil = (p) => { setManual(false); setBorrador(new Set(p.permisos)); };
  const restablecer = () => aplicarPerfil(perfiles.find((p) => p.clave === 'admin') ?? { permisos: asignables });

  return (
    <div className="overlay" onClick={(e) => e.target === e.currentTarget && !guardando && onCancelar()}>
      <div className="dialog pinv" role="dialog" aria-modal="true" aria-labelledby="pinv-titulo">
        <style>{CSS}</style>
        <h3 id="pinv-titulo">Permisos de {persona?.email || persona?.nombre}</h3>
        <p className="hint">Solo aplica a esta persona Invitada. De entrada puede lo mismo que un Administrador, salvo lo que es solo del Propietario.</p>

        {/* div y no fieldset: un fieldset no respeta min-height: 0 dentro de un
            flex, la lista crecía fuera de la ventana y lo de abajo no se veía.
            Mientras guarda, inert bloquea los clics como hacía el disabled. */}
        <div className="pinv-cuerpo" inert={guardando} aria-busy={guardando}>
          {/* Perfiles rápidos */}
          <div className="pinv-perfiles" role="radiogroup" aria-label="Perfil rápido">
            {perfiles.map((p) => (
              <button
                key={p.clave} type="button" role="radio" aria-checked={perfilActivo === p.clave}
                className={`pinv-perfil${perfilActivo === p.clave ? ' on' : ''}`}
                onClick={() => aplicarPerfil(p)}
              >
                {p.etiqueta}
              </button>
            ))}
            {/* Personalizado: parte de lo marcado y abre todos los módulos para
                ajustarlo a mano. También se enciende solo al cambiar algo. */}
            <button type="button" role="radio" aria-checked={perfilActivo === 'personalizado'}
              className={`pinv-perfil${perfilActivo === 'personalizado' ? ' on' : ''}`}
              title="Ajustar permiso por permiso" onClick={personalizar}>
              Personalizado
            </button>
          </div>

          {/* Progreso */}
          <div className="pinv-progreso">
            <div className="pinv-barra" role="progressbar" aria-valuemin={0} aria-valuemax={asignables.length} aria-valuenow={activos}
              aria-label="Permisos activos">
              <div style={{ width: `${asignables.length ? (activos / asignables.length) * 100 : 0}%` }} />
            </div>
            <small>{activos} de {asignables.length} permisos activos</small>
          </div>

          <div className="pinv-lista">
            {secciones.map((sec) => (
              <section key={sec.clave} className="pinv-seccion">
                <h4>{sec.etiqueta}</h4>
                {modulos.filter((m) => m.seccion === sec.clave).map((m) => {
                  const propias = m.acciones.filter((a) => !a.soloPropietario);
                  const n = propias.filter((a) => borrador.has(clave(m, a))).length;
                  const editables = propias;
                  const nEdit = editables.filter((a) => borrador.has(clave(m, a))).length;
                  const abierto = !!abiertos[m.clave];
                  return (
                    <div key={m.clave} className={`pinv-modulo${abierto ? ' abierto' : ''}`}>
                      <div className="pinv-mod-cab">
                        <input
                          type="checkbox" aria-label={`Todas las acciones de ${m.etiqueta}`}
                          checked={n === propias.length} disabled={editables.length === 0}
                          ref={(el) => { if (el) el.indeterminate = nEdit > 0 && n < propias.length; }}
                          onChange={(e) => cambiar(m, editables, e.target.checked)}
                        />
                        <button type="button" className="pinv-mod-nombre" aria-expanded={abierto}
                          onClick={() => setAbiertos((s) => ({ ...s, [m.clave]: !abierto }))}>
                          <span className="pinv-chev" aria-hidden="true">{abierto ? '▾' : '▸'}</span>
                          {m.etiqueta}
                        </button>
                        <AyudaModal texto={m.ayuda} />
                        <small className="pinv-cuenta">{n} de {propias.length}</small>
                      </div>
                      {abierto && (
                        <ul className="pinv-acciones">
                          {m.acciones.map((a) => {
                            const k = clave(m, a);
                            // La última vista encendida no se apaga: es la puerta de entrada.
                            const ultimaVista = a.vista && vistasActivas.length === 1 && borrador.has(k);
                            const bloqueada = a.soloPropietario || ultimaVista;
                            return (
                              <li key={k} className={bloqueada ? 'bloq' : undefined}>
                                <label>
                                  <input
                                    type="checkbox" checked={!a.soloPropietario && borrador.has(k)} disabled={bloqueada}
                                    title={ultimaVista ? 'Debe quedar al menos una vista del panel para que pueda entrar' : undefined}
                                    onChange={(e) => cambiar(m, [a], e.target.checked)}
                                  />
                                  <span>{a.etiqueta}</span>
                                </label>
                                <span className="pinv-etiquetas">
                                  {ultimaVista && <span className="chip neutral" title="Sin ninguna vista no podría entrar al panel">Mínimo para entrar</span>}
                                  {a.sensible && <span className="chip warn">Sensible</span>}
                                  {a.soloPropietario && <span className="chip crit" title="Ni la interfaz ni el servidor se lo permiten a un Invitado">Solo Propietario</span>}
                                </span>
                              </li>
                            );
                          })}
                        </ul>
                      )}
                    </div>
                  );
                })}
              </section>
            ))}
          </div>
        </div>

        <div className="dialog-actions pinv-pie">
          {hayCambios && <span className="pinv-aviso" role="status">Hay cambios sin guardar</span>}
          <button type="button" className="btn" onClick={restablecer} disabled={guardando}
            title="Todo activado, menos lo exclusivo del Propietario">Restablecer</button>
          <button type="button" className="btn" onClick={onCancelar} disabled={guardando}>Cancelar</button>
          <button type="button" className="btn primary" onClick={() => onGuardar([...borrador])} disabled={guardando || !hayCambios}>
            {guardando ? 'Guardando…' : 'Guardar'}
          </button>
        </div>
      </div>
    </div>
  );
}

const CSS = `
.dialog.pinv { max-width: 640px; max-height: calc(100dvh - 32px); display: flex; flex-direction: column; overflow: hidden; }
.pinv-cuerpo { border: 0; padding: 0; margin: 0; min-width: 0; display: flex; flex-direction: column; gap: 10px; min-height: 0; flex: 1; }
.pinv-perfiles { display: flex; flex-wrap: wrap; gap: 6px; }
.pinv-perfil { font: inherit; font-size: 12.5px; padding: 5px 10px; border-radius: 999px; border: 1px solid var(--grid); background: var(--surface); color: var(--ink-2); cursor: pointer; }
.pinv-perfil.on { border-color: var(--accent); background: var(--accent-soft); color: var(--ink); font-weight: 600; }
.pinv-progreso { display: flex; align-items: center; gap: 10px; }
.pinv-progreso small { color: var(--muted); white-space: nowrap; font-size: 12px; }
.pinv-barra { flex: 1; height: 6px; border-radius: 999px; background: var(--grid); overflow: hidden; }
.pinv-barra > div { height: 100%; background: var(--accent); transition: width .2s; }
.pinv-lista { overflow-y: auto; overscroll-behavior: contain; min-height: 0; flex: 1 1 auto; padding-right: 2px; }
.pinv-seccion + .pinv-seccion { margin-top: 12px; }
.pinv-seccion h4 { font-size: 11.5px; text-transform: uppercase; letter-spacing: .04em; color: var(--muted); margin: 0 0 6px; }
.pinv-modulo { border: 1px solid var(--grid); border-radius: 8px; margin-bottom: 6px; }
.pinv-mod-cab { display: flex; align-items: center; gap: 8px; padding: 7px 10px; }
.pinv-mod-nombre { flex: 1; text-align: left; font: inherit; font-size: 13.5px; font-weight: 600; color: var(--ink); background: none; border: 0; padding: 0; cursor: pointer; display: flex; align-items: center; gap: 6px; }
.pinv-chev { color: var(--muted); width: 10px; }
.pinv-cuenta { color: var(--muted); font-size: 12px; white-space: nowrap; }
.pinv-acciones { list-style: none; margin: 0; padding: 4px 10px 8px 34px; border-top: 1px solid var(--grid); }
.pinv-acciones li { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 4px 0; font-size: 13px; }
.pinv-acciones li.bloq { color: var(--muted); }
.pinv-acciones label { display: flex; align-items: center; gap: 8px; cursor: pointer; }
.pinv-acciones li.bloq label { cursor: default; }
.pinv-etiquetas { display: flex; gap: 4px; flex-wrap: wrap; justify-content: flex-end; }
.pinv-pie { align-items: center; flex-wrap: wrap; margin-top: 12px; }
/* El globo fijo no lleva la flecha: su posición cambia según el espacio. */
.pinv-tip::after { display: none; }
.pinv-aviso { margin-right: auto; font-size: 12.5px; color: var(--warn-text); }
@media (max-width: 520px) {
  .pinv-acciones { padding-left: 12px; }
  .pinv-acciones li { flex-wrap: wrap; }
}
`;
