'use client';

/**
 * components/PlataformaPanel.jsx — Consola de la plataforma (solo superadmin).
 *
 * No es un panel de asistencia: es la herramienta de operación del negocio.
 * Se entra a ella con una pregunta concreta —¿cuáles de estos esquemas sobran?—
 * y por eso está ordenada para responderla: primero el agregado, después la
 * tabla, y las empresas abandonadas arriba.
 *
 * El estado se codifica en la FORMA además de en el número: cada fila lleva un
 * riel de color a la izquierda, así el ojo encuentra las inactivas sin leer.
 *
 * Eliminar exige teclear el nombre del esquema — la misma protección que usa
 * GitHub para borrar un repositorio.
 */
import { useEffect, useMemo, useState } from 'react';
import { signOut } from '../lib/auth-client';

const nf = new Intl.NumberFormat('es-CO');

const fmtFecha = (iso) =>
  iso ? new Date(iso).toLocaleDateString('es-CO', { day: 'numeric', month: 'short', year: 'numeric' }) : '—';

/** Días sin actividad: el criterio para decidir si una empresa sobra. */
const diasSinUso = (e) => {
  const ultimo = e.ultimaMarcacion ?? e.ultimoAcceso ?? e.creadaEn;
  return Math.floor((Date.now() - new Date(ultimo).getTime()) / 86400000);
};

/**
 * «hace 3 días» se escanea más rápido que «7 ago 2026» cuando lo que se busca
 * es antigüedad. La fecha exacta queda en el title, para quien la necesite.
 */
const haceCuanto = (dias) => {
  if (dias <= 0) return 'hoy';
  if (dias === 1) return 'ayer';
  if (dias < 30) return `hace ${dias} días`;
  if (dias < 60) return 'hace un mes';
  if (dias < 365) return `hace ${Math.floor(dias / 30)} meses`;
  return dias < 730 ? 'hace un año' : `hace ${Math.floor(dias / 365)} años`;
};

/**
 * Estado de la SUSCRIPCIÓN, que es distinto del uso: una empresa puede estar
 * marcando todos los días con la suscripción vencida, y al revés.
 *
 * La consola no lo mostraba —se veía el plan, no si estaba vigente— así que
 * para saber a quién había que cobrarle tocaba entrar a la base de datos.
 */
function suscripcion(e) {
  const dias = (f) => Math.ceil((new Date(f).getTime() - Date.now()) / 86400000);
  if (e.venceEn && new Date(e.venceEn) > new Date()) {
    const d = dias(e.venceEn);
    return { etiqueta: `Paga · ${d} d`, tono: d <= 7 ? 'warn' : 'good', detalle: `Vence el ${fmtFecha(e.venceEn)}` };
  }
  if (e.pruebaHasta && new Date(e.pruebaHasta) > new Date()) {
    const d = dias(e.pruebaHasta);
    return { etiqueta: `Prueba · ${d} d`, tono: d <= 1 ? 'warn' : 'info', detalle: `La prueba termina el ${fmtFecha(e.pruebaHasta)}` };
  }
  if (e.venceEn || e.pruebaHasta) {
    const cuando = e.venceEn ?? e.pruebaHasta;
    return { etiqueta: 'Vencida', tono: 'crit', detalle: `Sin acceso desde el ${fmtFecha(cuando)}` };
  }
  return { etiqueta: 'Sin plan', tono: 'crit', detalle: 'Nunca tuvo prueba ni suscripción' };
}

/** Los tres estados que importan, en orden de urgencia para quien limpia. */
function salud(e) {
  if (e.esquemaRoto) return { clave: 'rota', etiqueta: 'Esquema roto', tono: 'crit' };
  const d = diasSinUso(e);
  if (d > 30) return { clave: 'inactiva', etiqueta: 'Abandonada', tono: 'crit' };
  if (d > 7) return { clave: 'inactiva', etiqueta: 'Sin uso', tono: 'warn' };
  return { clave: 'activa', etiqueta: 'Activa', tono: 'good' };
}

const FILTROS = [
  { clave: 'todas', etiqueta: 'Todas' },
  { clave: 'activa', etiqueta: 'Activas' },
  { clave: 'inactiva', etiqueta: 'Sin uso' },
  { clave: 'rota', etiqueta: 'Rotas' },
];

export default function PlataformaPanel({ sesion }) {
  const [empresas, setEmpresas] = useState(null); // null = cargando
  const [error, setError] = useState(null);
  const [filtro, setFiltro] = useState('');
  const [segmento, setSegmento] = useState('todas');
  const [borrando, setBorrando] = useState(null); // { empresa, confirmacion }
  const [regalando, setRegalando] = useState(null); // { empresa, dias, que }
  const [tareas, setTareas] = useState([]);         // últimas corridas programadas
  const [toast, setToast] = useState(null);

  const showToast = (m) => { setToast(m); setTimeout(() => setToast(null), 2800); };

  const cargar = () => {
    fetch('/api/plataforma/empresas')
      .then((r) => r.json())
      .then((d) => {
        if (d.ok) { setEmpresas(d.empresas); setTareas(d.tareas ?? []); setError(null); }
        else setError(d.error);
      })
      .catch((e) => setError(e.message));
  };
  useEffect(cargar, []);

  const cambiar = async (e, cambios) => {
    const r = await fetch(`/api/plataforma/empresas/${e.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(cambios),
    });
    const d = await r.json().catch(() => null);
    if (!r.ok || !d?.ok) { showToast(d?.error ?? `Error ${r.status}`); return; }
    showToast(`${e.nombre} actualizada`);
    cargar();
  };

  /** Regala días de prueba o de suscripción. Suma sobre lo que ya tenía. */
  const darDias = async () => {
    const { empresa, dias, que } = regalando;
    const r = await fetch(`/api/plataforma/empresas/${empresa.id}/dias`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ dias: Number(dias), que }),
    });
    const d = await r.json().catch(() => null);
    if (!r.ok || !d?.ok) { showToast(d?.error ?? `Error ${r.status}`); return; }
    const hasta = que === 'prueba' ? d.empresa?.pruebaHasta : d.empresa?.venceEn;
    setRegalando(null);
    showToast(`${empresa.nombre}: ${dias} días más${hasta ? `, hasta el ${fmtFecha(hasta)}` : ''}`);
    cargar();
  };

  const eliminar = async () => {
    const { empresa, confirmacion } = borrando;
    const r = await fetch(`/api/plataforma/empresas/${empresa.id}`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ confirmacion }),
    });
    const d = await r.json().catch(() => null);
    if (!r.ok || !d?.ok) { showToast(d?.error ?? `Error ${r.status}`); return; }
    setBorrando(null);
    showToast(`«${d.nombre}» eliminada`);
    cargar();
  };

  // Agregado de toda la plataforma: es lo primero que se quiere saber al
  // entrar, antes que cualquier empresa concreta.
  const resumen = useMemo(() => {
    if (!empresas) return null;
    const cuenta = { activa: 0, inactiva: 0, rota: 0 };
    let empleados = 0;
    let marcaciones = 0;
    // Del negocio, no del uso: cuántas pagan, cuántas están probando, cuántas
    // se cayeron, y cuánto dinero entró.
    let pagando = 0;
    let enPrueba = 0;
    let vencidas = 0;
    let pendientes = 0;
    let ingresos = 0;
    let moneda = '';
    for (const e of empresas) {
      cuenta[salud(e).clave]++;
      empleados += e.empleados ?? 0;
      marcaciones += e.marcaciones ?? 0;
      const s = suscripcion(e).etiqueta;
      if (s.startsWith('Paga')) pagando++;
      else if (s.startsWith('Prueba')) enPrueba++;
      else vencidas++;
      pendientes += e.pagosPendientes ?? 0;
      ingresos += e.totalPagado ?? 0;
      if (e.moneda) moneda = e.moneda;
    }
    return { total: empresas.length, ...cuenta, empleados, marcaciones, pagando, enPrueba, vencidas, pendientes, ingresos, moneda };
  }, [empresas]);

  const lista = useMemo(() => {
    if (!empresas) return [];
    const q = filtro.trim().toLowerCase();
    return empresas
      .filter((e) => segmento === 'todas' || salud(e).clave === segmento)
      .filter((e) => !q || e.nombre.toLowerCase().includes(q) || e.esquema.includes(q))
      // Las más abandonadas primero: es a lo que se viene a esta pantalla.
      .sort((a, b) => diasSinUso(b) - diasSinUso(a));
  }, [empresas, filtro, segmento]);

  const cerrarSesion = async () => {
    try {
      await signOut();
    } catch (e) {
      // Igual que en el panel de empresa: si la sesión no muere, redirigir
      // solo aparenta haber salido y el siguiente inicio de sesión reusa la
      // cuenta vieja. Es preferible avisar y no moverse.
      alert(`No se pudo cerrar la sesión: ${e?.message || 'inténtalo de nuevo'}`);
      return;
    }
    window.location.href = '/login';
  };

  return (
    <div className="plat-root">
      <style>{CSS}</style>

      <header className="plat-head">
        <div className="plat-id">
          <span className="brand">ASISTENC<span>IA</span></span>
          <h1>Consola de plataforma</h1>
        </div>
        <div className="quien">
          <span className="quien-mail">{sesion.email}</span>
          <button className="btn" onClick={cerrarSesion}>Salir</button>
        </div>
      </header>

      {resumen && (
        <section className="resumen" aria-label="Resumen de la plataforma">
          <div className="metrica">
            <span className="m-label">Empresas</span>
            <span className="m-valor">{nf.format(resumen.total)}</span>
          </div>
          <div className="metrica">
            <span className="m-label">En uso</span>
            <span className="m-valor good">{nf.format(resumen.activa)}</span>
          </div>
          <div className="metrica">
            <span className="m-label">Sin uso</span>
            <span className={`m-valor${resumen.inactiva > 0 ? ' warn' : ''}`}>{nf.format(resumen.inactiva)}</span>
          </div>
          <div className="metrica">
            <span className="m-label">Esquemas rotos</span>
            <span className={`m-valor${resumen.rota > 0 ? ' crit' : ''}`}>{nf.format(resumen.rota)}</span>
          </div>
          <div className="metrica ancha">
            <span className="m-label">Empleados</span>
            <span className="m-valor">{nf.format(resumen.empleados)}</span>
          </div>
          <div className="metrica ancha">
            <span className="m-label">Marcaciones</span>
            <span className="m-valor">{nf.format(resumen.marcaciones)}</span>
          </div>
        </section>
      )}

      {/* El NEGOCIO, aparte del uso: son preguntas distintas y se miran en
          momentos distintos. Arriba «quién usa esto»; aquí «quién paga». */}
      {resumen && (
        <section className="resumen negocio" aria-label="Resumen de suscripciones">
          <div className="metrica">
            <span className="m-label">Pagando</span>
            <span className="m-valor good">{nf.format(resumen.pagando)}</span>
          </div>
          <div className="metrica">
            <span className="m-label">En prueba</span>
            <span className="m-valor info">{nf.format(resumen.enPrueba)}</span>
          </div>
          <div className="metrica">
            <span className="m-label">Sin acceso</span>
            <span className={`m-valor${resumen.vencidas > 0 ? ' crit' : ''}`}>{nf.format(resumen.vencidas)}</span>
          </div>
          <div className="metrica">
            {/* Un pago pendiente viejo casi siempre es un webhook que no llegó:
                el cliente pagó y su plan no se activó. Duele no verlo. */}
            <span className="m-label">Pagos sin resolver</span>
            <span className={`m-valor${resumen.pendientes > 0 ? ' warn' : ''}`}>{nf.format(resumen.pendientes)}</span>
          </div>
          <div className="metrica ancha">
            <span className="m-label">Recaudado</span>
            <span className="m-valor">{nf.format(resumen.ingresos)} {resumen.moneda}</span>
          </div>
        </section>
      )}

      {/* Tareas programadas. Corren solas de madrugada y le mandan correos a
          los empleados de todas las empresas: si una noche fallan, esto tiene
          que decirlo antes de que lo note un cliente. */}
      <section className="tareas" aria-label="Tareas programadas">
        <span className="m-label">Envíos automáticos</span>
        {tareas.length === 0 ? (
          <p className="tarea-vacio">
            Sin corridas registradas todavía. El resumen diario sale entre las 11:00 y
            las 11:59 p. m.; si mañana esto sigue vacío, la tarea no se está disparando.
          </p>
        ) : (
          <div className="tarea-lista">
            {tareas.map((t) => {
              const d = t.detalle ?? {};
              return (
                <div className={`tarea ${t.estado}`} key={t.creadoEn}>
                  <span className={`chip ${t.estado === 'ok' ? 'good' : 'crit'}`}>
                    {t.estado === 'ok' ? 'Corrió' : 'Falló'}
                  </span>
                  <b>{t.tarea}</b>
                  <span className="tarea-cuando">
                    {new Date(t.creadoEn).toLocaleString('es-CO', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', hour12: true })}
                    {t.sobre ? ` · sobre el ${fmtFecha(t.sobre)}` : ''}
                  </span>
                  <span className="tarea-detalle">
                    {t.estado === 'ok'
                      ? `${d.enviados ?? 0} enviados${d.fallidos ? `, ${d.fallidos} fallidos` : ''}${d.sinCorreo ? `, ${d.sinCorreo} sin correo` : ''}`
                      : (d.error ?? 'sin detalle')}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </section>

      <div className="plat-controls">
        <div className="segmentos" role="tablist" aria-label="Filtrar por estado">
          {FILTROS.map((f) => (
            <button
              key={f.clave}
              role="tab"
              aria-selected={segmento === f.clave}
              className={segmento === f.clave ? 'activo' : ''}
              onClick={() => setSegmento(f.clave)}
            >
              {f.etiqueta}
            </button>
          ))}
        </div>
        <input
          className="buscar" type="search" placeholder="Buscar empresa o esquema…"
          value={filtro} onChange={(e) => setFiltro(e.target.value)}
        />
        {empresas && <span className="conteo">{lista.length} de {empresas.length}</span>}
      </div>

      {error && <p className="aviso crit">No se pudo cargar: {error}</p>}
      {empresas === null && !error && <p className="aviso">Cargando empresas…</p>}
      {empresas?.length === 0 && <p className="aviso">Todavía no hay empresas registradas.</p>}
      {empresas?.length > 0 && lista.length === 0 && (
        <p className="aviso">Ninguna empresa coincide con este filtro.</p>
      )}

      {lista.length > 0 && (
        <div className="tabla" role="table">
          <div className="fila cabecera" role="row">
            <span>Empresa</span>
            <span className="num">Usuarios</span>
            <span className="num">Empleados</span>
            <span className="num">Marcaciones</span>
            <span>Actividad</span>
            <span>Suscripción</span>
            <span>Plan</span>
            <span />
          </div>

          {lista.map((e) => {
            const s = salud(e);
            const sus = suscripcion(e);
            const dias = diasSinUso(e);
            return (
              <div className={`fila dato tono-${s.tono}`} role="row" key={e.id}>
                <div className="empresa">
                  <b>{e.nombre}</b>
                  <small>
                    <code>{e.esquema}</code>
                    {e.dominio ? ` · ${e.dominio}` : ''}
                    {e.nit ? ` · NIT ${e.nit}` : ''}
                  </small>
                </div>

                {/* `data-etq` es la etiqueta que aparece sobre el número
                    cuando la tabla se convierte en fichas (pantalla angosta):
                    sin encabezados, un número suelto no dice qué es. */}
                <span className="num" data-etq="Usuarios">{e.usuarios == null ? '—' : nf.format(e.usuarios)}</span>
                <span className="num" data-etq="Empleados">{e.empleados == null ? '—' : nf.format(e.empleados)}</span>
                <span className="num" data-etq="Marcaciones">{e.marcaciones == null ? '—' : nf.format(e.marcaciones)}</span>

                <div className="actividad">
                  <span className={`chip ${s.tono}`}>{s.etiqueta}</span>
                  <small title={`Creada el ${fmtFecha(e.creadaEn)}`}>
                    {e.esquemaRoto ? 'sin datos' : haceCuanto(dias)}
                  </small>
                </div>

                <div className="actividad" data-etq="Suscripción">
                  <span className={`chip ${sus.tono}`} title={sus.detalle}>{sus.etiqueta}</span>
                  <small>
                    {e.planId ? `plan ${e.planId}` : 'sin plan contratado'}
                    {e.pagosPendientes > 0 ? ` · ${e.pagosPendientes} pago sin resolver` : ''}
                  </small>
                  {/* Configuración a medias: una empresa sin rostros ni horarios
                      no llegó a usarse, por más que la suscripción esté al día.
                      Es la señal de que hay que llamarla, no cobrarle. */}
                  {!e.esquemaRoto && (e.empleados === 0 || e.conRostro === 0 || e.horarios === 0) && (
                    <small className="falta">
                      {e.empleados === 0 ? 'sin empleados'
                        : e.conRostro === 0 ? 'nadie con rostro registrado'
                          : 'sin horarios'}
                    </small>
                  )}
                </div>

                <div className="plan">
                  <select
                    aria-label={`Plan de ${e.nombre}`}
                    value={e.plan}
                    onChange={(ev) => cambiar(e, { plan: ev.target.value })}
                  >
                    <option value="gratis">Gratis · tope {e.limiteEmpleados ?? 10}</option>
                    <option value="pago">Pago · sin tope</option>
                  </select>
                  {e.plan === 'pago' && (
                    <select
                      aria-label={`Estado de suscripción de ${e.nombre}`}
                      className={e.estado !== 'activa' ? 'alerta' : ''}
                      value={e.estado}
                      onChange={(ev) => cambiar(e, { estado: ev.target.value })}
                    >
                      <option value="activa">Al día</option>
                      <option value="vencida">Vencida</option>
                      <option value="cancelada">Cancelada</option>
                    </select>
                  )}
                </div>

                <div className="acciones">
                  {/* Regalar días: cerrando una venta es lo más pedido, y
                      hasta ahora obligaba a entrar a la base a mano. */}
                  <button className="btn" onClick={() => setRegalando({ empresa: e, dias: 7, que: 'suscripcion' })}>
                    + Días
                  </button>
                  <button
                    className="btn ghost-danger"
                    onClick={() => setBorrando({ empresa: e, confirmacion: '' })}
                  >
                    Eliminar
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Regalar días de servicio */}
      {regalando && (
        <div className="velo" onClick={(ev) => ev.target === ev.currentTarget && setRegalando(null)}>
          <div className="dialogo" role="dialog" aria-modal="true" aria-labelledby="dlg-dias">
            <h3 id="dlg-dias">Días para «{regalando.empresa.nombre}»</h3>
            <p className="dlg-cuerpo">
              {suscripcion(regalando.empresa).detalle}. Los días se SUMAN a lo que ya
              tiene, así que regalar nunca le quita los que le quedaban.
            </p>
            <div className="dlg-campos">
              <label>
                Cuántos días
                <input
                  type="number" min="1" max="365" value={regalando.dias}
                  onChange={(ev) => setRegalando({ ...regalando, dias: ev.target.value })}
                />
              </label>
              <label>
                A qué
                <select
                  value={regalando.que}
                  onChange={(ev) => setRegalando({ ...regalando, que: ev.target.value })}
                >
                  <option value="suscripcion">Suscripción (le da acceso pago)</option>
                  <option value="prueba">Prueba gratuita</option>
                </select>
              </label>
            </div>
            <div className="dlg-botones">
              <button className="btn" onClick={() => setRegalando(null)}>Cancelar</button>
              <button
                className="btn primary"
                disabled={!(Number(regalando.dias) >= 1 && Number(regalando.dias) <= 365)}
                onClick={darDias}
              >
                Regalar {regalando.dias} días
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Confirmación de borrado: teclear el esquema, sin atajos */}
      {borrando && (
        <div className="velo" onClick={(ev) => ev.target === ev.currentTarget && setBorrando(null)}>
          <div className="dialogo" role="dialog" aria-modal="true" aria-labelledby="dlg-t">
            <h3 id="dlg-t">Eliminar «{borrando.empresa.nombre}»</h3>
            <p className="dlg-cuerpo">
              Se borra el esquema <code>{borrando.empresa.esquema}</code> completo:
              sus <b>{nf.format(borrando.empresa.usuarios ?? 0)}</b> usuario(s),
              sus <b>{borrando.empresa.empleados == null ? '?' : nf.format(borrando.empresa.empleados)}</b> empleado(s)
              y sus <b>{borrando.empresa.marcaciones == null ? '?' : nf.format(borrando.empresa.marcaciones)}</b> marcaciones.
            </p>
            <p className="dlg-alerta">Esto no se puede deshacer.</p>
            <label className="dlg-campo">
              <span>Escribe <code>{borrando.empresa.esquema}</code> para confirmar</span>
              <input
                type="text" autoFocus autoComplete="off" spellCheck="false"
                value={borrando.confirmacion}
                onChange={(ev) => setBorrando({ ...borrando, confirmacion: ev.target.value })}
              />
            </label>
            <div className="acciones">
              <button className="btn" onClick={() => setBorrando(null)}>Cancelar</button>
              <button
                className="btn danger"
                disabled={borrando.confirmacion.trim() !== borrando.empresa.esquema}
                onClick={eliminar}
              >
                Eliminar para siempre
              </button>
            </div>
          </div>
        </div>
      )}

      {toast && <div className="toast" role="status">{toast}</div>}
    </div>
  );
}

/* Todo el color sale de los tokens de app/globals.css: esta consola es parte
   del mismo producto y no puede tener su propia paleta. */
const CSS = `
.plat-root {
  font-family: var(--f-body);
  font-weight: 300;
  color: var(--ink);
  background: var(--page);
  min-height: 100dvh;
  max-width: 1180px;
  margin: 0 auto;
  padding: 26px 20px 60px;
  box-sizing: border-box;
}
.plat-root * { box-sizing: border-box; margin: 0; }
.plat-root b { font-weight: 600; }
.plat-root code {
  font-family: var(--f-data);
  font-size: .92em;
  background: var(--accent-soft);
  padding: 1px 5px;
  border-radius: 4px;
}

/* ── Cabecera ─────────────────────────────────────────────── */
.plat-head {
  display: flex; justify-content: space-between; align-items: flex-end;
  gap: 16px; padding-bottom: 16px; margin-bottom: 20px;
  border-bottom: 1px solid var(--border);
}
.plat-id { display: flex; flex-direction: column; gap: 6px; }
.brand {
  font-family: var(--f-display);
  font-size: 10.5px; letter-spacing: .16em; font-weight: 700; color: var(--muted);
}
.brand span { color: var(--accent); }
.plat-head h1 { font-family: var(--f-display); font-size: 22px; font-weight: 700; letter-spacing: -.01em; }
.quien { display: flex; align-items: center; gap: 12px; font-size: 13px; color: var(--ink-2); }
.quien-mail { font-family: var(--f-data); font-size: 12.5px; }

/* ── Resumen: el agregado antes del detalle ───────────────── */
.resumen {
  display: grid; grid-template-columns: repeat(6, 1fr); gap: 10px; margin-bottom: 22px;
}
.metrica {
  background: var(--surface); border: 1px solid var(--border); border-radius: var(--r-md);
  box-shadow: var(--elev-1); padding: 12px 14px;
  display: flex; flex-direction: column; gap: 2px;
}
.m-label {
  font-family: var(--f-display); font-size: 9.5px; letter-spacing: .09em;
  text-transform: uppercase; color: var(--muted); font-weight: 600;
}
.m-valor {
  font-family: var(--f-data); font-size: 25px; font-weight: 700; line-height: 1.15;
  font-variant-numeric: tabular-nums; color: var(--ink);
}
.m-valor.good { color: var(--good-text); }
.m-valor.warn { color: var(--warn-text); }
.m-valor.crit { color: var(--crit-text); }

/* ── Controles ────────────────────────────────────────────── */
.plat-controls { display: flex; align-items: center; gap: 12px; margin-bottom: 14px; flex-wrap: wrap; }
.segmentos {
  display: inline-flex; background: var(--surface); border: 1px solid var(--border);
  border-radius: var(--r-sm); padding: 2px; gap: 2px;
}
.segmentos button {
  font: inherit; font-size: 12.5px; font-weight: 600; color: var(--ink-2);
  border: 0; background: transparent; padding: 6px 13px; border-radius: 6px; cursor: pointer;
}
.segmentos button:hover { background: var(--accent-soft); }
.segmentos button.activo { background: var(--accent); color: var(--accent-ink); }
.buscar {
  flex: 1; min-width: 200px; font: inherit; font-size: 13.5px; padding: 9px 12px;
  border-radius: var(--r-sm); border: 1px solid var(--border);
  background: var(--surface); color: var(--ink);
}
.conteo { font-family: var(--f-data); font-size: 12px; color: var(--muted); white-space: nowrap; }

.aviso { color: var(--muted); font-size: 14px; padding: 26px 2px; }
.aviso.crit { color: var(--crit-text); }

/* ── Tabla ────────────────────────────────────────────────── */
.tabla { display: flex; flex-direction: column; }
.fila {
  display: grid;
  grid-template-columns: minmax(0, 1.9fr) 4.6rem 5rem 6.2rem 7.5rem 9.5rem 9.5rem 8.5rem;
  gap: 14px; align-items: center;
}
.fila.cabecera {
  padding: 0 14px 8px;
  font-family: var(--f-display); font-size: 9.5px; letter-spacing: .09em;
  text-transform: uppercase; color: var(--muted); font-weight: 600;
}
.fila.dato {
  background: var(--surface); border: 1px solid var(--border);
  border-left: 3px solid var(--grid);           /* riel de severidad */
  border-radius: var(--r-sm); box-shadow: var(--elev-1);
  padding: 11px 14px; margin-bottom: 7px;
}
.fila.dato.tono-good { border-left-color: var(--good-text); }
.fila.dato.tono-warn { border-left-color: var(--warn-text); }
.fila.dato.tono-crit { border-left-color: var(--crit); }

.empresa { display: flex; flex-direction: column; gap: 3px; min-width: 0; }
.empresa b { font-size: 14.5px; letter-spacing: -.01em; }
.empresa small {
  font-size: 11.5px; color: var(--muted);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.num {
  font-family: var(--f-data); font-size: 13.5px; font-variant-numeric: tabular-nums;
  text-align: right; color: var(--ink-2);
}
.fila.cabecera .num { font-family: var(--f-display); }

.actividad { display: flex; flex-direction: column; gap: 3px; align-items: flex-start; }
.actividad small { font-size: 11.5px; color: var(--muted); }
.chip {
  font-size: 11px; font-weight: 700; padding: 2px 9px; border-radius: 999px;
  white-space: nowrap; letter-spacing: .01em;
}
.chip.good { background: var(--good-soft); color: var(--good-text); }
.chip.warn { background: var(--warn-soft); color: var(--warn-text); }
.chip.crit { background: var(--crit-soft); color: var(--crit-text); }
/* Azul para «en prueba»: no es bueno ni malo, es un estado en curso. Pintarlo
   de verde diría que ya está resuelto y de rojo que algo falla. */
.chip.info { background: var(--accent-soft); color: var(--accent-2); }

/* La suscripción trae dos o tres renglones, así que la celda no centra. */
.actividad .falta { color: var(--warn-text); }
.acciones { display: flex; gap: 6px; align-items: center; justify-content: flex-end; flex-wrap: wrap; }

/* Los dos resúmenes son la misma rejilla; el de negocio va pegado al de
   arriba y con una línea que los separa sin gritar. */
.resumen.negocio { margin-top: -12px; padding-top: 16px; border-top: 1px solid var(--grid); }

.tareas { margin-bottom: 22px; padding-top: 16px; border-top: 1px solid var(--grid); }
.tarea-vacio { margin: 8px 0 0; font-size: 13px; color: var(--muted); line-height: 1.55; max-width: 62ch; }
.tarea-lista { display: flex; flex-direction: column; gap: 6px; margin-top: 8px; }
.tarea { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; font-size: 12.5px; }
.tarea b { font-weight: 650; color: var(--ink); }
.tarea-cuando { color: var(--muted); }
.tarea-detalle { color: var(--ink-2); margin-left: auto; font-variant-numeric: tabular-nums; }
.tarea.error .tarea-detalle { color: var(--crit-text); }
.dlg-campos { display: flex; gap: 14px; flex-wrap: wrap; margin: 16px 0 4px; }
.dlg-campos label { display: flex; flex-direction: column; gap: 5px; font-size: 12px; color: var(--muted); flex: 1 1 140px; }
.dlg-campos input, .dlg-campos select {
  font: inherit; font-size: 14px; padding: 8px 10px; border-radius: 8px;
  border: 1px solid var(--border); background: var(--surface); color: var(--ink);
}

.plan { display: flex; flex-direction: column; gap: 5px; }
.plan select {
  font: inherit; font-size: 12px; padding: 5px 8px; border-radius: 6px;
  border: 1px solid var(--border); background: var(--page); color: var(--ink); cursor: pointer;
}
.plan select:hover { background: var(--accent-soft); }
.plan select.alerta { border-color: var(--crit); color: var(--crit-text); font-weight: 600; }

/* ── Botones ──────────────────────────────────────────────── */
.btn {
  font: inherit; font-size: 13px; font-weight: 600; padding: 7px 13px;
  border-radius: var(--r-sm); border: 1px solid var(--border);
  background: var(--surface); color: var(--ink); cursor: pointer;
}
.btn:hover { background: var(--accent-soft); }
.btn:disabled { opacity: .4; cursor: not-allowed; }
/* La acción destructiva no grita hasta que se necesita: se descubre al pasar. */
.btn.ghost-danger {
  border-color: transparent; background: transparent; color: var(--muted); font-size: 12.5px;
}
.btn.ghost-danger:hover { background: var(--crit-soft); color: var(--crit-text); }
.btn.danger { background: var(--crit); border-color: var(--crit); color: #fff; }
.btn.danger:hover { background: var(--crit); filter: brightness(1.15); }
.btn.danger:disabled { background: var(--crit-soft); border-color: transparent; color: var(--crit-text); }

/* ── Diálogo de borrado ───────────────────────────────────── */
.velo {
  position: fixed; inset: 0; background: rgba(16, 24, 40, .5);
  display: grid; place-items: center; padding: 20px; z-index: 50;
}
.dialogo {
  background: var(--surface); border-radius: var(--r-lg); box-shadow: var(--elev-2);
  padding: 22px; max-width: 460px; width: 100%;
  display: flex; flex-direction: column; gap: 14px;
}
.dialogo h3 { font-family: var(--f-display); font-size: 17px; font-weight: 700; }
.dlg-cuerpo { font-size: 13.5px; color: var(--ink-2); line-height: 1.55; }
.dlg-alerta {
  font-size: 13px; font-weight: 600; color: var(--crit-text);
  background: var(--crit-soft); border-radius: var(--r-sm); padding: 9px 12px;
}
.dlg-campo { display: flex; flex-direction: column; gap: 7px; font-size: 13px; color: var(--ink-2); }
.dlg-campo input {
  font-family: var(--f-data); font-size: 14px; padding: 9px 12px;
  border-radius: var(--r-sm); border: 1px solid var(--border);
  background: var(--page); color: var(--ink);
}
.acciones { display: flex; justify-content: flex-end; gap: 8px; }

.toast {
  position: fixed; left: 50%; bottom: 24px; transform: translateX(-50%);
  background: var(--ink); color: #fff; font-size: 13.5px;
  padding: 10px 18px; border-radius: 999px; box-shadow: var(--elev-2); z-index: 60;
}

.plat-root :focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }

/* ── Angosto: la tabla se vuelve fichas ───────────────────── */
@media (max-width: 900px) {
  .resumen { grid-template-columns: repeat(3, 1fr); }
  .fila.cabecera { display: none; }
  .fila.dato {
    grid-template-columns: 1fr auto;
    row-gap: 10px;
    padding: 14px;
  }
  .empresa { grid-column: 1 / -1; }
  .num { text-align: left; }
  .num::before {
    content: attr(data-etq);
    display: block;
    font-family: var(--f-display); font-size: 9px; letter-spacing: .09em;
    text-transform: uppercase; color: var(--muted); font-weight: 600;
  }
  .actividad, .plan { grid-column: 1 / -1; }
  .plan { flex-direction: row; }
  .plan select { flex: 1; }
}
@media (max-width: 520px) {
  .resumen { grid-template-columns: repeat(2, 1fr); }
  .plat-head { flex-direction: column; align-items: flex-start; gap: 12px; }
}
`;
