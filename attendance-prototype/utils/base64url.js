/**
 * utils/base64url.js
 * Conversión entre ArrayBuffer y base64url (el formato que usa WebAuthn
 * para IDs de credenciales y challenges). Sin dependencias; funciona en
 * navegador y Node (pruebas por terminal).
 */

export function bufferToBase64url(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  const base64 = typeof btoa !== 'undefined'
    ? btoa(binary)
    : Buffer.from(bytes).toString('base64');
  return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function base64urlToBuffer(base64url) {
  const base64 = base64url.replace(/-/g, '+').replace(/_/g, '/');
  const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
  const binary = typeof atob !== 'undefined'
    ? atob(padded)
    : Buffer.from(padded, 'base64').toString('binary');
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

/** Codifica un string UTF-8 como ArrayBuffer (para user.id de WebAuthn). */
export function stringToBuffer(str) {
  return new TextEncoder().encode(str).buffer;
}
