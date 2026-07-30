/**
 * services/attendanceService.js
 * Simulación de la capa de persistencia (Supabase Mock).
 *
 * En producción, reemplazar el Map en memoria por llamadas reales:
 *   - registerEmployee  -> supabase.from('employees').upsert({ id, embedding })
 *   - checkInEmployee   -> supabase.from('employees').select('embedding').eq('id', id)
 *                          + insert en tabla 'attendance_logs'
 *
 * IMPORTANTE (privacidad / costo $0): solo se persiste el vector de 128 floats.
 * La foto NUNCA se envía ni se guarda.
 */

import { compareFaces, isValidEmbedding } from '../utils/faceMath.js';

/**
 * "Base de datos" persistida en localStorage (navegador) para que el
 * registro sobreviva recargas de página. En Node (pruebas de terminal)
 * cae de forma transparente a un Map en memoria.
 */
const STORAGE_KEY = 'attendance_mock_db';
const LOG_KEY = 'attendance_mock_log';

const hasLocalStorage = typeof localStorage !== 'undefined';

const loadMap = () => {
  if (!hasLocalStorage) return new Map();
  try {
    return new Map(Object.entries(JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}')));
  } catch {
    return new Map();
  }
};

const mockDatabase = loadMap();

const persistDatabase = () => {
  if (!hasLocalStorage) return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(Object.fromEntries(mockDatabase)));
};

const loadLog = () => {
  if (!hasLocalStorage) return [];
  try {
    return JSON.parse(localStorage.getItem(LOG_KEY) || '[]');
  } catch {
    return [];
  }
};

/** Log de fichajes simulado */
const attendanceLog = loadLog();

const persistLog = () => {
  if (!hasLocalStorage) return;
  localStorage.setItem(LOG_KEY, JSON.stringify(attendanceLog));
};

/** Latencia artificial para imitar una llamada de red */
const simulateNetwork = (ms = 300) => new Promise((res) => setTimeout(res, ms));

/**
 * Registro inicial (enrolamiento): guarda el Embedding Máster del empleado.
 * @param {string} employeeId
 * @param {number[]|Float32Array} embedding - 128 floats de referencia
 */
export async function registerEmployee(employeeId, embedding) {
  await simulateNetwork();

  if (!employeeId || typeof employeeId !== 'string') {
    return { success: false, error: 'ID de empleado inválido.' };
  }
  if (!isValidEmbedding(embedding)) {
    return { success: false, error: 'El embedding debe ser un vector de 128 floats.' };
  }

  mockDatabase.set(employeeId, {
    embedding: Array.from(embedding), // normalizamos Float32Array -> Array (JSON-friendly)
    registeredAt: new Date().toISOString(),
  });
  persistDatabase();

  return { success: true, message: `Empleado ${employeeId} registrado correctamente.` };
}

/**
 * Fichaje diario: compara el embedding en vivo contra el Embedding Máster.
 * Éxito si la Distancia Euclidiana < 0.55.
 * @param {string} employeeId
 * @param {number[]|Float32Array} liveEmbedding
 */
export async function checkInEmployee(employeeId, liveEmbedding) {
  await simulateNetwork();

  const record = mockDatabase.get(employeeId);
  if (!record) {
    return { success: false, error: `Empleado ${employeeId} no está registrado.` };
  }
  if (!isValidEmbedding(liveEmbedding)) {
    return { success: false, error: 'El embedding recibido no es válido (128 floats).' };
  }

  const { isMatch, distance, threshold } = compareFaces(record.embedding, liveEmbedding);

  if (!isMatch) {
    return {
      success: false,
      distance,
      threshold,
      error: `Rostro no coincide (distancia ${distance} >= ${threshold}). Fichaje rechazado.`,
    };
  }

  const entry = {
    employeeId,
    distance,
    timestamp: new Date().toISOString(),
  };
  attendanceLog.push(entry);
  persistLog();

  return {
    success: true,
    distance,
    threshold,
    message: `Fichaje exitoso para ${employeeId} (distancia ${distance}).`,
    entry,
  };
}

/** Utilidades para pruebas/depuración */
export function getAttendanceLog() {
  return [...attendanceLog];
}

export function isEmployeeRegistered(employeeId) {
  return mockDatabase.has(employeeId);
}

export function _resetMockDatabase() {
  mockDatabase.clear();
  attendanceLog.length = 0;
  if (hasLocalStorage) {
    localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem(LOG_KEY);
  }
}
