/**
 * services/configService.js
 * Reglamento laboral configurable del sistema (persistido en localStorage).
 *
 *  - weeklyHours: jornada legal semanal. Colombia: 42 h desde julio de 2026
 *    (Ley 2101 de 2021, reducción gradual desde las 48 h). Por encima de
 *    este valor, las horas cuentan como EXTRAS.
 *  - graceMinutes: minutos de gracia sobre la hora esperada de entrada
 *    antes de contar la marcación como "tardía".
 *
 * En producción esto vive en una tabla de configuración en Supabase,
 * editable solo por administradores.
 */

const CONFIG_KEY = 'attendance_labor_config';

export const DEFAULT_CONFIG = Object.freeze({
  weeklyHours: 42,
  graceMinutes: 15,
});

const hasLS = typeof localStorage !== 'undefined';

export function getLaborConfig() {
  if (!hasLS) return { ...DEFAULT_CONFIG };
  try {
    const raw = JSON.parse(localStorage.getItem(CONFIG_KEY) || '{}');
    return {
      weeklyHours: Number.isFinite(raw.weeklyHours) && raw.weeklyHours > 0 ? raw.weeklyHours : DEFAULT_CONFIG.weeklyHours,
      graceMinutes: Number.isFinite(raw.graceMinutes) && raw.graceMinutes >= 0 ? raw.graceMinutes : DEFAULT_CONFIG.graceMinutes,
    };
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

export function saveLaborConfig(partial) {
  const next = { ...getLaborConfig(), ...partial };
  if (hasLS) localStorage.setItem(CONFIG_KEY, JSON.stringify(next));
  return next;
}
