'use client';

/**
 * components/LivenessIdentityDemo.jsx
 * Dashboard de pruebas: registra VARIAS personas, elige contra quién validar
 * (intercambiable), corre prueba de vida 3D (MediaPipe) + identidad (face-api),
 * y registra cada intento para calcular métricas de confianza (FAR / FRR).
 *
 * Modelos en /public: /models/face_landmarker.task, /wasm/*, pesos de face-api.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { euclideanDistance, MATCH_THRESHOLD } from '../utils/faceMath.js';
import {
  listPeople, addPerson, removePerson, getPerson,
  logAttempt, listAttempts, clearAttempts, computeMetrics,
} from '../services/rosterService.js';

const FACEAPI_MODEL_URL = '/models';
const MEDIAPIPE_MODEL = '/models/face_landmarker.task';
const WASM_PATH = '/wasm';

const YAW_DEGREES = 15;              // giro mínimo a cada lado
const MAX_FACE_CAPTURES = 3;         // capturas face-api por reto
const FACE_CAPTURE_GAP_MS = 1200;    // separación entre capturas
const CHALLENGE_TIMEOUT_MS = 20000;  // si no completa el reto → rechazado (spoof/fallo)

/** Promedia varios descriptores de 128 floats en uno solo (más estable). */
function averageDescriptors(descs) {
  if (!descs || descs.length === 0) return null;
  if (descs.length === 1) return descs[0];
  const out = new Array(descs[0].length).fill(0);
  for (const d of descs) for (let i = 0; i < d.length; i++) out[i] += d[i];
  return out.map((v) => v / descs.length);
}

export default function LivenessIdentityDemo() {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const streamRef = useRef(null);
  const landmarkerRef = useRef(null);
  const faceapiRef = useRef(null);
  const rafRef = useRef(null);
  const lastDescriptorRef = useRef(null);

  const [ready, setReady] = useState(false);
  const [loadError, setLoadError] = useState(null);
  const [status, setStatus] = useState('Cargando modelos de IA…');
  const [permsReady, setPermsReady] = useState(false);
  const [cameraOn, setCameraOn] = useState(false);

  // Roster de personas y selección
  const [people, setPeople] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [newName, setNewName] = useState('');

  // Acceso de administrador: solo los admins pueden registrar personas.
  // Prototipo: PIN fijo. Producción: rol de usuario en Supabase.
  const ADMIN_PIN = '1234';
  const [adminOk, setAdminOk] = useState(false);
  const [pinInput, setPinInput] = useState('');
  const photoInputRef = useRef(null);

  // Reto en curso
  const [testing, setTesting] = useState(false);
  const testingRef = useRef(false);
  const [instruction, setInstruction] = useState('');
  const [blinkDone, setBlinkDone] = useState(false);
  const [turnDone, setTurnDone] = useState(false);
  // phase: idle|blink|turn|done ; mode: enroll|test ; kind: genuine|impostor|spoof
  const challengeRef = useRef({ phase: 'idle', mode: 'test', kind: 'genuine', side: 'left', name: '', targetId: null, sawOpen: false, sawClosed: false, sawTurn: false });

  const [metrics, setMetrics] = useState({ faceDetected: false, blinkScore: 0, yaw: 0, identityDistance: null });
  const [verdict, setVerdict] = useState(null);

  // Métricas y log
  const [stats, setStats] = useState(null);
  const [attempts, setAttempts] = useState([]);
  const refreshData = useCallback(() => {
    setPeople(listPeople());
    setStats(computeMetrics());
    setAttempts(listAttempts().slice(-8).reverse());
  }, []);

  // Instrumentación de tiempos
  const [timings, setTimings] = useState({ modelLoad: null, permission: null, gps: null, cameraStart: null, mpAvg: null, faceapiAvg: null, challenge: null });
  const perfRef = useRef({ challengeStart: 0, deadline: 0, mpSamples: [], faSamples: [], faceRuns: 0, lastFaceRun: 0, faceDescs: [] });
  const pushSample = (arr, v) => { arr.push(v); if (arr.length > 30) arr.shift(); };
  const avg = (arr) => (arr.length ? Math.round(arr.reduce((a, b) => a + b, 0) / arr.length) : null);

  useEffect(() => { refreshData(); }, [refreshData]);

  // ── Carga de modelos (GPU→CPU, timeout, errores visibles) ─────────────
  useEffect(() => {
    let cancelled = false;
    // Si en 45 s no cargó, no dejamos la app colgada: mostramos error + recuperación.
    const timeout = setTimeout(() => {
      if (!cancelled) {
        setLoadError('Tiempo de espera agotado cargando los modelos (posible caché dañado o conexión lenta).');
        setStatus('❌ La carga se quedó bloqueada.');
      }
    }, 45000);
    (async () => {
      const t0 = performance.now();
      try {
        setStatus('Cargando modelos (MediaPipe + face-api en paralelo)…');

        // Cadena de MediaPipe (descarga .task + inicializa, GPU→CPU).
        const loadMediaPipe = (async () => {
          const vision = await import('@mediapipe/tasks-vision');
          const fileset = await vision.FilesetResolver.forVisionTasks(WASM_PATH);
          const make = (delegate) => vision.FaceLandmarker.createFromOptions(fileset, {
            baseOptions: { modelAssetPath: MEDIAPIPE_MODEL, delegate },
            outputFaceBlendshapes: true,
            outputFacialTransformationMatrixes: true,
            runningMode: 'VIDEO',
            numFaces: 1,
          });
          try { return await make('GPU'); }
          catch { return await make('CPU'); }
        })();

        // Cadena de face-api (descarga sus 3 pesos).
        const loadFaceApi = (async () => {
          const faceapi = await import('@vladmandic/face-api');
          await Promise.all([
            faceapi.nets.tinyFaceDetector.loadFromUri(FACEAPI_MODEL_URL),
            faceapi.nets.faceLandmark68Net.loadFromUri(FACEAPI_MODEL_URL),
            faceapi.nets.faceRecognitionNet.loadFromUri(FACEAPI_MODEL_URL),
          ]);
          return faceapi;
        })();

        // Ambas cadenas corren AL MISMO TIEMPO.
        const [landmarker, faceapi] = await Promise.all([loadMediaPipe, loadFaceApi]);
        if (cancelled) return;

        clearTimeout(timeout);
        setTimings((t) => ({ ...t, modelLoad: Math.round(performance.now() - t0) }));
        landmarkerRef.current = landmarker;
        faceapiRef.current = faceapi;
        setReady(true);
        setStatus('✅ Modelos listos. Pulsa "Conceder permisos".');
      } catch (err) {
        if (cancelled) return;
        clearTimeout(timeout);
        setLoadError(`${err?.name || 'Error'}: ${err?.message || err}`);
        setStatus('❌ No se pudieron cargar los modelos.');
      }
    })();
    return () => { cancelled = true; clearTimeout(timeout); };
  }, []);

  // Recuperación: borra el caché del SW y lo desregistra, luego recarga.
  // Útil si un caché dañado dejó la carga bloqueada.
  const handleClearCacheReload = async () => {
    try {
      if ('serviceWorker' in navigator) {
        const regs = await navigator.serviceWorker.getRegistrations();
        await Promise.all(regs.map((r) => r.unregister()));
      }
      if ('caches' in window) {
        const keys = await caches.keys();
        await Promise.all(keys.map((k) => caches.delete(k)));
      }
    } finally {
      location.reload();
    }
  };

  const stopCamera = useCallback(() => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    if (streamRef.current) { streamRef.current.getTracks().forEach((t) => t.stop()); streamRef.current = null; }
    if (videoRef.current) videoRef.current.srcObject = null;
  }, []);
  useEffect(() => stopCamera, [stopCamera]);

  // ── Permisos por adelantado y en paralelo ─────────────────────────────
  const handlePreparePermissions = async () => {
    setStatus('Concede cámara y ubicación cuando el sistema lo pida…');
    const camReq = (async () => {
      const t0 = performance.now();
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' }, audio: false });
      const ms = Math.round(performance.now() - t0);
      stream.getTracks().forEach((tr) => tr.stop());
      return ms;
    })();
    const gpsReq = new Promise((resolve) => {
      if (!('geolocation' in navigator)) return resolve(null);
      const t0 = performance.now();
      navigator.geolocation.getCurrentPosition(() => resolve(Math.round(performance.now() - t0)), () => resolve(null), { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 });
    });
    try {
      const [permission, gps] = await Promise.all([camReq, gpsReq]);
      setTimings((t) => ({ ...t, permission, gps }));
      setPermsReady(true);
      setStatus('✅ Permisos listos. Enciende la cámara.');
    } catch (err) {
      setStatus(`No se concedieron los permisos: ${err?.message || err}`);
    }
  };

  const handleStartCamera = async () => {
    try {
      const t0 = performance.now();
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } }, audio: false });
      streamRef.current = stream;
      videoRef.current.srcObject = stream;
      await videoRef.current.play();
      setTimings((t) => ({ ...t, cameraStart: Math.round(performance.now() - t0) }));
      setCameraOn(true);
      setStatus('Cámara activa. Registra personas o valida contra una.');
      startLoop();
    } catch (err) {
      setStatus(`No se pudo abrir la cámara: ${err?.message || err}`);
    }
  };

  // ── Bucle de análisis (limitado a ~8 fps) ─────────────────────────────
  const ANALYSIS_INTERVAL_MS = 120;
  const startLoop = () => {
    const faceapi = faceapiRef.current;
    const landmarker = landmarkerRef.current;
    const video = videoRef.current;
    let faceapiBusy = false;
    let lastRun = 0;

    const tick = async () => {
      if (!video || video.readyState < 2) { rafRef.current = requestAnimationFrame(tick); return; }
      const now = performance.now();
      if (now - lastRun < ANALYSIS_INTERVAL_MS) { rafRef.current = requestAnimationFrame(tick); return; }
      lastRun = now;

      const mpT0 = performance.now();
      const res = landmarker.detectForVideo(video, now);
      pushSample(perfRef.current.mpSamples, performance.now() - mpT0);
      const lm = res.faceLandmarks?.[0];
      let blinkScore = 0, yaw = 0;

      if (lm) {
        const bs = res.faceBlendshapes?.[0]?.categories || [];
        const byName = (n) => bs.find((c) => c.categoryName === n)?.score || 0;
        const bothClosed = Math.min(byName('eyeBlinkLeft'), byName('eyeBlinkRight'));
        const bothOpen = Math.max(byName('eyeBlinkLeft'), byName('eyeBlinkRight'));
        blinkScore = Math.round(bothClosed * 100) / 100;
        const mtx = res.facialTransformationMatrixes?.[0]?.data;
        if (mtx) yaw = Math.atan2(-mtx[8], mtx[0]) * (180 / Math.PI);

        const ch = challengeRef.current;
        if (testingRef.current) {
          // Timeout del reto → rechazado (cubre spoof con foto que no parpadea).
          if (now > perfRef.current.deadline && ch.phase !== 'done') {
            finishChallenge(false);
          } else if (ch.phase === 'blink') {
            if (bothOpen < 0.15) ch.sawOpen = true;
            if (ch.sawOpen && bothClosed > 0.55) ch.sawClosed = true;
            if (ch.sawClosed && bothOpen < 0.20) {
              setBlinkDone(true); ch.phase = 'turn';
              setInstruction(`✅ Parpadeo OK. Gira la cabeza a tu ${ch.side === 'left' ? 'IZQUIERDA' : 'DERECHA'} y vuelve al centro.`);
            }
          } else if (ch.phase === 'turn') {
            const goal = ch.side === 'left' ? 1 : -1;
            if (Math.sign(yaw) === goal && Math.abs(yaw) > YAW_DEGREES) ch.sawTurn = true;
            if (ch.sawTurn && Math.abs(yaw) < 8) { setTurnDone(true); ch.phase = 'done'; setInstruction('✅ Verificando…'); }
          }
        }

        if (testingRef.current && ch.phase === 'done' && lastDescriptorRef.current) {
          finishChallenge(true);
        }
      }

      // face-api: captura la identidad SOLO de FRENTE (yaw pequeño). Un rostro
      // de perfil (durante el giro) da un descriptor malo → falsas aceptaciones.
      const pf = perfRef.current;
      const isFrontal = !!lm && Math.abs(yaw) < 12;
      if (testingRef.current && isFrontal && !faceapiBusy && pf.faceRuns < MAX_FACE_CAPTURES && now - pf.lastFaceRun >= FACE_CAPTURE_GAP_MS) {
        faceapiBusy = true; pf.faceRuns += 1; pf.lastFaceRun = now;
        const faT0 = performance.now();
        faceapi.detectSingleFace(video, new faceapi.TinyFaceDetectorOptions({ inputSize: 224, scoreThreshold: 0.5 }))
          .withFaceLandmarks().withFaceDescriptor()
          .then((det) => {
            pushSample(pf.faSamples, performance.now() - faT0);
            if (det) {
              const desc = Array.from(det.descriptor);
              pf.faceDescs.push(desc);
              lastDescriptorRef.current = desc;
              const sel = challengeRef.current.targetId ? getPerson(challengeRef.current.targetId) : null;
              if (sel) setMetrics((m) => ({ ...m, identityDistance: Math.round(euclideanDistance(sel.descriptor, desc) * 1000) / 1000 }));
            }
          }).catch(() => {}).finally(() => { faceapiBusy = false; });
      }

      setMetrics((m) => ({ ...m, faceDetected: !!lm, blinkScore, yaw: Math.round(yaw) }));
      drawOverlay(canvasRef.current, video, lm, testingRef.current);
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
  };

  // Concluye el reto (ok=false si venció el tiempo / falló la vida).
  function finishChallenge(livenessOk) {
    const ch = challengeRef.current;
    testingRef.current = false;
    setTesting(false);
    setInstruction('');
    const pf = perfRef.current;
    setTimings((t) => ({ ...t, challenge: Math.round(performance.now() - pf.challengeStart), mpAvg: avg(pf.mpSamples), faceapiAvg: avg(pf.faSamples) }));
    const liveDesc = averageDescriptors(pf.faceDescs) || lastDescriptorRef.current;

    if (ch.mode === 'enroll') {
      if (!livenessOk || !liveDesc) {
        setVerdict({ pass: false, kind: 'enroll', msg: 'No se pudo registrar: no se completó la prueba de vida.' });
        setStatus('❌ Registro fallido.');
        return;
      }
      const p = addPerson(ch.name, liveDesc);
      setSelectedId(p.id);
      refreshData();
      setVerdict({ pass: true, kind: 'enroll', msg: `✅ Registrado: ${p.name}` });
      setStatus(`✅ ${p.name} registrado.`);
      return;
    }

    // mode 'test': comparar contra la persona seleccionada
    const target = getPerson(ch.targetId);
    let distance = null, identityOk = false;
    if (livenessOk && liveDesc && target) {
      distance = Math.round(euclideanDistance(target.descriptor, liveDesc) * 1000) / 1000;
      identityOk = distance < MATCH_THRESHOLD;
    }
    const accepted = livenessOk && identityOk;
    logAttempt({ targetId: ch.targetId, targetName: target?.name, kind: ch.kind, distance, livenessOk, accepted });
    refreshData();
    setVerdict({
      pass: accepted, kind: ch.kind, livenessOk, identityOk, distance,
      msg: accepted ? `✅ ACEPTADO como ${target?.name}` : '❌ RECHAZADO',
    });
    setStatus(accepted ? '✅ Validación aceptada.' : '❌ Validación rechazada.');
  }

  // Inicia un reto. mode: 'enroll' | 'test'. Para test: kind + targetId.
  const startChallenge = (mode, opts = {}) => {
    if (!metrics.faceDetected) { setStatus('⚠️ No se detecta rostro. Céntrate en la cámara.'); return; }
    if (mode === 'enroll' && !newName.trim()) { setStatus('⚠️ Escribe un nombre para registrar.'); return; }
    if (mode === 'test' && !selectedId) { setStatus('⚠️ Selecciona contra quién validar.'); return; }

    const pf = perfRef.current;
    pf.challengeStart = performance.now();
    pf.deadline = performance.now() + CHALLENGE_TIMEOUT_MS;
    pf.mpSamples = []; pf.faSamples = []; pf.faceRuns = 0; pf.lastFaceRun = 0; pf.faceDescs = [];
    lastDescriptorRef.current = null;
    challengeRef.current = {
      phase: 'blink', mode, side: Math.random() < 0.5 ? 'left' : 'right',
      kind: opts.kind || 'genuine', name: newName, targetId: selectedId,
      sawOpen: false, sawClosed: false, sawTurn: false,
    };
    setBlinkDone(false); setTurnDone(false); setVerdict(null);
    setTesting(true); testingRef.current = true;
    setInstruction('👁 Parpadea con LOS DOS ojos (ciérralos y ábrelos).');
  };

  /**
   * Registro por FOTO (solo admin): extrae el descriptor de una imagen
   * estática. Sin prueba de vida — el admin da fe de que la foto es de la
   * persona real. La foto NUNCA se guarda; solo el vector de 128 floats.
   */
  const handlePhotoRegister = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = ''; // permite re-subir el mismo archivo
    if (!file) return;
    if (!newName.trim()) { setStatus('⚠️ Escribe primero el nombre de la persona.'); return; }
    const faceapi = faceapiRef.current;
    if (!faceapi) { setStatus('⚠️ Modelos aún cargando…'); return; }

    setStatus('Analizando la foto…');
    try {
      const img = await faceapi.bufferToImage(file);
      const det = await faceapi
        .detectSingleFace(img, new faceapi.TinyFaceDetectorOptions({ inputSize: 416, scoreThreshold: 0.5 }))
        .withFaceLandmarks()
        .withFaceDescriptor();
      if (!det) {
        setStatus('❌ No se detectó un rostro claro en la foto. Usa una foto frontal y bien iluminada.');
        return;
      }
      const p = addPerson(newName, Array.from(det.descriptor));
      setSelectedId(p.id);
      setNewName('');
      refreshData();
      setVerdict({ pass: true, kind: 'enroll', msg: `✅ Registrado por foto: ${p.name}` });
      setStatus(`✅ ${p.name} registrado desde la foto.`);
    } catch (err) {
      setStatus(`❌ Error procesando la foto: ${err?.message || err}`);
    }
  };

  const handleDeletePerson = (id) => {
    removePerson(id);
    if (selectedId === id) setSelectedId(null);
    refreshData();
  };
  const handleClearLog = () => { clearAttempts(); refreshData(); };

  const spotlightState = verdict ? (verdict.pass ? 'success' : 'fail') : (testing ? 'active' : 'idle');
  const selectedPerson = selectedId ? people.find((p) => p.id === selectedId) : null;

  return (
    <div style={s.card}>
      <h2 style={{ margin: '0 0 4px' }}>🧪 Dashboard de pruebas biométricas</h2>
      <p style={s.sub}>{status}</p>
      {loadError && (
        <div style={s.err}>
          <strong>Error al cargar modelos:</strong>
          <div style={{ fontFamily: 'monospace', fontSize: 12, margin: '4px 0 8px', wordBreak: 'break-word' }}>{loadError}</div>
          <button style={{ ...s.btn, width: '100%', background: '#dc2626' }} onClick={handleClearCacheReload}>
            🧹 Limpiar caché y reintentar
          </button>
        </div>
      )}

      <div style={s.videoWrap}>
        <video ref={videoRef} playsInline muted autoPlay style={s.video} />
        <canvas ref={canvasRef} style={s.overlay} />
        {cameraOn && <FaceSpotlight state={spotlightState} faceDetected={metrics.faceDetected} />}
      </div>
      {testing && instruction && <div style={s.instruction}>{instruction}</div>}

      {cameraOn && (
        <div style={s.liveGrid}>
          <Mini label="Rostro" v={metrics.faceDetected ? 'Sí' : 'No'} />
          <Mini label="Parpadeo" v={metrics.blinkScore} />
          <Mini label="Giro°" v={metrics.yaw} />
          <Mini label={`Dist. a ${selectedPerson?.name || '—'}`} v={metrics.identityDistance ?? '—'} />
        </div>
      )}

      {/* Barra visual de distancia vs umbral */}
      {cameraOn && (verdict?.distance != null || metrics.identityDistance != null) && (
        <DistanceBar distance={verdict?.distance ?? metrics.identityDistance} threshold={MATCH_THRESHOLD} />
      )}

      {verdict && (
        <div style={verdict.pass ? s.ok : s.bad}>
          <strong>{verdict.msg}</strong>
          {verdict.kind !== 'enroll' && (
            <div style={s.small}>Vida: {verdict.livenessOk ? 'OK' : 'falló'} · Identidad: {verdict.identityOk ? 'coincide' : 'no'} {verdict.distance != null && `(dist ${verdict.distance})`}</div>
          )}
        </div>
      )}

      {/* Controles de cámara */}
      {!permsReady ? (
        <button style={{ ...s.btnAlt, width: '100%' }} onClick={handlePreparePermissions} disabled={!ready}>🔓 Conceder permisos (cámara + GPS)</button>
      ) : !cameraOn ? (
        <button style={{ ...s.btn, width: '100%' }} onClick={handleStartCamera} disabled={!ready}>📷 Encender cámara</button>
      ) : null}

      {/* Secciones siempre visibles (registro por foto y roster no requieren cámara) */}
      {ready && (
        <>
          {/* Registrar nueva persona — SOLO administradores */}
          <div style={s.section}>
            <div style={s.sectionTitle}>1 · Registrar persona (solo admin)</div>
            {!adminOk ? (
              <div style={{ display: 'flex', gap: 8 }}>
                <input
                  style={s.input}
                  type="password"
                  inputMode="numeric"
                  placeholder="PIN de administrador"
                  value={pinInput}
                  onChange={(e) => setPinInput(e.target.value)}
                />
                <button
                  style={s.btnAlt}
                  onClick={() => {
                    if (pinInput === ADMIN_PIN) { setAdminOk(true); setPinInput(''); setStatus('🔓 Modo administrador activo.'); }
                    else { setPinInput(''); setStatus('❌ PIN incorrecto.'); }
                  }}
                >
                  🔑 Entrar
                </button>
              </div>
            ) : (
              <>
                <input style={{ ...s.input, width: '100%', boxSizing: 'border-box', marginBottom: 8 }} placeholder="Nombre de la persona" value={newName} onChange={(e) => setNewName(e.target.value)} disabled={testing} />
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                  <button style={{ ...s.btnAlt, opacity: cameraOn ? 1 : 0.5 }} onClick={() => startChallenge('enroll')} disabled={testing || !cameraOn} title={cameraOn ? '' : 'Enciende la cámara primero'}>📷 Con cámara</button>
                  <button style={s.btnAlt} onClick={() => photoInputRef.current?.click()} disabled={testing}>🖼️ Con una foto</button>
                </div>
                {/* input oculto para subir la foto */}
                <input ref={photoInputRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={handlePhotoRegister} />
                <p style={s.dim}>Foto: frontal, buena luz, rostro despejado (tipo carnet). Solo se guarda el vector, no la imagen.</p>
              </>
            )}
          </div>

          {/* Roster + selección */}
          <div style={s.section}>
            <div style={s.sectionTitle}>2 · Elegir a quién validar ({people.length})</div>
            {people.length === 0 && <p style={s.dim}>Aún no hay personas registradas.</p>}
            {people.map((p) => (
              <label key={p.id} style={{ ...s.personRow, background: selectedId === p.id ? 'rgba(59,130,246,0.18)' : '#0A1120', borderColor: selectedId === p.id ? '#3B82F6' : '#22304A' }}>
                <input type="radio" name="target" checked={selectedId === p.id} onChange={() => setSelectedId(p.id)} />
                <span style={{ flex: 1 }}>{p.name}</span>
                {adminOk && <button style={s.del} onClick={(e) => { e.preventDefault(); handleDeletePerson(p.id); }}>🗑️</button>}
              </label>
            ))}
          </div>

          {/* Validar — modo real: el SISTEMA decide según la cámara */}
          <div style={s.section}>
            <div style={s.sectionTitle}>3 · Validar contra {selectedPerson?.name || '(selecciona)'}</div>
            <button style={{ ...s.btn, width: '100%', opacity: cameraOn ? 1 : 0.5 }} onClick={() => startChallenge('test', { kind: 'live' })} disabled={testing || !selectedId || !cameraOn} title={cameraOn ? '' : 'Enciende la cámara primero'}>
              ▶️ Validar (el sistema decide)
            </button>
            <p style={s.dim}>
              Ponte frente a la cámara y haz la prueba de vida. El sistema compara tu rostro con
              <strong> {selectedPerson?.name || 'la persona seleccionada'}</strong> y decide solo si acepta o rechaza.
            </p>
          </div>

          {/* Modo prueba — etiquetas SOLO para calcular FAR/FRR del piloto */}
          <details style={s.section}>
            <summary style={s.sectionTitle}>🧪 Modo prueba (para medir FAR/FRR)</summary>
            <p style={s.dim}>
              El sistema decide igual mirando la cámara. Aquí tú declaras <em>la verdad</em> del intento
              (quién eres realmente) para que las métricas sepan si el sistema acertó. Úsalo solo en el piloto.
            </p>
            <div style={{ ...s.validBtns, marginTop: 8 }}>
              <button style={s.btnGood} onClick={() => startChallenge('test', { kind: 'genuine' })} disabled={testing || !selectedId || !cameraOn}>✅ De verdad SOY {selectedPerson?.name || '…'}</button>
              <button style={s.btnWarn} onClick={() => startChallenge('test', { kind: 'impostor' })} disabled={testing || !selectedId || !cameraOn}>🕵️ NO soy esa persona (impostor)</button>
              <button style={s.btnGhost} onClick={() => startChallenge('test', { kind: 'spoof' })} disabled={testing || !selectedId || !cameraOn}>🖼️ Es una foto/video (spoof)</button>
            </div>
          </details>
        </>
      )}

      {/* Métricas de confianza */}
      {stats && stats.total > 0 && (
        <div style={s.metricsBox}>
          <strong>📊 Métricas de confianza ({stats.total} intentos)</strong>
          <div style={s.mgrid}>
            <M label="FRR (falso rechazo)" v={stats.frr} unit="%" good={stats.frr != null && stats.frr < 5} sub={`${stats.genuineRejected}/${stats.genuine} genuinos`} />
            <M label="FAR (falsa aceptación)" v={stats.far} unit="%" good={stats.far === 0} sub={`${stats.impostorAccepted}/${stats.impostor} impostores`} bad={stats.far > 0} />
            <M label="Spoof bloqueado" v={stats.spoofBlockRate} unit="%" good={stats.spoofBlockRate === 100} sub={`${stats.spoofBlocked}/${stats.spoof} fotos/videos`} />
          </div>
          <button style={s.clearBtn} onClick={handleClearLog}>🗑️ Borrar historial</button>
        </div>
      )}

      {/* Últimos intentos */}
      {attempts.length > 0 && (
        <div style={s.logBox}>
          <strong>Últimos intentos</strong>
          {attempts.map((a) => (
            <div key={a.id} style={s.logRow}>
              <span style={{ color: a.accepted ? '#22C55E' : '#EF4444' }}>{a.accepted ? '✅' : '❌'}</span>
              <span style={{ flex: 1 }}>{a.targetName} · {kindLabel(a.kind)}</span>
              <span style={s.mono}>{a.distance ?? '—'}</span>
            </div>
          ))}
        </div>
      )}

      {/* Tiempos */}
      <div style={s.timings}>
        <strong>⏱ Tiempos (ms)</strong>
        <div style={s.tgrid}>
          <T label="Carga modelos (1 vez)" value={timings.modelLoad} />
          <T label="Permiso cámara" value={timings.permission} />
          <T label="Permiso GPS (paralelo)" value={timings.gps} />
          <T label="Arranque cámara REAL" value={timings.cameraStart} />
          <T label="MediaPipe (prom.)" value={timings.mpAvg} />
          <T label="face-api (prom.)" value={timings.faceapiAvg} />
        </div>
      </div>
    </div>
  );
}

function kindLabel(k) { return k === 'genuine' ? 'genuino' : k === 'impostor' ? 'impostor' : 'spoof'; }

function drawOverlay(canvas, video, lm, active) {
  if (!canvas || !video?.videoWidth) return;
  if (canvas.width !== video.videoWidth) canvas.width = video.videoWidth;
  if (canvas.height !== video.videoHeight) canvas.height = video.videoHeight;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  if (!lm) return;
  ctx.fillStyle = active ? '#f59e0b' : '#22d3ee';
  for (let i = 0; i < lm.length; i += 4) {
    ctx.beginPath();
    ctx.arc(lm[i].x * canvas.width, lm[i].y * canvas.height, 1.4, 0, Math.PI * 2);
    ctx.fill();
  }
}

function FaceSpotlight({ state, faceDetected }) {
  const ring = { idle: '#e5e7eb', active: '#f59e0b', success: '#22c55e', fail: '#ef4444' }[state] || '#e5e7eb';
  return (
    <svg style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none' }} viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
      <defs><mask id="hole"><rect x="0" y="0" width="100" height="100" fill="white" /><ellipse cx="50" cy="46" rx="27" ry="36" fill="black" /></mask></defs>
      <rect x="0" y="0" width="100" height="100" fill="rgba(0,0,0,0.55)" mask="url(#hole)" />
      <ellipse cx="50" cy="46" rx="27" ry="36" fill="none" stroke={ring} strokeWidth="1.2" strokeDasharray={state === 'active' ? '4 3' : '0'} />
      {!faceDetected && <text x="50" y="90" textAnchor="middle" fontSize="4" fill="#fff" opacity="0.85">Centra tu rostro</text>}
    </svg>
  );
}

function Mini({ label, v }) { return <div style={s.mini}><div style={s.miniL}>{label}</div><div style={s.miniV}>{v}</div></div>; }

/**
 * Barra visual de distancia (0 a 1.0) con la línea de umbral.
 * Verde a la izquierda (misma persona), rojo a la derecha (otra persona).
 */
function DistanceBar({ distance, threshold }) {
  const MAX = 1.0;
  const pct = (v) => `${Math.min(100, Math.max(0, (v / MAX) * 100))}%`;
  const isMatch = distance < threshold;
  return (
    <div style={s.distWrap}>
      <div style={s.distHead}>
        <span>Distancia: <strong style={{ color: isMatch ? '#22C55E' : '#EF4444', fontFamily: 'monospace' }}>{distance}</strong></span>
        <span style={s.dim}>umbral {threshold}</span>
      </div>
      <div style={s.distTrack}>
        {/* zona verde (acepta) y roja (rechaza) */}
        <div style={{ ...s.distZone, left: 0, width: pct(threshold), background: 'rgba(34,197,94,0.22)' }} />
        <div style={{ ...s.distZone, left: pct(threshold), right: 0, background: 'rgba(239,68,68,0.20)' }} />
        {/* línea de umbral */}
        <div style={{ ...s.distThresh, left: pct(threshold) }} />
        {/* marcador de la distancia actual */}
        <div style={{ ...s.distMark, left: pct(distance), background: isMatch ? '#22C55E' : '#EF4444' }} />
      </div>
      <div style={s.distScale}><span>0 (idéntico)</span><span>{isMatch ? '✅ misma persona' : '❌ otra persona'}</span><span>1.0</span></div>
    </div>
  );
}
function M({ label, v, unit, good, bad, sub }) {
  return <div style={s.mcell}><div style={s.mlabel}>{label}</div><div style={{ ...s.mval, color: bad ? '#EF4444' : good ? '#22C55E' : '#E8EEF9' }}>{v == null ? '—' : v}{v != null && unit}</div><div style={s.msub}>{sub}</div></div>;
}
function T({ label, value }) { return <div style={s.tcell}><span style={s.tlabel}>{label}</span><span style={s.tval}>{value == null ? '—' : value}</span></div>; }

/* Sistema de diseño ArriveControl (tema oscuro):
   tinta #0A1120 · panel #141E31 · línea #22304A · texto #E8EEF9 · dim #8296B3
   acento #3B82F6 · éxito #22C55E · rechazo #EF4444 · escaneo #F59E0B */
const s = {
  card: { maxWidth: 460, margin: '0 auto', padding: 20, fontFamily: 'system-ui, sans-serif', border: '1px solid #22304A', borderRadius: 16, background: '#0A1120', color: '#E8EEF9' },
  sub: { fontSize: 14, color: '#8296B3', minHeight: 20 },
  err: { background: 'rgba(239,68,68,0.12)', border: '1px solid rgba(239,68,68,0.4)', color: '#FCA5A5', padding: 12, borderRadius: 10, margin: '8px 0', fontSize: 14 },
  videoWrap: { position: 'relative', lineHeight: 0, borderRadius: 12, overflow: 'hidden', border: '1px solid #22304A' },
  video: { width: '100%', borderRadius: 12, background: '#000', transform: 'scaleX(-1)', display: 'block' },
  overlay: { position: 'absolute', inset: 0, width: '100%', height: '100%', transform: 'scaleX(-1)', pointerEvents: 'none' },
  instruction: { margin: '10px 0', padding: '12px 14px', background: 'rgba(245,158,11,0.14)', border: '1px solid rgba(245,158,11,0.45)', color: '#FCD34D', borderRadius: 10, fontSize: 16, fontWeight: 600, textAlign: 'center' },
  liveGrid: { display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 6, margin: '10px 0' },
  mini: { background: '#141E31', border: '1px solid #22304A', borderRadius: 8, padding: 6, textAlign: 'center' },
  miniL: { fontSize: 10, color: '#8296B3' },
  miniV: { fontSize: 15, fontWeight: 700, fontFamily: 'ui-monospace, monospace' },
  distWrap: { margin: '8px 0', padding: 10, border: '1px solid #22304A', borderRadius: 10, background: '#141E31' },
  distHead: { display: 'flex', justifyContent: 'space-between', fontSize: 13, marginBottom: 6 },
  distTrack: { position: 'relative', height: 22, borderRadius: 6, overflow: 'hidden', background: '#0A1120' },
  distZone: { position: 'absolute', top: 0, bottom: 0 },
  distThresh: { position: 'absolute', top: -2, bottom: -2, width: 2, background: '#E8EEF9' },
  distMark: { position: 'absolute', top: '50%', width: 14, height: 14, borderRadius: '50%', border: '2px solid #fff', transform: 'translate(-50%,-50%)', boxShadow: '0 0 6px rgba(0,0,0,0.6)' },
  distScale: { display: 'flex', justifyContent: 'space-between', fontSize: 10, color: '#8296B3', marginTop: 4 },
  ok: { background: 'rgba(34,197,94,0.12)', border: '1px solid rgba(34,197,94,0.4)', color: '#86EFAC', padding: 12, borderRadius: 10, margin: '8px 0' },
  bad: { background: 'rgba(239,68,68,0.12)', border: '1px solid rgba(239,68,68,0.4)', color: '#FCA5A5', padding: 12, borderRadius: 10, margin: '8px 0' },
  small: { fontSize: 13, marginTop: 6 },
  section: { border: '1px solid #22304A', borderRadius: 12, padding: 12, margin: '10px 0', background: '#141E31' },
  sectionTitle: { fontSize: 12, fontWeight: 700, color: '#8296B3', marginBottom: 8, letterSpacing: '0.06em', textTransform: 'uppercase' },
  input: { flex: 1, padding: '10px 12px', fontSize: 15, borderRadius: 8, border: '1px solid #22304A', background: '#0A1120', color: '#E8EEF9' },
  personRow: { display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', border: '1px solid #22304A', borderRadius: 8, marginBottom: 6, cursor: 'pointer' },
  del: { border: 'none', background: 'transparent', cursor: 'pointer', fontSize: 16 },
  validBtns: { display: 'grid', gridTemplateColumns: '1fr', gap: 6 },
  dim: { fontSize: 12, color: '#8296B3', margin: '6px 0 0' },
  btn: { padding: '14px 16px', fontSize: 16, borderRadius: 12, border: 'none', background: '#3B82F6', color: '#fff', cursor: 'pointer', fontWeight: 700 },
  btnAlt: { padding: '10px 14px', fontSize: 15, borderRadius: 10, border: 'none', background: '#3B82F6', color: '#fff', cursor: 'pointer', fontWeight: 600 },
  btnGood: { padding: '12px', fontSize: 15, borderRadius: 10, border: 'none', background: '#22C55E', color: '#03140A', cursor: 'pointer', fontWeight: 700 },
  btnWarn: { padding: '12px', fontSize: 15, borderRadius: 10, border: 'none', background: '#F59E0B', color: '#1C1203', cursor: 'pointer', fontWeight: 700 },
  btnGhost: { padding: '12px', fontSize: 15, borderRadius: 10, border: '1px solid #22304A', background: 'transparent', color: '#E8EEF9', cursor: 'pointer' },
  metricsBox: { marginTop: 12, padding: 12, background: '#141E31', border: '1px solid #22304A', borderRadius: 12 },
  mgrid: { display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 8, margin: '8px 0' },
  mcell: { background: '#0A1120', border: '1px solid #22304A', borderRadius: 8, padding: 8, textAlign: 'center' },
  mlabel: { fontSize: 11, color: '#8296B3' },
  mval: { fontSize: 20, fontWeight: 800, fontVariantNumeric: 'tabular-nums' },
  msub: { fontSize: 10, color: '#8296B3' },
  clearBtn: { marginTop: 4, padding: '6px 10px', border: '1px solid #22304A', borderRadius: 8, background: 'transparent', color: '#8296B3', cursor: 'pointer', fontSize: 13 },
  logBox: { marginTop: 12, padding: 12, background: '#141E31', border: '1px solid #22304A', borderRadius: 12, fontSize: 13 },
  logRow: { display: 'flex', gap: 8, padding: '5px 0', borderTop: '1px solid #22304A' },
  mono: { fontFamily: 'ui-monospace, monospace' },
  timings: { marginTop: 12, padding: 12, background: '#141E31', border: '1px solid #22304A', color: '#E8EEF9', borderRadius: 12, fontSize: 13 },
  tgrid: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginTop: 8 },
  tcell: { display: 'flex', justifyContent: 'space-between', gap: 8, background: '#0A1120', padding: '6px 8px', borderRadius: 6 },
  tlabel: { color: '#8296B3', fontSize: 12 },
  tval: { fontFamily: 'ui-monospace, monospace', fontWeight: 700, fontVariantNumeric: 'tabular-nums' },
};
