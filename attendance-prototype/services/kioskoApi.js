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

const headers = () => ({
  'Content-Type': 'application/json',
  ...(getDeviceKey() ? { 'X-Device-Key': getDeviceKey() } : {}),
});

/** Sedes para el selector de configuración del kiosco. */
export async function cargarSedes() {
  const r = await fetch('/api/sedes', { headers: headers() });
  // Nunca asumir JSON: un cuerpo vacío (p. ej. el dev server compilando, o un
  // proxy caído) reventaba con "Unexpected end of JSON input" y el kiosco lo
  // mostraba como "Sin conexión", que era engañoso.
  let d = null;
  try { d = await r.json(); } catch { /* cuerpo vacío o no-JSON */ }
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
    const d = await r.json();
    if (!r.ok || !d.ok) throw new Error(d.error || `Error ${r.status}`);
    const empleados = d.empleados.map((e) => ({ id: e.id, name: e.nombre, descriptor: e.descriptor_facial }));
    if (hasLS) localStorage.setItem(KEY_ROSTER, JSON.stringify(empleados));
    return { empleados, deCache: false };
  } catch (e) {
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
