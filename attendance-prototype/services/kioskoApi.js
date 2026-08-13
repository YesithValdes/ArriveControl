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
export async function registrarPaso(empleadoId) {
  const cuerpo = { empleado_id: empleadoId, sede_id: getSedeId() };
  try {
    const r = await fetch('/api/marcaciones', { method: 'POST', headers: headers(), body: JSON.stringify(cuerpo) });
    const d = await r.json();
    if (r.status === 404) return { errorConfig: 'Empleado no encontrado en la base de datos.' };
    if (r.status === 400 || r.status === 500) return { errorConfig: d.error };
    if (!r.ok) throw new Error(d.error || `Error ${r.status}`);
    if (d.duplicado) return { duplicado: true, ultima: d.ultima };
    return { tipo: d.tipo, marcacion: d.marcacion };
  } catch {
    // Sin red: a la cola con la hora del dispositivo (única vez que se usa).
    const cola = leerCola();
    cola.push({ ...cuerpo, ts_dispositivo: new Date().toISOString(), diferido: true });
    guardarCola(cola);
    return { pendiente: true, enCola: cola.length };
  }
}

/** Reenvía la cola pendiente. Devuelve cuántas se sincronizaron. */
export async function sincronizarCola() {
  const cola = leerCola();
  if (cola.length === 0) return 0;
  const restantes = [];
  let ok = 0;
  for (const item of cola) {
    try {
      const r = await fetch('/api/marcaciones', { method: 'POST', headers: headers(), body: JSON.stringify(item) });
      if (r.ok) ok += 1;
      else if (r.status === 404) ok += 0; // empleado borrado: se descarta
      else restantes.push(item);
    } catch {
      restantes.push(item); // sigue sin red: se conserva
    }
  }
  guardarCola(restantes);
  return ok;
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
