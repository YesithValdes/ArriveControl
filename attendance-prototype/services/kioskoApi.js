/**
 * services/kioskoApi.js — Cliente del kiosco contra la API (Postgres).
 *
 * Autenticación: la marcación exige sesión (el celular del administrador ya
 * inició sesión: la cookie viaja sola) O la clave del dispositivo
 * (X-Device-Key), pensada para tablets dedicadas sin usuario. La clave y la
 * SEDE del dispositivo se configuran una vez y quedan en localStorage.
 *
 * Resistencia a cortes de red:
 *  - Roster: se cachea localmente; si al arrancar no hay red, se usa el caché.
 *  - Marcaciones: si el POST falla, van a una cola local y se reenvían como
 *    `diferido` con la hora del dispositivo (el servidor las marca
 *    `kiosco_diferido`). La cola se vacía al reconectar.
 */

const KEY_SEDE = 'kiosco_sede_id';
const KEY_DEVICE = 'kiosco_device_key';
const KEY_ROSTER = 'kiosco_roster_cache';
const KEY_COLA = 'kiosco_cola_pendientes';

const hasLS = typeof localStorage !== 'undefined';

export const getSedeId = () => (hasLS ? localStorage.getItem(KEY_SEDE) || '' : '');
export const setSedeId = (id) => hasLS && localStorage.setItem(KEY_SEDE, id);
export const getDeviceKey = () => (hasLS ? localStorage.getItem(KEY_DEVICE) || '' : '');
export const setDeviceKey = (k) => hasLS && localStorage.setItem(KEY_DEVICE, k);

/**
 * Olvida la activación de este aparato. Se llama cuando el servidor rechaza la
 * clave: el dispositivo fue revocado, o la base cambió y esa clave ya no
 * existe. Sin esto, el kiosco se queda mostrando una pantalla que no puede
 * marcar ni reconocer a nadie, y sin avisar de nada.
 *
 * NO borra la cola de marcaciones pendientes: son horas trabajadas que todavía
 * no llegaron al servidor y se reenvían cuando el aparato se reactive.
 */
export function olvidarActivacion() {
  if (!hasLS) return;
  localStorage.removeItem(KEY_DEVICE);
  localStorage.removeItem(KEY_SEDE);
  localStorage.removeItem(KEY_ROSTER); // son datos biométricos de otra instalación
}

/**
 * Error de credencial del dispositivo, distinto de un fallo de red.
 *
 * La diferencia es la que decide el comportamiento del kiosco: sin red hay que
 * SEGUIR marcando contra el caché —la gente está fichando y el internet no es
 * su problema—, pero con la clave rechazada hay que parar y pedir reactivación.
 */
export class ClaveRechazada extends Error {
  constructor(mensaje = 'Este dispositivo ya no está autorizado.') {
    super(mensaje)
    this.name = 'ClaveRechazada'
  }
}

const headers = () => ({
  'Content-Type': 'application/json',
  ...(getDeviceKey() ? { 'X-Device-Key': getDeviceKey() } : {}),
});

/**
 * Sedes de la empresa. Cumple dos papeles: llena el selector al activar, y
 * sirve de SONDA para comprobar que la clave del aparato sigue valiendo —
 * es la petición más barata que la exige, mucho más que bajar los rostros.
 */
export async function cargarSedes() {
  const conClave = Boolean(getDeviceKey());
  const r = await fetch('/api/sedes', { headers: headers() });
  // Nunca asumir JSON: un cuerpo vacío (p. ej. el dev server compilando, o un
  // proxy caído) reventaba con "Unexpected end of JSON input" y el kiosco lo
  // mostraba como "Sin conexión", que era engañoso.
  let d = null;
  try { d = await r.json(); } catch { /* cuerpo vacío o no-JSON */ }

  // Si se mandó clave y el servidor responde 401, la clave está muerta. Sin
  // clave, un 401 solo significa que hace falta iniciar sesión para activar.
  if (r.status === 401 && conClave) throw new ClaveRechazada(d?.detalle || d?.error);

  if (!r.ok || !d?.ok) throw new Error(d?.error || `El servidor respondió ${r.status} sin datos. Reintenta en unos segundos.`);
  return d.sedes;
}

/**
 * Roster de empleados con descriptor. Red primero; caché local como respaldo
 * (el kiosco debe reconocer gente aunque se caiga el internet).
 * @returns {{empleados: Array, deCache: boolean}}
 */
export async function cargarRoster() {
  try {
    const r = await fetch('/api/empleados?rostros=1', { headers: headers() });
    let d = null;
    try { d = await r.json(); } catch { /* cuerpo vacío o no-JSON */ }

    // 401 aquí NO es un problema de red: el servidor contestó, y contestó que
    // esta clave no vale. Se distingue a propósito para no caer al caché — con
    // la clave muerta, seguir mostrando rostros cacheados sería enseñar datos
    // biométricos de una instalación a la que este aparato ya no pertenece.
    if (r.status === 401) throw new ClaveRechazada(d?.detalle || d?.error);

    if (!r.ok || !d?.ok) throw new Error(d?.error || `Error ${r.status}`);
    const empleados = d.empleados.map((e) => ({
      id: e.id, name: e.nombre, descriptor: e.descriptor_facial,
      // TODOS sus rostros: al identificar se usa el más parecido de los suyos.
      // Respaldo al principal para rosters guardados antes de esta versión.
      descriptores: Array.isArray(e.descriptores) && e.descriptores.length > 0
        ? e.descriptores
        : (e.descriptor_facial ? [e.descriptor_facial] : []),
      // Para exigir (si el flag está activo) que marque en SU sede.
      sedeId: e.sede_id || null, validarSede: e.validar_sede === true,
    }));
    if (hasLS) localStorage.setItem(KEY_ROSTER, JSON.stringify(empleados));
    return { empleados, deCache: false };
  } catch (e) {
    if (e instanceof ClaveRechazada) throw e; // nunca se cae al caché por esto
    if (hasLS) {
      try {
        const cache = JSON.parse(localStorage.getItem(KEY_ROSTER) || '[]');
        if (cache.length > 0) return { empleados: cache, deCache: true };
      } catch { /* caché corrupto: cae al throw */ }
    }
    throw e;
  }
}

const leerCola = () => {
  try { return JSON.parse(localStorage.getItem(KEY_COLA) || '[]'); } catch { return []; }
};
const guardarCola = (c) => hasLS && localStorage.setItem(KEY_COLA, JSON.stringify(c));
export const pendientesEnCola = () => leerCola().length;

/**
 * Registra un paso. El SERVIDOR decide entrada/salida y pone la hora.
 * Sin red: encola y devuelve { pendiente: true } — la persona debe saber que
 * su marcación quedó guardada pero aún no sincronizada.
 */
export async function registrarPaso(empleadoId, ubicacion = null) {
  // sede_id nulo (no ""): un dispositivo sin sede mandaba cadena vacía y el
  // insert reventaba en Postgres (la columna es uuid) — 500 en cada intento.
  const cuerpo = { empleado_id: empleadoId, sede_id: getSedeId() || null };
  // Ubicación GPS del dispositivo, si el kiosco la tiene fresca. El SERVIDOR
  // decide qué hacer con ella: guardarla (validar_ubicacion) o exigir que
  // caiga dentro del radio de la sede del empleado (validar_sede).
  if (ubicacion && Number.isFinite(ubicacion.lat) && Number.isFinite(ubicacion.lon)) {
    cuerpo.lat = ubicacion.lat;
    cuerpo.lon = ubicacion.lon;
    if (Number.isFinite(ubicacion.precision_m)) cuerpo.precision_m = Math.round(ubicacion.precision_m);
  }
  let r;
  try {
    r = await fetch('/api/marcaciones', { method: 'POST', headers: headers(), body: JSON.stringify(cuerpo) });
  } catch {
    // Sin red DE VERDAD (el fetch ni llegó): a la cola con la hora del
    // dispositivo (única vez que se usa). Cualquier otra cosa —el servidor
    // respondió, aunque sea con error— NO es un problema de conexión y no
    // debe encolarse: antes un 401/402 se encolaba como "sin red", el kiosco
    // decía "se enviará sola" y el reintento la rechazaba para siempre.
    const cola = leerCola();
    cola.push({ ...cuerpo, ts_dispositivo: new Date().toISOString(), diferido: true });
    guardarCola(cola);
    return { pendiente: true, enCola: cola.length };
  }
  let d = null;
  try { d = await r.json(); } catch { /* cuerpo vacío o no-JSON */ }
  if (r.status === 401) throw new ClaveRechazada(d?.detalle || d?.error);
  if (r.status === 404) return { errorConfig: 'Empleado no encontrado en la base de datos.' };
  if (!r.ok) return { errorConfig: d?.detalle || d?.error || `El servidor respondió ${r.status}.` };
  if (d?.duplicado) return { duplicado: true, ultima: d.ultima };
  return { tipo: d.tipo, marcacion: d.marcacion };
}

/**
 * Reenvía la cola pendiente.
 * @returns {{enviadas:number, quedan:number, motivo:string|null}} `motivo` es
 * la causa (legible) por la que quedaron marcaciones sin enviar, para que el
 * kiosco la MUESTRE — una cola que no baja sin decir por qué es indebuggeable.
 */
export async function sincronizarCola() {
  const cola = leerCola();
  if (cola.length === 0) return { enviadas: 0, quedan: 0, motivo: null };
  const restantes = [];
  let motivo = null;
  for (const item of cola) {
    // sede_id "" de colas viejas: se normaliza a null (uuid inválido → 500).
    if (item.sede_id === '') item.sede_id = null;
    try {
      const r = await fetch('/api/marcaciones', { method: 'POST', headers: headers(), body: JSON.stringify(item) });
      if (r.ok) continue; // sincronizada
      if (r.status === 404 || r.status === 400) continue; // rechazo definitivo (empleado borrado, datos inválidos): reintentar jamás va a funcionar
      // 401 (clave revocada), 402 (suscripción vencida), 5xx: son horas
      // trabajadas y el rechazo puede ser transitorio — se conservan y se
      // reintentará cuando el aparato se reactive / la suscripción vuelva.
      let d = null;
      try { d = await r.json(); } catch { /* cuerpo vacío o no-JSON */ }
      motivo = d?.detalle || d?.error || `El servidor respondió ${r.status}.`;
      restantes.push(item);
    } catch {
      motivo = 'Sin conexión con el servidor.';
      restantes.push(item); // sigue sin red: se conserva
    }
  }
  guardarCola(restantes);
  return { enviadas: cola.length - restantes.length, quedan: restantes.length, motivo };
}

/** Log de intento de reconocimiento (fire-and-forget: nunca bloquea el kiosco). */
export function logIntento({ empleadoId = null, aceptado, distancia = null, livenessOk = null }) {
  fetch('/api/intentos', {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({
      empleado_id: empleadoId, aceptado, distancia,
      liveness_ok: livenessOk, sede_id: getSedeId() || null,
    }),
  }).catch(() => { /* métricas: si se pierde una, no pasa nada */ });
}
