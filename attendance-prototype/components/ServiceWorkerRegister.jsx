'use client';

/**
 * components/ServiceWorkerRegister.jsx
 * Registra el Service Worker de caché de modelos SOLO en producción.
 *
 * En desarrollo (`next dev`) NO se registra, porque un SW interfiere con el
 * Hot Reload de Next y provoca 404 en los chunks (/_next/static/...).
 * Además, si quedó uno registrado de una sesión previa, lo desregistra y
 * limpia sus cachés para dejar el entorno limpio.
 */

import { useEffect } from 'react';

export default function ServiceWorkerRegister() {
  useEffect(() => {
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;

    const isProd = process.env.NODE_ENV === 'production';

    if (isProd) {
      navigator.serviceWorker.register('/sw.js').catch(() => {});
    } else {
      // Desarrollo: limpiar cualquier SW/caché previo que esté causando 404s.
      navigator.serviceWorker.getRegistrations().then((regs) => {
        regs.forEach((r) => r.unregister());
      }).catch(() => {});
      if ('caches' in window) {
        caches.keys().then((keys) => keys.forEach((k) => caches.delete(k))).catch(() => {});
      }
    }
  }, []);

  return null;
}
