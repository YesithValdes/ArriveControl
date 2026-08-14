/**
 * lib/geocodificar.js — Lat/lon → dirección legible (solo servidor).
 *
 * Usa Nominatim (OpenStreetMap): gratis y sin API key. Sus condiciones piden
 * identificarse con un User-Agent y no pasar de ~1 petición/segundo — a
 * nuestro volumen (una por marcación con GPS) va sobrado. Mejor esfuerzo:
 * si falla o tarda, se devuelve null y todo sigue con las coordenadas.
 */

export async function direccionDesdeCoordenadas(lat, lon) {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null
  try {
    const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lon}&zoom=17&accept-language=es`
    const r = await fetch(url, {
      headers: { 'User-Agent': 'ControlRegistro/1.0 (comprobante de marcacion)' },
      signal: AbortSignal.timeout(4000),
    })
    if (!r.ok) return null
    const d = await r.json()
    const a = d.address ?? {}
    // Armado corto y útil: vía + número, barrio, ciudad. El display_name
    // completo de Nominatim es kilométrico (incluye departamento, país…).
    const via = [a.road, a.house_number].filter(Boolean).join(' ')
    const ciudad = a.city || a.town || a.village || a.municipality
    const partes = [via || a.neighbourhood || a.suburb, a.neighbourhood && via ? a.neighbourhood : null, ciudad]
      .filter(Boolean)
    const texto = partes.join(', ')
    return texto || d.display_name?.split(',').slice(0, 3).join(',') || null
  } catch {
    return null
  }
}
