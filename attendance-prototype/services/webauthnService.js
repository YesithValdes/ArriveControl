/**
 * services/webauthnService.js
 * Fichaje con la biometría NATIVA del dispositivo (Face ID / huella /
 * Windows Hello) vía WebAuthn (navigator.credentials).
 *
 * Arquitectura en producción (Supabase):
 *  - El servidor genera el challenge aleatorio por sesión y lo guarda.
 *  - registerDevice  -> el servidor valida la attestation y guarda la
 *                       CLAVE PÚBLICA + credentialId del empleado.
 *  - checkInWithDevice -> el servidor verifica la FIRMA de la assertion
 *                       con esa clave pública (lib: @simplewebauthn/server).
 *
 * En este prototipo el "servidor" es un mock en localStorage: guardamos el
 * credentialId y confiamos en la verificación local del navegador
 * (userVerification: 'required' => el SO exigió rostro/huella/PIN).
 * NOTA: sin verificación de firma en servidor esto NO es seguro en
 * producción; es suficiente para probar la UX y el flujo.
 */

import { bufferToBase64url, base64urlToBuffer, stringToBuffer } from '../utils/base64url.js';

const CRED_KEY = 'attendance_webauthn_creds'; // employeeId -> registro
const LOG_KEY = 'attendance_webauthn_log';

const hasLS = typeof localStorage !== 'undefined';

/**
 * Estructura de cada registro:
 *   {
 *     credentialId: string (base64url),  // identifica al dispositivo
 *     employeeName: string,
 *     status: 'pending' | 'approved',    // aprobado por RRHH
 *     registeredAt: string,
 *     approvedAt: string | null,
 *     approvedBy: string | null,
 *   }
 */
const loadCreds = () => {
  if (!hasLS) return {};
  let raw;
  try { raw = JSON.parse(localStorage.getItem(CRED_KEY) || '{}'); } catch { return {}; }

  // Migración: en versiones antiguas cada valor era el credentialId (string).
  // Lo convertimos al objeto nuevo y marcamos como pendiente (RRHH re-aprueba).
  const normalized = {};
  for (const [employeeId, value] of Object.entries(raw)) {
    if (typeof value === 'string') {
      normalized[employeeId] = {
        credentialId: value,
        employeeName: employeeId,
        status: 'pending',
        registeredAt: null,
        approvedAt: null,
        approvedBy: null,
      };
    } else if (value && typeof value === 'object' && value.credentialId) {
      normalized[employeeId] = value;
    }
    // Cualquier otro formato corrupto se descarta silenciosamente.
  }
  return normalized;
};
const saveCreds = (c) => hasLS && localStorage.setItem(CRED_KEY, JSON.stringify(c));

/** Challenge aleatorio (en producción lo genera y recuerda el servidor). */
const randomChallenge = () => crypto.getRandomValues(new Uint8Array(32));

// ─── Código de registro de un solo uso (OTP) ─────────────────────────────
// Reemplaza la aprobación manual de RRHH por una verificación automática:
// solo quien controla el canal del empleado (correo/WhatsApp corporativo)
// recibe el código. En este prototipo se muestra en pantalla (mock).
// En producción: el SERVIDOR genera el código, lo envía por el canal y lo
// valida — nunca se expone al cliente.

const OTP_KEY = 'attendance_enroll_otp';
const OTP_TTL_MS = 5 * 60 * 1000; // 5 minutos de validez

/** Genera un código de 6 dígitos para un empleado y lo guarda con expiración. */
export function generateEnrollmentCode(employeeId) {
  const code = String(crypto.getRandomValues(new Uint32Array(1))[0] % 1000000).padStart(6, '0');
  if (hasLS) {
    const all = JSON.parse(localStorage.getItem(OTP_KEY) || '{}');
    all[employeeId] = { code, expiresAt: Date.now() + OTP_TTL_MS };
    localStorage.setItem(OTP_KEY, JSON.stringify(all));
  }
  return code; // en producción NO se retorna; se envía por el canal seguro
}

/** Verifica el código; si es válido lo consume (un solo uso). */
export function verifyEnrollmentCode(employeeId, code) {
  if (!hasLS) return false;
  const all = JSON.parse(localStorage.getItem(OTP_KEY) || '{}');
  const rec = all[employeeId];
  if (!rec) return false;
  const ok = rec.code === String(code).trim() && Date.now() < rec.expiresAt;
  if (ok) {
    delete all[employeeId]; // consumido
    localStorage.setItem(OTP_KEY, JSON.stringify(all));
  }
  return ok;
}

export function isWebAuthnAvailable() {
  return typeof window !== 'undefined' && !!window.PublicKeyCredential;
}

/** ¿El dispositivo tiene biometría de plataforma (Face ID/huella/Hello)? */
export async function hasPlatformAuthenticator() {
  if (!isWebAuthnAvailable()) return false;
  return PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
}

export function isDeviceRegistered(employeeId) {
  return Boolean(loadCreds()[employeeId]);
}

/** Estado del registro: 'none' | 'pending' | 'approved'. */
export function getRegistrationStatus(employeeId) {
  const rec = loadCreds()[employeeId];
  return rec ? rec.status : 'none';
}

/**
 * Registro del dispositivo: crea una credencial biométrica atada a este
 * teléfono/PC. El SO pedirá rostro/huella para confirmar.
 *
 * Reglas de seguridad del enrolamiento:
 *  1. Un empleado solo puede tener UNA credencial (no re-registra por su
 *     cuenta si ya está aprobado; eso lo debe reautorizar RRHH).
 *  2. UN DISPOSITIVO = UN EMPLEADO: si el credentialId ya pertenece a otro
 *     empleado, se rechaza (evita el "celular señuelo" compartido).
 *  3. Queda en estado 'pending' hasta que RRHH lo apruebe.
 */
export async function registerDevice(employeeId, employeeName = employeeId) {
  const creds = loadCreds();

  const existing = creds[employeeId];
  if (existing && existing.status === 'approved') {
    return {
      success: false,
      error: 'Este empleado ya tiene un dispositivo aprobado. Para cambiarlo, RRHH debe revocarlo primero.',
    };
  }

  const credential = await navigator.credentials.create({
    publicKey: {
      challenge: randomChallenge(),
      rp: { name: 'ArriveControl' }, // rp.id se infiere del dominio (localhost en dev)
      user: {
        id: stringToBuffer(employeeId),
        name: employeeId,
        displayName: employeeName,
      },
      pubKeyCredParams: [
        { type: 'public-key', alg: -7 },   // ES256
        { type: 'public-key', alg: -257 }, // RS256
      ],
      authenticatorSelection: {
        authenticatorAttachment: 'platform', // SOLO biometría del dispositivo (no llaves USB)
        userVerification: 'required',        // exige rostro/huella/PIN, no basta tocar
        residentKey: 'preferred',
      },
      timeout: 60000,
    },
  });

  const credentialId = bufferToBase64url(credential.rawId);

  // Regla 2: ¿este dispositivo ya está registrado para OTRO empleado?
  const ownerOfDevice = Object.entries(creds).find(
    ([empId, rec]) => rec.credentialId === credentialId && empId !== employeeId
  );
  if (ownerOfDevice) {
    return {
      success: false,
      error: `Este dispositivo ya está registrado para el empleado ${ownerOfDevice[0]}. Un dispositivo solo puede pertenecer a una persona.`,
    };
  }

  // Aprobación AUTOMÁTICA: el código de un solo uso ya verificó la identidad
  // del empleado (llegó a su canal corporativo), así que no requiere RRHH.
  creds[employeeId] = {
    credentialId,
    employeeName,
    status: 'approved',
    registeredAt: new Date().toISOString(),
    approvedAt: new Date().toISOString(),
    approvedBy: 'codigo-de-registro',
  };
  saveCreds(creds);

  return {
    success: true,
    message: `Dispositivo registrado y activado para ${employeeId}. Ya puedes fichar.`,
  };
}

// ─── Funciones de Recursos Humanos ───────────────────────────────────────

export function listRegistrations() {
  return Object.entries(loadCreds()).map(([employeeId, rec]) => ({ employeeId, ...rec }));
}

export function approveRegistration(employeeId, approvedBy = 'RRHH') {
  const creds = loadCreds();
  const rec = creds[employeeId];
  if (!rec) return { success: false, error: 'Registro no encontrado.' };
  rec.status = 'approved';
  rec.approvedAt = new Date().toISOString();
  rec.approvedBy = approvedBy;
  saveCreds(creds);
  return { success: true, message: `Registro de ${employeeId} aprobado.` };
}

export function revokeRegistration(employeeId) {
  const creds = loadCreds();
  if (!creds[employeeId]) return { success: false, error: 'Registro no encontrado.' };
  delete creds[employeeId];
  saveCreds(creds);
  return { success: true, message: `Registro de ${employeeId} revocado.` };
}

/**
 * Fichaje: pide al SO verificar al dueño del dispositivo (Face ID/huella)
 * contra la credencial registrada para este empleado.
 */
export async function checkInWithDevice(employeeId) {
  const creds = loadCreds();
  const rec = creds[employeeId];
  if (!rec) {
    return { success: false, error: `No hay dispositivo registrado para ${employeeId}.` };
  }
  if (rec.status !== 'approved') {
    return {
      success: false,
      error: 'Tu registro aún está PENDIENTE de aprobación por Recursos Humanos. No puedes fichar todavía.',
    };
  }
  const credentialId = rec.credentialId;

  const assertion = await navigator.credentials.get({
    publicKey: {
      challenge: randomChallenge(),
      allowCredentials: [
        { type: 'public-key', id: base64urlToBuffer(credentialId), transports: ['internal'] },
      ],
      userVerification: 'required',
      timeout: 60000,
    },
  });

  // En producción: enviar assertion al servidor y verificar la firma.
  const returnedId = bufferToBase64url(assertion.rawId);
  if (returnedId !== credentialId) {
    return { success: false, error: 'La credencial devuelta no coincide con la registrada.' };
  }

  const entry = { employeeId, method: 'webauthn', timestamp: new Date().toISOString() };
  if (hasLS) {
    const log = JSON.parse(localStorage.getItem(LOG_KEY) || '[]');
    log.push(entry);
    localStorage.setItem(LOG_KEY, JSON.stringify(log));
  }

  return { success: true, message: `Fichaje exitoso para ${employeeId} (biometría del dispositivo).`, entry };
}

export function getWebAuthnLog() {
  if (!hasLS) return [];
  try { return JSON.parse(localStorage.getItem(LOG_KEY) || '[]'); } catch { return []; }
}

export function _resetWebAuthn() {
  if (hasLS) {
    localStorage.removeItem(CRED_KEY);
    localStorage.removeItem(LOG_KEY);
  }
}
