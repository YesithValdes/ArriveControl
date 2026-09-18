'use client';

/**
 * components/PlataformaPanel.jsx — Consola de la plataforma (solo superadmin).
 *
 * No es un panel de asistencia: es la herramienta de operación del negocio.
 * Tiene el MISMO armazón que el panel de una empresa (barra superior azul,
 * menú lateral que se encoge a un riel en PC y se abre encima en móvil),
 * porque quien opera la plataforma ya vive en ese panel y no tiene por qué
 * aprender otro. Lo que cambia es el contenido, repartido en cuatro
 * pantallas para que ninguna cargue con todo:
 *
 *   Resumen   → el agregado (uso y negocio) y lo que requiere atención.
 *   Empresas  → una ficha por empresa: qué adquirió, qué usa, qué le falta,
 *               y sus ajustes (plan, estado, fechas, topes).
 *   Pagos     → todos los pagos de la plataforma con su desenlace.
 *   Envíos    → las tareas programadas y si corrieron.
 *
 * Los colores son sólidos a propósito: en la consola se decide rápido y un
 * chip pálido no se distingue de otro de un vistazo.
 *
 * Eliminar exige teclear el nombre del esquema — la misma protección que usa
 * GitHub para borrar un repositorio.
 */
import { Fragment, useEffect, useMemo, useState } from 'react';
import { signOut } from '../lib/auth-client';
import { PLANES, planPorId, MONEDA } from '../lib/planes.js';

const nf = new Intl.NumberFormat('es-CO');

const fmtFecha = (iso) =>
  iso ? new Date(iso).toLocaleDateString('es-CO', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'America/Bogota' }) : '—';

const fmtFechaHora = (iso) =>
  iso ? new Date(iso).toLocaleString('es-CO', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'America/Bogota' }) : '—';

/** Fecha → 'AAAA-MM-DD' en hora de Colombia, para un <input type="date">. */
const aDia = (iso) => (iso ? new Date(iso).toLocaleDateString('en-CA', { timeZone: 'America/Bogota' }) : '');

const fmtDinero = (monto, moneda) =>
  `${moneda === 'USD' ? 'US$' : '$'}${nf.format(Math.round(monto))}${moneda && moneda !== 'USD' ? ` ${moneda}` : ''}`;

const iniciales = (texto) =>
  String(texto ?? '').split(/[\s@.]+/).filter(Boolean).slice(0, 2).map((p) => p[0]).join('').toUpperCase();

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
      return { clave: 'vencida', etiqueta: e.estado === 'cancelada' ? 'Cancelada' : 'Suspendida', tono: 'crit', dias: 0, detalle: `Pagada hasta el ${fmtFecha(e.venceEn)}, pero el estado la bloquea` };
    }
    const d = dias(e.venceEn);
    return { clave: 'paga', etiqueta: `Paga · ${d} d`, tono: d <= 7 ? 'warn' : 'good', dias: d, detalle: `Vence el ${fmtFecha(e.venceEn)}` };
  }
  if (enPrueba(e)) {
    const d = dias(e.pruebaHasta);
    return { clave: 'prueba', etiqueta: `Prueba · ${d} d`, tono: d <= 1 ? 'warn' : 'info', dias: d, detalle: `La prueba termina el ${fmtFecha(e.pruebaHasta)}` };
  }
  if (e.venceEn || e.pruebaHasta) {
    const cuando = e.venceEn ?? e.pruebaHasta;
    return { clave: 'vencida', etiqueta: 'Vencida', tono: 'crit', dias: 0, detalle: `Sin acceso desde el ${fmtFecha(cuando)}` };
  }
  return { clave: 'vencida', etiqueta: 'Sin plan', tono: 'crit', dias: 0, detalle: 'Nunca tuvo prueba ni suscripción' };
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

/**
 * Qué hay que hacer HOY con esta empresa, si algo. Es la lista del resumen:
 * lo que, sin esta pantalla, se descubría entrando a la base o por un correo
 * de queja del cliente.
 */
function pendientes(e) {
  const lista = [];
  const sus = suscripcion(e);
  if (e.esquemaRoto) lista.push({ tono: 'crit', texto: 'El esquema no responde: alta a medias o borrado a mano.' });
  if (e.pagosPendientes > 0) lista.push({ tono: 'warn', texto: `${e.pagosPendientes} pago${e.pagosPendientes === 1 ? '' : 's'} sin resolver: puede que el webhook no llegara.` });
  if (sus.clave === 'paga' && sus.dias <= 7) lista.push({ tono: 'warn', texto: `La suscripción vence en ${sus.dias} día${sus.dias === 1 ? '' : 's'}.` });
  if (sus.clave === 'prueba' && sus.dias <= 1) lista.push({ tono: 'warn', texto: 'La prueba termina hoy y no ha pagado.' });
  if (!e.esquemaRoto && salud(e).etiqueta === 'Abandonada') lista.push({ tono: 'crit', texto: `Sin actividad ${haceCuanto(diasSinUso(e)).replace('hace ', 'desde hace ')}: candidata a limpiar.` });
  if (!e.esquemaRoto && sus.clave !== 'vencida' && (e.empleados === 0 || e.conRostro === 0)) {
    lista.push({ tono: 'info', texto: e.empleados === 0 ? 'Tiene acceso pero no ha registrado colaboradores.' : 'Nadie tiene rostro registrado: el kiosco no reconoce a nadie.' });
  }
  return lista;
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

const FILTROS_PAGO = [
  { clave: 'todos', etiqueta: 'Todos' },
  { clave: 'APROBADA', etiqueta: 'Aprobados' },
  { clave: 'PENDIENTE', etiqueta: 'Pendientes' },
  { clave: 'otros', etiqueta: 'Rechazados' },
];

const SECCIONES = [
  { id: 'resumen', label: 'Resumen', icon: 'dashboard', grupo: 'Plataforma' },
  { id: 'empresas', label: 'Empresas', icon: 'database', grupo: 'Plataforma' },
  { id: 'pagos', label: 'Pagos', icon: 'receipt', grupo: 'Plataforma' },
  { id: 'envios', label: 'Envíos automáticos', icon: 'mail', grupo: 'Sistema' },
];

function Icono({ name, size = 17 }) {
  const paths = {
    dashboard: <><rect x="3" y="3" width="7" height="9" rx="1" /><rect x="14" y="3" width="7" height="5" rx="1" /><rect x="14" y="12" width="7" height="9" rx="1" /><rect x="3" y="16" width="7" height="5" rx="1" /></>,
    database: <><ellipse cx="12" cy="5" rx="9" ry="3" /><path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3" /><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5" /></>,
    mail: <><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" /><polyline points="22,6 12,13 2,6" /></>,
    sliders: <><line x1="4" y1="21" x2="4" y2="14" /><line x1="4" y1="10" x2="4" y2="3" /><line x1="12" y1="21" x2="12" y2="12" /><line x1="12" y1="8" x2="12" y2="3" /><line x1="20" y1="21" x2="20" y2="16" /><line x1="20" y1="12" x2="20" y2="3" /><line x1="1" y1="14" x2="7" y2="14" /><line x1="9" y1="8" x2="15" y2="8" /><line x1="17" y1="16" x2="23" y2="16" /></>,
    calendarPlus: <><rect x="3" y="4" width="18" height="18" rx="2" /><line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" /><line x1="3" y1="10" x2="21" y2="10" /><line x1="12" y1="14" x2="12" y2="18" /><line x1="10" y1="16" x2="14" y2="16" /></>,
    receipt: <><path d="M4 2v20l3-2 3 2 2-2 2 2 3-2 3 2V2l-3 2-3-2-2 2-2-2-3 2z" /><line x1="8" y1="9" x2="16" y2="9" /><line x1="8" y1="13" x2="16" y2="13" /></>,
    trash: <><polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /></>,
    lock: <><rect x="3" y="11" width="18" height="11" rx="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" /></>,
    x: <><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></>,
    refresh: <><polyline points="23 4 23 10 17 10" /><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" /></>,
    chevronRight: <polyline points="9 18 15 12 9 6" />,
  };
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {paths[name]}
    </svg>
  );
}

/** La misma marca del panel de empresa (cara con visto). */
function MarcaCDial({ size = 20 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden="true">
      <circle cx="32" cy="31" r="20" stroke="currentColor" strokeWidth="4.6" fill="none" />
      <circle cx="25.4" cy="27" r="2.2" fill="currentColor" />
      <circle cx="38.6" cy="27" r="2.2" fill="currentColor" />
      <path d="M 24 37 l 6 6 l 12 -12" stroke="#9fdcca" strokeWidth="4.4" strokeLinecap="round" strokeLinejoin="round" fill="none" />
    </svg>
  );
}

export default function PlataformaPanel({ sesion }) {
  const [tab, setTab] = useState('resumen');
  const [collapsed, setCollapsed] = useState(false); // riel de iconos (PC)
  const [navOpen, setNavOpen] = useState(false);     // menú encima (móvil)
  const [sesionAbierta, setSesionAbierta] = useState(false);

  const [empresas, setEmpresas] = useState(null); // null = cargando
  const [error, setError] = useState(null);
  const [filtro, setFiltro] = useState('');
  const [segmento, setSegmento] = useState('todas');
  const [pagos, setPagos] = useState(null);       // null = no pedidos aún
  const [filtroPago, setFiltroPago] = useState('todos');
  const [borrando, setBorrando] = useState(null);   // { empresa, confirmacion }
  const [regalando, setRegalando] = useState(null); // { empresa, dias, que }
  const [editando, setEditando] = useState(null);   // { empresa, ...campos }
  const [compras, setCompras] = useState(null);     // { empresa, pagos: null | [] }
  const [guardando, setGuardando] = useState(false);
  const [tareas, setTareas] = useState([]);         // últimas corridas programadas
  const [toast, setToast] = useState(null);

  const showToast = (m) => { setToast(m); setTimeout(() => setToast(null), 2800); };

  // La pantalla va en el hash (#empresas) para poder volver a ella al
  // recargar y para enlazarla desde el resumen.
  useEffect(() => {
    const h = window.location.hash.replace('#', '');
    if (SECCIONES.some((s) => s.id === h)) setTab(h);
  }, []);
  const irA = (id, opciones = {}) => {
    setTab(id);
    setNavOpen(false);
    if (opciones.buscar !== undefined) setFiltro(opciones.buscar);
    if (opciones.segmento) setSegmento(opciones.segmento);
    try { window.history.replaceState(null, '', `#${id}`); } catch { /* sin historial, sin drama */ }
  };

  /**
   * Las tres líneas hacen cosas distintas según el ancho: en PC encogen el
   * menú a un riel de iconos; en móvil lo abren encima del contenido.
   */
  const alternarMenu = () => {
    if (typeof window !== 'undefined' && window.matchMedia('(min-width: 900px)').matches) {
      setCollapsed((c) => !c);
    } else {
      setNavOpen((o) => !o);
    }
  };

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

  const cargarPagos = () => {
    fetch('/api/plataforma/pagos')
      .then((r) => r.json())
      .then((d) => setPagos(d.ok ? d.pagos : []))
      .catch(() => setPagos([]));
  };
  // Los pagos se piden la primera vez que se entra a la pantalla, no al
  // abrir la consola: es la lista más larga y no siempre se necesita.
  useEffect(() => { if (tab === 'pagos' && pagos === null) cargarPagos(); }, [tab]); // eslint-disable-line react-hooks/exhaustive-deps

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
    let kioscos = 0;
    // Del negocio, no del uso: cuántas pagan, cuántas están probando, cuántas
    // se cayeron, y cuánto dinero entró.
    let pagando = 0;
    let enPruebaN = 0;
    let vencidas = 0;
    let pendientesN = 0;
    let ingresos = 0;
    let moneda = '';
    const atencion = [];
    for (const e of empresas) {
      cuenta[salud(e).clave]++;
      empleados += e.empleados ?? 0;
      marcaciones += e.marcaciones ?? 0;
      kioscos += e.kioscos ?? 0;
      const s = suscripcion(e).clave;
      if (s === 'paga') pagando++;
      else if (s === 'prueba') enPruebaN++;
      else vencidas++;
      pendientesN += e.pagosPendientes ?? 0;
      ingresos += e.totalPagado ?? 0;
      if (e.moneda) moneda = e.moneda;
      for (const p of pendientes(e)) atencion.push({ empresa: e, ...p });
    }
    const peso = { crit: 0, warn: 1, info: 2 };
    atencion.sort((a, b) => peso[a.tono] - peso[b.tono]);
    return { total: empresas.length, ...cuenta, empleados, marcaciones, kioscos, pagando, enPrueba: enPruebaN, vencidas, pendientes: pendientesN, ingresos, moneda, atencion };
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

  const listaPagos = useMemo(() => {
    if (!pagos) return [];
    if (filtroPago === 'todos') return pagos;
    if (filtroPago === 'otros') return pagos.filter((p) => p.estado !== 'APROBADA' && p.estado !== 'PENDIENTE');
    return pagos.filter((p) => p.estado === filtroPago);
  }, [pagos, filtroPago]);

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
  const seccion = SECCIONES.find((s) => s.id === tab) ?? SECCIONES[0];
  // Lo que pide acción, en el menú: esquemas rotos y pagos sin resolver.
  const badges = { empresas: resumen?.rota ?? 0, pagos: resumen?.pendientes ?? 0 };

  const chipPago = (estado) => {
    const tono = estado === 'APROBADA' ? 'good' : estado === 'PENDIENTE' ? 'warn' : 'crit';
    const texto = estado === 'APROBADA' ? 'Aprobado' : estado === 'PENDIENTE' ? 'Pendiente' : estado.toLowerCase();
    return <span className={`chip ${tono}`}>{texto}</span>;
  };

  return (
    <div className={`plat-root${collapsed ? ' nav-collapsed' : ''}${navOpen ? ' nav-open' : ''}`}>
      <style>{CSS}</style>

      {/* ── Barra superior: la misma del panel de empresa ─────────── */}
      <header className="app-header">
        <button className="menu-btn" onClick={alternarMenu} aria-label="Mostrar u ocultar el menú" title="Menú">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
            <line x1="3" y1="6" x2="21" y2="6" /><line x1="3" y1="12" x2="21" y2="12" /><line x1="3" y1="18" x2="21" y2="18" />
          </svg>
        </button>
        <span className="head-marca">
          <span className="head-logo" aria-hidden="true"><MarcaCDial size={22} /></span>
          <span className="head-brand">ASISTENC<b>IA</b></span>
        </span>
        <div className="head-titles">
          <span className="head-tab">{seccion.label}</span>
          <span className="date-note">
            Plataforma · {new Date().toLocaleDateString('es-CO', { weekday: 'long', day: 'numeric', month: 'long' })}
          </span>
        </div>
        <div className="head-right">
          <button className="head-ico" onClick={() => { cargar(); if (pagos !== null) cargarPagos(); showToast('Actualizando…'); }} title="Volver a cargar" aria-label="Volver a cargar">
            <Icono name="refresh" size={17} />
          </button>
          <div className="head-user">
            <button
              className="head-user-btn"
              aria-expanded={sesionAbierta}
              onClick={() => setSesionAbierta((v) => !v)}
              title={sesion.email}
            >
              {sesion.foto ? (
                <img
                  className="sesion-avatar" src={sesion.foto} alt="" referrerPolicy="no-referrer"
                  onError={(e) => { e.currentTarget.style.display = 'none'; e.currentTarget.nextElementSibling.style.display = 'flex'; }}
                />
              ) : null}
              <span className="sesion-avatar" style={sesion.foto ? { display: 'none' } : undefined}>
                {iniciales(sesion.nombre || sesion.email)}
              </span>
              <span className="head-user-nombre">{sesion.nombre || sesion.email}</span>
            </button>
            {sesionAbierta && (
              <div className="head-user-menu">
                <b>{sesion.nombre || sesion.email}</b>
                <span>{sesion.email}</span>
                <span>Superadministrador</span>
                <button className="lock-btn" onClick={cerrarSesion} title="Cerrar sesión">
                  <span className="icon"><Icono name="lock" size={14} /></span>
                  <span className="lbl">Cerrar sesión</span>
                </button>
              </div>
            )}
          </div>
        </div>
      </header>

      {/* ── Menú lateral ──────────────────────────────────────────── */}
      {navOpen && <div className="nav-scrim" onClick={() => setNavOpen(false)} />}
      <nav className="tabbar" aria-label="Navegación de la consola">
        {SECCIONES.map((s, i) => (
          <Fragment key={s.id}>
            {s.grupo !== SECCIONES[i - 1]?.grupo && (
              <span className={`tab-grupo${i === 0 ? ' primero' : ''}`} aria-hidden="true">{s.grupo}</span>
            )}
            <button aria-pressed={tab === s.id} onClick={() => irA(s.id)} title={s.label}>
              <span className="icon"><Icono name={s.icon} /></span>
              <span className="lbl">{s.label}</span>
              {badges[s.id] ? <span className="badge">{badges[s.id]}</span> : null}
            </button>
          </Fragment>
        ))}
        <span className="side-foot">Consola de plataforma</span>
      </nav>

      {/* ── Contenido ─────────────────────────────────────────────── */}
      <div className="screen">
        {error && <p className="aviso crit">No se pudo cargar: {error}</p>}
        {empresas === null && !error && <p className="aviso">Cargando…</p>}

        {/* Resumen: el agregado y lo que requiere atención */}
        {tab === 'resumen' && resumen && (
          <>
            <div className="dos">
              <section className="card">
                <h2>Uso</h2>
                <p className="hint">Quién está usando la plataforma.</p>
                <div className="tiles">
                  <div className="tile"><span className="label">Empresas</span><span className="value">{nf.format(resumen.total)}</span></div>
                  <div className="tile"><span className="label">En uso</span><span className="value good">{nf.format(resumen.activa)}</span></div>
                  <div className="tile"><span className="label">Sin uso</span><span className={`value${resumen.inactiva > 0 ? ' warn' : ''}`}>{nf.format(resumen.inactiva)}</span></div>
                  <div className="tile"><span className="label">Esquemas rotos</span><span className={`value${resumen.rota > 0 ? ' crit' : ''}`}>{nf.format(resumen.rota)}</span></div>
                  <div className="tile"><span className="label">Colaboradores</span><span className="value">{nf.format(resumen.empleados)}</span></div>
                  <div className="tile"><span className="label">Marcaciones</span><span className="value">{nf.format(resumen.marcaciones)}</span></div>
                </div>
              </section>
              <section className="card">
                <h2>Negocio</h2>
                <p className="hint">Quién paga y cuánto ha entrado.</p>
                <div className="tiles">
                  <div className="tile"><span className="label">Pagando</span><span className="value good">{nf.format(resumen.pagando)}</span></div>
                  <div className="tile"><span className="label">En prueba</span><span className="value info">{nf.format(resumen.enPrueba)}</span></div>
                  <div className="tile"><span className="label">Sin acceso</span><span className={`value${resumen.vencidas > 0 ? ' crit' : ''}`}>{nf.format(resumen.vencidas)}</span></div>
                  {/* Un pago pendiente viejo casi siempre es un webhook que no
                      llegó: el cliente pagó y su plan no se activó. */}
                  <div className="tile"><span className="label">Pagos sin resolver</span><span className={`value${resumen.pendientes > 0 ? ' warn' : ''}`}>{nf.format(resumen.pendientes)}</span></div>
                  <div className="tile ancha"><span className="label">Recaudado</span><span className="value">{fmtDinero(resumen.ingresos, resumen.moneda || MONEDA)}</span></div>
                </div>
                <button className="btn enlace" onClick={() => irA('pagos')}>Ver los pagos <Icono name="chevronRight" size={14} /></button>
              </section>
            </div>

            <section className="card">
              <h2>Requieren atención</h2>
              <p className="hint">Lo que conviene resolver hoy, de lo más urgente a lo menos.</p>
              {resumen.atencion.length === 0 ? (
                <p className="empty">Nada pendiente. Todas las empresas están al día.</p>
              ) : (
                <ul className="atencion">
                  {resumen.atencion.map((a, i) => (
                    <li className={`aten ${a.tono}`} key={`${a.empresa.id}-${i}`}>
                      <span className="aten-punto" aria-hidden="true" />
                      <div className="aten-texto">
                        <b>{a.empresa.nombre}</b>
                        <span>{a.texto}</span>
                      </div>
                      <button className="btn small" onClick={() => irA('empresas', { buscar: a.empresa.nombre, segmento: 'todas' })}>Ver</button>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section className="card">
              <h2>Últimos envíos automáticos</h2>
              {tareas.length === 0 ? (
                <p className="empty">Sin corridas registradas todavía.</p>
              ) : (
                <div className="tarea-lista">
                  {tareas.slice(0, 3).map((t) => <Tarea t={t} key={t.creadoEn} />)}
                </div>
              )}
              <button className="btn enlace" onClick={() => irA('envios')}>Ver todos <Icono name="chevronRight" size={14} /></button>
            </section>
          </>
        )}

        {/* Empresas: fichas con lo adquirido, lo usado y los ajustes */}
        {tab === 'empresas' && empresas && (
          <>
            <div className="plat-controls">
              <div className="segmentos" role="tablist" aria-label="Filtrar empresas">
                {FILTROS.map((f) => (
                  <button key={f.clave} role="tab" aria-selected={segmento === f.clave} className={segmento === f.clave ? 'activo' : ''} onClick={() => setSegmento(f.clave)}>
                    {f.etiqueta}
                  </button>
                ))}
              </div>
              <div className="buscar-fila">
                <input
                  className="buscar" type="search" placeholder="Buscar por nombre, esquema, NIT o correo…"
                  value={filtro} onChange={(e) => setFiltro(e.target.value)}
                />
                <span className="conteo">{lista.length} de {empresas.length}</span>
              </div>
            </div>

            {empresas.length === 0 && <p className="aviso">Todavía no hay empresas registradas.</p>}
            {empresas.length > 0 && lista.length === 0 && <p className="aviso">Ninguna empresa coincide con este filtro.</p>}

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

                      {/* Lo que ADQUIRIÓ: plan, vigencia y pagos. Va primero
                          porque es lo que se pregunta cuando un cliente escribe. */}
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
                          {e.pagosPendientes > 0 && <span className="chip warn chico">{e.pagosPendientes} sin resolver</span>}
                        </div>
                      </section>

                      {/* Lo que USA, contra el tope: quién está a punto de
                          necesitar un plan mayor. */}
                      <section className="uso" aria-label="Uso">
                        <div className={`dato${c.cupo != null && accesos >= c.cupo ? ' tope' : ''}`}>
                          <span className="d-etq">Accesos</span>
                          <span className="d-val">{nf.format(accesos)}{c.cupo != null ? <em>/{c.cupo}</em> : null}</span>
                        </div>
                        <div className={`dato${c.tope != null && e.empleados >= c.tope ? ' tope' : ''}`}>
                          <span className="d-etq">Colab.</span>
                          <span className="d-val">{e.empleados == null ? '—' : nf.format(e.empleados)}{c.tope != null ? <em>/{c.tope}</em> : null}</span>
                        </div>
                        <div className="dato"><span className="d-etq">Kioscos</span><span className="d-val">{nf.format(e.kioscos ?? 0)}</span></div>
                        <div className="dato"><span className="d-etq">Sedes</span><span className="d-val">{e.sedes == null ? '—' : nf.format(e.sedes)}</span></div>
                        <div className="dato"><span className="d-etq">Marcaciones</span><span className="d-val">{e.marcaciones == null ? '—' : nf.format(e.marcaciones)}</span></div>
                        <div className="dato">
                          <span className="d-etq">Actividad</span>
                          <span className="d-val chica" title={e.ultimaMarcacion ? `Última marcación el ${fmtFecha(e.ultimaMarcacion)}` : 'Sin marcaciones'}>
                            {e.esquemaRoto ? 'sin datos' : haceCuanto(dias)}
                          </span>
                        </div>
                      </section>

                      {falta && <p className="falta">{falta}</p>}
                      {e.esquemaRoto && <p className="falta crit">El esquema no responde: alta a medias o borrado a mano.</p>}

                      <footer className="ficha-acciones">
                        <button className="btn ico" title="Ajustes: plan, estado, fechas y topes" aria-label="Ajustes" onClick={() => abrirAjustes(e)}><Icono name="sliders" /></button>
                        <button className="btn ico" title="Regalar días de prueba o de suscripción" aria-label="Regalar días" onClick={() => setRegalando({ empresa: e, dias: 7, que: 'suscripcion' })}><Icono name="calendarPlus" /></button>
                        <button className="btn ico" title="Compras: cada pago y su desenlace" aria-label="Compras" onClick={() => verCompras(e)}><Icono name="receipt" /></button>
                        <button className="btn ico peligro" title="Eliminar la empresa y su esquema" aria-label="Eliminar" onClick={() => setBorrando({ empresa: e, confirmacion: '' })}><Icono name="trash" /></button>
                      </footer>
                    </article>
                  );
                })}
              </div>
            )}
          </>
        )}

        {/* Pagos: todos los de la plataforma */}
        {tab === 'pagos' && (
          <>
            {resumen && (
              <div className="tiles tres">
                <div className="tile"><span className="label">Recaudado</span><span className="value">{fmtDinero(resumen.ingresos, resumen.moneda || MONEDA)}</span></div>
                <div className="tile"><span className="label">Aprobados</span><span className="value good">{nf.format(pagos ? pagos.filter((p) => p.estado === 'APROBADA').length : 0)}</span></div>
                <div className="tile"><span className="label">Sin resolver</span><span className={`value${resumen.pendientes > 0 ? ' warn' : ''}`}>{nf.format(resumen.pendientes)}</span></div>
              </div>
            )}
            <section className="card">
              <div className="card-cab">
                <h2>Pagos</h2>
                <div className="segmentos" role="tablist" aria-label="Filtrar pagos">
                  {FILTROS_PAGO.map((f) => (
                    <button key={f.clave} role="tab" aria-selected={filtroPago === f.clave} className={filtroPago === f.clave ? 'activo' : ''} onClick={() => setFiltroPago(f.clave)}>
                      {f.etiqueta}
                    </button>
                  ))}
                </div>
              </div>
              <p className="hint">
                Cada intento de pago con su desenlace, el más reciente primero. Un pendiente
                de hace días es un webhook que no llegó: el cliente pagó y el plan no se activó.
              </p>
              {pagos === null && <p className="empty">Cargando pagos…</p>}
              {pagos?.length === 0 && <p className="empty">Todavía no hay pagos.</p>}
              {pagos?.length > 0 && listaPagos.length === 0 && <p className="empty">Ningún pago con este filtro.</p>}
              {listaPagos.length > 0 && (
                <ul className="pagos">
                  {listaPagos.map((p) => {
                    const plan = planPorId(p.planId);
                    return (
                      <li className="pago" key={p.id}>
                        <div className="pago-cab">
                          <div className="pago-quien">
                            <b>{p.empresa}</b>
                            <small>{fmtFechaHora(p.creadoEn)}</small>
                          </div>
                          <b className="pago-monto">{fmtDinero(p.monto, p.moneda)}</b>
                          {chipPago(p.estado)}
                        </div>
                        <small>
                          {plan ? plan.nombre : (p.planId ?? 'plan sin registrar')} · {p.meses} mes{p.meses === 1 ? '' : 'es'}
                          {p.cubreHasta ? ` · cubre hasta el ${fmtFecha(p.cubreHasta)}` : ''}
                          {' · '}{p.proveedor}
                        </small>
                        <div className="pago-pie">
                          <small className="ref"><code>{p.referencia}</code></small>
                          <button className="btn small" onClick={() => irA('empresas', { buscar: p.empresa, segmento: 'todas' })}>Ver empresa</button>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>
          </>
        )}

        {/* Envíos automáticos: las tareas programadas */}
        {tab === 'envios' && (
          <section className="card">
            <h2>Envíos automáticos</h2>
            <p className="hint">
              Tareas que corren solas de madrugada y le mandan correos a los colaboradores de
              todas las empresas. Si una noche fallan, esto tiene que decirlo antes de que lo
              note un cliente.
            </p>
            {tareas.length === 0 ? (
              <p className="empty">
                Sin corridas registradas todavía. El resumen diario sale entre las 11:00 y
                las 11:59 p. m.; si mañana esto sigue vacío, la tarea no se está disparando.
              </p>
            ) : (
              <div className="tarea-lista">
                {tareas.map((t) => <Tarea t={t} key={t.creadoEn} />)}
              </div>
            )}
          </section>
        )}
      </div>

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

      {/* Compras de una empresa */}
      {compras && (
        <div className="velo" onClick={(ev) => ev.target === ev.currentTarget && setCompras(null)}>
          <div className="dialogo ancha" role="dialog" aria-modal="true" aria-labelledby="dlg-co">
            <div className="dlg-cab">
              <h3 id="dlg-co">Compras de «{compras.empresa.nombre}»</h3>
              <button className="btn ico" aria-label="Cerrar" onClick={() => setCompras(null)}><Icono name="x" /></button>
            </div>
            {compras.pagos === null && <p className="dlg-cuerpo">Cargando…</p>}
            {compras.error && <p className="dlg-alerta">{compras.error}</p>}
            {compras.pagos?.length === 0 && !compras.error && <p className="dlg-cuerpo">Esta empresa no ha iniciado ningún pago.</p>}
            {compras.pagos?.length > 0 && (
              <ul className="pagos">
                {compras.pagos.map((p) => {
                  const plan = planPorId(p.planId);
                  return (
                    <li className="pago" key={p.id}>
                      <div className="pago-cab">
                        <b className="pago-monto">{fmtDinero(p.monto, p.moneda)}</b>
                        {chipPago(p.estado)}
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
                <select value={regalando.que} onChange={(ev) => setRegalando({ ...regalando, que: ev.target.value })}>
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

/** Una corrida de tarea programada, en una línea. */
function Tarea({ t }) {
  const d = t.detalle ?? {};
  return (
    <div className={`tarea ${t.estado}`}>
      <span className={`chip ${t.estado === 'ok' ? 'good' : 'crit'}`}>{t.estado === 'ok' ? 'Corrió' : 'Falló'}</span>
      <b>{t.tarea}</b>
      <span className="tarea-cuando">
        {fmtFechaHora(t.creadoEn)}
        {t.sobre ? ` · sobre el ${fmtFecha(t.sobre)}` : ''}
      </span>
      <span className="tarea-detalle">
        {t.estado === 'ok'
          ? `${d.enviados ?? 0} enviados${d.fallidos ? `, ${d.fallidos} fallidos` : ''}${d.sinCorreo ? `, ${d.sinCorreo} sin correo` : ''}`
          : (d.error ?? 'sin detalle')}
      </span>
    </div>
  );
}

/* Todo el color sale de los tokens de app/globals.css: esta consola es parte
   del mismo producto y no puede tener su propia paleta. El armazón (barra,
   menú, riel) copia las medidas del panel de empresa (AdminPanel.jsx) para
   que las dos pantallas se sientan como una. Los tres tonos sólidos
   (--p-good/--p-warn/--p-crit) son los del kiosco: la misma tinta que ya
   significa «bien / ojo / mal» en el producto. */
const CSS = `
.plat-root {
  --p-good: var(--k-in);
  --p-warn: var(--k-out);
  --p-crit: var(--k-no);
  --p-info: var(--accent);
  --page: #dfe8f8;
  font-family: var(--f-body);
  font-weight: 400;
  color: var(--ink);
  background: var(--page);
  min-height: 100dvh; max-width: 560px; margin: 0 auto;
  display: flex; flex-direction: column; gap: 10px;
  padding: 14px 12px 10px; box-sizing: border-box;
}
.plat-root * { box-sizing: border-box; margin: 0; }
.plat-root b { font-weight: 700; }
.plat-root code {
  font-family: var(--f-data); font-size: .92em;
  background: var(--accent-soft); padding: 1px 5px; border-radius: 4px;
}

/* ── Barra superior (la misma del panel de empresa) ───────── */
.app-header {
  display: flex; align-items: center; gap: 10px; flex: 0 0 auto;
  background: var(--btn-primary); color: #fff; border-radius: 12px; padding: 8px 12px;
}
.menu-btn {
  flex: 0 0 auto; width: 40px; height: 40px; border-radius: 50%;
  border: none; background: transparent; color: #fff;
  display: flex; align-items: center; justify-content: center; cursor: pointer;
}
.menu-btn:hover { background: rgba(255,255,255,.14); }
.menu-btn:active { background: rgba(255,255,255,.22); }
.head-marca { display: flex; align-items: center; gap: 9px; flex: 0 0 auto; }
.head-brand {
  font-family: var(--f-display); font-size: 13px; font-weight: 400;
  letter-spacing: .13em; color: rgba(255,255,255,.72); white-space: nowrap;
}
.head-brand b { font-weight: 800; color: #fff; }
@media (max-width: 430px) { .head-brand { display: none; } }
@media (max-width: 360px) { .head-logo { display: none; } }
.head-logo {
  flex: 0 0 auto; width: 34px; height: 34px; border-radius: 9px;
  background: rgba(255,255,255,.14); color: #fff;
  display: flex; align-items: center; justify-content: center;
}
.head-titles { display: flex; flex-direction: column; min-width: 0; overflow: hidden; flex: 1 1 auto; }
.head-tab { font-family: var(--f-display); font-size: 15px; font-weight: 700; color: #fff; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.app-header .date-note { color: rgba(255,255,255,.65); font-size: 11.5px; font-family: var(--f-data); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.head-right { margin-left: auto; display: flex; align-items: center; gap: 6px; position: relative; }
.head-ico {
  width: 36px; height: 36px; border-radius: 50%; border: 0; background: transparent; color: #fff;
  display: flex; align-items: center; justify-content: center; cursor: pointer;
}
.head-ico:hover { background: rgba(255,255,255,.12); }
.head-user { position: relative; }
.head-user-btn {
  display: flex; align-items: center; gap: 8px;
  background: transparent; border: 0; color: #fff; cursor: pointer;
  font: inherit; padding: 3px; border-radius: 999px;
}
.head-user-btn:hover, .head-user-btn[aria-expanded="true"] { background: rgba(255,255,255,.12); }
.head-user-nombre { display: none; max-width: 170px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 600; font-size: 13px; padding-right: 6px; }
.sesion-avatar {
  flex: 0 0 auto; width: 30px; height: 30px; border-radius: 50%;
  background: rgba(255,255,255,.18); color: #fff;
  font-size: 11px; font-weight: 700; letter-spacing: .02em;
  display: flex; align-items: center; justify-content: center;
}
img.sesion-avatar { object-fit: cover; display: block; }
.head-user-menu {
  position: absolute; top: calc(100% + 10px); right: 0; z-index: 40;
  min-width: 230px; padding: 12px 14px;
  background: var(--surface-blanca); color: var(--ink);
  border: 1px solid var(--border); border-radius: 12px; box-shadow: var(--elev-2);
  display: flex; flex-direction: column; gap: 4px; font-size: 13px;
}
.head-user-menu b { font-weight: 600; }
.head-user-menu > span { color: var(--muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.lock-btn {
  border: 0; background: transparent; color: var(--muted); font: inherit; font-size: 12px; font-weight: 600;
  cursor: pointer; display: flex; align-items: center; gap: 7px; padding: 7px 10px; border-radius: 9px; margin-top: 8px;
}
.lock-btn:hover { background: var(--k-no-soft); color: var(--p-crit); }

/* ── Menú lateral: encima en móvil, columna en PC ─────────── */
.nav-scrim { position: fixed; inset: 0; background: rgba(16,24,40,0.42); z-index: 59; }
.tabbar {
  position: fixed; top: 0; bottom: 0; left: 0; width: 280px; z-index: 60;
  display: flex; flex-direction: column; gap: 2px;
  padding: 16px 12px 12px;
  background: var(--btn-primary-hover); border-right: 1px solid rgba(255,255,255,.12);
  box-shadow: var(--elev-2);
  transform: translateX(-105%); transition: transform .24s ease;
}
.plat-root.nav-open .tabbar { transform: translateX(0); }
@media (prefers-reduced-motion: reduce) { .tabbar { transition: none; } }
.tabbar > button {
  position: relative; border: 0; background: transparent; color: rgba(255,255,255,.72);
  font-family: var(--f-body); font-size: 13.5px; font-weight: 600; cursor: pointer;
  display: flex; align-items: center; gap: 12px;
  width: 100%; min-width: 0; text-align: left; padding: 11px 12px; border-radius: 9px;
}
.tabbar > button .icon { display: flex; line-height: 1; flex: 0 0 auto; }
.tabbar .lbl { flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.tabbar > button:hover { background: rgba(255,255,255,.08); }
.tabbar > button[aria-pressed="true"] { color: #fff; background: rgba(255,255,255,.15); }
.tabbar .badge {
  margin-left: auto; flex: 0 0 auto; min-width: 18px; height: 18px; border-radius: 9px;
  background: var(--p-warn); color: #fff; font-size: 10.5px; font-weight: 700;
  display: flex; align-items: center; justify-content: center; padding: 0 5px;
}
.tab-grupo {
  display: block; margin: 10px 12px 2px; padding-top: 10px;
  border-top: 1px solid rgba(255,255,255,.12);
  font-family: var(--f-data); font-size: 10px; font-weight: 700;
  letter-spacing: .1em; text-transform: uppercase; color: rgba(255,255,255,.45);
}
.tab-grupo.primero { margin-top: 0; padding-top: 0; border-top: 0; }
.side-foot {
  display: block; margin-top: auto; padding: 10px 12px 2px; font-size: 10px; color: rgba(255,255,255,.4);
  font-family: var(--f-data); letter-spacing: .08em; text-transform: uppercase;
}

/* ── Contenido ────────────────────────────────────────────── */
.screen { flex: 1 1 auto; min-height: 0; display: flex; flex-direction: column; gap: 10px; }
.card { background: var(--surface); border: 1px solid var(--border); border-radius: 12px; padding: 14px; box-shadow: var(--elev-1); display: flex; flex-direction: column; }
.card h2 { font-family: var(--f-display); font-size: 13.5px; font-weight: 700; letter-spacing: .02em; margin-bottom: 2px; color: var(--ink); }
.card .hint { font-size: 13px; color: var(--muted); margin-bottom: 10px; line-height: 1.5; }
.card-cab { display: flex; justify-content: space-between; align-items: center; gap: 10px; flex-wrap: wrap; margin-bottom: 4px; }
.empty { color: var(--muted); font-size: 14px; padding: 8px 0; }
.dos { display: grid; grid-template-columns: 1fr; gap: 10px; }
.tiles { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; flex: 0 0 auto; }
.tiles.tres { grid-template-columns: repeat(3, 1fr); }
.tile { background: var(--surface-blanca); border: 1px solid var(--border); border-radius: 12px; padding: 10px 12px; box-shadow: var(--elev-1); min-width: 0; display: flex; flex-direction: column; gap: 2px; }
.tile.ancha { grid-column: 1 / -1; }
.tile .label { font-family: var(--f-display); font-size: 10px; letter-spacing: .08em; text-transform: uppercase; color: var(--muted); font-weight: 700; }
.tile .value { font-family: var(--f-data); font-size: 24px; font-weight: 700; line-height: 1.2; color: var(--ink); font-variant-numeric: tabular-nums; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.tile .value.good { color: var(--p-good); }
.tile .value.warn { color: var(--p-warn); }
.tile .value.crit { color: var(--p-crit); }
.tile .value.info { color: var(--p-info); }
.btn.enlace { align-self: flex-end; margin-top: 10px; border: 0; background: transparent; color: var(--accent); padding: 4px 6px; }
.btn.enlace:hover { background: var(--accent-soft); }

/* Requieren atención: un punto sólido por severidad y la empresa en negrita. */
.atencion { list-style: none; padding: 0; display: flex; flex-direction: column; gap: 6px; }
.aten {
  display: flex; align-items: center; gap: 10px;
  padding: 9px 12px; border-radius: 10px; border: 1px solid var(--grid); background: var(--surface-blanca);
}
.aten-punto { flex: 0 0 auto; width: 10px; height: 10px; border-radius: 50%; background: var(--muted); }
.aten.crit .aten-punto { background: var(--p-crit); }
.aten.warn .aten-punto { background: var(--p-warn); }
.aten.info .aten-punto { background: var(--p-info); }
.aten-texto { display: flex; flex-direction: column; gap: 1px; min-width: 0; flex: 1; }
.aten-texto b { font-size: 13.5px; }
.aten-texto span { font-size: 12.5px; color: var(--ink-2); line-height: 1.4; }

.m-label {
  font-family: var(--f-display); font-size: 9.5px; letter-spacing: .09em;
  text-transform: uppercase; color: var(--muted); font-weight: 700;
}

/* ── Controles de la lista ────────────────────────────────── */
.plat-controls { display: flex; flex-direction: column; gap: 10px; }
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
.aviso { color: var(--muted); font-size: 14px; padding: 16px 2px; }
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
.chip.info { background: var(--p-info); }
.chip.chico { font-size: 10px; padding: 2px 7px; align-self: flex-start; margin-top: 4px; }

/* ── Fichas de empresa ────────────────────────────────────── */
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
.ficha-nombre small { font-size: 11.5px; color: var(--ink-2); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ficha-nombre .dueno { font-family: var(--f-data); color: var(--muted); }

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
.dato { display: flex; flex-direction: column; gap: 2px; min-width: 0; padding: 7px 8px; border: 1px solid var(--grid); border-radius: var(--r-sm); }
.dato.tope { border-color: var(--p-warn); background: var(--k-out-soft); }
.d-etq { font-family: var(--f-display); font-size: 9px; letter-spacing: .08em; text-transform: uppercase; color: var(--muted); font-weight: 700; white-space: nowrap; }
.d-val { font-family: var(--f-data); font-size: 15px; font-weight: 700; color: var(--ink); font-variant-numeric: tabular-nums; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.d-val em { font-style: normal; font-weight: 600; font-size: 12px; color: var(--muted); }
.d-val.chica { font-size: 12.5px; font-weight: 600; }

.falta { font-size: 12.5px; font-weight: 600; color: var(--p-warn); padding: 7px 10px; border-radius: var(--r-sm); background: var(--k-out-soft); }
.falta.crit { color: var(--p-crit); background: var(--k-no-soft); }
.ficha-acciones { display: flex; gap: 8px; justify-content: flex-end; align-items: center; padding-top: 10px; border-top: 1px solid var(--grid); }

/* ── Tareas ───────────────────────────────────────────────── */
.tarea-lista { display: flex; flex-direction: column; gap: 6px; }
.tarea { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; font-size: 12.5px; padding: 8px 10px; border: 1px solid var(--grid); border-radius: 10px; background: var(--surface-blanca); }
.tarea b { font-weight: 650; color: var(--ink); }
.tarea-cuando { color: var(--muted); }
.tarea-detalle { color: var(--ink-2); margin-left: auto; font-variant-numeric: tabular-nums; }
.tarea.error .tarea-detalle { color: var(--p-crit); }

/* ── Pagos ────────────────────────────────────────────────── */
.pagos { list-style: none; padding: 0; display: flex; flex-direction: column; gap: 8px; }
.pago { display: flex; flex-direction: column; gap: 4px; padding: 10px 12px; border: 1px solid var(--grid); border-radius: var(--r-sm); background: var(--surface-blanca); }
.pago-cab { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.pago-quien { display: flex; flex-direction: column; gap: 1px; min-width: 0; flex: 1 1 160px; }
.pago-quien b { font-size: 14px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.pago-monto { font-family: var(--f-data); font-size: 15px; font-variant-numeric: tabular-nums; }
.pago small { font-size: 12px; color: var(--ink-2); line-height: 1.45; }
.pago-pie { display: flex; justify-content: space-between; align-items: center; gap: 10px; }
.pago .ref { color: var(--muted); font-size: 11px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; }

/* ── Botones ──────────────────────────────────────────────── */
.btn {
  font: inherit; font-size: 13px; font-weight: 600; padding: 8px 14px;
  border-radius: var(--r-sm); border: 1px solid var(--border);
  background: var(--surface-blanca); color: var(--ink); cursor: pointer;
  display: inline-flex; align-items: center; justify-content: center; gap: 6px;
}
.btn:hover { background: var(--accent-soft); border-color: var(--accent); }
.btn:disabled { opacity: .45; cursor: not-allowed; }
.btn.small { padding: 5px 10px; font-size: 12px; flex: 0 0 auto; }
.btn.ico { width: 38px; height: 38px; padding: 0; color: var(--ink-2); }
.btn.ico:hover { color: var(--accent); }
.btn.ico.peligro:hover { background: var(--k-no-soft); border-color: var(--p-crit); color: var(--p-crit); }
.btn.primary { background: var(--btn-primary); border-color: var(--btn-primary); color: #fff; }
.btn.primary:hover { background: var(--btn-primary-hover); }
.btn.danger { background: var(--p-crit); border-color: var(--p-crit); color: #fff; }
.btn.danger:hover { filter: brightness(1.1); }
.btn.danger:disabled { background: var(--k-no-soft); border-color: transparent; color: var(--p-crit); }

/* ── Diálogos ─────────────────────────────────────────────── */
.velo { position: fixed; inset: 0; background: rgba(16, 24, 40, .55); display: grid; place-items: center; padding: 16px; z-index: 70; }
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
.dlg-alerta { font-size: 13px; font-weight: 600; color: var(--p-crit); background: var(--k-no-soft); border-radius: var(--r-sm); padding: 9px 12px; }
.dlg-campos { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
.dlg-campos label { display: flex; flex-direction: column; gap: 5px; font-size: 12px; font-weight: 600; color: var(--ink-2); min-width: 0; }
.dlg-campos label.ancho { grid-column: 1 / -1; }
.dlg-campos input, .dlg-campos select {
  font: inherit; font-size: 14px; font-weight: 400; padding: 9px 10px; border-radius: 8px;
  border: 1px solid var(--border); background: var(--surface-blanca); color: var(--ink); min-width: 0; width: 100%;
}
.dlg-campo { display: flex; flex-direction: column; gap: 7px; font-size: 13px; color: var(--ink-2); }
.dlg-campo input { font-family: var(--f-data); font-size: 14px; padding: 9px 12px; border-radius: var(--r-sm); border: 1px solid var(--border); background: var(--page); color: var(--ink); }
.dlg-botones { display: flex; justify-content: flex-end; gap: 8px; }

.toast {
  position: fixed; left: 50%; bottom: 24px; transform: translateX(-50%);
  background: var(--ink); color: #fff; font-size: 13.5px;
  padding: 10px 18px; border-radius: 999px; box-shadow: var(--elev-2); z-index: 80;
  max-width: calc(100vw - 32px); text-align: center;
}
.plat-root :focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }

/* ── Teléfono ─────────────────────────────────────────────── */
@media (max-width: 560px) {
  .compra { grid-template-columns: 1fr 1fr; }
  .compra-plan { grid-column: 1 / -1; }
  .uso { grid-template-columns: repeat(3, 1fr); }
  .fichas { grid-template-columns: 1fr; }
  .ficha-acciones { justify-content: space-between; }
  .ficha-acciones .btn.ico { flex: 1; height: 42px; }
  .dlg-campos { grid-template-columns: 1fr; }
  .dialogo { padding: 16px; }
  .velo { padding: 10px; align-items: end; }
  .tiles.tres { grid-template-columns: 1fr 1fr; }
  .tiles.tres .tile:first-child { grid-column: 1 / -1; }
}

/* ── PC: barra arriba, menú en columna, contenido con su scroll ── */
@media (min-width: 900px) {
  .plat-root {
    max-width: none; width: 100%; height: 100dvh;
    display: grid; grid-template-columns: 240px minmax(0, 1fr); grid-template-rows: auto minmax(0, 1fr);
    gap: 0; padding: 0;
  }
  .app-header {
    grid-column: 1 / -1; grid-row: 1; padding: 12px 24px; border-radius: 0;
    border-bottom: 1px solid rgba(255,255,255,.16); position: relative; z-index: 2;
  }
  .head-tab { font-size: 16px; }
  .app-header .date-note { font-size: 12.5px; }
  .head-user-nombre { display: block; }
  .tabbar {
    position: static; transform: none; width: auto; z-index: auto;
    grid-column: 1; grid-row: 2;
    align-self: stretch; height: 100%; gap: 4px;
    padding: 18px 14px 14px; border-radius: 0; box-shadow: none;
  }
  .nav-scrim { display: none; }
  .tabbar > button { font-size: 12px; padding: 10px 14px; gap: 10px; }
  .side-foot { padding: 10px 6px 2px; }
  /* riel de iconos */
  .nav-collapsed { grid-template-columns: 74px minmax(0, 1fr); }
  .nav-collapsed .tabbar { padding: 18px 8px 14px; }
  .nav-collapsed .lbl, .nav-collapsed .side-foot { display: none; }
  .nav-collapsed .tabbar > button { justify-content: center; padding: 10px 0; }
  .nav-collapsed .tab-grupo { font-size: 0; margin: 6px 8px 0; padding-top: 6px; }
  .nav-collapsed .tab-grupo.primero { display: none; }
  .nav-collapsed .tabbar .badge { position: absolute; top: 2px; right: 4px; margin-left: 0; }

  .screen { grid-column: 2; grid-row: 2; padding: 14px 20px; gap: 12px; overflow-y: auto; min-height: 0; }
  .card { padding: 18px 22px; }
  .card h2 { font-size: 16px; }
  .dos { grid-template-columns: 1fr 1fr; gap: 12px; }
  .tiles { grid-template-columns: repeat(3, 1fr); gap: 12px; }
  .tiles.tres { grid-template-columns: repeat(3, 1fr); }
  .tile { padding: 14px 16px; }
  .tile .value { font-size: 28px; }
  .tile.ancha { grid-column: span 2; }
  .plat-controls { flex-direction: row; align-items: center; flex-wrap: wrap; }
  .buscar-fila { flex: 1; min-width: 260px; }
}
`;
