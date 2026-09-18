'use client';

/**
 * components/PlataformaPanel.jsx — Consola de la plataforma (solo superadmin).
 *
 * No es un panel de asistencia: es la herramienta de operación del negocio.
 * Se entra a ella con dos preguntas —¿quién paga y qué compró? ¿cuáles de
 * estos esquemas sobran?— y por eso está ordenada para responderlas: primero
 * el agregado, después cada empresa como una ficha con lo que adquirió, lo
 * que usa y lo que le falta.
 *
 * Es una ficha y no una tabla porque se opera desde el celular tanto como
 * desde el PC: una fila de ocho columnas no cabe en 400 px, una ficha sí.
 *
 * El estado se codifica en la FORMA además de en el número: cada ficha lleva
 * un riel de color a la izquierda, así el ojo encuentra las inactivas sin
 * leer. Los colores son sólidos a propósito: en la consola se decide rápido y
 * un chip pálido no se distingue de otro de un vistazo.
 *
 * Eliminar exige teclear el nombre del esquema — la misma protección que usa
 * GitHub para borrar un repositorio.
 */
import { useEffect, useMemo, useState } from 'react';
import { signOut } from '../lib/auth-client';
import { PLANES, planPorId, MONEDA } from '../lib/planes.js';

const nf = new Intl.NumberFormat('es-CO');

const fmtFecha = (iso) =>
  iso ? new Date(iso).toLocaleDateString('es-CO', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'America/Bogota' }) : '—';

/** Fecha → 'AAAA-MM-DD' en hora de Colombia, para un <input type="date">. */
const aDia = (iso) => (iso ? new Date(iso).toLocaleDateString('en-CA', { timeZone: 'America/Bogota' }) : '');

const fmtDinero = (monto, moneda) =>
  `${moneda === 'USD' ? 'US$' : '$'}${nf.format(Math.round(monto))}${moneda && moneda !== 'USD' ? ` ${moneda}` : ''}`;

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

const enPrueba = (e) => Boolean(e.pruebaHasta) && new Date(e.pruebaHasta) > new Date();

/**
 * Estado de la SUSCRIPCIÓN, que es distinto del uso: una empresa puede estar
 * marcando todos los días con la suscripción vencida, y al revés.
 */
function suscripcion(e) {
  const dias = (f) => Math.ceil((new Date(f).getTime() - Date.now()) / 86400000);
  if (e.venceEn && new Date(e.venceEn) > new Date()) {
    if (e.estado !== 'activa') {
      return { clave: 'vencida', etiqueta: e.estado === 'cancelada' ? 'Cancelada' : 'Suspendida', tono: 'crit', detalle: `Pagada hasta el ${fmtFecha(e.venceEn)}, pero el estado la bloquea` };
    }
    const d = dias(e.venceEn);
    return { clave: 'paga', etiqueta: `Paga · ${d} d`, tono: d <= 7 ? 'warn' : 'good', detalle: `Vence el ${fmtFecha(e.venceEn)}` };
  }
  if (enPrueba(e)) {
    const d = dias(e.pruebaHasta);
    return { clave: 'prueba', etiqueta: `Prueba · ${d} d`, tono: d <= 1 ? 'warn' : 'info', detalle: `La prueba termina el ${fmtFecha(e.pruebaHasta)}` };
  }
  if (e.venceEn || e.pruebaHasta) {
    const cuando = e.venceEn ?? e.pruebaHasta;
    return { clave: 'vencida', etiqueta: 'Vencida', tono: 'crit', detalle: `Sin acceso desde el ${fmtFecha(cuando)}` };
  }
  return { clave: 'vencida', etiqueta: 'Sin plan', tono: 'crit', detalle: 'Nunca tuvo prueba ni suscripción' };
}

/**
 * Lo que la empresa TIENE contratado, resuelto: el plan, y los topes que
 * rigen de verdad (el acuerdo puntual gana sobre el plan; en prueba rige el
 * plan más pequeño, como en lib/empresas.js).
 */
function contrato(e) {
  const plan = planPorId(e.planId);
  const base = plan ?? (enPrueba(e) ? planPorId('esencial') : null);
  const tope = e.limiteEmpleados ?? base?.empleados ?? null;
  const cupo = e.limiteUsuarios ?? base?.usuarios ?? null;
  return {
    plan,
    nombre: plan ? plan.nombre : (enPrueba(e) ? 'Prueba' : 'Sin plan'),
    precio: plan ? `${fmtDinero(plan.precio, MONEDA)}/mes` : null,
    tope, topeAcuerdo: e.limiteEmpleados != null,
    cupo, cupoAcuerdo: e.limiteUsuarios != null,
  };
}

/** Los tres estados que importan, en orden de urgencia para quien limpia. */
function salud(e) {
  if (e.esquemaRoto) return { clave: 'rota', etiqueta: 'Esquema roto', tono: 'crit' };
  const d = diasSinUso(e);
  if (d > 30) return { clave: 'inactiva', etiqueta: 'Abandonada', tono: 'crit' };
  if (d > 7) return { clave: 'inactiva', etiqueta: 'Sin uso', tono: 'warn' };
  return { clave: 'activa', etiqueta: 'Activa', tono: 'good' };
}

/** Por uso y por negocio: son dos preguntas distintas y se filtran aparte. */
const FILTROS = [
  { clave: 'todas', etiqueta: 'Todas' },
  { clave: 'activa', etiqueta: 'Activas' },
  { clave: 'inactiva', etiqueta: 'Sin uso' },
  { clave: 'rota', etiqueta: 'Rotas' },
  { clave: 'paga', etiqueta: 'Pagando' },
  { clave: 'prueba', etiqueta: 'En prueba' },
  { clave: 'vencida', etiqueta: 'Sin acceso' },
];

function Icono({ name, size = 17 }) {
  const paths = {
    sliders: <><line x1="4" y1="21" x2="4" y2="14" /><line x1="4" y1="10" x2="4" y2="3" /><line x1="12" y1="21" x2="12" y2="12" /><line x1="12" y1="8" x2="12" y2="3" /><line x1="20" y1="21" x2="20" y2="16" /><line x1="20" y1="12" x2="20" y2="3" /><line x1="1" y1="14" x2="7" y2="14" /><line x1="9" y1="8" x2="15" y2="8" /><line x1="17" y1="16" x2="23" y2="16" /></>,
    calendarPlus: <><rect x="3" y="4" width="18" height="18" rx="2" /><line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" /><line x1="3" y1="10" x2="21" y2="10" /><line x1="12" y1="14" x2="12" y2="18" /><line x1="10" y1="16" x2="14" y2="16" /></>,
    receipt: <><path d="M4 2v20l3-2 3 2 2-2 2 2 3-2 3 2V2l-3 2-3-2-2 2-2-2-3 2z" /><line x1="8" y1="9" x2="16" y2="9" /><line x1="8" y1="13" x2="16" y2="13" /></>,
    trash: <><polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /></>,
    x: <><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></>,
  };
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {paths[name]}
    </svg>
  );
}

export default function PlataformaPanel({ sesion }) {
  const [empresas, setEmpresas] = useState(null); // null = cargando
  const [error, setError] = useState(null);
  const [filtro, setFiltro] = useState('');
  const [segmento, setSegmento] = useState('todas');
  const [borrando, setBorrando] = useState(null);   // { empresa, confirmacion }
  const [regalando, setRegalando] = useState(null); // { empresa, dias, que }
  const [editando, setEditando] = useState(null);   // { empresa, ...campos }
  const [compras, setCompras] = useState(null);     // { empresa, pagos: null | [] }
  const [guardando, setGuardando] = useState(false);
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
    if (!r.ok || !d?.ok) { showToast(d?.error ?? `Error ${r.status}`); return false; }
    showToast(`${e.nombre} actualizada`);
    cargar();
    return true;
  };

  /** Abre los ajustes con lo que la empresa tiene hoy. */
  const abrirAjustes = (e) => setEditando({
    empresa: e,
    planId: e.planId ?? '',
    estado: e.estado ?? 'activa',
    venceEn: aDia(e.venceEn),
    pruebaHasta: aDia(e.pruebaHasta),
    limiteEmpleados: e.limiteEmpleados ?? '',
    limiteUsuarios: e.limiteUsuarios ?? '',
  });

  /** Manda SOLO lo que cambió: así un ajuste no pisa lo que no se tocó. */
  const guardarAjustes = async () => {
    const { empresa: e, ...v } = editando;
    const cambios = {};
    if (v.planId !== (e.planId ?? '')) cambios.planId = v.planId || null;
    if (v.estado !== (e.estado ?? 'activa')) cambios.estado = v.estado;
    if (v.venceEn !== aDia(e.venceEn)) cambios.venceEn = v.venceEn || null;
    if (v.pruebaHasta !== aDia(e.pruebaHasta)) cambios.pruebaHasta = v.pruebaHasta || null;
    if (String(v.limiteEmpleados) !== String(e.limiteEmpleados ?? '')) cambios.limiteEmpleados = v.limiteEmpleados === '' ? null : Number(v.limiteEmpleados);
    if (String(v.limiteUsuarios) !== String(e.limiteUsuarios ?? '')) cambios.limiteUsuarios = v.limiteUsuarios === '' ? null : Number(v.limiteUsuarios);
    if (Object.keys(cambios).length === 0) { setEditando(null); return; }
    setGuardando(true);
    const ok = await cambiar(e, cambios);
    setGuardando(false);
    if (ok) setEditando(null);
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

  const verCompras = (e) => {
    setCompras({ empresa: e, pagos: null });
    fetch(`/api/plataforma/empresas/${e.id}/pagos`)
      .then((r) => r.json())
      .then((d) => setCompras((c) => (c && c.empresa.id === e.id ? { ...c, pagos: d.ok ? d.pagos : [], error: d.ok ? null : d.error } : c)))
      .catch((err) => setCompras((c) => (c && c.empresa.id === e.id ? { ...c, pagos: [], error: err.message } : c)));
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
    let enPruebaN = 0;
    let vencidas = 0;
    let pendientes = 0;
    let ingresos = 0;
    let moneda = '';
    for (const e of empresas) {
      cuenta[salud(e).clave]++;
      empleados += e.empleados ?? 0;
      marcaciones += e.marcaciones ?? 0;
      const s = suscripcion(e).clave;
      if (s === 'paga') pagando++;
      else if (s === 'prueba') enPruebaN++;
      else vencidas++;
      pendientes += e.pagosPendientes ?? 0;
      ingresos += e.totalPagado ?? 0;
      if (e.moneda) moneda = e.moneda;
    }
    return { total: empresas.length, ...cuenta, empleados, marcaciones, pagando, enPrueba: enPruebaN, vencidas, pendientes, ingresos, moneda };
  }, [empresas]);

  const lista = useMemo(() => {
    if (!empresas) return [];
    const q = filtro.trim().toLowerCase();
    const porUso = ['activa', 'inactiva', 'rota'].includes(segmento);
    return empresas
      .filter((e) => segmento === 'todas' || (porUso ? salud(e).clave === segmento : suscripcion(e).clave === segmento))
      .filter((e) => !q || e.nombre.toLowerCase().includes(q) || e.esquema.includes(q) || (e.dueno ?? '').toLowerCase().includes(q) || (e.nit ?? '').includes(q))
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

  const planEditado = editando ? planPorId(editando.planId) : null;

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
          <div className="metrica">
            <span className="m-label">Colaboradores</span>
            <span className="m-valor">{nf.format(resumen.empleados)}</span>
          </div>
          <div className="metrica">
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
            <span className="m-valor">{fmtDinero(resumen.ingresos, resumen.moneda || MONEDA)}</span>
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
        <div className="segmentos" role="tablist" aria-label="Filtrar empresas">
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
        <div className="buscar-fila">
          <input
            className="buscar" type="search" placeholder="Buscar por nombre, esquema, NIT o correo…"
            value={filtro} onChange={(e) => setFiltro(e.target.value)}
          />
          {empresas && <span className="conteo">{lista.length} de {empresas.length}</span>}
        </div>
      </div>

      {error && <p className="aviso crit">No se pudo cargar: {error}</p>}
      {empresas === null && !error && <p className="aviso">Cargando empresas…</p>}
      {empresas?.length === 0 && <p className="aviso">Todavía no hay empresas registradas.</p>}
      {empresas?.length > 0 && lista.length === 0 && (
        <p className="aviso">Ninguna empresa coincide con este filtro.</p>
      )}

      {lista.length > 0 && (
        <div className="fichas">
          {lista.map((e) => {
            const s = salud(e);
            const sus = suscripcion(e);
            const c = contrato(e);
            const dias = diasSinUso(e);
            const accesos = (e.usuarios ?? 0) + (e.invitaciones ?? 0);
            const falta = e.esquemaRoto ? null
              : e.empleados === 0 ? 'Sin colaboradores registrados'
                : e.conRostro === 0 ? 'Nadie con rostro registrado: el kiosco no reconoce a nadie'
                  : e.horarios === 0 ? 'Sin horarios: no se calculan horas'
                    : e.kioscos === 0 ? 'Sin kiosco vinculado' : null;
            return (
              <article className={`ficha tono-${s.tono}`} key={e.id}>
                <header className="ficha-cab">
                  <div className="ficha-nombre">
                    <b>{e.nombre}</b>
                    <small>
                      <code>{e.esquema}</code>
                      {e.nit ? <span> · NIT {e.nit}</span> : null}
                      {e.dominio ? <span> · {e.dominio}</span> : null}
                    </small>
                    {e.dueno && <small className="dueno">{e.dueno}</small>}
                  </div>
                  <span className={`chip ${s.tono}`} title={`Creada el ${fmtFecha(e.creadaEn)}`}>{s.etiqueta}</span>
                </header>

                {/* Lo que ADQUIRIÓ: plan, vigencia y pagos. Es la mitad de
                    negocio de la ficha, y va primero porque es lo que se
                    pregunta cuando un cliente escribe. */}
                <section className="compra" aria-label="Lo que tiene contratado">
                  <div className="compra-plan">
                    <span className="m-label">Plan</span>
                    <b className={c.plan ? '' : 'sin'}>{c.nombre}</b>
                    <small>
                      {c.precio ?? (enPrueba(e) ? 'gratis, sin tarjeta' : 'nada contratado')}
                      {c.tope != null ? ` · hasta ${c.tope} colab.` : ' · sin tope'}
                      {c.cupo != null ? ` · ${c.cupo} acceso${c.cupo === 1 ? '' : 's'}` : ''}
                      {(c.topeAcuerdo || c.cupoAcuerdo) ? ' · acuerdo' : ''}
                    </small>
                  </div>
                  <div className="compra-vigencia">
                    <span className="m-label">Vigencia</span>
                    <span className={`chip ${sus.tono}`}>{sus.etiqueta}</span>
                    <small>{sus.detalle}</small>
                  </div>
                  <div className="compra-pagos">
                    <span className="m-label">Pagos</span>
                    {e.pagosOk > 0 ? (
                      <>
                        <b>{fmtDinero(e.totalPagado ?? 0, e.moneda || MONEDA)}</b>
                        <small>{e.pagosOk} pago{e.pagosOk === 1 ? '' : 's'} · último el {fmtFecha(e.ultimoPago)}</small>
                      </>
                    ) : (
                      <>
                        <b className="sin">Ninguno</b>
                        <small>nunca ha pagado</small>
                      </>
                    )}
                    {e.pagosPendientes > 0 && (
                      <span className="chip warn chico">{e.pagosPendientes} sin resolver</span>
                    )}
                  </div>
                </section>

                {/* Lo que USA: contra el tope, para ver de un vistazo quién
                    está a punto de necesitar un plan mayor. */}
                <section className="uso" aria-label="Uso">
                  <div className={`dato${c.cupo != null && accesos >= c.cupo ? ' tope' : ''}`}>
                    <span className="d-etq">Accesos</span>
                    <span className="d-val">{nf.format(accesos)}{c.cupo != null ? <em>/{c.cupo}</em> : null}</span>
                  </div>
                  <div className={`dato${c.tope != null && e.empleados >= c.tope ? ' tope' : ''}`}>
                    <span className="d-etq">Colab.</span>
                    <span className="d-val">{e.empleados == null ? '—' : nf.format(e.empleados)}{c.tope != null ? <em>/{c.tope}</em> : null}</span>
                  </div>
                  <div className="dato">
                    <span className="d-etq">Kioscos</span>
                    <span className="d-val">{nf.format(e.kioscos ?? 0)}</span>
                  </div>
                  <div className="dato">
                    <span className="d-etq">Sedes</span>
                    <span className="d-val">{e.sedes == null ? '—' : nf.format(e.sedes)}</span>
                  </div>
                  <div className="dato">
                    <span className="d-etq">Marcaciones</span>
                    <span className="d-val">{e.marcaciones == null ? '—' : nf.format(e.marcaciones)}</span>
                  </div>
                  <div className="dato">
                    <span className="d-etq">Actividad</span>
                    <span className="d-val chica" title={e.ultimaMarcacion ? `Última marcación el ${fmtFecha(e.ultimaMarcacion)}` : 'Sin marcaciones'}>
                      {e.esquemaRoto ? 'sin datos' : haceCuanto(dias)}
                    </span>
                  </div>
                </section>

                {/* Configuración a medias: una empresa sin rostros ni horarios
                    no llegó a usarse, por más que la suscripción esté al día.
                    Es la señal de que hay que llamarla, no cobrarle. */}
                {falta && <p className="falta">{falta}</p>}
                {e.esquemaRoto && <p className="falta crit">El esquema no responde: alta a medias o borrado a mano.</p>}

                <footer className="ficha-acciones">
                  <button className="btn ico" title="Ajustes: plan, estado, fechas y topes" aria-label="Ajustes" onClick={() => abrirAjustes(e)}>
                    <Icono name="sliders" />
                  </button>
                  <button className="btn ico" title="Regalar días de prueba o de suscripción" aria-label="Regalar días" onClick={() => setRegalando({ empresa: e, dias: 7, que: 'suscripcion' })}>
                    <Icono name="calendarPlus" />
                  </button>
                  <button className="btn ico" title="Compras: cada pago y su desenlace" aria-label="Compras" onClick={() => verCompras(e)}>
                    <Icono name="receipt" />
                  </button>
                  <button className="btn ico peligro" title="Eliminar la empresa y su esquema" aria-label="Eliminar" onClick={() => setBorrando({ empresa: e, confirmacion: '' })}>
                    <Icono name="trash" />
                  </button>
                </footer>
              </article>
            );
          })}
        </div>
      )}

      {/* Ajustes de la empresa: todo lo que fija el superadmin, en un solo sitio */}
      {editando && (
        <div className="velo" onClick={(ev) => ev.target === ev.currentTarget && !guardando && setEditando(null)}>
          <div className="dialogo" role="dialog" aria-modal="true" aria-labelledby="dlg-aj">
            <div className="dlg-cab">
              <h3 id="dlg-aj">Ajustes de «{editando.empresa.nombre}»</h3>
              <button className="btn ico" aria-label="Cerrar" onClick={() => setEditando(null)}><Icono name="x" /></button>
            </div>

            <div className="dlg-campos">
              <label className="ancho">
                Plan contratado
                <select value={editando.planId} onChange={(ev) => setEditando({ ...editando, planId: ev.target.value })}>
                  <option value="">Sin plan (solo prueba)</option>
                  {Object.entries(PLANES).map(([id, p]) => (
                    <option key={id} value={id}>
                      {p.nombre} · {fmtDinero(p.precio, MONEDA)}/mes · {p.empleados} colab. · {p.usuarios} acceso{p.usuarios === 1 ? '' : 's'}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Estado
                <select value={editando.estado} onChange={(ev) => setEditando({ ...editando, estado: ev.target.value })}>
                  <option value="activa">Al día</option>
                  <option value="vencida">Vencida</option>
                  <option value="cancelada">Cancelada</option>
                </select>
              </label>
              <label>
                Pagada hasta
                <input type="date" value={editando.venceEn} onChange={(ev) => setEditando({ ...editando, venceEn: ev.target.value })} />
              </label>
              <label>
                Prueba hasta
                <input type="date" value={editando.pruebaHasta} onChange={(ev) => setEditando({ ...editando, pruebaHasta: ev.target.value })} />
              </label>
              <label>
                Tope de colaboradores
                <input
                  type="number" min="1" inputMode="numeric"
                  placeholder={planEditado ? `del plan: ${planEditado.empleados}` : 'sin tope'}
                  value={editando.limiteEmpleados}
                  onChange={(ev) => setEditando({ ...editando, limiteEmpleados: ev.target.value })}
                />
              </label>
              <label>
                Accesos al panel
                <input
                  type="number" min="1" inputMode="numeric"
                  placeholder={planEditado ? `del plan: ${planEditado.usuarios}` : 'sin tope'}
                  value={editando.limiteUsuarios}
                  onChange={(ev) => setEditando({ ...editando, limiteUsuarios: ev.target.value })}
                />
              </label>
            </div>
            <p className="dlg-nota">
              Los topes vacíos siguen al plan. Una fecha vacía quita la vigencia. El acceso
              se abre con «Al día» y una fecha de pago futura, o con la prueba corriendo.
            </p>
            <div className="dlg-botones">
              <button className="btn" onClick={() => setEditando(null)} disabled={guardando}>Cancelar</button>
              <button className="btn primary" onClick={guardarAjustes} disabled={guardando}>
                {guardando ? 'Guardando…' : 'Guardar'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Compras: cada pago con su desenlace */}
      {compras && (
        <div className="velo" onClick={(ev) => ev.target === ev.currentTarget && setCompras(null)}>
          <div className="dialogo ancha" role="dialog" aria-modal="true" aria-labelledby="dlg-co">
            <div className="dlg-cab">
              <h3 id="dlg-co">Compras de «{compras.empresa.nombre}»</h3>
              <button className="btn ico" aria-label="Cerrar" onClick={() => setCompras(null)}><Icono name="x" /></button>
            </div>
            {compras.pagos === null && <p className="dlg-cuerpo">Cargando…</p>}
            {compras.error && <p className="dlg-alerta">{compras.error}</p>}
            {compras.pagos?.length === 0 && !compras.error && (
              <p className="dlg-cuerpo">Esta empresa no ha iniciado ningún pago.</p>
            )}
            {compras.pagos?.length > 0 && (
              <ul className="pagos">
                {compras.pagos.map((p) => {
                  const plan = planPorId(p.planId);
                  const tono = p.estado === 'APROBADA' ? 'good' : p.estado === 'PENDIENTE' ? 'warn' : 'crit';
                  return (
                    <li className="pago" key={p.id}>
                      <div className="pago-cab">
                        <b>{fmtDinero(p.monto, p.moneda)}</b>
                        <span className={`chip ${tono}`}>{p.estado === 'APROBADA' ? 'Aprobado' : p.estado === 'PENDIENTE' ? 'Pendiente' : p.estado.toLowerCase()}</span>
                      </div>
                      <small>
                        {plan ? plan.nombre : (p.planId ?? 'plan sin registrar')} · {p.meses} mes{p.meses === 1 ? '' : 'es'}
                        {' · '}{fmtFecha(p.creadoEn)}
                        {p.cubreHasta ? ` · cubre hasta el ${fmtFecha(p.cubreHasta)}` : ''}
                      </small>
                      <small className="ref">{p.proveedor} · <code>{p.referencia}</code></small>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
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
                  type="number" min="1" max="365" inputMode="numeric" value={regalando.dias}
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
              sus <b>{borrando.empresa.empleados == null ? '?' : nf.format(borrando.empresa.empleados)}</b> colaborador(es)
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
            <div className="dlg-botones">
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
   del mismo producto y no puede tener su propia paleta. Los tres tonos
   sólidos (--p-good/--p-warn/--p-crit) son los del kiosco (--k-in/--k-out/
   --k-no): la misma tinta que ya significa «bien / ojo / mal» en el producto. */
const CSS = `
.plat-root {
  --p-good: var(--k-in);
  --p-warn: var(--k-out);
  --p-crit: var(--k-no);
  --p-info: var(--accent);
  font-family: var(--f-body);
  font-weight: 400;
  color: var(--ink);
  background: var(--page);
  min-height: 100dvh;
  max-width: 1180px;
  margin: 0 auto;
  padding: 22px 20px 60px;
  box-sizing: border-box;
}
.plat-root * { box-sizing: border-box; margin: 0; }
.plat-root b { font-weight: 700; }
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
.quien-mail { font-family: var(--f-data); font-size: 12.5px; overflow: hidden; text-overflow: ellipsis; }

/* ── Resumen: el agregado antes del detalle ───────────────── */
.resumen {
  display: grid; grid-template-columns: repeat(6, 1fr); gap: 10px; margin-bottom: 22px;
}
.metrica {
  background: var(--surface-blanca); border: 1px solid var(--border); border-radius: var(--r-md);
  box-shadow: var(--elev-1); padding: 12px 14px;
  display: flex; flex-direction: column; gap: 2px; min-width: 0;
}
.m-label {
  font-family: var(--f-display); font-size: 9.5px; letter-spacing: .09em;
  text-transform: uppercase; color: var(--muted); font-weight: 700;
}
.m-valor {
  font-family: var(--f-data); font-size: 25px; font-weight: 700; line-height: 1.15;
  font-variant-numeric: tabular-nums; color: var(--ink);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.m-valor.good { color: var(--p-good); }
.m-valor.warn { color: var(--p-warn); }
.m-valor.crit { color: var(--p-crit); }
.m-valor.info { color: var(--p-info); }

/* ── Controles ────────────────────────────────────────────── */
.plat-controls { display: flex; flex-direction: column; gap: 10px; margin-bottom: 14px; }
.segmentos {
  display: flex; background: var(--surface-blanca); border: 1px solid var(--border);
  border-radius: var(--r-sm); padding: 3px; gap: 2px; overflow-x: auto; max-width: 100%;
  scrollbar-width: none; align-self: flex-start;
}
.segmentos::-webkit-scrollbar { display: none; }
.segmentos button {
  font: inherit; font-size: 12.5px; font-weight: 600; color: var(--ink-2);
  border: 0; background: transparent; padding: 7px 12px; border-radius: 6px; cursor: pointer;
  white-space: nowrap; flex: 0 0 auto;
}
.segmentos button:hover { background: var(--accent-soft); }
.segmentos button.activo { background: var(--accent); color: var(--accent-ink); }
.buscar-fila { display: flex; align-items: center; gap: 12px; }
.buscar {
  flex: 1; min-width: 0; font: inherit; font-size: 14px; padding: 10px 12px;
  border-radius: var(--r-sm); border: 1px solid var(--border);
  background: var(--surface-blanca); color: var(--ink);
}
.conteo { font-family: var(--f-data); font-size: 12px; color: var(--muted); white-space: nowrap; }

.aviso { color: var(--muted); font-size: 14px; padding: 26px 2px; }
.aviso.crit { color: var(--p-crit); }

/* ── Chips: sólidos, para que se distingan de un vistazo ──── */
.chip {
  display: inline-flex; align-items: center;
  font-size: 11px; font-weight: 700; padding: 3px 9px; border-radius: 999px;
  white-space: nowrap; letter-spacing: .02em; color: #fff; line-height: 1.3;
}
.chip.good { background: var(--p-good); }
.chip.warn { background: var(--p-warn); }
.chip.crit { background: var(--p-crit); }
/* Azul para «en prueba»: no es bueno ni malo, es un estado en curso. */
.chip.info { background: var(--p-info); }
.chip.chico { font-size: 10px; padding: 2px 7px; align-self: flex-start; margin-top: 4px; }

/* ── Fichas ───────────────────────────────────────────────── */
.fichas { display: grid; grid-template-columns: repeat(auto-fill, minmax(360px, 1fr)); gap: 12px; }
.ficha {
  background: var(--surface-blanca); border: 1px solid var(--border);
  border-left: 5px solid var(--grid);            /* riel de severidad */
  border-radius: var(--r-md); box-shadow: var(--elev-1);
  padding: 14px 14px 12px; display: flex; flex-direction: column; gap: 12px; min-width: 0;
}
.ficha.tono-good { border-left-color: var(--p-good); }
.ficha.tono-warn { border-left-color: var(--p-warn); }
.ficha.tono-crit { border-left-color: var(--p-crit); }

.ficha-cab { display: flex; justify-content: space-between; align-items: flex-start; gap: 10px; }
.ficha-nombre { display: flex; flex-direction: column; gap: 3px; min-width: 0; }
.ficha-nombre b { font-size: 16px; letter-spacing: -.01em; line-height: 1.25; }
.ficha-nombre small {
  font-size: 11.5px; color: var(--ink-2);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.ficha-nombre .dueno { font-family: var(--f-data); color: var(--muted); }

/* Lo contratado: tres celdas que se leen de izquierda a derecha como una
   frase: qué plan, si está vigente, cuánto ha pagado. */
.compra {
  display: grid; grid-template-columns: 1.2fr 1fr 1fr; gap: 10px;
  background: var(--page); border-radius: var(--r-sm); padding: 10px 12px;
}
.compra > div { display: flex; flex-direction: column; gap: 3px; min-width: 0; }
.compra b { font-size: 15px; line-height: 1.2; color: var(--ink); }
.compra b.sin { color: var(--muted); font-weight: 600; }
.compra small { font-size: 11px; color: var(--ink-2); line-height: 1.4; }
.compra .chip { align-self: flex-start; }

.uso { display: grid; grid-template-columns: repeat(6, 1fr); gap: 6px; }
.dato {
  display: flex; flex-direction: column; gap: 2px; min-width: 0;
  padding: 7px 8px; border: 1px solid var(--grid); border-radius: var(--r-sm);
}
.dato.tope { border-color: var(--p-warn); background: var(--k-out-soft); }
.d-etq {
  font-family: var(--f-display); font-size: 9px; letter-spacing: .08em;
  text-transform: uppercase; color: var(--muted); font-weight: 700; white-space: nowrap;
}
.d-val {
  font-family: var(--f-data); font-size: 15px; font-weight: 700; color: var(--ink);
  font-variant-numeric: tabular-nums; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.d-val em { font-style: normal; font-weight: 600; font-size: 12px; color: var(--muted); }
.d-val.chica { font-size: 12.5px; font-weight: 600; }

.falta {
  font-size: 12.5px; font-weight: 600; color: var(--p-warn);
  padding: 7px 10px; border-radius: var(--r-sm); background: var(--k-out-soft);
}
.falta.crit { color: var(--p-crit); background: var(--k-no-soft); }

.ficha-acciones {
  display: flex; gap: 8px; justify-content: flex-end; align-items: center;
  padding-top: 10px; border-top: 1px solid var(--grid);
}

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
.tarea.error .tarea-detalle { color: var(--p-crit); }

/* ── Botones ──────────────────────────────────────────────── */
.btn {
  font: inherit; font-size: 13px; font-weight: 600; padding: 8px 14px;
  border-radius: var(--r-sm); border: 1px solid var(--border);
  background: var(--surface-blanca); color: var(--ink); cursor: pointer;
  display: inline-flex; align-items: center; justify-content: center; gap: 6px;
}
.btn:hover { background: var(--accent-soft); border-color: var(--accent); }
.btn:disabled { opacity: .45; cursor: not-allowed; }
.btn.ico { width: 38px; height: 38px; padding: 0; color: var(--ink-2); }
.btn.ico:hover { color: var(--accent); }
.btn.ico.peligro:hover { background: var(--k-no-soft); border-color: var(--p-crit); color: var(--p-crit); }
.btn.primary { background: var(--btn-primary); border-color: var(--btn-primary); color: #fff; }
.btn.primary:hover { background: var(--btn-primary-hover); }
.btn.danger { background: var(--p-crit); border-color: var(--p-crit); color: #fff; }
.btn.danger:hover { filter: brightness(1.1); }
.btn.danger:disabled { background: var(--k-no-soft); border-color: transparent; color: var(--p-crit); }

/* ── Diálogos ─────────────────────────────────────────────── */
.velo {
  position: fixed; inset: 0; background: rgba(16, 24, 40, .55);
  display: grid; place-items: center; padding: 16px; z-index: 50;
}
.dialogo {
  background: var(--surface-blanca); border-radius: var(--r-lg); box-shadow: var(--elev-2);
  padding: 20px; max-width: 480px; width: 100%; max-height: calc(100dvh - 32px); overflow: auto;
  display: flex; flex-direction: column; gap: 14px;
}
.dialogo.ancha { max-width: 560px; }
.dialogo h3 { font-family: var(--f-display); font-size: 17px; font-weight: 700; line-height: 1.3; }
.dlg-cab { display: flex; justify-content: space-between; align-items: flex-start; gap: 10px; }
.dlg-cab .btn.ico { width: 32px; height: 32px; flex: 0 0 auto; }
.dlg-cuerpo { font-size: 13.5px; color: var(--ink-2); line-height: 1.55; }
.dlg-nota { font-size: 12px; color: var(--muted); line-height: 1.5; }
.dlg-alerta {
  font-size: 13px; font-weight: 600; color: var(--p-crit);
  background: var(--k-no-soft); border-radius: var(--r-sm); padding: 9px 12px;
}
.dlg-campos { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
.dlg-campos label {
  display: flex; flex-direction: column; gap: 5px;
  font-size: 12px; font-weight: 600; color: var(--ink-2); min-width: 0;
}
.dlg-campos label.ancho { grid-column: 1 / -1; }
.dlg-campos input, .dlg-campos select {
  font: inherit; font-size: 14px; font-weight: 400; padding: 9px 10px; border-radius: 8px;
  border: 1px solid var(--border); background: var(--surface-blanca); color: var(--ink); min-width: 0; width: 100%;
}
.dlg-campo { display: flex; flex-direction: column; gap: 7px; font-size: 13px; color: var(--ink-2); }
.dlg-campo input {
  font-family: var(--f-data); font-size: 14px; padding: 9px 12px;
  border-radius: var(--r-sm); border: 1px solid var(--border);
  background: var(--page); color: var(--ink);
}
.dlg-botones { display: flex; justify-content: flex-end; gap: 8px; }

.pagos { list-style: none; padding: 0; display: flex; flex-direction: column; gap: 8px; }
.pago {
  display: flex; flex-direction: column; gap: 3px;
  padding: 10px 12px; border: 1px solid var(--grid); border-radius: var(--r-sm);
}
.pago-cab { display: flex; justify-content: space-between; align-items: center; gap: 10px; }
.pago-cab b { font-family: var(--f-data); font-size: 15px; }
.pago small { font-size: 12px; color: var(--ink-2); line-height: 1.45; }
.pago .ref { color: var(--muted); font-size: 11px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

.toast {
  position: fixed; left: 50%; bottom: 24px; transform: translateX(-50%);
  background: var(--ink); color: #fff; font-size: 13.5px;
  padding: 10px 18px; border-radius: 999px; box-shadow: var(--elev-2); z-index: 60;
  max-width: calc(100vw - 32px); text-align: center;
}

.plat-root :focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }

/* ── Angosto ──────────────────────────────────────────────── */
@media (max-width: 900px) {
  .resumen { grid-template-columns: repeat(3, 1fr); }
  .fichas { grid-template-columns: 1fr; }
}
@media (max-width: 560px) {
  .plat-root { padding: 14px 14px 48px; }
  .plat-head { flex-direction: column; align-items: stretch; gap: 10px; }
  .quien { justify-content: space-between; }
  .resumen { grid-template-columns: repeat(2, 1fr); gap: 8px; }
  .metrica { padding: 10px 12px; }
  .m-valor { font-size: 22px; }
  .segmentos { align-self: stretch; }
  .compra { grid-template-columns: 1fr 1fr; }
  .compra-plan { grid-column: 1 / -1; }
  .uso { grid-template-columns: repeat(3, 1fr); }
  .ficha-acciones { justify-content: space-between; }
  .ficha-acciones .btn.ico { flex: 1; height: 42px; }
  .dlg-campos { grid-template-columns: 1fr; }
  .dialogo { padding: 16px; }
  .velo { padding: 10px; align-items: end; }
}
`;
