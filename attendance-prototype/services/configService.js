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

/** Festivos de Colombia 2026 (Ley Emiliani: varios trasladados a lunes). */
export const HOLIDAYS_CO_2026 = Object.freeze([
  '2026-01-01', '2026-01-12', '2026-03-23', '2026-04-02', '2026-04-03',
  '2026-05-01', '2026-05-18', '2026-06-08', '2026-06-15', '2026-06-29',
  '2026-07-20', '2026-08-07', '2026-08-17', '2026-10-12', '2026-11-02',
  '2026-11-16', '2026-12-08', '2026-12-25',
]);

export const DEFAULT_CONFIG = Object.freeze({
  weeklyHours: 42,
  graceMinutes: 15,
  holidays: HOLIDAYS_CO_2026,
});

const hasLS = typeof localStorage !== 'undefined';

export function getLaborConfig() {
  if (!hasLS) return { ...DEFAULT_CONFIG };
  try {
    const raw = JSON.parse(localStorage.getItem(CONFIG_KEY) || '{}');
    return {
      weeklyHours: Number.isFinite(raw.weeklyHours) && raw.weeklyHours > 0 ? raw.weeklyHours : DEFAULT_CONFIG.weeklyHours,
      graceMinutes: Number.isFinite(raw.graceMinutes) && raw.graceMinutes >= 0 ? raw.graceMinutes : DEFAULT_CONFIG.graceMinutes,
      holidays: Array.isArray(raw.holidays)
        ? raw.holidays.filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort()
        : [...DEFAULT_CONFIG.holidays],
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
