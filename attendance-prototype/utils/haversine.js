/**
 * utils/haversine.js
 * Lógica matemática del GPS: distancia entre dos coordenadas (Fórmula de Haversine).
 * Sin dependencias — funciona en navegador y en Node (pruebas por terminal).
 */

/** Radio medio de la Tierra en metros */
const EARTH_RADIUS_M = 6371000;

/**
 * Ubicaciones válidas para fichar. El empleado puede estar dentro del radio
 * de CUALQUIERA de ellas. Para agregar una sede nueva, añade un objeto más.
 */
export const OFFICE_LOCATIONS = Object.freeze([
  { name: 'Sede 1', lat: 1.2129816587171653, lon: -77.28015736947805 },
  { name: 'Sede 2', lat: 1.2211231883656561, lon: -77.28114303755562 },
  { name: 'Sede 3', lat: 1.2211972559885957, lon: -77.28108383473862}
]);

/** Alias de compatibilidad: la primera sede como punto único. */
export const OFFICE_LOCATION = OFFICE_LOCATIONS[0];

export const MAX_RADIUS_METERS = 50;

const toRadians = (degrees) => (degrees * Math.PI) / 180;

/**
 * Distancia en metros entre dos puntos (lat/lon en grados decimales).
 * @param {number} lat1
 * @param {number} lon1
 * @param {number} lat2
 * @param {number} lon2
 * @returns {number} distancia en metros
 */
export function haversineDistance(lat1, lon1, lat2, lon2) {
  const dLat = toRadians(lat2 - lat1);
  const dLon = toRadians(lon2 - lon1);

  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRadians(lat1)) * Math.cos(toRadians(lat2)) * Math.sin(dLon / 2) ** 2;

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return EARTH_RADIUS_M * c;
}

/**
 * Valida si el usuario está dentro del radio de alguna sede.
 * @param {number} userLat
 * @param {number} userLon
 * @param {string} [onlySede] - si se indica, SOLO valida contra esa sede
 *   (la sede asignada al empleado); si no, contra todas.
 * @returns {{ inRange: boolean, distance: number, nearest: string }}
 *   distance en metros hasta la sede más cercana evaluada.
 */
export function isWithinOfficeRadius(userLat, userLon, onlySede, locations = OFFICE_LOCATIONS) {
  const candidates = onlySede
    ? locations.filter((o) => o.name === onlySede)
    : locations;
  // Sede desconocida → cae a todas (mejor validar de más que bloquear).
  const list = candidates.length > 0 ? candidates : locations;

  let best = { distance: Infinity, name: null, radius: MAX_RADIUS_METERS };
  for (const office of list) {
    const d = haversineDistance(userLat, userLon, office.lat, office.lon);
    if (d < best.distance) best = { distance: d, name: office.name, radius: office.radius ?? MAX_RADIUS_METERS };
  }
  return {
    inRange: best.distance <= best.radius, // radio propio de cada sede
    distance: Math.round(best.distance * 100) / 100,
    nearest: best.name,
  };
}
