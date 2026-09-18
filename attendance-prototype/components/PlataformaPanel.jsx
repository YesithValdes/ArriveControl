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
 * Los colores, las tarjetas, la tabla y el acordeón son los del panel de
 * empresa: mismos tokens y mismas medidas, sin paleta propia.
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
    user: <><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" /></>,
    file: <><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /></>,
    clock: <><circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" /></>,
    alert: <><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" /><line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" /></>,
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
    const leer = () => {
      const h = window.location.hash.replace('#', '');
      if (SECCIONES.some((s) => s.id === h)) setTab(h);
    };
    leer();
    // También al usar «atrás» del navegador o tocar un enlace con #.
    window.addEventListener('hashchange', leer);
    return () => window.removeEventListener('hashchange', leer);
  }, []);
  const irA = (id, opciones = {}) => {
    setTab(id);
    setNavOpen(false);
    if (opciones.buscar !== undefined) setFiltro(opciones.buscar);
    if (opciones.segmento) setSegmento(opciones.segmento);
    try { if (window.location.hash !== `#${id}`) window.history.pushState(null, '', `#${id}`); } catch { /* sin historial, sin drama */ }
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
    const texto = estado === 'APROBADA' ? 'Aprobado' : estado === 'PENDIENTE' ? 'Pendiente' : estado === 'RECHAZADA' ? 'Rechazado' : estado === 'ANULADA' ? 'Anulado' : 'Error';
    return <span className={`chip ${tono}`}>{texto}</span>;
  };

  /** Lo que le falta a una empresa para usarse de verdad, o null. */
  const queFalta = (e) => (e.esquemaRoto ? null
    : e.empleados === 0 ? 'Sin colaboradores registrados'
      : e.conRostro === 0 ? 'Nadie con rostro registrado: el kiosco no reconoce a nadie'
        : e.horarios === 0 ? 'Sin horarios: no se calculan horas'
          : e.kioscos === 0 ? 'Sin kiosco vinculado' : null);

  /** Los cuatro botones de una empresa, iguales en la tabla y en el acordeón. */
  const accionesDe = (e) => (
    <>
      <button className="btn btn-ico" title="Ajustes: plan, estado, fechas y topes" aria-label="Ajustes" onClick={() => abrirAjustes(e)}><Icono name="sliders" size={16} /></button>
      <button className="btn btn-ico" title="Regalar días de prueba o de suscripción" aria-label="Regalar días" onClick={() => setRegalando({ empresa: e, dias: 7, que: 'suscripcion' })}><Icono name="calendarPlus" size={16} /></button>
      <button className="btn btn-ico" title="Compras: cada pago y su desenlace" aria-label="Compras" onClick={() => verCompras(e)}><Icono name="receipt" size={16} /></button>
      <button className="btn btn-ico danger-btn" title="Eliminar la empresa y su esquema" aria-label="Eliminar" onClick={() => setBorrando({ empresa: e, confirmacion: '' })}><Icono name="trash" size={16} /></button>
    </>
  );

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

        {/* Resumen: el agregado (como el dashboard) y lo que requiere atención */}
        {tab === 'resumen' && resumen && (
          <>
            <div className="tiles">
              <div className="tile"><span className="label">Empresas</span><span className="value">{nf.format(resumen.total)}</span></div>
              <div className="tile"><span className="label">En uso</span><span className="value">{nf.format(resumen.activa)}</span></div>
              <div className={`tile${resumen.inactiva > 0 ? ' alerta' : ''}`}><span className="label">Sin uso</span><span className="value">{nf.format(resumen.inactiva)}</span></div>
              <div className={`tile${resumen.rota > 0 ? ' alerta' : ''}`}><span className="label">Esquemas rotos</span><span className="value">{nf.format(resumen.rota)}</span></div>
              <div className="tile"><span className="label">Pagando</span><span className="value">{nf.format(resumen.pagando)}</span></div>
              <div className="tile"><span className="label">En prueba</span><span className="value">{nf.format(resumen.enPrueba)}</span></div>
              <div className={`tile${resumen.vencidas > 0 ? ' alerta' : ''}`}><span className="label">Sin acceso</span><span className="value">{nf.format(resumen.vencidas)}</span></div>
              <div className="tile"><span className="label">Recaudado</span><span className="value">{fmtDinero(resumen.ingresos, resumen.moneda || MONEDA)}</span></div>
            </div>
            <p className="totales">
              {nf.format(resumen.empleados)} colaboradores · {nf.format(resumen.marcaciones)} marcaciones · {nf.format(resumen.kioscos)} kioscos en toda la plataforma
              {resumen.pendientes > 0 && <> · <button className="enlace" onClick={() => irA('pagos')}>{resumen.pendientes} pago{resumen.pendientes === 1 ? '' : 's'} sin resolver</button></>}
            </p>

            <section className="card grow">
                <h2>Requieren atención</h2>
                <p className="hint">Lo que conviene resolver hoy, de lo más urgente a lo menos.</p>
                {resumen.atencion.length === 0 ? (
                  <p className="empty">Nada pendiente. Todas las empresas están al día.</p>
                ) : (
                  <div className="atencion">
                    {resumen.atencion.map((a, i) => (
                      <div className="aten" key={`${a.empresa.id}-${i}`}>
                        <span className={`chip ${a.tono === 'info' ? 'neutral' : a.tono}`}>{a.tono === 'crit' ? 'Urgente' : a.tono === 'warn' ? 'Pronto' : 'Aviso'}</span>
                        <div className="aten-texto">
                          <b>{a.empresa.nombre}</b>
                          <span>{a.texto}</span>
                        </div>
                        <button className="btn small" onClick={() => irA('empresas', { buscar: a.empresa.nombre, segmento: 'todas' })}>Ver</button>
                      </div>
                    ))}
                  </div>
                )}
              </section>
          </>
        )}

        {/* Empresas: tabla en PC, acordeón en móvil (como Colaboradores) */}
        {tab === 'empresas' && empresas && (
          <section className="card grow">
            <div className="card-cab">
              <h2>Empresas <span className="conteo">{lista.length} de {empresas.length}</span></h2>
              <div className="controles">
                <div className="segmentos" role="tablist" aria-label="Filtrar empresas">
                  {FILTROS.map((f) => (
                    <button key={f.clave} role="tab" aria-selected={segmento === f.clave} className={segmento === f.clave ? 'activo' : ''} onClick={() => setSegmento(f.clave)}>
                      {f.etiqueta}
                    </button>
                  ))}
                </div>
                <input
                  className="buscar" type="search" placeholder="Buscar nombre, esquema, NIT o correo…"
                  value={filtro} onChange={(e) => setFiltro(e.target.value)}
                />
              </div>
            </div>

            {empresas.length === 0 && <p className="empty">Todavía no hay empresas registradas.</p>}
            {empresas.length > 0 && lista.length === 0 && <p className="empty">Ninguna empresa coincide con este filtro.</p>}

            {lista.length > 0 && (
              <>
                {/* PC: una fila por empresa, con todo lo que adquirió y usa a la vista. */}
                <div className="att-tablewrap">
                  <table className="att-table">
                    <thead>
                      <tr>
                        <th>Empresa</th>
                        <th>Plan</th>
                        <th>Vigencia</th>
                        <th>Actividad</th>
                        <th>Uso</th>
                        <th className="num">Pagado</th>
                        <th className="num" aria-label="Acciones" />
                      </tr>
                    </thead>
                    <tbody>
                      {lista.map((e) => {
                        const s = salud(e);
                        const sus = suscripcion(e);
                        const c = contrato(e);
                        const accesos = (e.usuarios ?? 0) + (e.invitaciones ?? 0);
                        const falta = queFalta(e);
                        return (
                          <tr className={`static${e.esquemaRoto ? ' con-novedad' : ''}`} key={e.id}>
                            <td>
                              <span className="att-name">{e.nombre}</span>
                              <span className="sub"><code>{e.esquema}</code>{e.nit ? ` · NIT ${e.nit}` : ''}</span>
                              {e.dueno && <span className="sub una-linea" title={e.dueno}>{e.dueno}</span>}
                            </td>
                            <td>
                              <span className={c.plan ? 'att-name' : 'libre'}>{c.nombre}</span>
                              <span className="sub">
                                {c.precio ?? (enPrueba(e) ? 'sin tarjeta' : '—')}
                                {c.tope != null ? ` · ${c.tope} colab.` : ''}
                                {c.cupo != null ? ` · ${c.cupo} acc.` : ''}
                                {(c.topeAcuerdo || c.cupoAcuerdo) ? ' · acuerdo' : ''}
                              </span>
                            </td>
                            <td>
                              <span className={`chip ${sus.tono === 'info' ? 'neutral' : sus.tono}`}>{sus.etiqueta}</span>
                              <span className="sub">{sus.detalle}</span>
                            </td>
                            <td>
                              <span className={`chip ${s.tono}`} title={`Creada el ${fmtFecha(e.creadaEn)}`}>{s.etiqueta}</span>
                              <span className="sub">{e.esquemaRoto ? 'sin datos' : haceCuanto(diasSinUso(e))}</span>
                              {falta && <span className="sub aviso-txt">{falta}</span>}
                            </td>
                            {/* Cuatro cifras en dos líneas: contra el tope, y en ámbar si ya lo tocó. */}
                            <td className="uso-td">
                              <span className={`uso-linea${c.cupo != null && accesos >= c.cupo ? ' al-tope' : ''}`}>
                                <b>{nf.format(accesos)}</b>{c.cupo != null ? `/${c.cupo}` : ''} accesos
                              </span>
                              <span className={`uso-linea${c.tope != null && e.empleados >= c.tope ? ' al-tope' : ''}`}>
                                <b>{e.empleados == null ? '—' : nf.format(e.empleados)}</b>{c.tope != null && e.empleados != null ? `/${c.tope}` : ''} colab.
                              </span>
                              <span className="uso-linea">
                                <b>{nf.format(e.kioscos ?? 0)}</b> kiosco{e.kioscos === 1 ? '' : 's'} · <b>{e.marcaciones == null ? '—' : nf.format(e.marcaciones)}</b> marc.
                              </span>
                            </td>
                            <td className="num">
                              {e.pagosOk > 0 ? (
                                <>
                                  <span className="att-name">{fmtDinero(e.totalPagado ?? 0, e.moneda || MONEDA)}</span>
                                  <span className="sub">{e.pagosOk} pago{e.pagosOk === 1 ? '' : 's'} · {fmtFecha(e.ultimoPago)}</span>
                                </>
                              ) : <span className="libre">—</span>}
                              {e.pagosPendientes > 0 && <span className="sub aviso-txt">{e.pagosPendientes} sin resolver</span>}
                            </td>
                            <td className="num"><div className="tl-actions">{accionesDe(e)}</div></td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                {/* Móvil: acordeón. Cabecera = nombre y vigencia; al abrir, lo demás. */}
                <Acordeon
                  items={lista.map((e) => {
                    const s = salud(e);
                    const sus = suscripcion(e);
                    const c = contrato(e);
                    const accesos = (e.usuarios ?? 0) + (e.invitaciones ?? 0);
                    const falta = queFalta(e);
                    return {
                      id: e.id,
                      title: e.nombre,
                      right: <span className={`chip ${sus.tono === 'info' ? 'neutral' : sus.tono}`}>{sus.etiqueta}</span>,
                      cuerpo: (
                        <>
                          <div className="acc-tiles">
                            <div className="acc-tile"><b>{nf.format(accesos)}{c.cupo != null ? <span className="libre">/{c.cupo}</span> : null}</b><small>Accesos</small></div>
                            <div className="acc-tile"><b>{e.empleados == null ? '—' : nf.format(e.empleados)}{c.tope != null ? <span className="libre">/{c.tope}</span> : null}</b><small>Colab.</small></div>
                            <div className="acc-tile"><b>{nf.format(e.kioscos ?? 0)}</b><small>Kioscos</small></div>
                            <div className="acc-tile"><b>{e.sedes == null ? '—' : nf.format(e.sedes)}</b><small>Sedes</small></div>
                            <div className="acc-tile"><b>{e.marcaciones == null ? '—' : nf.format(e.marcaciones)}</b><small>Marcac.</small></div>
                            <div className="acc-tile"><b className="chica">{e.esquemaRoto ? '—' : haceCuanto(diasSinUso(e))}</b><small>Actividad</small></div>
                          </div>
                          <div className="acc-lineas">
                            <span className="acc-linea"><Icono name="file" size={14} />
                              <b>{c.nombre}</b>{c.precio ? ` · ${c.precio}` : ''}{c.tope != null ? ` · ${c.tope} colab.` : ''}{c.cupo != null ? ` · ${c.cupo} acceso${c.cupo === 1 ? '' : 's'}` : ''}{(c.topeAcuerdo || c.cupoAcuerdo) ? ' · acuerdo' : ''}
                            </span>
                            <span className="acc-linea"><Icono name="clock" size={14} />{sus.detalle}</span>
                            <span className="acc-linea"><Icono name="receipt" size={14} />
                              {e.pagosOk > 0 ? `${fmtDinero(e.totalPagado ?? 0, e.moneda || MONEDA)} · ${e.pagosOk} pago${e.pagosOk === 1 ? '' : 's'} · último el ${fmtFecha(e.ultimoPago)}` : 'Nunca ha pagado'}
                              {e.pagosPendientes > 0 ? ` · ${e.pagosPendientes} sin resolver` : ''}
                            </span>
                            <span className="acc-linea"><Icono name="user" size={14} />{e.dueno ?? 'sin dueño activo'}</span>
                            <span className="acc-linea"><Icono name="database" size={14} /><code>{e.esquema}</code>{e.nit ? ` · NIT ${e.nit}` : ''}</span>
                            <span className="acc-linea"><span className={`chip ${s.tono}`}>{s.etiqueta}</span><span className="libre">creada el {fmtFecha(e.creadaEn)}</span></span>
                            {falta && <span className="acc-linea aviso"><Icono name="alert" size={14} />{falta}</span>}
                            {e.esquemaRoto && <span className="acc-linea aviso"><Icono name="alert" size={14} />El esquema no responde: alta a medias o borrado a mano.</span>}
                          </div>
                        </>
                      ),
                      actions: <div className="acc-iconos">{accionesDe(e)}</div>,
                    };
                  })}
                />
              </>
            )}
          </section>
        )}

        {/* Pagos: todos los de la plataforma; tabla en PC, acordeón en móvil */}
        {tab === 'pagos' && (
          <>
            {resumen && (
              <div className="tiles">
                <div className="tile"><span className="label">Recaudado</span><span className="value">{fmtDinero(resumen.ingresos, resumen.moneda || MONEDA)}</span></div>
                <div className="tile"><span className="label">Aprobados</span><span className="value">{nf.format(pagos ? pagos.filter((p) => p.estado === 'APROBADA').length : 0)}</span></div>
                <div className={`tile${resumen.pendientes > 0 ? ' alerta' : ''}`}><span className="label">Sin resolver</span><span className="value">{nf.format(resumen.pendientes)}</span></div>
                <div className="tile"><span className="label">Empresas pagando</span><span className="value">{nf.format(resumen.pagando)}</span></div>
              </div>
            )}
            <section className="card grow">
              <div className="card-cab">
                <h2>Pagos {pagos && <span className="conteo">{listaPagos.length} de {pagos.length}</span>}</h2>
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
                <>
                  <div className="att-tablewrap">
                    <table className="att-table">
                      <thead>
                        <tr>
                          <th>Fecha</th>
                          <th>Empresa</th>
                          <th>Plan</th>
                          <th className="num">Monto</th>
                          <th>Estado</th>
                          <th>Cubre hasta</th>
                          <th>Referencia</th>
                          <th className="num" aria-label="Acciones" />
                        </tr>
                      </thead>
                      <tbody>
                        {listaPagos.map((p) => {
                          const plan = planPorId(p.planId);
                          return (
                            <tr className="static" key={p.id}>
                              <td className="nw">{fmtFechaHora(p.creadoEn)}</td>
                              <td><span className="att-name">{p.empresa}</span><span className="sub"><code>{p.esquema}</code></span></td>
                              <td>{plan ? plan.nombre : (p.planId ?? '—')}<span className="sub">{p.meses} mes{p.meses === 1 ? '' : 'es'} · {p.proveedor}</span></td>
                              <td className="num att-name">{fmtDinero(p.monto, p.moneda)}</td>
                              <td>{chipPago(p.estado)}</td>
                              <td className="nw">{p.cubreHasta ? fmtFecha(p.cubreHasta) : <span className="libre">—</span>}</td>
                              <td><code className="ref">{p.referencia}</code></td>
                              <td className="num"><button className="btn small" onClick={() => irA('empresas', { buscar: p.empresa, segmento: 'todas' })}>Empresa</button></td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                  <Acordeon
                    items={listaPagos.map((p) => {
                      const plan = planPorId(p.planId);
                      return {
                        id: p.id,
                        title: p.empresa,
                        right: <><span className="acc-note">{fmtDinero(p.monto, p.moneda)}</span>{chipPago(p.estado)}</>,
                        fields: [
                          ['Fecha', fmtFechaHora(p.creadoEn)],
                          ['Plan', `${plan ? plan.nombre : (p.planId ?? '—')} · ${p.meses} mes${p.meses === 1 ? '' : 'es'}`],
                          ['Cubre hasta', p.cubreHasta ? fmtFecha(p.cubreHasta) : '—'],
                          ['Pasarela', p.proveedor],
                          ['Referencia', p.referencia],
                        ],
                        actions: <button className="btn small block" onClick={() => irA('empresas', { buscar: p.empresa, segmento: 'todas' })}>Ver empresa</button>,
                      };
                    })}
                  />
                </>
              )}
            </section>
          </>
        )}

        {/* Envíos automáticos: las tareas programadas */}
        {tab === 'envios' && (
          <section className="card grow">
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
        <div className="overlay" onClick={(ev) => ev.target === ev.currentTarget && !guardando && setEditando(null)}>
          <div className="dialog" role="dialog" aria-modal="true" aria-labelledby="dlg-aj">
            <h3 id="dlg-aj">Ajustes de «{editando.empresa.nombre}»</h3>
            <p className="hint">
              Los topes vacíos siguen al plan. Una fecha vacía quita la vigencia. El acceso se
              abre con «Al día» y una fecha de pago futura, o con la prueba corriendo.
            </p>
            <div className="field">
              <label htmlFor="aj-plan">Plan contratado</label>
              <select id="aj-plan" value={editando.planId} onChange={(ev) => setEditando({ ...editando, planId: ev.target.value })}>
                <option value="">Sin plan (solo prueba)</option>
                {Object.entries(PLANES).map(([id, p]) => (
                  <option key={id} value={id}>
                    {p.nombre} · {fmtDinero(p.precio, MONEDA)}/mes · {p.empleados} colab. · {p.usuarios} acceso{p.usuarios === 1 ? '' : 's'}
                  </option>
                ))}
              </select>
            </div>
            <div className="hours-row">
              <div className="sub-field">
                Estado
                <select value={editando.estado} onChange={(ev) => setEditando({ ...editando, estado: ev.target.value })}>
                  <option value="activa">Al día</option>
                  <option value="vencida">Vencida</option>
                  <option value="cancelada">Cancelada</option>
                </select>
              </div>
              <div className="sub-field">
                Pagada hasta
                <input type="date" value={editando.venceEn} onChange={(ev) => setEditando({ ...editando, venceEn: ev.target.value })} />
              </div>
              <div className="sub-field">
                Prueba hasta
                <input type="date" value={editando.pruebaHasta} onChange={(ev) => setEditando({ ...editando, pruebaHasta: ev.target.value })} />
              </div>
            </div>
            <div className="hours-row dos">
              <div className="sub-field">
                Tope de colaboradores
                <input
                  type="number" min="1" inputMode="numeric"
                  placeholder={planEditado ? `del plan: ${planEditado.empleados}` : 'sin tope'}
                  value={editando.limiteEmpleados}
                  onChange={(ev) => setEditando({ ...editando, limiteEmpleados: ev.target.value })}
                />
              </div>
              <div className="sub-field">
                Accesos al panel
                <input
                  type="number" min="1" inputMode="numeric"
                  placeholder={planEditado ? `del plan: ${planEditado.usuarios}` : 'sin tope'}
                  value={editando.limiteUsuarios}
                  onChange={(ev) => setEditando({ ...editando, limiteUsuarios: ev.target.value })}
                />
              </div>
            </div>
            <div className="dialog-actions">
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
        <div className="overlay" onClick={(ev) => ev.target === ev.currentTarget && setCompras(null)}>
          <div className="dialog ancho" role="dialog" aria-modal="true" aria-labelledby="dlg-co">
            <h3 id="dlg-co">Compras de «{compras.empresa.nombre}»</h3>
            {compras.pagos === null && <p className="hint">Cargando…</p>}
            {compras.error && <p className="banner-vencida">{compras.error}</p>}
            {compras.pagos?.length === 0 && !compras.error && <p className="hint">Esta empresa no ha iniciado ningún pago.</p>}
            {compras.pagos?.length > 0 && (
              <div className="compras">
                {compras.pagos.map((p) => {
                  const plan = planPorId(p.planId);
                  return (
                    <div className="compra" key={p.id}>
                      <div className="compra-cab">
                        <b>{fmtDinero(p.monto, p.moneda)}</b>
                        {chipPago(p.estado)}
                        <span className="libre">{fmtFecha(p.creadoEn)}</span>
                      </div>
                      <span className="sub">
                        {plan ? plan.nombre : (p.planId ?? 'plan sin registrar')} · {p.meses} mes{p.meses === 1 ? '' : 'es'}
                        {p.cubreHasta ? ` · cubre hasta el ${fmtFecha(p.cubreHasta)}` : ''} · {p.proveedor}
                      </span>
                      <span className="sub"><code className="ref">{p.referencia}</code></span>
                    </div>
                  );
                })}
              </div>
            )}
            <div className="dialog-actions">
              <button className="btn" onClick={() => setCompras(null)}>Cerrar</button>
            </div>
          </div>
        </div>
      )}

      {/* Regalar días de servicio */}
      {regalando && (
        <div className="overlay" onClick={(ev) => ev.target === ev.currentTarget && setRegalando(null)}>
          <div className="dialog" role="dialog" aria-modal="true" aria-labelledby="dlg-dias">
            <h3 id="dlg-dias">Días para «{regalando.empresa.nombre}»</h3>
            <p className="hint">
              {suscripcion(regalando.empresa).detalle}. Los días se SUMAN a lo que ya
              tiene, así que regalar nunca le quita los que le quedaban.
            </p>
            <div className="hours-row dos">
              <div className="sub-field">
                Cuántos días
                <input
                  type="number" min="1" max="365" inputMode="numeric" value={regalando.dias}
                  onChange={(ev) => setRegalando({ ...regalando, dias: ev.target.value })}
                />
              </div>
              <div className="sub-field">
                A qué
                <select value={regalando.que} onChange={(ev) => setRegalando({ ...regalando, que: ev.target.value })}>
                  <option value="suscripcion">Suscripción (acceso pago)</option>
                  <option value="prueba">Prueba gratuita</option>
                </select>
              </div>
            </div>
            <div className="dialog-actions">
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
        <div className="overlay" onClick={(ev) => ev.target === ev.currentTarget && setBorrando(null)}>
          <div className="dialog" role="dialog" aria-modal="true" aria-labelledby="dlg-t">
            <h3 id="dlg-t">Eliminar «{borrando.empresa.nombre}»</h3>
            <p className="hint">
              Se borra el esquema <code>{borrando.empresa.esquema}</code> completo:
              sus <b>{nf.format(borrando.empresa.usuarios ?? 0)}</b> usuario(s),
              sus <b>{borrando.empresa.empleados == null ? '?' : nf.format(borrando.empresa.empleados)}</b> colaborador(es)
              y sus <b>{borrando.empresa.marcaciones == null ? '?' : nf.format(borrando.empresa.marcaciones)}</b> marcaciones.
            </p>
            <p className="banner-vencida">Esto no se puede deshacer.</p>
            <div className="field">
              <label htmlFor="dlg-conf">Escribe <code>{borrando.empresa.esquema}</code> para confirmar</label>
              <input
                id="dlg-conf" type="text" autoFocus autoComplete="off" spellCheck="false"
                value={borrando.confirmacion}
                onChange={(ev) => setBorrando({ ...borrando, confirmacion: ev.target.value })}
              />
            </div>
            <div className="dialog-actions">
              <button className="btn" onClick={() => setBorrando(null)}>Cancelar</button>
              <button
                className="btn primary danger"
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

/**
 * Lista en acordeón para móvil (la misma que usa el panel de empresa en
 * Colaboradores y Asistencia): cabecera = lo esencial; al abrir, lo demás.
 */
function Acordeon({ items }) {
  const [openId, setOpenId] = useState(null);
  return (
    <div className="acc">
      {items.map((it) => {
        const open = openId === it.id;
        return (
          <div className={`acc-item${open ? ' open' : ''}`} key={it.id}>
            <button className="acc-head" aria-expanded={open} onClick={() => setOpenId(open ? null : it.id)}>
              <span className="acc-title">{it.title}</span>
              {it.right}
              <span className="acc-chev"><Icono name="chevronRight" size={14} /></span>
            </button>
            {open && (
              <div className="acc-body">
                {it.cuerpo ?? it.fields.map(([label, value]) => (
                  <div className="acc-field" key={label}><b>{label}</b><span>{value}</span></div>
                ))}
                {it.actions && <div className="acc-actions">{it.actions}</div>}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

/* Todo sale de los tokens de app/globals.css y de las MISMAS reglas que el
   panel de empresa (AdminPanel.jsx): barra, menú, tarjetas, tiles, tabla,
   acordeón, chips, botones y diálogos copian sus medidas y colores, para que
   las dos pantallas se sientan como una sola aplicación. */
const CSS = `
.plat-root {
  --page: #dfe8f8;
  font-family: var(--f-body);
  font-weight: 300;
  color: var(--ink);
  background: var(--page);
  min-height: 100dvh; max-width: 560px; margin: 0 auto;
  display: flex; flex-direction: column; gap: 10px;
  padding: 14px 12px 10px; box-sizing: border-box;
}
.plat-root * { box-sizing: border-box; margin: 0; }
.plat-root b { font-weight: 600; }
.plat-root code { font-family: var(--f-data); font-size: .92em; background: var(--accent-soft); padding: 1px 5px; border-radius: 4px; }

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
.head-brand { font-family: var(--f-display); font-size: 13px; font-weight: 400; letter-spacing: .13em; color: rgba(255,255,255,.72); white-space: nowrap; }
.head-brand b { font-weight: 800; color: #fff; }
@media (max-width: 430px) { .head-brand { display: none; } }
@media (max-width: 360px) { .head-logo { display: none; } }
.head-logo { flex: 0 0 auto; width: 34px; height: 34px; border-radius: 9px; background: rgba(255,255,255,.14); color: #fff; display: flex; align-items: center; justify-content: center; }
.head-titles { display: flex; flex-direction: column; min-width: 0; overflow: hidden; flex: 1 1 auto; }
.head-tab { font-family: var(--f-display); font-size: 15px; font-weight: 700; color: #fff; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.app-header .date-note { color: rgba(255,255,255,.65); font-size: 11.5px; font-family: var(--f-data); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.head-right { margin-left: auto; display: flex; align-items: center; gap: 6px; position: relative; }
.head-ico { width: 36px; height: 36px; border-radius: 50%; border: 0; background: transparent; color: #fff; display: flex; align-items: center; justify-content: center; cursor: pointer; }
.head-ico:hover { background: rgba(255,255,255,.12); }
.head-user { position: relative; }
.head-user-btn { display: flex; align-items: center; gap: 8px; background: transparent; border: 0; color: #fff; cursor: pointer; font: inherit; padding: 3px; border-radius: 999px; }
.head-user-btn:hover, .head-user-btn[aria-expanded="true"] { background: rgba(255,255,255,.12); }
.head-user-nombre { display: none; max-width: 170px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 600; font-size: 13px; padding-right: 6px; }
.sesion-avatar { flex: 0 0 auto; width: 30px; height: 30px; border-radius: 50%; background: rgba(255,255,255,.18); color: #fff; font-size: 11px; font-weight: 700; letter-spacing: .02em; display: flex; align-items: center; justify-content: center; }
img.sesion-avatar { object-fit: cover; display: block; }
.head-user-menu {
  position: absolute; top: calc(100% + 10px); right: 0; z-index: 40; min-width: 230px; padding: 12px 14px;
  background: var(--surface); color: var(--ink); border: 1px solid var(--border); border-radius: 12px; box-shadow: var(--elev-1);
  display: flex; flex-direction: column; gap: 4px; font-size: 13px;
}
.head-user-menu b { font-weight: 600; }
.head-user-menu > span { color: var(--muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.lock-btn { border: 0; background: transparent; color: var(--muted); font: inherit; font-size: 12px; font-weight: 600; cursor: pointer; display: flex; align-items: center; gap: 7px; padding: 7px 10px; border-radius: 9px; margin-top: 8px; }
.lock-btn:hover { background: var(--crit-soft); color: var(--crit-text); }

/* ── Menú lateral: encima en móvil, columna en PC ─────────── */
.nav-scrim { position: fixed; inset: 0; background: rgba(16,24,40,0.42); z-index: 59; }
.tabbar {
  position: fixed; top: 0; bottom: 0; left: 0; width: 280px; z-index: 60;
  display: flex; flex-direction: column; gap: 2px; padding: 16px 12px 12px;
  background: var(--btn-primary-hover); border-right: 1px solid rgba(255,255,255,.12); box-shadow: var(--elev-2);
  transform: translateX(-105%); transition: transform .24s ease;
}
.plat-root.nav-open .tabbar { transform: translateX(0); }
@media (prefers-reduced-motion: reduce) { .tabbar { transition: none; } .acc-chev { transition: none; } }
.tabbar > button {
  position: relative; border: 0; background: transparent; color: rgba(255,255,255,.72);
  font-family: var(--f-body); font-size: 13.5px; font-weight: 600; cursor: pointer;
  display: flex; align-items: center; gap: 12px; width: 100%; min-width: 0; text-align: left; padding: 11px 12px; border-radius: 9px;
}
.tabbar > button .icon { display: flex; line-height: 1; flex: 0 0 auto; }
.tabbar .lbl { flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.tabbar > button:hover { background: rgba(255,255,255,.08); }
.tabbar > button[aria-pressed="true"] { color: #fff; background: rgba(255,255,255,.15); }
.tabbar .badge { margin-left: auto; flex: 0 0 auto; min-width: 18px; height: 18px; border-radius: 9px; background: var(--crit); color: #fff; font-size: 10.5px; font-weight: 700; display: flex; align-items: center; justify-content: center; padding: 0 5px; }
.tab-grupo { display: block; margin: 10px 12px 2px; padding-top: 10px; border-top: 1px solid rgba(255,255,255,.12); font-family: var(--f-data); font-size: 10px; font-weight: 700; letter-spacing: .1em; text-transform: uppercase; color: rgba(255,255,255,.45); }
.tab-grupo.primero { margin-top: 0; padding-top: 0; border-top: 0; }
.side-foot { display: block; margin-top: auto; padding: 10px 12px 2px; font-size: 10px; color: rgba(255,255,255,.4); font-family: var(--f-data); letter-spacing: .08em; text-transform: uppercase; }

/* ── Contenido: tarjetas y tiles del dashboard ────────────── */
.screen { flex: 1 1 auto; min-height: 0; display: flex; flex-direction: column; gap: 10px; }
.card { background: var(--surface); border: 1px solid var(--border); border-radius: 12px; padding: 14px; box-shadow: var(--elev-1); }
.card.grow { flex: 1 1 auto; min-height: 0; display: flex; flex-direction: column; }
.card h2 { font-family: var(--f-display); font-size: 13.5px; font-weight: 700; letter-spacing: .02em; margin-bottom: 2px; color: var(--ink); display: flex; align-items: baseline; gap: 8px; }
.card .hint { font-size: 13px; color: var(--muted); margin-bottom: 10px; line-height: 1.5; }
.card-cab { display: flex; justify-content: space-between; align-items: center; gap: 10px; flex-wrap: wrap; margin-bottom: 10px; }
.conteo { font-family: var(--f-data); font-size: 12px; color: var(--muted); font-weight: 500; }
.empty { color: var(--muted); font-size: 14px; padding: 8px 0; }
.aviso { color: var(--muted); font-size: 14px; padding: 16px 2px; }
.aviso.crit { color: var(--crit-text); }
.libre { color: var(--muted); font-size: 12px; font-weight: 400; font-style: normal; }
.tiles { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; flex: 0 0 auto; }
.tile { background: var(--surface); border: 1px solid var(--border); border-radius: 12px; padding: 10px 12px; box-shadow: var(--elev-1); min-width: 0; }
.tile .label { display: block; font-family: var(--f-display); font-size: 10px; letter-spacing: .08em; text-transform: uppercase; color: var(--muted); font-weight: 600; }
.tile .value { display: block; font-family: var(--f-data); font-size: 24px; font-weight: 700; line-height: 1.2; color: var(--ink); font-variant-numeric: tabular-nums; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.tile.alerta .value { color: var(--accent); }
.totales { font-size: 12.5px; color: var(--muted); padding: 0 2px; }
.enlace { border: 0; background: transparent; color: var(--accent); font: inherit; font-weight: 600; cursor: pointer; padding: 0; }
.enlace:hover { text-decoration: underline; }

/* Requieren atención: chip de urgencia, empresa en negrita, «Ver» al final. */
.atencion { display: flex; flex-direction: column; }
.aten { display: flex; align-items: center; gap: 10px; padding: 10px 0; border-top: 1px solid var(--grid); }
.aten:first-child { border-top: 0; }
.aten-texto { display: flex; flex-direction: column; gap: 1px; min-width: 0; flex: 1; }
.aten-texto b { font-size: 13.5px; }
.aten-texto span { font-size: 12.5px; color: var(--ink-2); line-height: 1.4; }

/* ── Chips: los del panel (suaves, con punto) ─────────────── */
.chip { display: inline-flex; align-items: center; gap: 6px; font-family: var(--f-data); font-size: 12px; font-weight: 600; padding: 2px 8px; border-radius: 4px; white-space: nowrap; }
.chip::before { content: ""; width: 6px; height: 6px; border-radius: 50%; background: currentColor; }
.chip.crit { color: var(--crit-text); background: var(--crit-soft); }
.chip.warn { color: var(--warn-text); background: var(--warn-soft); }
.chip.good { color: var(--good-text); background: var(--good-soft); }
.chip.neutral { color: var(--ink-2); background: var(--accent-soft); }
.chip.neutral::before { background: var(--accent); }

/* ── Controles de la lista ────────────────────────────────── */
.controles { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; flex: 1 1 auto; min-width: 0; }
.segmentos { display: inline-flex; background: var(--page); border: 1px solid var(--grid); border-radius: 8px; padding: 2px; gap: 2px; overflow-x: auto; max-width: 100%; scrollbar-width: none; }
.segmentos::-webkit-scrollbar { display: none; }
.segmentos button { font-family: var(--f-data); font-size: 12px; font-weight: 600; color: var(--ink-2); border: 0; background: transparent; padding: 6px 11px; border-radius: 6px; cursor: pointer; white-space: nowrap; flex: 0 0 auto; }
.segmentos button:hover { color: var(--accent); }
.segmentos button.activo { background: var(--surface); color: var(--ink); box-shadow: var(--elev-1); }
.buscar { flex: 1 1 200px; min-width: 0; font-family: var(--f-data); font-size: 13.5px; padding: 7px 10px; border-radius: 8px; border: 1px solid var(--border); background: var(--page); color: var(--ink); }

/* ── Tabla (PC) y acordeón (móvil), como en Colaboradores ─── */
.att-tablewrap { display: none; overflow-x: auto; }
.att-table { border-collapse: collapse; width: 100%; min-width: 960px; font-size: 13px; font-variant-numeric: tabular-nums; }
.att-table th { text-align: left; font-size: 11px; letter-spacing: .05em; text-transform: uppercase; color: var(--muted); font-weight: 600; padding: 6px 10px 6px 0; border-bottom: 1px solid var(--grid); white-space: nowrap; }
.att-table td { padding: 9px 10px 9px 0; border-bottom: 1px solid var(--grid); color: var(--ink); vertical-align: top; }
.att-table th.num, .att-table td.num { text-align: right; }
.att-table tbody tr:hover td { background: var(--accent-soft); }
.att-table tbody tr.con-novedad td { background: color-mix(in srgb, var(--crit-soft) 55%, transparent); }
.att-table .att-name { font-weight: 600; display: block; }
.att-table td.num.att-name { display: table-cell; }
.att-table .sub { display: block; font-size: 11.5px; color: #475467; margin-top: 2px; line-height: 1.35; max-width: 230px; overflow-wrap: anywhere; }
.att-table td.num .sub { margin-left: auto; white-space: nowrap; }
.att-table .sub.una-linea { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 190px; }
.att-table .sub.aviso-txt { color: var(--warn-text); font-weight: 600; max-width: 200px; }
.uso-td { white-space: nowrap; }
.uso-linea { display: block; font-size: 12px; color: var(--ink-2); line-height: 1.45; }
.uso-linea b { font-weight: 600; color: var(--ink); }
.uso-linea.al-tope, .uso-linea.al-tope b { color: var(--warn-text); font-weight: 700; }
.att-table .chip { margin-bottom: 2px; }
.att-table code.ref, .compra code.ref { background: transparent; padding: 0; font-size: 11.5px; color: var(--muted); overflow-wrap: anywhere; }
.att-table td.nw { white-space: nowrap; }
.tl-actions { display: flex; gap: 5px; justify-content: flex-end; }
.tl-actions .btn.btn-ico { padding: 6px 7px; min-width: 32px; }

.acc { display: flex; flex-direction: column; gap: 8px; }
.acc-item { background: var(--surface); border: 1px solid var(--grid); border-radius: 10px; box-shadow: var(--elev-1); }
.acc-head { display: flex; align-items: center; gap: 10px; width: 100%; border: 0; background: transparent; font: inherit; font-weight: 600; font-size: 14px; padding: 12px 14px; cursor: pointer; text-align: left; color: var(--ink); border-radius: 10px; }
.acc-head:active { background: var(--accent-soft); }
.acc-title { flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.acc-note { font-family: var(--f-data); font-size: 12.5px; color: var(--ink-2); font-weight: 600; flex: 0 0 auto; }
.acc-chev { color: var(--muted); display: flex; flex: 0 0 auto; transition: transform .18s; }
.acc-item.open .acc-chev { transform: rotate(90deg); }
.acc-body { border-top: 1px solid var(--grid); padding: 10px 14px 12px; display: flex; flex-direction: column; gap: 7px; }
.acc-field { display: flex; justify-content: space-between; align-items: baseline; gap: 12px; font-size: 13px; }
.acc-field b { color: var(--muted); font-size: 10.5px; letter-spacing: .06em; text-transform: uppercase; font-weight: 600; flex: 0 0 auto; }
.acc-field span { color: var(--ink-2); text-align: right; font-variant-numeric: tabular-nums; min-width: 0; overflow-wrap: anywhere; }
.acc-tiles { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 6px; }
.acc-tile { display: flex; flex-direction: column; align-items: center; gap: 1px; padding: 8px 4px; border-radius: 8px; background: var(--page); text-align: center; min-width: 0; }
.acc-tile b { font-family: var(--f-data); font-size: 14.5px; font-weight: 700; color: var(--ink); font-variant-numeric: tabular-nums; white-space: nowrap; }
.acc-tile b.chica { font-size: 12px; font-weight: 600; }
.acc-tile b .libre { font-weight: 500; }
.acc-tile small { font-size: 10.5px; letter-spacing: .04em; text-transform: uppercase; color: var(--muted); font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 100%; }
.acc-lineas { display: flex; flex-direction: column; gap: 6px; margin-top: 2px; }
.acc-linea { display: inline-flex; align-items: center; gap: 6px; font-size: 12.5px; color: var(--ink-2); min-width: 0; flex-wrap: wrap; }
.acc-linea > svg { flex: none; color: var(--muted); }
.acc-linea.aviso { color: var(--warn-text); }
.acc-linea.aviso > svg { color: var(--warn-text); }
.acc-actions { margin-top: 4px; display: flex; flex-direction: column; gap: 6px; }
.acc-iconos { display: flex; gap: 8px; }
.acc-iconos .btn { flex: 1 1 0; justify-content: center; }

/* ── Tareas ───────────────────────────────────────────────── */
.tarea-lista { display: flex; flex-direction: column; }
.tarea { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; font-size: 12.5px; padding: 8px 0; border-top: 1px solid var(--grid); }
.tarea:first-child { border-top: 0; }
.tarea b { font-weight: 600; color: var(--ink); }
.tarea-cuando { color: var(--muted); font-family: var(--f-data); font-size: 12px; }
.tarea-detalle { color: var(--ink-2); margin-left: auto; font-variant-numeric: tabular-nums; }
.tarea.error .tarea-detalle { color: var(--crit-text); }

/* ── Botones (los del panel) ──────────────────────────────── */
.btn { border: 1px solid var(--grid); background: var(--surface); color: var(--ink-2); font-family: var(--f-data); font-size: 13.5px; font-weight: 600; padding: 7px 14px; border-radius: 6px; cursor: pointer; box-shadow: var(--elev-1); }
.btn:hover { border-color: var(--accent); color: var(--accent); }
.btn:active { box-shadow: var(--press); }
.btn:disabled { opacity: .5; cursor: not-allowed; }
.btn.small { font-size: 12px; padding: 4px 10px; }
.btn.small.block { display: block; width: 100%; text-align: center; }
.btn.btn-ico { display: inline-flex; align-items: center; justify-content: center; gap: 6px; padding: 7px 9px; min-width: 36px; line-height: 1; }
.btn.danger-btn:hover { border-color: var(--crit); color: var(--crit-text); background: var(--crit-soft); }
.btn.primary { background: var(--btn-primary); border-color: var(--btn-primary); color: var(--accent-ink); }
.btn.primary:hover { background: var(--btn-primary-hover); border-color: var(--btn-primary-hover); color: var(--accent-ink); }
.btn.primary.danger { background: var(--crit); border-color: var(--crit); }
.btn.primary.danger:hover { filter: brightness(1.1); }

/* ── Diálogos (los del panel) ─────────────────────────────── */
.overlay { position: fixed; inset: 0; background: rgba(0,0,0,.4); display: flex; align-items: center; justify-content: center; padding: 16px; z-index: 70; }
/* min-width: 0 porque el diálogo es un ítem flex: sin eso, un <select> con
   una opción larga lo ensancha más que la pantalla del celular. */
.dialog { background: var(--surface); color: var(--ink); border: 1px solid var(--grid); border-radius: 10px; padding: 18px 20px; max-width: 440px; width: 100%; min-width: 0; box-shadow: 0 12px 40px rgba(16,24,40,0.18); max-height: calc(100dvh - 32px); overflow: auto; }
.dialog.ancho { max-width: 520px; }
.dialog h3 { font-family: var(--f-display); font-size: 14px; font-weight: 700; color: var(--ink); margin-bottom: 2px; }
.dialog .hint { font-size: 13px; color: var(--muted); margin-bottom: 12px; line-height: 1.5; }
.field { display: flex; flex-direction: column; gap: 4px; margin-bottom: 12px; }
.field label { font-size: 13px; font-weight: 600; color: var(--ink-2); }
.field input, .field select { font-family: var(--f-data); font-size: 14px; padding: 7px 10px; border-radius: 8px; border: 1px solid var(--border); background: var(--page); color: var(--ink); color-scheme: light; min-width: 0; width: 100%; }
.hours-row { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 8px; margin-bottom: 12px; }
.hours-row.dos { grid-template-columns: 1fr 1fr; }
.hours-row .sub-field { display: flex; flex-direction: column; gap: 3px; font-size: 12px; font-weight: 600; color: var(--muted); min-width: 0; }
.hours-row .sub-field input, .hours-row .sub-field select { font-family: var(--f-data); font-size: 14px; font-weight: 400; padding: 7px 8px; border-radius: 8px; border: 1px solid var(--border); background: var(--page); color: var(--ink); color-scheme: light; min-width: 0; width: 100%; }
.dialog-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 4px; }
.banner-vencida { background: var(--crit-soft); color: var(--crit-text); border: 1px solid var(--crit); border-radius: 10px; padding: 9px 14px; font-size: 13px; font-weight: 600; margin-bottom: 12px; }
.compras { display: flex; flex-direction: column; margin-bottom: 12px; }
.compra { display: flex; flex-direction: column; gap: 2px; padding: 9px 0; border-top: 1px solid var(--grid); }
.compra:first-child { border-top: 0; }
.compra-cab { display: flex; align-items: center; gap: 10px; }
.compra-cab b { font-family: var(--f-data); font-size: 14px; }
.compra-cab .libre { margin-left: auto; }
.compra .sub { font-size: 12px; color: var(--ink-2); }

.toast { position: fixed; left: 50%; bottom: 20px; transform: translateX(-50%); background: var(--ink); color: #fff; font-family: var(--f-data); font-size: 13.5px; padding: 9px 18px; border-radius: 8px; z-index: 80; box-shadow: var(--elev-2); max-width: calc(100vw - 32px); text-align: center; }
.btn:focus-visible, .tabbar button:focus-visible, input:focus-visible, select:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }

/* ── Móvil angosto: el diálogo de ajustes apila sus campos ── */
@media (max-width: 520px) {
  .hours-row { grid-template-columns: 1fr; }
  .hours-row.dos { grid-template-columns: 1fr 1fr; }
  .card-cab { flex-direction: column; align-items: stretch; }
  /* En columna, el wrap de la fila haría que la columna tome el ancho de
     su contenido (se salía de la tarjeta) y el flex-basis del buscador se
     volvería ALTO: por eso aquí van sin wrap y con ancho fijo. */
  .controles { flex-direction: column; flex-wrap: nowrap; align-items: stretch; width: 100%; }
  .segmentos { align-self: stretch; width: 100%; }
  .buscar { flex: 0 0 auto; width: 100%; }
}

/* ── PC: barra arriba, menú en columna, contenido con su scroll ── */
@media (min-width: 900px) {
  .plat-root {
    max-width: none; width: 100%; height: 100dvh;
    display: grid; grid-template-columns: 240px minmax(0, 1fr); grid-template-rows: auto minmax(0, 1fr);
    gap: 0; padding: 0;
  }
  .app-header { grid-column: 1 / -1; grid-row: 1; padding: 12px 24px; border-radius: 0; border-bottom: 1px solid rgba(255,255,255,.16); position: relative; z-index: 2; }
  .head-tab { font-size: 16px; }
  .app-header .date-note { font-size: 12.5px; }
  .head-user-nombre { display: block; }
  .tabbar { position: static; transform: none; width: auto; z-index: auto; grid-column: 1; grid-row: 2; align-self: stretch; height: 100%; gap: 4px; padding: 18px 14px 14px; border-radius: 0; box-shadow: none; }
  .nav-scrim { display: none; }
  .tabbar > button { font-size: 12px; padding: 10px 14px; gap: 10px; }
  .side-foot { padding: 10px 6px 2px; }
  .nav-collapsed { grid-template-columns: 74px minmax(0, 1fr); }
  .nav-collapsed .tabbar { padding: 18px 8px 14px; }
  .nav-collapsed .lbl, .nav-collapsed .side-foot { display: none; }
  .nav-collapsed .tabbar > button { justify-content: center; padding: 10px 0; }
  .nav-collapsed .tab-grupo { font-size: 0; margin: 6px 8px 0; padding-top: 6px; }
  .nav-collapsed .tab-grupo.primero { display: none; }
  .nav-collapsed .tabbar .badge { position: absolute; top: 2px; right: 4px; margin-left: 0; }

  .screen { grid-column: 2; grid-row: 2; padding: 14px 20px; gap: 12px; overflow-y: auto; min-height: 0; }
  .card { border: 1px solid var(--grid); border-radius: 8px; padding: 18px 22px; box-shadow: var(--elev-1); }
  .card h2 { font-size: 16px; }
  .tiles { grid-template-columns: repeat(4, 1fr); gap: 12px; }
  .tile { border: 1px solid var(--grid); border-radius: 8px; padding: 14px 16px; }
  .tile .value { font-size: 30px; }
  .att-tablewrap { display: block; }
  .acc { display: none; }
}
`;
