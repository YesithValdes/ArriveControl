'use client';

/**
 * components/KioskMode.jsx
 * Modo KIOSCO con el sistema de diseño ArriveControl (tema oscuro permanente):
 *
 *   Estado 1 · REPOSO     → reloj gigante + "Acércate para marcar tu asistencia"
 *   Estado 2 · VALIDANDO  → cámara + óvalo ámbar punteado + "Parpadea 👁"
 *   Estado 3 · ÉXITO      → verde, "¡Bienvenido, X!" + hora, se autodescarta
 *   Estado 4 · RECHAZO    → rojo, "No reconocido" + botón Reintentar
 *
 * Lógica: identificación 1:N contra todo el roster, prueba de vida por
 * parpadeo (ambos ojos), capturas de identidad solo de frente, Wake Lock,
 * cooldown hasta que la persona se retire.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { euclideanDistance, MATCH_THRESHOLD } from '../utils/faceMath.js';
import {
  cargarRoster, cargarSedes, registrarPaso, sincronizarCola, logIntento,
  getSedeId, setSedeId, getDeviceKey, setDeviceKey, pendientesEnCola,
} from '../services/kioskoApi.js';

const FACEAPI_MODEL_URL = '/models';
const MEDIAPIPE_MODEL = '/models/face_landmarker.task';
const WASM_PATH = '/wasm';

const ACTIVE_INTERVAL_MS = 120;     // ~8 fps durante el reto
const IDLE_INTERVAL_MS = 330;       // ~3 fps en reposo (solo vigila presencia)
const CHALLENGE_TIMEOUT_MS = 12000; // tiempo máx. para el parpadeo
const RESULT_SHOW_MS = 2200;        // cuánto se muestra el resultado de éxito
const COOLDOWN_MS = 700;            // pausa tras cada validación
const FACE_CAPTURES = 2;            // capturas face-api por validación
const CAPTURE_GAP_MS = 900;

function averageDescriptors(descs) {
  if (!descs || descs.length === 0) return null;
  if (descs.length === 1) return descs[0];
  const out = new Array(descs[0].length).fill(0);
  for (const d of descs) for (let i = 0; i < d.length; i++) out[i] += d[i];
  return out.map((v) => v / descs.length);
}

export default function KioskMode() {
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const landmarkerRef = useRef(null);
  const faceapiRef = useRef(null);
  const rafRef = useRef(null);
  const wakeLockRef = useRef(null);
  const peopleRef = useRef([]);

  // Máquina de estados: idle | challenge | result | cooldown
  const stateRef = useRef({ phase: 'idle', deadline: 0, until: 0, sawOpen: false, sawClosed: false, descs: [], lastCapture: 0, captures: 0 });

  const [ready, setReady] = useState(false);
  const [running, setRunning] = useState(false);
  const [loadError, setLoadError] = useState(null);
  const [statusNote, setStatusNote] = useState('Cargando modelos…');

  // Estado visual (espejo de la máquina, para render): idle | challenge | ok | no
  const [ui, setUi] = useState('idle');
  const [result, setResult] = useState(null); // { ok, name, time, distance, reason }
  const [peopleCount, setPeopleCount] = useState(0);
  const [pendientes, setPendientes] = useState(0); // cola offline sin sincronizar

  // ACTIVACIÓN del dispositivo (una sola vez, con sesión de admin): el
  // servidor genera la clave propia de este aparato y aquí queda persistida.
  // Un dispositivo sin activar no puede marcar ni descargar el roster.
  const [configurado, setConfigurado] = useState(true); // se evalúa al montar
  const [cfgSedes, setCfgSedes] = useState([]);
  const [cfgSede, setCfgSede] = useState('');
  const [cfgNombre, setCfgNombre] = useState('');
  const [cfgError, setCfgError] = useState(null);
  const [activando, setActivando] = useState(false);
  useEffect(() => {
    const listo = Boolean(getSedeId()) && Boolean(getDeviceKey());
    setConfigurado(listo);
    setPendientes(pendientesEnCola());
    if (!listo) {
      cargarSedes().then(setCfgSedes).catch((e) => setCfgError(`Sin conexión con el servidor: ${e.message}`));
    }
  }, []);

  // Cola offline: reintenta al reconectar y cada minuto.
  useEffect(() => {
    const flush = async () => {
      const n = await sincronizarCola();
      if (n > 0) setPendientes(pendientesEnCola());
    };
    window.addEventListener('online', flush);
    const id = setInterval(flush, 60000);
    return () => { window.removeEventListener('online', flush); clearInterval(id); };
  }, []);

  const activarEsteDispositivo = async () => {
    if (!cfgSede) { setCfgError('Elige la sede de este dispositivo.'); return; }
    if (!cfgNombre.trim()) { setCfgError('Ponle un nombre (p. ej. "Tablet recepción").'); return; }
    setCfgError(null);
    setActivando(true);
    try {
      const r = await fetch('/api/dispositivos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nombre: cfgNombre.trim(), sede_id: cfgSede }),
      });
      const d = await r.json().catch(() => null);
      if (r.status === 401) {
        setCfgError('Necesitas sesión de administrador. Inicia sesión y vuelve.');
        return;
      }
      if (!r.ok || !d?.ok) { setCfgError(d?.error || `El servidor respondió ${r.status}.`); return; }
      // La clave se recibe UNA sola vez: queda en este aparato y en ningún otro lado.
      setDeviceKey(d.dispositivo.clave);
      setSedeId(cfgSede);
      setConfigurado(true);
      setStatusNote(`Dispositivo "${d.dispositivo.nombre}" activado. Listo para iniciar.`);
    } catch (e) {
      setCfgError(`Sin conexión con el servidor: ${e.message}`);
    } finally {
      setActivando(false);
    }
  };

  // Reloj del estado de reposo
  const [clock, setClock] = useState({ time: '', date: '' });
  useEffect(() => {
    const update = () => {
      const d = new Date();
      setClock({
        time: d.toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }),
        date: d.toLocaleDateString('es-CO', { weekday: 'long', day: 'numeric', month: 'long' }),
      });
    };
    update();
    const id = setInterval(update, 1000);
    return () => clearInterval(id);
  }, []);

  // ── Carga de modelos (paralela, GPU→CPU) ──────────────────────────────
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const loadMp = (async () => {
          const vision = await import('@mediapipe/tasks-vision');
          const fileset = await vision.FilesetResolver.forVisionTasks(WASM_PATH);
          const make = (delegate) => vision.FaceLandmarker.createFromOptions(fileset, {
            baseOptions: { modelAssetPath: MEDIAPIPE_MODEL, delegate },
            outputFaceBlendshapes: true,
            outputFacialTransformationMatrixes: true,
            runningMode: 'VIDEO',
            numFaces: 1,
          });
          try { return await make('GPU'); } catch { return await make('CPU'); }
        })();
        const loadFa = (async () => {
          const faceapi = await import('@vladmandic/face-api');
          // El backend de TensorFlow (wasm/webgl) inicializa ASÍNCRONO tras el
          // import. Cargar los modelos sin esperarlo es una carrera que a veces
          // revienta con "backend 'wasm' has not yet been initialized". Si el
          // backend rápido falla, se cae a CPU antes que dejar el kiosco muerto.
          try { await faceapi.tf.ready(); } catch { await faceapi.tf.setBackend('cpu'); await faceapi.tf.ready(); }
          await Promise.all([
            faceapi.nets.tinyFaceDetector.loadFromUri(FACEAPI_MODEL_URL),
            faceapi.nets.faceLandmark68Net.loadFromUri(FACEAPI_MODEL_URL),
            faceapi.nets.faceRecognitionNet.loadFromUri(FACEAPI_MODEL_URL),
          ]);
          return faceapi;
        })();
        const [landmarker, faceapi] = await Promise.all([loadMp, loadFa]);
        if (cancelled) return;
        landmarkerRef.current = landmarker;
        faceapiRef.current = faceapi;
        setReady(true);
        setStatusNote('Listo para iniciar.');
      } catch (err) {
        if (!cancelled) { setLoadError(`${err?.name}: ${err?.message || err}`); setStatusNote('Error cargando modelos.'); }
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // ── Wake Lock ─────────────────────────────────────────────────────────
  const acquireWakeLock = useCallback(async () => {
    try { if ('wakeLock' in navigator) wakeLockRef.current = await navigator.wakeLock.request('screen'); } catch {}
  }, []);
  useEffect(() => {
    const onVisible = () => { if (document.visibilityState === 'visible' && running) acquireWakeLock(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [running, acquireWakeLock]);

  const stopAll = useCallback(() => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    if (streamRef.current) { streamRef.current.getTracks().forEach((t) => t.stop()); streamRef.current = null; }
    if (videoRef.current) videoRef.current.srcObject = null;
    wakeLockRef.current?.release?.().catch(() => {});
    setRunning(false);
    setUi('idle');
    setResult(null);
  }, []);
  useEffect(() => stopAll, [stopAll]);

  // ── Arranque ──────────────────────────────────────────────────────────
  const handleStart = async () => {
    // Roster desde la BASE DE DATOS (con caché local para cortes de red).
    let all = [];
    try {
      const { empleados, deCache } = await cargarRoster();
      all = empleados;
      if (deCache) setStatusNote('Sin conexión: usando el roster de la última sincronización.');
    } catch (e) {
      setStatusNote(`No se pudo cargar el roster: ${e.message}`);
      return;
    }
    // Solo personas con descriptor VÁLIDO: un registro corrupto en el roster
    // no debe poder tumbar la comparación 1:N (y con ella, todo el kiosco).
    const valid = all.filter(
      (p) => Array.isArray(p.descriptor) && p.descriptor.length === 128 && p.descriptor.every(Number.isFinite)
    );
    if (valid.length < all.length) {
      console.warn(`Kiosco: ${all.length - valid.length} registro(s) sin rostro o corruptos fueron excluidos.`);
    }
    peopleRef.current = valid;
    setPeopleCount(valid.length);
    if (valid.length === 0) {
      setStatusNote(all.length > 0
        ? 'Hay empleados pero ninguno tiene rostro registrado. Re-regístralos con foto.'
        : 'No hay empleados en la base de datos. Regístralos desde el panel.');
      return;
    }
    // Aprovechar el arranque para vaciar la cola offline pendiente.
    sincronizarCola().then(() => setPendientes(pendientesEnCola())).catch(() => {});
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } }, audio: false });
      streamRef.current = stream;
      videoRef.current.srcObject = stream;
      await videoRef.current.play();
      await acquireWakeLock();
      stateRef.current = { phase: 'idle', deadline: 0, until: 0, sawOpen: false, sawClosed: false, descs: [], lastCapture: 0, captures: 0 };
      setRunning(true);
      setResult(null);
      setUi('idle');
      startLoop();
    } catch (err) {
      setStatusNote(`No se pudo abrir la cámara: ${err?.message || err}`);
    }
  };

  // ── Bucle principal ───────────────────────────────────────────────────
  const startLoop = () => {
    const landmarker = landmarkerRef.current;
    const faceapi = faceapiRef.current;
    const video = videoRef.current;
    let lastRun = 0;
    let faBusy = false;

    // step() hace el análisis; tick() lo envuelve en try/catch y SIEMPRE
    // re-agenda el siguiente cuadro: ninguna excepción puede matar el bucle
    // (el kiosco debe seguir vivo aunque un cuadro falle).
    const step = () => {
      if (!video || video.readyState < 2) return;
      const now = performance.now();
      // En reposo vigilamos presencia a baja frecuencia (menos calor/batería);
      // durante el reto subimos a ~8 fps para captar el parpadeo.
      const interval = stateRef.current.phase === 'challenge' ? ACTIVE_INTERVAL_MS : IDLE_INTERVAL_MS;
      if (now - lastRun < interval) return;
      lastRun = now;

      const res = landmarker.detectForVideo(video, now);
      const lm = res.faceLandmarks?.[0];
      const st = stateRef.current;

      let bothClosed = 0, bothOpen = 0, yaw = 0;
      if (lm) {
        const bs = res.faceBlendshapes?.[0]?.categories || [];
        const byName = (n) => bs.find((c) => c.categoryName === n)?.score || 0;
        bothClosed = Math.min(byName('eyeBlinkLeft'), byName('eyeBlinkRight'));
        bothOpen = Math.max(byName('eyeBlinkLeft'), byName('eyeBlinkRight'));
        const mtx = res.facialTransformationMatrixes?.[0]?.data;
        if (mtx) yaw = Math.atan2(-mtx[8], mtx[0]) * (180 / Math.PI);
      }

      switch (st.phase) {
        case 'idle': {
          if (lm) {
            st.phase = 'challenge';
            st.deadline = now + CHALLENGE_TIMEOUT_MS;
            st.sawOpen = false; st.sawClosed = false;
            st.descs = []; st.captures = 0; st.lastCapture = 0;
            setResult(null);
            setUi('challenge');
          }
          break;
        }
        case 'challenge': {
          if (!lm) { st.phase = 'idle'; setUi('idle'); break; }
          if (now > st.deadline) {
            concludeResult(false, null, null, 'No se detectó el parpadeo. Inténtalo de nuevo mirando de frente.');
            break;
          }
          if (bothOpen < 0.15) st.sawOpen = true;
          if (st.sawOpen && bothClosed > 0.55) st.sawClosed = true;

          const frontal = Math.abs(yaw) < 12;
          if (frontal && !faBusy && st.captures < FACE_CAPTURES && now - st.lastCapture >= CAPTURE_GAP_MS) {
            faBusy = true; st.captures += 1; st.lastCapture = now;
            faceapi.detectSingleFace(video, new faceapi.TinyFaceDetectorOptions({ inputSize: 224, scoreThreshold: 0.5 }))
              .withFaceLandmarks().withFaceDescriptor()
              .then((det) => { if (det) st.descs.push(Array.from(det.descriptor)); })
              .catch(() => {}).finally(() => { faBusy = false; });
          }

          if (st.sawClosed && bothOpen < 0.20 && st.descs.length > 0) {
            const live = averageDescriptors(st.descs);
            let best = { distance: Infinity, person: null };
            for (const p of peopleRef.current) {
              const d = euclideanDistance(p.descriptor, live);
              if (d < best.distance) best = { distance: d, person: p };
            }
            const distance = Math.round(best.distance * 1000) / 1000;
            const ok = distance < MATCH_THRESHOLD;
            concludeResult(ok, ok ? best.person : null, distance, ok ? null : 'Inténtalo de nuevo mirando de frente, o contacta a Recursos Humanos.');
          }
          break;
        }
        case 'result': {
          // El éxito se autodescarta; el rechazo espera al botón Reintentar.
          if (st.autoDismiss && now > st.until) {
            st.phase = 'cooldown';
            st.until = now + COOLDOWN_MS;
          }
          break;
        }
        case 'cooldown': {
          if (now > st.until && !lm) {
            st.phase = 'idle';
            setResult(null);
            setUi('idle');
          }
          break;
        }
      }
    };

    const tick = () => {
      try { step(); } catch (err) { console.error('Kiosco: error en un cuadro (el bucle continúa):', err); }
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
  };

  function concludeResult(ok, person, distance, failReason) {
    const st = stateRef.current;
    st.phase = 'result';
    st.autoDismiss = true; // todo resultado se cierra solo (kiosco sin botones)
    st.until = performance.now() + RESULT_SHOW_MS;
    logIntento({
      empleadoId: person?.id ?? null,
      aceptado: ok,
      distancia: distance,
      livenessOk: !failReason?.includes('parpadeo'),
    });

    const time = new Date().toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });

    if (!ok) {
      setResult({ kind: 'no', name: person?.name, time, distance, reason: failReason });
      setUi('no');
      return;
    }

    // Identidad confirmada → el SERVIDOR decide ENTRADA o SALIDA y pone la
    // hora. Mientras responde, la pantalla muestra "registrando…".
    setResult({ kind: 'saving', name: person.name, time });
    setUi('ok');
    st.until = performance.now() + RESULT_SHOW_MS * 4; // margen para la red

    registrarPaso(person.id).then((paso) => {
      const stNow = stateRef.current;
      stNow.until = performance.now() + RESULT_SHOW_MS;

      if (paso.errorConfig) {
        setResult({ kind: 'no', name: person.name, time, reason: `Identidad verificada, pero la marcación NO quedó: ${paso.errorConfig}` });
        setUi('no');
        return;
      }
      if (paso.pendiente) {
        // Sin red: quedó en la cola local y se sincroniza sola.
        setPendientes(paso.enCola);
        setResult({ kind: 'pending', name: person.name, time });
        setUi('ok');
        return;
      }
      if (paso.duplicado) {
        const lastTime = new Date(paso.ultima.ts).toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
        const lastLabel = paso.ultima.tipo === 'entrada' ? 'ENTRADA' : 'SALIDA';
        setResult({ kind: 'dup', name: person.name, time, lastLabel, lastTime });
        setUi('ok');
        return;
      }
      const tsOficial = new Date(paso.marcacion.ts).toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
      setResult({
        kind: paso.tipo === 'entrada' ? 'in' : 'out',
        name: person.name,
        time: tsOficial, // la hora OFICIAL del servidor, no la del dispositivo
        distance,
        flag: null,
      });
      setUi('ok');
    });
  }

  return (
    <div style={s.kiosk}>
      <EmojiKeyframes />
      {/* Video siempre montado; visible solo durante el reto */}
      <div style={{ ...s.camWrap, opacity: running && ui === 'challenge' ? 1 : 0 }}>
        <video ref={videoRef} playsInline muted autoPlay style={s.video} />
        {ui === 'challenge' && (
          <>
            <ScanOval />
            <div style={s.instruction}>Parpadea 👁</div>
            <div style={s.scanStatus}>Buscando coincidencia…</div>
          </>
        )}
      </div>

      {/* Estado 1 · Reposo */}
      {(ui === 'idle') && (
        <div style={s.idle}>
          <div style={s.brand}>ARRIVE<span style={{ color: 'var(--accent)' }}>CONTROL</span></div>
          <div style={s.clock}>{clock.time}</div>
          <div style={s.date}>{clock.date}</div>
          <div style={s.idleOval}>
            <span className="ac-emoji ac-float" role="img" aria-label="esperando">⏳</span>
          </div>
          <div style={s.idleCta}>{running ? 'Acércate para marcar tu asistencia' : statusNote}</div>

          {/* Activación del dispositivo (una sola vez, con sesión de admin) */}
          {!running && !configurado && (
            <div style={s.cfgBox}>
              <div style={s.cfgTitle}>Activar este dispositivo</div>
              <input
                style={s.cfgInput}
                type="text"
                placeholder='Nombre (p. ej. "Tablet recepción")'
                value={cfgNombre}
                onChange={(e) => setCfgNombre(e.target.value)}
              />
              <select style={s.cfgInput} value={cfgSede} onChange={(e) => setCfgSede(e.target.value)}>
                <option value="">— Elegir sede —</option>
                {cfgSedes.map((x) => <option key={x.id} value={x.id}>{x.nombre}</option>)}
              </select>
              <button style={s.startBtn} onClick={activarEsteDispositivo} disabled={!cfgSede || !cfgNombre.trim() || activando}>
                {activando ? 'Activando…' : '🔑 Activar dispositivo'}
              </button>
              {cfgError && (
                <div style={s.errNote}>
                  {cfgError}{' '}
                  {cfgError.includes('sesión') && <a href="/login?destino=/">Iniciar sesión →</a>}
                </div>
              )}
            </div>
          )}

          {!running && configurado && (
            <button style={s.startBtn} onClick={handleStart} disabled={!ready}>
              {ready ? '▶️ Iniciar kiosco' : 'Cargando…'}
            </button>
          )}
          {running && <button style={s.stopBtn} onClick={stopAll}>⏹ Detener</button>}
          {pendientes > 0 && (
            <div style={s.pendNote}>⌛ {pendientes} marcación(es) sin conexión, pendientes de sincronizar</div>
          )}
          <div style={s.privacy}>🔐 Tus fotos no se almacenan — solo un código matemático</div>
          {loadError && <div style={s.errNote}>{loadError}</div>}
          {running && <div style={s.count}>Personas registradas: {peopleCount}</div>}
        </div>
      )}

      {/* Estado 3 · Éxito — ENTRADA (verde) / SALIDA (ámbar) / duplicado (azul) */}
      {ui === 'ok' && result && result.kind === 'in' && (
        <div style={{ ...s.resultScreen, ...s.okBg }}>
          <div style={{ ...s.badge, ...s.badgeOk }}>
            <span className="ac-emoji ac-pop" role="img" aria-label="registrado">👍</span>
          </div>
          <div style={s.typeTag}>🟢 ENTRADA</div>
          <div style={s.rName}>¡Bienvenido/a,<br />{result.name}!</div>
          <div style={{ ...s.rTime, color: 'var(--k-in)' }}>{result.time}</div>
          {result.flag === 'late-entry' && (
            <div style={s.warnNote}>⚠️ Entrada registrada en la tarde. Si olvidaste marcar en la mañana, avisa a RRHH.</div>
          )}
          <div style={s.countdown}>dist {result.distance} · cerrando…</div>
        </div>
      )}
      {ui === 'ok' && result && result.kind === 'out' && (
        <div style={{ ...s.resultScreen, ...s.outBg }}>
          <div style={{ ...s.badge, ...s.badgeOut }}>
            <span className="ac-emoji ac-wave" role="img" aria-label="hasta pronto">👋</span>
          </div>
          <div style={{ ...s.typeTag, color: 'var(--k-out)' }}>🟠 SALIDA</div>
          <div style={s.rName}>¡Hasta pronto,<br />{result.name}!</div>
          <div style={{ ...s.rTime, color: 'var(--k-out)' }}>{result.time}</div>
          <div style={s.countdown}>dist {result.distance} · cerrando…</div>
        </div>
      )}
      {ui === 'ok' && result && result.kind === 'dup' && (
        <div style={{ ...s.resultScreen, ...s.dupBg }}>
          <div style={{ ...s.badge, ...s.badgeDup }}>ℹ</div>
          <div style={s.rName}>{result.name}</div>
          <div style={s.rSub}>Ya registraste tu {result.lastLabel} a las {result.lastTime}.</div>
          <div style={s.countdown}>Sin cambios · cerrando…</div>
        </div>
      )}

      {/* Registrando en el servidor… (espera de red tras verificar identidad) */}
      {ui === 'ok' && result && result.kind === 'saving' && (
        <div style={{ ...s.resultScreen, ...s.dupBg }}>
          <div style={{ ...s.badge, ...s.badgeDup }}>
            <span className="ac-emoji ac-float" role="img" aria-label="registrando">⏳</span>
          </div>
          <div style={s.rName}>{result.name}</div>
          <div style={s.rSub}>Registrando tu marcación…</div>
        </div>
      )}

      {/* Sin conexión: la marcación quedó en la cola local y se sincroniza sola */}
      {ui === 'ok' && result && result.kind === 'pending' && (
        <div style={{ ...s.resultScreen, ...s.dupBg }}>
          <div style={{ ...s.badge, ...s.badgeDup }}>
            <span className="ac-emoji ac-float" role="img" aria-label="pendiente">📶</span>
          </div>
          <div style={s.rName}>{result.name}</div>
          <div style={s.rSub}>Sin conexión: tu marcación quedó guardada y se sincronizará automáticamente.</div>
          <div style={s.countdown}>{result.time} · guardada en el dispositivo</div>
        </div>
      )}

      {/* Estado 4 · Rechazo (se autodescarta; la persona solo vuelve a intentar) */}
      {ui === 'no' && result && (
        <div style={{ ...s.resultScreen, ...s.noBg }}>
          <div style={{ ...s.badge, ...s.badgeNo }}>
            <span className="ac-emoji ac-shake" role="img" aria-label="no reconocido">🤔</span>
          </div>
          <div style={s.rName}>No reconocido</div>
          <div style={s.rSub}>{result.reason}</div>
          {result.distance != null && <div style={s.countdown}>distancia {result.distance} · umbral {MATCH_THRESHOLD}</div>}
        </div>
      )}
    </div>
  );
}

/** Animaciones de los emojis de estado (espera, éxito, salida, rechazo). */
function EmojiKeyframes() {
  return (
    <style>{`
      .ac-emoji { display: inline-block; will-change: transform; }
      /* Espera: el reloj de arena flota y se balancea suavemente */
      @keyframes ac-float {
        0%, 100% { transform: translateY(0) rotate(-8deg); }
        50%      { transform: translateY(-10px) rotate(8deg); }
      }
      .ac-float { animation: ac-float 2.2s ease-in-out infinite; }
      /* Registrado: el pulgar entra con un pop y sigue rebotando */
      @keyframes ac-pop {
        0%   { transform: scale(0); }
        45%  { transform: scale(1.25); }
        60%  { transform: scale(1); }
        75%  { transform: scale(1.12) translateY(-4px); }
        100% { transform: scale(1) translateY(0); }
      }
      @keyframes ac-bounce {
        0%, 100% { transform: translateY(0) scale(1); }
        50%      { transform: translateY(-6px) scale(1.08); }
      }
      .ac-pop { animation: ac-pop .7s cubic-bezier(.2,1.4,.4,1) 1, ac-bounce 1.1s ease-in-out .7s infinite; }
      /* Salida: la mano saluda */
      @keyframes ac-wave {
        0%, 100% { transform: rotate(0deg); }
        25%      { transform: rotate(20deg); }
        75%      { transform: rotate(-14deg); }
      }
      .ac-wave { animation: ac-wave .9s ease-in-out infinite; transform-origin: 70% 80%; }
      /* Rechazo: sacudida corta de "no te encontré" */
      @keyframes ac-shake {
        0%, 100% { transform: translateX(0); }
        20% { transform: translateX(-6px) rotate(-6deg); }
        40% { transform: translateX(6px) rotate(6deg); }
        60% { transform: translateX(-4px) rotate(-4deg); }
        80% { transform: translateX(4px) rotate(4deg); }
      }
      .ac-shake { animation: ac-shake .6s ease-in-out 2; }
      @media (prefers-reduced-motion: reduce) {
        .ac-float, .ac-pop, .ac-wave, .ac-shake { animation: none; }
      }
    `}</style>
  );
}

/** Óvalo de enfoque ámbar: estático, con pulso de brillo intermitente. */
function ScanOval() {
  return (
    <>
      <style>{`
        @keyframes ac-pulse {
          0%, 100% { opacity: 0.55; box-shadow: 0 0 0 2000px rgba(5,10,20,0.62), 0 0 12px rgba(245,158,11,0.25); }
          50%      { opacity: 1;    box-shadow: 0 0 0 2000px rgba(5,10,20,0.62), 0 0 34px rgba(245,158,11,0.65); }
        }
        .ac-oval { animation: ac-pulse 1.6s ease-in-out infinite; }
        @media (prefers-reduced-motion: reduce) { .ac-oval { animation: none; opacity: 1; } }
      `}</style>
      <div className="ac-oval" style={s.scanOval} />
    </>
  );
}

/**
 * Kiosco en tema CLARO, con la tipografía y los tokens del sistema
 * (app/globals.css). Conserva emojis como iconografía: a un metro de
 * distancia se reconocen más rápido que un trazo fino.
 * Los estados de marcación sí usan color semántico (--k-in/out/no) porque
 * deben leerse de reojo; el resto de la UI vive en la familia azul.
 */
const s = {
  kiosk: {
    position: 'relative', maxWidth: 430, margin: '0 auto', minHeight: 640,
    background: 'var(--surface)', borderRadius: 24, overflow: 'hidden',
    color: 'var(--ink)', fontFamily: 'var(--f-body)',
    border: '1px solid var(--border)', boxShadow: 'var(--elev-2)',
  },
  camWrap: { position: 'absolute', inset: 0, transition: 'opacity .3s' },
  video: { width: '100%', height: '100%', objectFit: 'cover', transform: 'scaleX(-1)' },
  scanOval: {
    position: 'absolute', left: '50%', top: '42%', transform: 'translate(-50%,-50%)',
    width: 190, height: 250, borderRadius: '50%',
    // El velo sigue siendo oscuro: es sobre el VIDEO, no sobre la interfaz.
    border: '3px dashed var(--k-scan)', boxShadow: '0 0 0 2000px rgba(16,24,40,0.55)',
  },
  instruction: {
    position: 'absolute', left: 16, right: 16, top: 40, textAlign: 'center',
    fontSize: 30, fontWeight: 800, letterSpacing: '-0.01em', color: '#ffffff',
    textShadow: '0 2px 12px rgba(0,0,0,0.8)',
  },
  scanStatus: {
    position: 'absolute', left: 0, right: 0, bottom: 40, textAlign: 'center',
    color: '#ffffff', fontSize: 13, fontWeight: 700, letterSpacing: '0.08em',
    textTransform: 'uppercase', textShadow: '0 1px 8px rgba(0,0,0,0.8)',
  },
  idle: { position: 'relative', display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '56px 24px 24px', minHeight: 640 },
  brand: { position: 'absolute', top: 18, left: 20, fontSize: 12, fontWeight: 800, letterSpacing: '0.1em', color: 'var(--muted)' },
  clock: { fontSize: 64, fontWeight: 800, letterSpacing: '-0.03em', fontVariantNumeric: 'tabular-nums', marginTop: 24, fontFamily: 'var(--f-data)' },
  date: { color: 'var(--muted)', fontSize: 15, textTransform: 'capitalize' },
  idleOval: {
    width: 120, height: 156, border: '2px dashed var(--grid)', borderRadius: '50%',
    margin: '36px auto 0', display: 'flex', alignItems: 'center', justifyContent: 'center',
    fontSize: 40,
  },
  idleCta: { textAlign: 'center', fontSize: 19, fontWeight: 600, marginTop: 26, textWrap: 'balance', maxWidth: 300 },
  startBtn: { marginTop: 24, background: 'var(--accent)', color: 'var(--accent-ink)', border: 'none', fontSize: 16, fontFamily: 'inherit', fontWeight: 700, padding: '14px 44px', borderRadius: 'var(--r-md)', cursor: 'pointer', boxShadow: 'var(--elev-1)' },
  stopBtn: { marginTop: 24, background: 'transparent', color: 'var(--muted)', border: '1px solid var(--border)', fontSize: 14, fontFamily: 'inherit', padding: '10px 28px', borderRadius: 'var(--r-md)', cursor: 'pointer' },
  privacy: { marginTop: 'auto', paddingTop: 24, textAlign: 'center', fontSize: 11, color: 'var(--muted)' },
  errNote: { marginTop: 10, fontSize: 12, color: 'var(--k-no)', textAlign: 'center', fontFamily: 'var(--f-data)' },
  // Configuración del dispositivo (clave + sede) y cola offline
  cfgBox: { marginTop: 20, display: 'flex', flexDirection: 'column', gap: 10, width: '100%', maxWidth: 300 },
  cfgTitle: { fontSize: 13, fontWeight: 700, textAlign: 'center', opacity: 0.85 },
  cfgInput: { padding: '12px 14px', fontSize: 15, borderRadius: 10, border: '1px solid rgba(255,255,255,0.25)', background: 'rgba(255,255,255,0.08)', color: 'inherit', fontFamily: 'inherit' },
  pendNote: { marginTop: 10, fontSize: 12, opacity: 0.8, textAlign: 'center' },
  count: { marginTop: 6, fontSize: 11, color: 'var(--muted)' },
  resultScreen: {
    position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column',
    alignItems: 'center', justifyContent: 'center', textAlign: 'center', gap: 8, padding: 24,
  },
  okBg: { background: 'var(--k-in-soft)' },
  outBg: { background: 'var(--k-out-soft)' },
  dupBg: { background: 'var(--accent-soft)' },
  noBg: { background: 'var(--k-no-soft)' },
  badge: { width: 92, height: 92, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 46, fontWeight: 800, marginBottom: 10, color: '#ffffff' },
  badgeOk: { background: 'var(--k-in)' },
  badgeOut: { background: 'var(--k-out)' },
  badgeDup: { background: 'var(--accent)' },
  badgeNo: { background: 'var(--k-no)' },
  typeTag: { fontSize: 15, fontWeight: 800, letterSpacing: '0.14em', color: 'var(--k-in)' },
  warnNote: { marginTop: 10, fontSize: 13, color: 'var(--k-out)', background: 'var(--k-out-soft)', border: '1px solid var(--k-out)', borderRadius: 'var(--r-md)', padding: '8px 12px', maxWidth: 300, lineHeight: 1.4 },
  rName: { fontSize: 30, fontWeight: 800, letterSpacing: '-0.02em', textWrap: 'balance', lineHeight: 1.2 },
  rSub: { color: 'var(--ink-2)', fontSize: 15, maxWidth: 300, lineHeight: 1.5 },
  rTime: { fontSize: 22, fontWeight: 700, fontVariantNumeric: 'tabular-nums', marginTop: 2, fontFamily: 'var(--f-data)' },
  countdown: { marginTop: 22, fontSize: 11, color: 'var(--muted)', letterSpacing: '0.1em', textTransform: 'uppercase', fontFamily: 'var(--f-data)' },
  retryBtn: { marginTop: 22, background: 'var(--k-no)', color: '#ffffff', border: 'none', fontSize: 16, fontFamily: 'inherit', fontWeight: 700, padding: '14px 44px', borderRadius: 'var(--r-md)', cursor: 'pointer' },
};
