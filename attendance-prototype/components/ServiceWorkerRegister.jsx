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
import { modelosDesdeApk } from '../lib/modelosApk.js';

export default function ServiceWorkerRegister() {
  useEffect(() => {
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;

    const isProd = process.env.NODE_ENV === 'production';

    if (isProd) {
      // App de Android que ANUNCIA traer los modelos: salen de la APK
      // (ModelosLocales.java). Con ?apk=1 el worker los deja pasar; si los
      // interceptara, su fetch() iría por el ServiceWorkerClient de Capacitor
      // a la red y la APK sobraría. Ver lib/modelosApk.js.
      const enApk = modelosDesdeApk();
      navigator.serviceWorker.register(enApk ? '/sw.js?apk=1' : '/sw.js').catch(() => {});
      // Pide que el navegador no desaloje los ~40 MB de modelos bajo presión
      // de espacio (en Chrome no pregunta nada: lo concede o no, en silencio).
      if (!enApk) navigator.storage?.persist?.().catch(() => {});
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
