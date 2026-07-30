'use client';

/**
 * components/AttendanceModule.jsx
 * Flujo estricto guiado por interacción del usuario (requisito de iOS: los
 * permisos de GPS/cámara SOLO se solicitan tras un gesto del usuario, nunca
 * automáticamente en el mount).
 *
 * Paso 1: Validar ubicación (Geolocation API + Haversine, radio 50 m).
 * Paso 2: Escanear rostro (getUserMedia + face-api.js) -> embedding 128 floats.
 * Paso 3: Fichaje contra el servicio mock (Distancia Euclidiana < 0.55).
 *
 * ─── MODELOS DE face-api.js ────────────────────────────────────────────────
 * Instalar:  npm i @vladmandic/face-api
 * Los pesos (weights) deben alojarse en /public/models. Descargarlos de:
 *   https://github.com/vladmandic/face-api/tree/master/model
 * Archivos mínimos requeridos (manifest .json + shards .bin):
 *   - tiny_face_detector_model-*        (detección ligera, ideal para móvil)
 *   - face_landmark_68_model-*          (landmarks, requerido por el descriptor)
 *   - face_recognition_model-*          (genera el embedding de 128 floats)
 * Next.js sirve /public en la raíz, por eso MODEL_URL = '/models'.
 * ───────────────────────────────────────────────────────────────────────────
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { isWithinOfficeRadius, MAX_RADIUS_METERS } from '../utils/haversine.js';
import { euclideanDistance } from '../utils/faceMath.js';
import { registerEmployee, checkInEmployee, isEmployeeRegistered } from '../services/attendanceService.js';

const MODEL_URL = '/models';

const STEPS = {
  MODE: 'MODE',       // pantalla inicial: elegir Registro o Fichaje (como un login)
  LOCATION: 'LOCATION',
  FACE: 'FACE',
  DONE: 'DONE',
};

// Instrucciones claras por plataforma cuando se deniegan permisos.
const PERMISSION_HELP = {
  gps: {
    title: 'Permiso de ubicación denegado',
    android:
      'Android (Chrome): toca el candado 🔒 junto a la URL → Permisos → Ubicación → Permitir. Verifica también que el GPS del teléfono esté encendido en Ajustes rápidos.',
    ios:
      'iOS (Safari): Ajustes → Privacidad y seguridad → Localización → Safari → "Al usar la app". Luego Ajustes → Safari → Ubicación → Permitir.',
  },
  camera: {
    title: 'Permiso de cámara denegado',
    android:
      'Android (Chrome): toca el candado 🔒 junto a la URL → Permisos → Cámara → Permitir, y recarga la página.',
    ios:
      'iOS (Safari): Ajustes → Safari → Cámara → Permitir. Si usas la PWA instalada, Ajustes → [nombre de la app] → Cámara.',
  },
};

export default function AttendanceModule({ employeeId = 'EMP-001' }) {
  const videoRef = useRef(null);
  const canvasRef = useRef(null); // overlay: recuadro + 68 landmarks en vivo
  const streamRef = useRef(null);
  const faceapiRef = useRef(null); // módulo face-api cargado dinámicamente

  const [step, setStep] = useState(STEPS.MODE);
  // Proceso elegido en la pantalla inicial: 'register' | 'checkin'
  const [mode, setMode] = useState(null);
  const [busy, setBusy] = useState(false);
  const [statusMsg, setStatusMsg] = useState('¿Qué deseas hacer?');
  const [error, setError] = useState(null); // { title, android, ios } | { title }
  const [locationInfo, setLocationInfo] = useState(null);
  const [cameraActive, setCameraActive] = useState(false);
  const [result, setResult] = useState(null);
  // ¿Ya existe un Embedding Máster para este empleado? (persistido en localStorage)
  const [registered, setRegistered] = useState(false);

  useEffect(() => {
    setRegistered(isEmployeeRegistered(employeeId));
  }, [employeeId]);

  // ── Limpieza de la cámara ─────────────────────────────────────────────
  const stopCamera = useCallback(() => {
    // Detener TODOS los tracks para apagar el LED de la cámara y liberar hardware.
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    setCameraActive(false);
  }, []);

  // Limpieza al desmontar el componente.
  useEffect(() => stopCamera, [stopCamera]);

  // ── PASO 0: Elegir proceso (pantalla tipo login) ──────────────────────
  const handleSelectMode = (selectedMode) => {
    setMode(selectedMode);
    setError(null);
    setResult(null);
    setStep(STEPS.LOCATION);
    setStatusMsg(
      selectedMode === 'register'
        ? 'Registro de rostro: primero valida tu ubicación.'
        : 'Fichaje: primero valida tu ubicación.'
    );
  };

  // ── PASO 1: Validar ubicación ─────────────────────────────────────────
  const handleValidateLocation = () => {
    setError(null);
    setBusy(true);
    setStatusMsg('Obteniendo tu ubicación GPS…');

    if (!('geolocation' in navigator)) {
      setBusy(false);
      setError({ title: 'Tu navegador no soporta geolocalización.' });
      return;
    }

    /**
     * La primera lectura de geolocalización suele ser imprecisa (sobre todo
     * en PC, que se ubica por WiFi/IP, o en móvil mientras el GPS "calienta").
     * Estrategia: escuchar con watchPosition durante hasta 12 s y quedarnos
     * con la lectura de MEJOR precisión. Terminamos antes si llega una
     * lectura con precisión <= 25 m.
     */
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
      const { inRange, distance } = isWithinOfficeRadius(latitude, longitude);
      setLocationInfo({ distance, accuracy: Math.round(accuracy) });

      if (inRange) {
        setStep(STEPS.FACE);
        setStatusMsg(`✅ Estás a ${distance} m de la oficina. Ahora escanea tu rostro.`);
      } else {
        // Flujo bloqueado: no se habilita la cámara.
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
        // Con 25 m de precisión ya es suficiente para un radio de 50 m.
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

    // Después de 12 s usamos la mejor lectura que haya llegado.
    const timer = setTimeout(finish, 12000);
  };

  // ── Carga perezosa de face-api y sus modelos ──────────────────────────
  const loadFaceApi = async () => {
    if (faceapiRef.current) return faceapiRef.current;

    setStatusMsg('Cargando modelos de IA (solo la primera vez)…');
    // Import dinámico: evita que face-api/tfjs se ejecute en SSR (usa APIs del navegador).
    const faceapi = await import('@vladmandic/face-api');

    // Los pesos se sirven estáticamente desde /public/models (ver cabecera del archivo).
    await Promise.all([
      faceapi.nets.tinyFaceDetector.loadFromUri(MODEL_URL),
      faceapi.nets.faceLandmark68Net.loadFromUri(MODEL_URL),
      faceapi.nets.faceRecognitionNet.loadFromUri(MODEL_URL),
    ]);

    faceapiRef.current = faceapi;
    return faceapi;
  };

  // ── PASO 2: Escanear rostro ───────────────────────────────────────────
  // Usa el `mode` elegido en la pantalla inicial: 'register' | 'checkin'
  const handleScanFace = async () => {
    setError(null);
    setBusy(true);
    setResult(null);

    try {
      const faceapi = await loadFaceApi();

      setStatusMsg('Solicitando acceso a la cámara…');
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } },
        audio: false,
      });
      streamRef.current = stream;

      const video = videoRef.current;
      video.srcObject = stream;
      // iOS requiere playsInline + muted (ya en el JSX) y un play() explícito.
      await video.play();
      setCameraActive(true);

      setStatusMsg('Cámara activa. Mira de frente… detectando rostro.');

      /**
       * PRUEBA DE VIDA (solo en fichaje): antes de extraer el vector,
       * exigimos parpadeo + giro de cabeza aleatorio. Una foto en un
       * celular no puede hacer ninguno de los dos gestos.
       */
      let livenessDescriptors = null;
      if (mode === 'checkin') {
        const liveness = await runLivenessCheck(faceapi, videoRef.current, canvasRef.current, setStatusMsg);
        if (!liveness.passed) {
          stopCamera();
          setError({ title: `❌ Prueba de vida fallida: ${liveness.reason} Inténtalo de nuevo.` });
          setStatusMsg('Fichaje bloqueado por prueba de vida.');
          return;
        }
        // Identidad AMARRADA a la prueba de vida: la verificación final usa
        // los vectores capturados durante el parpadeo/giro, no una captura
        // posterior que alguien podría sustituir por una foto.
        livenessDescriptors = liveness.descriptors;
        setStatusMsg('✅ Persona real confirmada. Verificando identidad…');
      }

      /**
       * "Huella matemática": un VECTOR (Float32Array) de 128 floats, no una
       * matriz. Es el descriptor facial que produce la red de reconocimiento;
       * no contiene la imagen ni permite reconstruirla.
       *
       * - Registro: capturamos 3 muestras y guardamos el PROMEDIO → un
       *   Embedding Máster más estable frente a cambios de luz/ángulo.
       * - Fichaje: basta 1 muestra, se compara contra el máster.
       */
      const samplesNeeded = mode === 'register' ? 3 : 1;
      // En fichaje, las muestras son los cuadros de la prueba de vida
      // (elegimos hasta 5 repartidos a lo largo del gesto).
      const samples = livenessDescriptors
        ? pickSpread(livenessDescriptors, 5)
        : [];

      for (let i = samples.length > 0 ? samplesNeeded : 0; i < samplesNeeded; i++) {
        setStatusMsg(
          samplesNeeded > 1
            ? `Capturando muestra ${i + 1} de ${samplesNeeded}… mueve ligeramente la cabeza.`
            : 'Detectando rostro…'
        );
        const detection = await detectWithRetries(faceapi, video, canvasRef.current, 20, 500);
        if (!detection) break;
        samples.push(Array.from(detection.descriptor));
        // Pequeña pausa entre muestras para que varíe un poco la pose.
        if (i < samplesNeeded - 1) await new Promise((res) => setTimeout(res, 700));
      }

      if (samples.length < samplesNeeded) {
        stopCamera();
        setError({ title: 'No se detectó ningún rostro. Asegura buena iluminación y que tu cara esté centrada, luego reintenta.' });
        setStatusMsg('Detección fallida.');
        return;
      }

      // Promedio elemento a elemento de las muestras (vector de 128 floats).
      const liveEmbedding = samples[0].map(
        (_, idx) => samples.reduce((sum, s) => sum + s[idx], 0) / samples.length
      );

      // Para inspección: abre la consola del navegador (F12) y verás el vector.
      console.log(`[Attendance] Vector facial (${liveEmbedding.length} floats):`, liveEmbedding);

      stopCamera(); // liberar cámara apenas tenemos el embedding

      if (mode === 'register') {
        setStatusMsg('Rostro capturado. Guardando registro…');
        const reg = await registerEmployee(employeeId, liveEmbedding);
        if (!reg.success) throw new Error(reg.error);
        setRegistered(true);
        setResult({ success: true, message: `🆕 ${reg.message} Embedding Máster guardado. Ya puedes fichar.` });
        setStep(STEPS.DONE);
        setStatusMsg('Registro inicial completado.');
        return;
      }

      setStatusMsg('Rostro capturado. Verificando identidad…');
      const checkin = await checkInEmployee(employeeId, liveEmbedding);
      setResult(checkin);
      setStep(STEPS.DONE);
      setStatusMsg(checkin.success ? '✅ Fichaje registrado.' : '❌ Fichaje rechazado.');
    } catch (err) {
      stopCamera();
      if (err?.name === 'NotAllowedError' || err?.name === 'PermissionDeniedError') {
        setError(PERMISSION_HELP.camera);
      } else if (err?.name === 'NotFoundError') {
        setError({ title: 'No se encontró ninguna cámara en el dispositivo.' });
      } else if (err?.name === 'NotReadableError') {
        setError({ title: 'La cámara está siendo usada por otra aplicación. Ciérrala e inténtalo de nuevo.' });
      } else {
        setError({ title: `Error inesperado: ${err?.message || err}` });
      }
      setStatusMsg('No se pudo completar el escaneo.');
    } finally {
      setBusy(false);
    }
  };

  const handleRestart = () => {
    stopCamera();
    setStep(STEPS.MODE);
    setMode(null);
    setError(null);
    setResult(null);
    setLocationInfo(null);
    setStatusMsg('¿Qué deseas hacer?');
  };

  return (
    <div style={styles.card}>
      <h2 style={styles.title}>🕐 Control de Asistencia</h2>
      <p style={styles.subtitle}>Empleado: <strong>{employeeId}</strong></p>

      {/* Indicador de pasos (solo dentro de un proceso) */}
      {step !== STEPS.MODE && (
        <div style={styles.steps}>
          <StepBadge
            label={mode === 'register' ? '🆕 Registro' : '🔐 Fichaje'}
            active
            done={step === STEPS.DONE && result?.success}
          />
          <StepBadge label="1. Ubicación" active={step === STEPS.LOCATION} done={step === STEPS.FACE || step === STEPS.DONE} />
          <StepBadge label="2. Rostro" active={step === STEPS.FACE} done={step === STEPS.DONE} />
        </div>
      )}

      <p style={styles.status}>{statusMsg}</p>

      {locationInfo && (
        <p style={styles.meta}>
          Distancia a la oficina: {locationInfo.distance} m · Precisión GPS: ±{locationInfo.accuracy} m
        </p>
      )}

      {/* Video + canvas de detección superpuesto.
          playsInline + muted evitan el fullscreen nativo de iOS. */}
      <div style={{ position: 'relative', display: cameraActive ? 'block' : 'none' }}>
        <video ref={videoRef} playsInline muted autoPlay style={styles.video} />
        <canvas ref={canvasRef} style={styles.overlay} />
      </div>

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
          {typeof result.distance === 'number' && (
            <p style={styles.meta}>Distancia euclidiana: {result.distance} (umbral {result.threshold})</p>
          )}
        </div>
      )}

      <div style={styles.actions}>
        {/* Pantalla inicial tipo login: dos procesos independientes */}
        {step === STEPS.MODE && (
          <>
            <button style={styles.buttonRegister} onClick={() => handleSelectMode('register')}>
              {registered ? '🔁 Volver a registrar mi rostro' : '🆕 Registrarme (primera vez)'}
            </button>
            <button
              style={{ ...styles.button, opacity: registered ? 1 : 0.5 }}
              onClick={() => handleSelectMode('checkin')}
              disabled={!registered}
            >
              🔐 Fichar (entrada / salida)
            </button>
            {!registered && (
              <p style={styles.meta}>Aún no tienes rostro registrado. Primero completa el registro.</p>
            )}
          </>
        )}
        {step === STEPS.LOCATION && (
          <button style={styles.button} onClick={handleValidateLocation} disabled={busy}>
            {busy ? 'Validando…' : '📍 Validar mi ubicación'}
          </button>
        )}
        {step === STEPS.FACE && (
          <button
            style={mode === 'register' ? styles.buttonRegister : styles.button}
            onClick={handleScanFace}
            disabled={busy}
          >
            {busy ? 'Procesando…' : mode === 'register' ? '📷 Escanear y registrar rostro' : '📷 Escanear y validar rostro'}
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

/** Toma hasta `n` elementos repartidos uniformemente a lo largo del array. */
function pickSpread(arr, n) {
  if (arr.length <= n) return [...arr];
  const step = (arr.length - 1) / (n - 1);
  return Array.from({ length: n }, (_, i) => arr[Math.round(i * step)]);
}

/** Reintenta la detección facial N veces con pausa entre intentos, dibujando el overlay. */
async function detectWithRetries(faceapi, video, canvas, maxAttempts, delayMs) {
  const options = new faceapi.TinyFaceDetectorOptions({ inputSize: 320, scoreThreshold: 0.5 });
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const detection = await faceapi
      .detectSingleFace(video, options)
      .withFaceLandmarks()
      .withFaceDescriptor();
    drawOverlay(canvas, video, detection);
    if (detection) return detection;
    await new Promise((res) => setTimeout(res, delayMs));
  }
  return null;
}

/** Dibuja el recuadro de detección y los 68 landmarks sobre el canvas. */
function drawOverlay(canvas, video, detection, color = '#22d3ee', label = '') {
  if (!canvas || !video?.videoWidth) return;
  // El canvas usa la resolución nativa del video; CSS lo escala junto al <video>.
  if (canvas.width !== video.videoWidth) canvas.width = video.videoWidth;
  if (canvas.height !== video.videoHeight) canvas.height = video.videoHeight;

  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  if (!detection) return;

  const box = detection.detection?.box || detection.alignedRect?.box;
  if (box) {
    ctx.strokeStyle = color;
    ctx.lineWidth = 3;
    ctx.strokeRect(box.x, box.y, box.width, box.height);
    if (label) {
      ctx.fillStyle = color;
      ctx.font = 'bold 20px system-ui';
      // El canvas está espejado por CSS: des-espejamos el texto para que sea legible.
      ctx.save();
      ctx.scale(-1, 1);
      ctx.fillText(label, -(box.x + box.width), Math.max(24, box.y - 8));
      ctx.restore();
    }
  }

  const points = detection.landmarks?.positions || [];
  ctx.fillStyle = color;
  for (const p of points) {
    ctx.beginPath();
    ctx.arc(p.x, p.y, 2.2, 0, Math.PI * 2);
    ctx.fill();
  }
}

// ─── Prueba de vida (liveness) — geometría de los 68 landmarks ───────────
// Una foto o pantalla estática no puede parpadear ni girar la cabeza,
// así que exigimos ambos gestos antes de aceptar el fichaje.

const dist2d = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

/**
 * Eye Aspect Ratio (EAR): apertura vertical del ojo / anchura horizontal.
 * Ojo abierto ≈ 0.30; ojo cerrado ≈ 0.10-0.15. Un parpadeo es una caída
 * momentánea del EAR seguida de recuperación.
 * Landmarks: ojo izq = puntos 36-41, ojo der = 42-47 (esquema de 68 puntos).
 */
function eyeAspectRatio(eye) {
  return (dist2d(eye[1], eye[5]) + dist2d(eye[2], eye[4])) / (2 * dist2d(eye[0], eye[3]));
}

/**
 * Giro de cabeza (yaw) aproximado: posición horizontal de la nariz (punto 30)
 * dentro del ancho de la mandíbula (puntos 0 a 16).
 * ≈0.5 mirando de frente; <0.35 o >0.65 indican giro claro hacia un lado.
 */
function headTurnRatio(landmarks) {
  const jawLeft = landmarks.positions[0];
  const jawRight = landmarks.positions[16];
  const nose = landmarks.positions[30];
  return (nose.x - jawLeft.x) / (jawRight.x - jawLeft.x);
}

/**
 * Ejecuta la prueba de vida en dos fases:
 *  1. Parpadeo: EAR debe caer por debajo de 0.22 y volver a subir.
 *  2. Giro: la nariz debe desplazarse claramente hacia el lado pedido
 *     (aleatorio) y volver al centro.
 * Devuelve { passed, reason }.
 */
async function runLivenessCheck(faceapi, video, canvas, setStatusMsg) {
  const options = new faceapi.TinyFaceDetectorOptions({ inputSize: 320, scoreThreshold: 0.5 });
  const BLINK_CLOSE = 0.22;
  const BLINK_OPEN = 0.27;
  // Si el vector de un cuadro se aleja más que esto del primer cuadro,
  // es OTRA persona (u objeto) → cambio de identidad a mitad de prueba.
  const IDENTITY_DRIFT_MAX = 0.55;
  const deadline = Date.now() + 25000; // 25 s para completar ambos gestos

  // Vectores de identidad recolectados DURANTE los gestos: amarran la
  // prueba de vida a la persona concreta que la realizó.
  const descriptors = [];

  // Lado aleatorio: imposible de anticipar con un video pregrabado simple.
  // Nota: el preview está espejado, así que invertimos la instrucción para
  // que "izquierda" sea la izquierda DEL USUARIO.
  const wantLeft = Math.random() < 0.5;
  const turnLabel = wantLeft ? 'IZQUIERDA' : 'DERECHA';

  let phase = 'blink';
  let sawClosed = false;
  let sawTurned = false;

  while (Date.now() < deadline) {
    // withFaceDescriptor: extraemos la identidad EN CADA CUADRO del gesto.
    const det = await faceapi
      .detectSingleFace(video, options)
      .withFaceLandmarks()
      .withFaceDescriptor();

    if (!det) {
      drawOverlay(canvas, video, null);
      setStatusMsg('Mantén tu rostro visible y centrado…');
      continue;
    }

    // Consistencia de identidad: todos los cuadros deben ser LA MISMA persona.
    const desc = Array.from(det.descriptor);
    if (descriptors.length > 0 && euclideanDistance(descriptors[0], desc) > IDENTITY_DRIFT_MAX) {
      return {
        passed: false,
        reason: 'Se detectó un cambio de rostro durante la prueba. Debe ser la misma persona de principio a fin.',
      };
    }
    descriptors.push(desc);

    if (phase === 'blink') {
      const lm = det.landmarks;
      const ear = (eyeAspectRatio(lm.getLeftEye()) + eyeAspectRatio(lm.getRightEye())) / 2;
      drawOverlay(canvas, video, det, '#f59e0b', '👁 Parpadea');
      setStatusMsg('Prueba de vida 1/2: parpadea con normalidad…');
      if (ear < BLINK_CLOSE) sawClosed = true;
      if (sawClosed && ear > BLINK_OPEN) {
        phase = 'turn'; // parpadeo completo: cerró y volvió a abrir
      }
    } else {
      const ratio = headTurnRatio(det.landmarks);
      drawOverlay(canvas, video, det, '#a78bfa', `↔ Gira a tu ${turnLabel}`);
      setStatusMsg(`Prueba de vida 2/2: gira la cabeza a tu ${turnLabel} y vuelve al centro…`);
      // Video espejado: girar la cabeza a TU izquierda mueve la nariz hacia
      // ratio ALTO en coordenadas crudas del video.
      const turned = wantLeft ? ratio > 0.62 : ratio < 0.38;
      const centered = ratio > 0.42 && ratio < 0.58;
      if (turned) sawTurned = true;
      if (sawTurned && centered) {
        drawOverlay(canvas, video, det, '#22c55e', '✔ Persona real');
        return { passed: true, descriptors };
      }
    }
  }

  return {
    passed: false,
    reason:
      phase === 'blink'
        ? 'No se detectó un parpadeo real. Una foto o pantalla no puede parpadear.'
        : 'No se detectó el giro de cabeza solicitado.',
  };
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
  card: { maxWidth: 420, margin: '0 auto', padding: 20, fontFamily: 'system-ui, sans-serif', border: '1px solid #e5e7eb', borderRadius: 16 },
  title: { margin: '0 0 4px' },
  subtitle: { margin: '0 0 16px', color: '#6b7280' },
  steps: { display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' },
  badge: { padding: '4px 10px', borderRadius: 999, fontSize: 13 },
  status: { fontSize: 15, minHeight: 22 },
  meta: { fontSize: 13, color: '#6b7280' },
  video: { width: '100%', borderRadius: 12, background: '#000', transform: 'scaleX(-1)', display: 'block' },
  overlay: { position: 'absolute', inset: 0, width: '100%', height: '100%', transform: 'scaleX(-1)', pointerEvents: 'none' },
  errorBox: { background: '#fef2f2', border: '1px solid #fca5a5', color: '#991b1b', padding: 12, borderRadius: 10, margin: '12px 0', fontSize: 14 },
  successBox: { background: '#f0fdf4', border: '1px solid #86efac', color: '#166534', padding: 12, borderRadius: 10, margin: '12px 0', fontSize: 14 },
  helpText: { margin: '8px 0 0', fontSize: 13 },
  actions: { display: 'flex', flexDirection: 'column', gap: 10, marginTop: 8 },
  button: { padding: '14px 16px', fontSize: 16, borderRadius: 12, border: 'none', background: '#2563eb', color: '#fff', cursor: 'pointer' },
  buttonRegister: { padding: '14px 16px', fontSize: 16, borderRadius: 12, border: 'none', background: '#7c3aed', color: '#fff', cursor: 'pointer' },
  buttonSecondary: { padding: '12px 16px', fontSize: 15, borderRadius: 12, border: '1px solid #d1d5db', background: '#fff', cursor: 'pointer' },
};
