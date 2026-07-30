'use client';

/**
 * components/AttendanceModule.jsx
 * Fichaje con GPS + biometría NATIVA del dispositivo (WebAuthn):
 * Face ID (iPhone), rostro/huella (Android), Windows Hello (PC).
 *
 * Flujo (dos procesos independientes, tipo login):
 *  - Registrarme: valida ubicación → crea la credencial biométrica del
 *    dispositivo (el SO pide rostro/huella).
 *  - Fichar: valida ubicación → el SO verifica al dueño del dispositivo
 *    contra la credencial registrada.
 *
 * La biometría la ejecuta y custodia el sistema operativo: nunca recibimos
 * foto, vector ni el método usado — solo la confirmación criptográfica.
 * Versión anterior con face-api.js conservada en AttendanceModuleFaceApi.jsx.
 */

import { useEffect, useState } from 'react';
import { isWithinOfficeRadius, MAX_RADIUS_METERS } from '../utils/haversine.js';
import {
  isWebAuthnAvailable,
  hasPlatformAuthenticator,
  getRegistrationStatus,
  registerDevice,
  checkInWithDevice,
  generateEnrollmentCode,
  verifyEnrollmentCode,
} from '../services/webauthnService.js';

const STEPS = {
  MODE: 'MODE',       // pantalla inicial: elegir proceso
  LOCATION: 'LOCATION',
  CODE: 'CODE',       // solo en registro: código de un solo uso
  BIOMETRIC: 'BIOMETRIC',
  DONE: 'DONE',
};

const PERMISSION_HELP = {
  gps: {
    title: 'Permiso de ubicación denegado',
    android:
      'Android (Chrome): toca el candado 🔒 junto a la URL → Permisos → Ubicación → Permitir. Verifica también que el GPS del teléfono esté encendido.',
    ios:
      'iOS (Safari): Ajustes → Privacidad y seguridad → Localización → Safari → "Al usar la app". Luego Ajustes → Safari → Ubicación → Permitir.',
  },
  biometric: {
    title: 'No se pudo usar la biometría del dispositivo',
    android:
      'Android: configura el desbloqueo facial o de huella en Ajustes → Seguridad → Desbloqueo biométrico, y usa Chrome actualizado.',
    ios:
      'iOS: activa Face ID en Ajustes → Face ID y código, y permite su uso en Safari.',
  },
};

export default function AttendanceModule({
  employeeId = 'EMP-001',
  employeeName = 'Empleado Demo',
  // El registro de dispositivos es función del administrador (/admin/registro);
  // en la pantalla pública solo se ficha.
  allowRegister = false,
}) {
  const [step, setStep] = useState(allowRegister ? STEPS.MODE : STEPS.LOCATION);
  const [mode, setMode] = useState(allowRegister ? null : 'checkin'); // 'register' | 'checkin'
  const [busy, setBusy] = useState(false);
  const [statusMsg, setStatusMsg] = useState(
    allowRegister ? '¿Qué deseas hacer?' : 'Valida tu ubicación para iniciar el fichaje.'
  );
  const [error, setError] = useState(null);
  const [locationInfo, setLocationInfo] = useState(null);
  const [result, setResult] = useState(null);
  // 'none' | 'pending' | 'approved'
  const [regStatus, setRegStatus] = useState('none');
  const [biometricsOk, setBiometricsOk] = useState(null); // null = comprobando
  const [sentCode, setSentCode] = useState('');   // código "enviado" (mock: se muestra)
  const [typedCode, setTypedCode] = useState(''); // código que escribe el empleado

  const registered = regStatus !== 'none';
  const approved = regStatus === 'approved';

  useEffect(() => {
    setRegStatus(getRegistrationStatus(employeeId));
    if (!isWebAuthnAvailable()) {
      setBiometricsOk(false);
      return;
    }
    hasPlatformAuthenticator().then(setBiometricsOk).catch(() => setBiometricsOk(false));
  }, [employeeId]);

  // ── PASO 0: Elegir proceso ────────────────────────────────────────────
  const handleSelectMode = (selectedMode) => {
    setMode(selectedMode);
    setError(null);
    setResult(null);
    setStep(STEPS.LOCATION);
    setStatusMsg(
      selectedMode === 'register'
        ? 'Registro de dispositivo: primero valida tu ubicación.'
        : 'Fichaje: primero valida tu ubicación.'
    );
  };

  // ── PASO 1: Validar ubicación (mejor lectura en hasta 12 s) ───────────
  const handleValidateLocation = () => {
    setError(null);
    setBusy(true);
    setStatusMsg('Obteniendo tu ubicación GPS…');

    if (!('geolocation' in navigator)) {
      setBusy(false);
      setError({ title: 'Tu navegador no soporta geolocalización.' });
      return;
    }

    let best = null;
    let finished = false;

    const finish = () => {
      if (finished) return;
      finished = true;
      navigator.geolocation.clearWatch(watchId);
      clearTimeout(timer);
      setBusy(false);

      if (!best) {
        setError({ title: 'No se pudo obtener la señal GPS. Sal a un lugar despejado e inténtalo de nuevo.' });
        return;
      }

      const { latitude, longitude, accuracy } = best.coords;
      const { inRange, distance, nearest } = isWithinOfficeRadius(latitude, longitude);
      setLocationInfo({ distance, accuracy: Math.round(accuracy), nearest });

      if (inRange) {
        if (mode === 'register') {
          // Genera y "envía" el código de un solo uso (mock: se muestra en pantalla).
          const code = generateEnrollmentCode(employeeId);
          setSentCode(code);
          setTypedCode('');
          setStep(STEPS.CODE);
          setStatusMsg(`✅ Estás a ${distance} m de ${nearest}. Ingresa el código de registro.`);
        } else {
          setStep(STEPS.BIOMETRIC);
          setStatusMsg(`✅ Estás a ${distance} m de ${nearest}. Continúa con la verificación biométrica.`);
        }
      } else {
        setError({
          title:
            `Estás fuera del rango permitido: ${Math.round(distance)} m (máximo ${MAX_RADIUS_METERS} m). ` +
            `Precisión de la lectura: ±${Math.round(accuracy)} m.` +
            (accuracy > 100
              ? ' ⚠️ La señal fue muy imprecisa (típico en PC sin GPS). Prueba desde un celular con GPS activado.'
              : ' Acércate a la oficina e inténtalo de nuevo.'),
        });
        setStatusMsg('Ubicación fuera de rango.');
      }
    };

    const watchId = navigator.geolocation.watchPosition(
      (position) => {
        if (!best || position.coords.accuracy < best.coords.accuracy) {
          best = position;
          setStatusMsg(`Afinando señal GPS… precisión actual: ±${Math.round(position.coords.accuracy)} m`);
        }
        if (position.coords.accuracy <= 25) finish();
      },
      (geoError) => {
        if (finished) return;
        finished = true;
        navigator.geolocation.clearWatch(watchId);
        clearTimeout(timer);
        setBusy(false);
        if (geoError.code === geoError.PERMISSION_DENIED) {
          setError(PERMISSION_HELP.gps);
        } else if (geoError.code === geoError.POSITION_UNAVAILABLE) {
          setError({ title: 'No se pudo obtener la señal GPS. Sal a un lugar despejado e inténtalo de nuevo.' });
        } else {
          setError({ title: 'Tiempo de espera agotado obteniendo la ubicación. Intenta de nuevo.' });
        }
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
    );

    const timer = setTimeout(finish, 12000);
  };

  // ── PASO 1.5 (solo registro): verificar el código de un solo uso ──────
  const handleVerifyCode = () => {
    setError(null);
    if (!verifyEnrollmentCode(employeeId, typedCode)) {
      setError({ title: 'Código incorrecto o vencido. Revisa e inténtalo de nuevo.' });
      return;
    }
    setSentCode('');
    setStep(STEPS.BIOMETRIC);
    setStatusMsg('Código verificado. Ahora registra tu rostro/huella.');
  };

  // ── PASO 2: Biometría nativa (WebAuthn) ───────────────────────────────
  const handleBiometric = async () => {
    setError(null);
    setBusy(true);

    try {
      if (mode === 'register') {
        setStatusMsg('El sistema te pedirá rostro/huella para registrar este dispositivo…');
        const reg = await registerDevice(employeeId, employeeName);
        if (!reg.success) {
          setError({ title: reg.error });
          setStatusMsg('Registro rechazado.');
          return;
        }
        setRegStatus(getRegistrationStatus(employeeId));
        setResult({ success: true, message: `🆕 ${reg.message}` });
        setStep(STEPS.DONE);
        setStatusMsg('Registro completado y activado.');
      } else {
        setStatusMsg('Verifica tu identidad con rostro/huella…');
        const checkin = await checkInWithDevice(employeeId);
        setResult(checkin);
        setStep(STEPS.DONE);
        setStatusMsg(checkin.success ? '✅ Fichaje registrado.' : '❌ Fichaje rechazado.');
      }
    } catch (err) {
      // NotAllowedError: el usuario canceló el diálogo o falló la verificación.
      if (err?.name === 'NotAllowedError') {
        setError({ title: 'Verificación cancelada o fallida. Inténtalo de nuevo.' });
      } else if (err?.name === 'InvalidStateError') {
        setError({ title: 'Este dispositivo ya tiene una credencial registrada para este empleado.' });
      } else if (err?.name === 'NotSupportedError' || err?.name === 'SecurityError') {
        setError(PERMISSION_HELP.biometric);
      } else {
        setError({ title: `Error inesperado: ${err?.message || err}` });
      }
      setStatusMsg('No se pudo completar la verificación.');
    } finally {
      setBusy(false);
    }
  };

  const handleRestart = () => {
    setStep(allowRegister ? STEPS.MODE : STEPS.LOCATION);
    setMode(allowRegister ? null : 'checkin');
    setError(null);
    setResult(null);
    setLocationInfo(null);
    setSentCode('');
    setTypedCode('');
    setRegStatus(getRegistrationStatus(employeeId));
    setStatusMsg(allowRegister ? '¿Qué deseas hacer?' : 'Valida tu ubicación para iniciar el fichaje.');
  };

  return (
    <div style={styles.card}>
      {biometricsOk === false && (
        <div style={styles.errorBox}>
          <strong>Este dispositivo no tiene biometría disponible.</strong>
          <p style={styles.helpText}>📱 {PERMISSION_HELP.biometric.android}</p>
          <p style={styles.helpText}>🍎 {PERMISSION_HELP.biometric.ios}</p>
        </div>
      )}

      {step !== STEPS.MODE && (
        <div style={styles.steps}>
          <StepBadge
            label={mode === 'register' ? '🆕 Registro' : '🔐 Fichaje'}
            active
            done={step === STEPS.DONE && result?.success}
          />
          <StepBadge label="1. Ubicación" active={step === STEPS.LOCATION} done={step === STEPS.CODE || step === STEPS.BIOMETRIC || step === STEPS.DONE} />
          {mode === 'register' && (
            <StepBadge label="2. Código" active={step === STEPS.CODE} done={step === STEPS.BIOMETRIC || step === STEPS.DONE} />
          )}
          <StepBadge label={mode === 'register' ? '3. Biometría' : '2. Biometría'} active={step === STEPS.BIOMETRIC} done={step === STEPS.DONE} />
        </div>
      )}

      <p style={styles.status}>{statusMsg}</p>

      {locationInfo && (
        <p style={styles.meta}>
          Sede más cercana: <strong>{locationInfo.nearest}</strong> · {locationInfo.distance} m · Precisión GPS: ±{locationInfo.accuracy} m
        </p>
      )}

      {error && (
        <div style={styles.errorBox}>
          <strong>{error.title}</strong>
          {error.android && <p style={styles.helpText}>📱 {error.android}</p>}
          {error.ios && <p style={styles.helpText}>🍎 {error.ios}</p>}
        </div>
      )}

      {result && (
        <div style={result.success ? styles.successBox : styles.errorBox}>
          {result.message || result.error}
        </div>
      )}

      <div style={styles.actions}>
        {step === STEPS.MODE && (
          <>
            <button
              style={styles.buttonRegister}
              onClick={() => handleSelectMode('register')}
              disabled={biometricsOk === false || approved}
            >
              {registered ? '📋 Dispositivo ya registrado' : '🆕 Registrarme (primera vez)'}
            </button>
            <button
              style={{ ...styles.button, opacity: approved ? 1 : 0.5 }}
              onClick={() => handleSelectMode('checkin')}
              disabled={!approved || biometricsOk === false}
            >
              🔐 Fichar (entrada / salida)
            </button>
            {regStatus === 'none' && (
              <p style={styles.meta}>Aún no tienes este dispositivo registrado. Primero completa el registro.</p>
            )}
            {regStatus === 'approved' && (
              <p style={{ ...styles.meta, color: '#15803d' }}>✅ Dispositivo registrado. Ya puedes fichar.</p>
            )}
          </>
        )}
        {step === STEPS.LOCATION && (
          <>
            <button style={styles.button} onClick={handleValidateLocation} disabled={busy || (!allowRegister && !approved)}>
              {busy ? 'Validando…' : '📍 Iniciar fichaje'}
            </button>
            {!allowRegister && !approved && (
              <p style={styles.meta}>
                Este dispositivo aún no está registrado. El registro lo realiza el administrador.
              </p>
            )}
          </>
        )}
        {step === STEPS.CODE && (
          <>
            {/* MOCK: en producción el código llega por correo/WhatsApp, no se muestra. */}
            <div style={styles.codeBox}>
              📩 Código enviado a tu canal corporativo (simulado): <strong style={styles.codeValue}>{sentCode}</strong>
            </div>
            <input
              style={styles.codeInput}
              inputMode="numeric"
              maxLength={6}
              placeholder="Ingresa el código de 6 dígitos"
              value={typedCode}
              onChange={(e) => setTypedCode(e.target.value.replace(/\D/g, ''))}
            />
            <button style={styles.buttonRegister} onClick={handleVerifyCode} disabled={typedCode.length !== 6}>
              ✅ Verificar código
            </button>
          </>
        )}
        {step === STEPS.BIOMETRIC && (
          <button
            style={mode === 'register' ? styles.buttonRegister : styles.button}
            onClick={handleBiometric}
            disabled={busy}
          >
            {busy
              ? 'Esperando al sistema…'
              : mode === 'register'
                ? '🪪 Registrar con rostro/huella'
                : '🔓 Verificar con rostro/huella'}
          </button>
        )}
        {(step === STEPS.DONE || (error && step !== STEPS.MODE)) && !busy && (
          <button style={styles.buttonSecondary} onClick={handleRestart}>
            🔄 Empezar de nuevo
          </button>
        )}
      </div>
    </div>
  );
}

function StepBadge({ label, active, done }) {
  return (
    <span
      style={{
        ...styles.badge,
        background: done ? '#16a34a' : active ? '#2563eb' : '#e5e7eb',
        color: done || active ? '#fff' : '#6b7280',
      }}
    >
      {label}
    </span>
  );
}

const styles = {
  // maxHeight + overflowY: la tarjeta cabe en la pantalla del móvil sin
  // desplazar la página; solo su interior se desplaza si un error la desborda.
  card: { maxWidth: 420, width: '100%', maxHeight: '100%', overflowY: 'auto', margin: '0 auto', padding: 20, boxSizing: 'border-box', fontFamily: 'system-ui, sans-serif', border: '1px solid #e5e7eb', borderRadius: 16, background: '#fff' },
  steps: { display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' },
  badge: { padding: '4px 10px', borderRadius: 999, fontSize: 13 },
  status: { fontSize: 15, minHeight: 22 },
  meta: { fontSize: 13, color: '#6b7280' },
  errorBox: { background: '#fef2f2', border: '1px solid #fca5a5', color: '#991b1b', padding: 12, borderRadius: 10, margin: '12px 0', fontSize: 14 },
  successBox: { background: '#f0fdf4', border: '1px solid #86efac', color: '#166534', padding: 12, borderRadius: 10, margin: '12px 0', fontSize: 14 },
  helpText: { margin: '8px 0 0', fontSize: 13 },
  actions: { display: 'flex', flexDirection: 'column', gap: 10, marginTop: 8 },
  button: { padding: '14px 16px', fontSize: 16, borderRadius: 12, border: 'none', background: '#2563eb', color: '#fff', cursor: 'pointer' },
  buttonRegister: { padding: '14px 16px', fontSize: 16, borderRadius: 12, border: 'none', background: '#7c3aed', color: '#fff', cursor: 'pointer' },
  codeBox: { background: '#eff6ff', border: '1px solid #bfdbfe', color: '#1e40af', padding: 12, borderRadius: 10, fontSize: 14 },
  codeValue: { fontSize: 22, letterSpacing: 3, fontFamily: 'monospace' },
  codeInput: { padding: '14px 16px', fontSize: 20, letterSpacing: 4, textAlign: 'center', borderRadius: 12, border: '1px solid #d1d5db', fontFamily: 'monospace' },
  buttonSecondary: { padding: '12px 16px', fontSize: 15, borderRadius: 12, border: '1px solid #d1d5db', background: '#fff', cursor: 'pointer' },
};
