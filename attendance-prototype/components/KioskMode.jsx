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
import { euclideanDistance, MATCH_THRESHOLD, MARGEN_MINIMO } from '../utils/faceMath.js';
import {
  cargarRoster, cargarSedes, registrarPaso, sincronizarCola, logIntento,
  getSedeId, setSedeId, getDeviceKey, setDeviceKey, pendientesEnCola,
  olvidarActivacion, ClaveRechazada,
} from '../services/kioskoApi.js';

/**
 * Tamaño con el que el detector busca la cara. TIENE que ser el mismo del
 * registro (EmployeeRegister): el kiosco usaba 224 y el registro 416, así que
 * el rostro se recortaba con precisión distinta al marcar que al registrarse
 * — y un recorte descuadrado corre el descriptor. Esa asimetría metía
 * distancia artificial entre la misma persona y su propia foto.
 */
const DETECTOR_INPUT = 416;

const FACEAPI_MODEL_URL = '/models';
const MEDIAPIPE_MODEL = '/models/face_landmarker.task';
const WASM_PATH = '/wasm';

// ~15 fps durante el reto: un parpadeo dura ~100-150 ms y a 8 fps caía entre
// dos cuadros y no se veía — la gente "parpadeaba y no pasaba nada".
const ACTIVE_INTERVAL_MS = 66;
const IDLE_INTERVAL_MS = 330;       // ~3 fps en reposo (solo vigila presencia)
const CHALLENGE_TIMEOUT_MS = 12000; // tiempo máx. para el parpadeo
const RESULT_SHOW_MS = 1500;        // cuánto se muestra el resultado de éxito
const COOLDOWN_MS = 700;            // pausa tras cada validación
const FACE_CAPTURES = 2;            // capturas face-api por validación
// Separación entre las dos capturas: suficiente para que sean fotogramas
// distintos (promediarlos baja el ruido) sin alargar la espera de la persona.
const CAPTURE_GAP_MS = 450;
// Cuánto puede quedarse la pantalla "Registrando…" esperando al servidor.
// Fijo a propósito: no debe encogerse si se acorta la duración del resultado
// (un arranque en frío de la función serverless puede tardar varios segundos).
const ESPERA_RED_MS = 8800;

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
  const [statusNote, setStatusNote] = useState('Preparando la cámara…');

  // Estado visual (espejo de la máquina, para render): idle | challenge | ok | no
  const [ui, setUi] = useState('idle');
  // Progreso REAL del escaneo (0–100) para la barra del modo HUD:
  // 25 rostro detectado · 50 ojos abiertos · 75 parpadeo confirmado · 100 coincidencia.
  const [scanProg, setScanProg] = useState(0);
  const scanProgRef = useRef(0);
  const ponerProgreso = (p) => {
    if (scanProgRef.current === p) return; // evita re-render por cuadro
    scanProgRef.current = p;
    setScanProg(p);
  };
  // Guía de encuadre en vivo: 'ok' | 'lejos' | 'cerca' | 'centro'.
  const [encuadre, setEncuadre] = useState('ok');
  const encuadreRef = useRef('ok');
  const ponerEncuadre = (e) => {
    if (encuadreRef.current === e) return; // evita re-render por cuadro
    encuadreRef.current = e;
    setEncuadre(e);
  };
  const [result, setResult] = useState(null); // { ok, name, time, distance, reason }
  const [peopleCount, setPeopleCount] = useState(0);
  const [pendientes, setPendientes] = useState(0); // cola offline sin sincronizar
  const [syncMotivo, setSyncMotivo] = useState(null); // por qué la cola no baja

  // ACTIVACIÓN del dispositivo (una sola vez, SOLO con código): el
  // administrador genera el código en el panel web (Dispositivos → Vincular
  // un aparato) y aquí se teclea. No existe activación con sesión desde el
  // kiosco: el panel es la única puerta de administración.
  const [configurado, setConfigurado] = useState(true); // se evalúa al montar
  const [cfgError, setCfgError] = useState(null);
  const [cfgCodigo, setCfgCodigo] = useState('');
  const [activando, setActivando] = useState(false);

  useEffect(() => {
    setPendientes(pendientesEnCola());

    // Tener una clave guardada NO significa que siga sirviendo: el aparato pudo
    // ser revocado desde el panel, o la base pudo cambiar. Antes solo se miraba
    // si existía, y el kiosco se quedaba abierto sin poder marcar ni reconocer
    // a nadie, sin avisar. Ahora se comprueba contra el servidor.
    // La clave es lo único indispensable: un dispositivo SIN sede es válido
    // (celular/kiosco móvil que registra desde cualquier lugar).
    if (!getDeviceKey()) {
      setConfigurado(false);
      return;
    }

    // Optimista: si ya estaba activado se muestra el kiosco de una, y solo se
    // baja a la pantalla de activación si el servidor DICE que la clave no
    // vale. Sin red no se toca nada — la gente sigue fichando contra el caché,
    // que para eso existe la cola offline.
    setConfigurado(true);
    cargarSedes().catch((e) => {
      if (e instanceof ClaveRechazada) {
        olvidarActivacion();
        setConfigurado(false);
        setCfgError('Este dispositivo ya no está autorizado. Pide un código nuevo en el panel y vuelve a registrarlo.');
      }
      // Cualquier otro error es de red: se ignora y el kiosco sigue.
    });
  }, []);

  // Cola offline: reintenta al ABRIR la app, al reconectar y cada minuto.
  // (Antes no había intento al abrir: recién conectado, la cola se quedaba
  // quieta hasta un minuto, o hasta que dispararan el evento 'online'.)
  useEffect(() => {
    const flush = async () => {
      const { motivo } = await sincronizarCola();
      // Siempre se refresca: también bajan las que el servidor descartó.
      setPendientes(pendientesEnCola());
      setSyncMotivo(motivo);
    };
    flush().catch(() => {});
    window.addEventListener('online', flush);
    const id = setInterval(flush, 60000);
    return () => { window.removeEventListener('online', flush); clearInterval(id); };
  }, []);

  /**
   * Canjea el código que el administrador generó en el panel. No necesita
   * sesión: el código es toda la credencial, y por eso es de un solo uso y
   * caduca en minutos.
   */
  const vincularConCodigo = async () => {
    setCfgError(null);
    setActivando(true);
    try {
      const r = await fetch('/api/dispositivos/canjear', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ codigo: cfgCodigo.replace(/\D/g, '') }),
      });
      const d = await r.json().catch(() => null);
      if (!r.ok || !d?.ok) { setCfgError(d?.error || `El servidor respondió ${r.status}.`); return; }
      // La clave llega UNA sola vez: queda aquí y en ningún otro lado.
      setDeviceKey(d.dispositivo.clave);
      if (d.dispositivo.sede_id) setSedeId(d.dispositivo.sede_id);
      setConfigurado(true);
      setCfgCodigo('');
      setStatusNote(`"${d.dispositivo.nombre}" registrado en ${d.empresa}.`);
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
        // CALENTAMIENTO: la primera inferencia real compila los kernels del
        // backend (~2-3 s en teléfono) y la pagaba el PRIMER empleado — por
        // eso el cronómetro daba ROSTRO ~2950 ms la primera vez y ~600 ms
        // después. Se paga aquí, contra lienzos vacíos, mientras la pantalla
        // todavía dice "Cargando…". Mejor esfuerzo: si falla, no bloquea.
        try {
          const c = document.createElement('canvas');
          c.width = 224; c.height = 224;
          await faceapi.detectSingleFace(c, new faceapi.TinyFaceDetectorOptions({ inputSize: DETECTOR_INPUT, scoreThreshold: 0.5 }));
          const c2 = document.createElement('canvas');
          c2.width = 150; c2.height = 150;
          await faceapi.nets.faceLandmark68Net.detectLandmarks(c2);
          await faceapi.nets.faceRecognitionNet.computeFaceDescriptor(c2);
        } catch { /* sin calentamiento se paga en la primera marcación, como antes */ }
        if (cancelled) return;
        landmarkerRef.current = landmarker;
        faceapiRef.current = faceapi;
        setReady(true);
        setStatusNote('Listo para iniciar.');
      } catch (err) {
        if (!cancelled) { setLoadError(`${err?.name}: ${err?.message || err}`); setStatusNote('No se pudo preparar la cámara.'); }
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // ── Sonidos ───────────────────────────────────────────────────────────
  // Se SINTETIZAN con Web Audio en vez de cargar archivos: pesan cero, suenan
  // sin internet (que es justo cuando el kiosco más los necesita) y no
  // dependen de que el service worker haya cacheado un .mp3.
  //
  // Cada resultado tiene su timbre, para que la persona sepa qué pasó sin
  // mirar la pantalla: entrada sube, salida baja, aviso es un toque neutro y
  // el rechazo es grave. El contexto se crea al pulsar "Iniciar kiosco"
  // porque los navegadores solo permiten audio tras un gesto de la persona.
  const audioRef = useRef(null);

  /**
   * Crea (o reanuda) el contexto de audio. TIENE que llamarse de forma
   * SÍNCRONA dentro del gesto de la persona: después de un `await` el
   * navegador ya no considera que sigue en el gesto y el contexto nace
   * suspendido — así quedó mudo el kiosco en el APK la primera vez.
   *
   * El buffer de un cuadro en silencio es el truco clásico de desbloqueo:
   * algunos WebView no arrancan el reloj de audio hasta que algo suena.
   */
  const abrirAudio = useCallback(() => {
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) { console.log('[KioscoAudio] este WebView no tiene Web Audio'); return; }
      if (!audioRef.current) audioRef.current = new AC();
      const ctx = audioRef.current;
      ctx.resume?.().then?.(() => console.log(`[KioscoAudio] contexto ${ctx.state}`)).catch?.(() => {});
      const src = ctx.createBufferSource();
      src.buffer = ctx.createBuffer(1, 1, 22050);
      src.connect(ctx.destination);
      src.start(0);
      console.log(`[KioscoAudio] desbloqueo pedido; estado ${ctx.state}`);
    } catch (e) {
      console.log(`[KioscoAudio] no se pudo abrir: ${e?.message || e}`);
    }
  }, []);

  // Red de seguridad: cualquier toque en la pantalla reanuda el audio si el
  // sistema lo dejó suspendido (pasa al volver de una llamada o del reposo).
  useEffect(() => {
    const despertar = () => { if (audioRef.current?.state === 'suspended') audioRef.current.resume?.(); };
    document.addEventListener('pointerdown', despertar);
    return () => document.removeEventListener('pointerdown', despertar);
  }, []);

  const sonar = useCallback((tipo) => {
    const ctx = audioRef.current;
    if (!ctx) { console.log(`[KioscoAudio] "${tipo}" sin contexto de audio`); return; }
    // [frecuencia Hz, arranque s, duración s]
    const NOTAS = {
      entrada: [[784.0, 0, 0.13], [1046.5, 0.11, 0.20]], // sol → do: sube
      salida: [[1046.5, 0, 0.13], [784.0, 0.11, 0.20]],  // do → sol: baja
      aviso: [[659.3, 0, 0.20]],                          // mi: un toque neutro
      error: [[311.1, 0, 0.20], [233.1, 0.16, 0.30]],     // mib → sib: grave
    };
    const notas = NOTAS[tipo];
    if (!notas) return;
    try {
      if (ctx.state === 'suspended') ctx.resume();
      console.log(`[KioscoAudio] suena "${tipo}" (contexto ${ctx.state})`);
      const t0 = ctx.currentTime;
      for (const [hz, desde, dur] of notas) {
        const osc = ctx.createOscillator();
        const gan = ctx.createGain();
        osc.type = tipo === 'error' ? 'triangle' : 'sine';
        osc.frequency.value = hz;
        // Envolvente suave: un tono que arranca o corta en seco produce un
        // "clic" desagradable en el altavoz de una tablet.
        const ini = t0 + desde;
        gan.gain.setValueAtTime(0.0001, ini);
        gan.gain.exponentialRampToValueAtTime(0.22, ini + 0.015);
        gan.gain.exponentialRampToValueAtTime(0.0001, ini + dur);
        osc.connect(gan).connect(ctx.destination);
        osc.start(ini);
        osc.stop(ini + dur + 0.02);
      }
    } catch { /* sin audio disponible: el kiosco sigue igual */ }
  }, []);

  // ── Ubicación GPS ─────────────────────────────────────────────────────
  // Mientras el kiosco corre se mantiene el último fix en memoria (watch,
  // sin esperar nada al marcar). Se envía con cada marcación y el SERVIDOR
  // decide: guardarlo (validar_ubicacion) o exigir el rango de la sede
  // (validar_sede). Si el permiso está negado, simplemente no viaja nada.
  const gpsRef = useRef(null);
  const gpsLogRef = useRef(0);
  useEffect(() => {
    if (!running) return;
    if (!('geolocation' in navigator)) { console.log('[KioscoGPS] este WebView no tiene geolocalización'); return; }
    console.log('[KioscoGPS] vigilancia de ubicación iniciada');
    const id = navigator.geolocation.watchPosition(
      (pos) => {
        gpsRef.current = {
          lat: pos.coords.latitude,
          lon: pos.coords.longitude,
          precision_m: pos.coords.accuracy,
          ts: Date.now(),
        };
        // Un log cada ~10 s basta para ver la señal sin inundar la consola.
        if (Date.now() - gpsLogRef.current > 10000) {
          gpsLogRef.current = Date.now();
          console.log(`[KioscoGPS] fix: ${pos.coords.latitude.toFixed(7)}, ${pos.coords.longitude.toFixed(7)} (±${Math.round(pos.coords.accuracy)} m)`);
        }
      },
      (err) => { console.log(`[KioscoGPS] sin ubicación: ${err?.message || err?.code} (permiso negado o sin señal)`); },
      { enableHighAccuracy: true, maximumAge: 15000, timeout: 20000 },
    );
    return () => navigator.geolocation.clearWatch(id);
  }, [running]);
  // Solo un fix reciente vale: uno viejo diría dónde ESTUVO el aparato.
  const gpsFresco = () => (gpsRef.current && Date.now() - gpsRef.current.ts < 120000 ? gpsRef.current : null);

  // ── Wake Lock ─────────────────────────────────────────────────────────
  const acquireWakeLock = useCallback(async () => {
    try { if ('wakeLock' in navigator) wakeLockRef.current = await navigator.wakeLock.request('screen'); } catch {}
  }, []);
  // Al volver del segundo plano (una LLAMADA, cambiar de app, apagar la
  // pantalla), Android le QUITA la cámara al WebView: el track queda 'ended',
  // el video congelado y el kiosco se veía "pegado". Aquí se recupera solo:
  // se vuelve a pedir la cámara, se re-engancha al <video> y el reto se
  // reinicia limpio (el que estaba a medias ya no vale tras la interrupción).
  const reanudarCamara = useCallback(async () => {
    const track = streamRef.current?.getVideoTracks?.()[0];
    if (track && track.readyState === 'live') {
      // La cámara sobrevivió: basta reanudar el video (queda pausado a veces).
      videoRef.current?.play?.().catch(() => {});
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false });
      streamRef.current?.getTracks?.().forEach((t) => t.stop());
      stream.getVideoTracks()[0]?.addEventListener('ended', () => {
        if (document.visibilityState === 'visible') reanudarCamara();
      });
      streamRef.current = stream;
      videoRef.current.srcObject = stream;
      await videoRef.current.play();
      stateRef.current = { phase: 'idle', deadline: 0, until: 0, sawOpen: false, sawClosed: false, descs: [], lastCapture: 0, captures: 0 };
      setResult(null);
      ponerProgreso(0);
      ponerEncuadre('ok');
      setUi('idle');
    } catch {
      // Sin permiso o cámara aún ocupada por la llamada: el próximo
      // visibilitychange (o tocar Detener/Iniciar) lo reintenta.
    }
  }, []);

  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState !== 'visible' || !running) return;
      acquireWakeLock();
      reanudarCamara();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [running, acquireWakeLock, reanudarCamara]);

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
    // LO PRIMERO, sin ningún `await` antes: el permiso de audio solo se
    // concede dentro del gesto que lo pidió.
    abrirAudio();

    // Roster desde la BASE DE DATOS (con caché local para cortes de red).
    let all = [];
    try {
      const { empleados, deCache } = await cargarRoster();
      all = empleados;
      if (deCache) setStatusNote('Sin conexión: usando la última copia.');
    } catch (e) {
      // La clave del aparato ya no vale (fue revocado, o la base cambió). No
      // es un fallo pasajero: hay que reactivarlo, así que se vuelve a la
      // pantalla de activación en vez de dejar un kiosco que no puede marcar.
      if (e instanceof ClaveRechazada) {
        olvidarActivacion();
        setConfigurado(false);
        setCfgError('Este dispositivo ya no está autorizado. Vuelve a registrarlo.');
        cargarSedes().then(setCfgSedes).catch(() => { /* sin red: se reintenta al reactivar */ });
        return;
      }
      setStatusNote(`No se pudo cargar el roster: ${e.message}`);
      return;
    }
    // Solo personas con descriptor VÁLIDO: un registro corrupto en el roster
    // no debe poder tumbar la comparación 1:N (y con ella, todo el kiosco).
    // Cada persona se queda solo con sus rostros SANOS; quien no conserve
    // ninguno sale del roster (no podría compararse contra nada).
    const sano = (d) => Array.isArray(d) && d.length === 128 && d.every(Number.isFinite);
    const valid = all
      .map((p) => ({ ...p, descriptores: (p.descriptores ?? []).filter(sano) }))
      .filter((p) => p.descriptores.length > 0);
    if (valid.length < all.length) {
      console.warn(`Kiosco: ${all.length - valid.length} registro(s) sin rostro o corruptos fueron excluidos.`);
    }
    peopleRef.current = valid;
    setPeopleCount(valid.length);
    if (valid.length === 0) {
      setStatusNote(all.length > 0
        ? 'Ningún empleado tiene rostro registrado.'
        : 'No hay empleados registrados.');
      return;
    }
    // Aprovechar el arranque para vaciar la cola offline pendiente.
    sincronizarCola().then(({ motivo }) => {
      setPendientes(pendientesEnCola());
      setSyncMotivo(motivo);
    }).catch(() => {});
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false });
      // Si el sistema mata el track SIN ocultar la app (llamada en burbuja,
      // otra app pidiendo la cámara), se recupera igual que al volver del
      // segundo plano. Oculta, no: el visibilitychange lo hará al volver.
      stream.getVideoTracks()[0]?.addEventListener('ended', () => {
        if (document.visibilityState === 'visible') reanudarCamara();
      });
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
            st.reintento = false; st.mejor = null; // reintento silencioso por distancia
            // Cronómetro del reto: cuánto tarda cada validación (se lee en el
            // logcat de Android como mensajes de consola del WebView).
            st.t0 = now; st.tParpadeo = null; st.tCaptura = null;
            console.log('[Kiosco⏱] reto iniciado: cara detectada');
            setResult(null);
            ponerProgreso(25); // fase 1: rostro detectado
            setUi('challenge');
          }
          break;
        }
        case 'challenge': {
          if (!lm) { st.phase = 'idle'; setUi('idle'); ponerEncuadre('ok'); break; }
          if (now > st.deadline) {
            concludeResult(false, null, null, 'No se detectó el parpadeo.');
            break;
          }

          // ── Encuadre automático ─────────────────────────────────────────
          // Con los mismos landmarks se mide la cara: qué tan grande se ve
          // (cerca/lejos) y si está centrada. Mientras el encuadre no sirva,
          // el reto NO avanza y la pantalla guía a la persona; así las
          // capturas de identidad salen siempre a una distancia comparable a
          // la del registro. El deadline sigue corriendo: el kiosco no se
          // queda pegado con alguien que nunca se acomoda.
          let minX = 1, maxX = 0, minY = 1, maxY = 0;
          for (const p of lm) {
            if (p.x < minX) minX = p.x; if (p.x > maxX) maxX = p.x;
            if (p.y < minY) minY = p.y; if (p.y > maxY) maxY = p.y;
          }
          // Solo los EXTREMOS de distancia frenan (muy lejos no hay píxeles
          // para reconocer; muy cerca la cara se sale del cuadro). Nada de
          // exigir centrado: con que MediaPipe vea la cara, alcanza — el
          // requisito de acomodarse en el óvalo hacía lento el flujo.
          const caraAlto = maxY - minY;
          const encuadre = caraAlto < 0.22 ? 'lejos' : caraAlto > 0.85 ? 'cerca' : 'ok';
          ponerEncuadre(encuadre);
          if (encuadre !== 'ok') { ponerProgreso(25); break; }

          // Prueba de vida SIN orden: ver ojos abiertos en algún momento y
          // cerrados en algún otro, en cualquier secuencia. El movimiento de
          // párpados es lo que demuestra vida; una foto no lo tiene.
          // Umbrales de MOVIMIENTO de párpado, no de cierre total: ver los
          // ojos razonablemente abiertos (< 0.25) y luego un cierre aunque
          // sea parcial (> 0.35) ya es vida — una foto da valores planos.
          // El 0.55 anterior exigía cerrar del todo y descartaba parpadeos
          // suaves: por eso los OJOS tardaban segundos en el cronómetro.
          if (bothOpen < 0.25) st.sawOpen = true;
          if (bothClosed > 0.35) st.sawClosed = true;
          if (st.sawOpen && st.sawClosed && st.tParpadeo == null) {
            st.tParpadeo = now - st.t0;
            console.log(`[Kiosco⏱] OJOS listos a los ${Math.round(st.tParpadeo)} ms (abierto y cerrado vistos)`);
          }
          // Barra HUD atada a las fases reales del reto.
          ponerProgreso(st.sawOpen && st.sawClosed ? 75 : (st.sawOpen || st.sawClosed) ? 50 : 25);

          const frontal = Math.abs(yaw) < 12;
          if (frontal && !faBusy && st.captures < FACE_CAPTURES && now - st.lastCapture >= CAPTURE_GAP_MS) {
            faBusy = true; st.captures += 1; st.lastCapture = now;
            faceapi.detectSingleFace(video, new faceapi.TinyFaceDetectorOptions({ inputSize: DETECTOR_INPUT, scoreThreshold: 0.5 }))
              .withFaceLandmarks().withFaceDescriptor()
              .then((det) => {
                if (det) {
                  st.descs.push(Array.from(det.descriptor));
                  if (st.tCaptura == null) {
                    st.tCaptura = performance.now() - st.t0;
                    console.log(`[Kiosco⏱] ROSTRO listo a los ${Math.round(st.tCaptura)} ms (primera captura de identidad)`);
                  }
                } else {
                  console.log('[Kiosco⏱] captura de rostro sin resultado (face-api no vio la cara en ese cuadro)');
                }
              })
              .catch(() => {}).finally(() => { faBusy = false; });
          }

          // Concluye APENAS se detecta el cierre de ojos: exigir además que
          // volvieran a abrirse (bothOpen < 0.20) solo agregaba espera — la
          // prueba de vida ya está demostrada con abierto → cerrado. La única
          // condición extra es tener al menos una captura de identidad, que
          // se toma en los cuadros previos con los ojos abiertos.
          if (st.sawOpen && st.sawClosed && st.descs.length > 0) {
            const live = averageDescriptors(st.descs);
            // Los DOS más parecidos, no solo el ganador: sin el segundo no se
            // puede saber si la decisión fue clara o un empate a los pelos.
            let best = { distance: Infinity, person: null };
            let segundo = { distance: Infinity, person: null };
            for (const p of peopleRef.current) {
              // Distancia al rostro MÁS PARECIDO de esa persona: con varias
              // fotos (distinta luz, con y sin gafas) gana la que se parezca,
              // sin promediarlas — un promedio de fotos distintas cae en un
              // punto que no representa a ninguna.
              let d = Infinity;
              for (const desc of p.descriptores) {
                const dd = euclideanDistance(desc, live);
                if (dd < d) d = dd;
              }
              if (d < best.distance) { segundo = best; best = { distance: d, person: p }; }
              else if (d < segundo.distance) segundo = { distance: d, person: p };
            }
            const margen = segundo.distance - best.distance; // Infinity con un solo empleado

            // MARGEN DE DECISIÓN: no basta parecerse al primero; hay que
            // parecerse CLARAMENTE más que al segundo. Con rostros vecinos
            // (Tatiana/Hanny a 0.548) una cara podía caer a 0.494 de la
            // persona equivocada y ganar por milésimas: el sistema lo daba
            // por certeza. Ahora un empate es "no sé quién eres" y se
            // rechaza, que es el error barato — el caro es marcar por otro.
            //
            // Bajar el umbral global NO era la solución: con las fotos
            // actuales (rostros apiñados) 0.45 habría rechazado el 38% de
            // las marcaciones buenas. El margen solo frena los empates.
            const ambiguo = margen < MARGEN_MINIMO;

            // REINTENTO SILENCIOSO: si la identidad no alcanzó el umbral, o
            // quedó ambigua, no se muestra el rechazo — se descartan las
            // capturas (pudieron salir movidas o en mal ángulo) y se toman
            // frescas para medir de nuevo. La prueba de vida ya está hecha y
            // no se repite; un reconocido con sede ajena no reintenta.
            if ((best.distance >= MATCH_THRESHOLD || ambiguo) && !st.reintento) {
              st.reintento = true;
              // El mejor de los dos intentos solo se guarda si fue LIMPIO:
              // quedarse con una medición ambigua sería reciclar la duda.
              st.mejor = ambiguo ? null : best;
              st.descs = []; st.captures = 0; st.lastCapture = 0;
              st.deadline = Math.max(st.deadline, now + 4000); // aire para las capturas nuevas
              console.log(`[Kiosco⏱] ${ambiguo ? `AMBIGUO: ${best.person?.name} (${best.distance.toFixed(3)}) vs ${segundo.person?.name} (${segundo.distance.toFixed(3)}), margen ${margen.toFixed(3)}` : `identidad no coincidió (distancia ${best.distance.toFixed(3)})`}; reintento silencioso con capturas frescas`);
              break;
            }
            // Tras un reintento, vale el MEJOR de los dos intentos limpios.
            if (st.mejor && st.mejor.distance < best.distance) best = st.mejor;

            const total = Math.round(now - st.t0);
            const primero = (st.tParpadeo ?? Infinity) <= (st.tCaptura ?? Infinity) ? 'OJOS' : 'ROSTRO';
            console.log(`[Kiosco⏱] CONCLUYE a los ${total} ms — primero terminó: ${primero} (ojos: ${Math.round(st.tParpadeo ?? -1)} ms, rostro: ${Math.round(st.tCaptura ?? -1)} ms${st.reintento ? ', con reintento' : ''}) · 1º ${best.person?.name} ${best.distance.toFixed(3)} · 2º ${segundo.person?.name ?? '—'} ${Number.isFinite(segundo.distance) ? segundo.distance.toFixed(3) : '—'} · margen ${Number.isFinite(margen) ? margen.toFixed(3) : '∞'}`);
            const distance = Math.round(best.distance * 1000) / 1000;
            const reconocido = distance < MATCH_THRESHOLD && !ambiguo;
            // Sede exigida: si el empleado tiene el flag, solo puede marcar en
            // un kiosco de SU sede. La sede asignada sin flag es informativa.
            const sedeAjena = reconocido && best.person.validarSede
              && best.person.sedeId && best.person.sedeId !== getSedeId();
            const ok = reconocido && !sedeAjena;
            concludeResult(
              ok,
              reconocido ? best.person : null, // con sede ajena el rechazo dice a QUIÉN
              distance,
              ok ? null : sedeAjena ? 'Debes marcar en el kiosco de tu sede asignada.'
                : ambiguo ? 'No pudimos distinguirte con seguridad. Acércate un poco más e intenta de nuevo.'
                  : 'Intenta de nuevo mirando de frente.',
            );
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
          // Tras un REGISTRO exitoso sí se exige que la cara se retire (!lm):
          // evita re-escanear a quien ya marcó y sigue frente al kiosco.
          // Tras un RECHAZO no: la persona puede reintentar de una, sin tener
          // que mirar para otro lado.
          if (now > st.until && (!lm || st.lastOk === false)) {
            st.phase = 'idle';
            setResult(null);
            ponerProgreso(0); // barra lista para el próximo escaneo
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
    ponerEncuadre('ok'); // que la guía no se quede pegada en el resultado
    ponerProgreso(100); // fase final: coincidencia resuelta
    const st = stateRef.current;
    st.lastOk = ok; // el cooldown decide con esto si exige que la cara se retire
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
      sonar('error');
      setResult({ kind: 'no', name: person?.name, time, distance, reason: failReason });
      setUi('no');
      return;
    }

    // Identidad confirmada → el SERVIDOR decide ENTRADA o SALIDA y pone la
    // hora. Mientras responde, la pantalla muestra "registrando…".
    setResult({ kind: 'saving', name: person.name, time });
    setUi('ok');
    st.until = performance.now() + ESPERA_RED_MS; // margen fijo para la red

    const gpsEnvio = gpsFresco();
    console.log(gpsEnvio
      ? `[KioscoGPS] marcación de ${person.name} con ubicación ${gpsEnvio.lat.toFixed(7)}, ${gpsEnvio.lon.toFixed(7)} (±${Math.round(gpsEnvio.precision_m)} m, de hace ${Math.round((Date.now() - gpsEnvio.ts) / 1000)} s)`
      : `[KioscoGPS] marcación de ${person.name} SIN ubicación (sin permiso, sin señal, o fix de más de 2 min)`);
    registrarPaso(person.id, gpsEnvio).then((paso) => {
      const stNow = stateRef.current;
      stNow.until = performance.now() + RESULT_SHOW_MS;

      if (paso.errorConfig) {
        // (con clave rechazada, registrarPaso lanza y cae al catch de abajo)
        sonar('error');
        setResult({ kind: 'no', name: person.name, time, reason: `No se pudo registrar: ${paso.errorConfig}` });
        setUi('no');
        return;
      }
      if (paso.pendiente) {
        // Sin red: quedó en la cola local y se sincroniza sola.
        sonar('aviso');
        setPendientes(paso.enCola);
        setResult({ kind: 'pending', name: person.name, time });
        setUi('ok');
        return;
      }
      if (paso.duplicado) {
        sonar('aviso');
        const lastTime = new Date(paso.ultima.ts).toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
        const lastLabel = paso.ultima.tipo === 'entrada' ? 'ENTRADA' : 'SALIDA';
        setResult({ kind: 'dup', name: person.name, time, lastLabel, lastTime });
        setUi('ok');
        return;
      }
      // Entrada sube, salida baja: se distinguen de oído, sin mirar.
      sonar(paso.tipo === 'entrada' ? 'entrada' : 'salida');
      const tsOficial = new Date(paso.marcacion.ts).toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
      setResult({
        kind: paso.tipo === 'entrada' ? 'in' : 'out',
        name: person.name,
        time: tsOficial, // la hora OFICIAL del servidor, no la del dispositivo
        distance,
        flag: null,
      });
      setUi('ok');
    }).catch((e) => {
      const stNow = stateRef.current;
      stNow.until = performance.now() + RESULT_SHOW_MS;
      if (e instanceof ClaveRechazada) {
        // El aparato fue revocado: parar y pedir reactivación (la cola local
        // se conserva; son horas trabajadas).
        stopAll();
        olvidarActivacion();
        setConfigurado(false);
        setCfgError('Este dispositivo ya no está autorizado. Vuelve a registrarlo.');
        return;
      }
      sonar('error');
      setResult({ kind: 'no', name: person.name, time, reason: `No se pudo registrar: ${e.message}` });
      setUi('no');
    });
  }

  // Veredicto DENTRO del cuadro de la cámara: velo translúcido del color
  // semántico + icono en círculo. El borde del cuadro toma el mismo color.
  const VEREDICTOS = {
    // 'saving' NO pinta nada dentro del cuadro: el velo gris con ⏳ se veía
    // como un "cargando" feo. Mientras responde el servidor, el cuadro queda
    // limpio y solo el texto de arriba dice "Registrando…".
    in:      { emoji: '👍', anim: 'ac-pop',   velo: 'rgba(21,128,61,0.55)',  circulo: 'var(--k-in)',     borde: 'var(--k-in)' },
    out:     { emoji: '👋', anim: 'ac-wave',  velo: 'rgba(180,83,9,0.55)',   circulo: 'var(--k-out)',    borde: 'var(--k-out)' },
    dup:     { emoji: 'ℹ',  anim: '',         velo: 'rgba(85,125,158,0.55)', circulo: 'var(--accent-2)', borde: 'var(--accent)' },
    pending: { emoji: '📶', anim: 'ac-float', velo: 'rgba(85,125,158,0.55)', circulo: 'var(--accent-2)', borde: 'var(--accent)' },
    no:      { emoji: '✕',  anim: 'ac-shake', velo: 'rgba(179,64,58,0.55)',  circulo: 'var(--k-no)',     borde: 'var(--k-no)' },
  };
  const conResultado = (ui === 'ok' || ui === 'no') && result;
  const ver = conResultado ? VEREDICTOS[result.kind] : null;

  return (
    <div className="kiosk-card" style={s.kiosk}>
      <EmojiKeyframes />
      {/* Pantalla de DETECCIÓN (blanca, permanente mientras corre): se entra
          con "Iniciar kiosco" y solo se sale con "Detener". Todo mensaje va
          ARRIBA del cuadro (zona de altura fija: el cuadro nunca salta) y el
          veredicto va DENTRO del cuadro (velo de color + icono). */}
      <div style={{
        ...s.camWrap,
        opacity: running ? 1 : 0,
        // Invisible NO basta: un overlay con opacity 0 sigue capturando los
        // toques y bloqueaba el botón "Iniciar kiosco" debajo.
        pointerEvents: running ? 'auto' : 'none',
      }}>
        <span style={s.hudMarca}>CONTROL <span style={{ color: 'var(--accent)' }}>REGISTRO</span></span>
        <button style={s.hudDetener} onClick={stopAll}>⏹ Detener</button>

        {/* Zona de mensaje, SIEMPRE arriba del cuadro */}
        <div style={s.hudMensaje}>
          {conResultado ? (
            <>
              {result.kind === 'in' && <div style={{ ...s.hudTag, color: 'var(--k-in)' }}>🟢 ENTRADA</div>}
              {result.kind === 'out' && <div style={{ ...s.hudTag, color: 'var(--k-out)' }}>🟠 SALIDA</div>}
              {result.kind === 'dup' && <div style={{ ...s.hudTag, color: 'var(--accent-2)' }}>ℹ YA REGISTRADA</div>}
              {result.kind === 'pending' && <div style={{ ...s.hudTag, color: 'var(--accent-2)' }}>📶 SIN CONEXIÓN</div>}
              {result.kind === 'no' && <div style={{ ...s.hudTag, color: 'var(--k-no)' }}>✕ NO RECONOCIDO</div>}

              <div style={s.hudTitulo}>
                {result.kind === 'in' && <>¡Bienvenido/a, {result.name}!</>}
                {result.kind === 'out' && <>¡Hasta pronto, {result.name}!</>}
                {result.kind === 'dup' && result.name}
                {result.kind === 'pending' && result.name}
                {result.kind === 'saving' && 'Registrando…'}
                {result.kind === 'no' && 'Intenta de nuevo'}
              </div>

              {result.kind === 'in' && <div style={{ ...s.hudHora, color: 'var(--k-in)' }}>{result.time}</div>}
              {result.kind === 'out' && <div style={{ ...s.hudHora, color: 'var(--k-out)' }}>{result.time}</div>}
              {result.kind === 'dup' && <div style={s.hudDetalle}>{result.lastLabel} registrada: {result.lastTime}</div>}
              {result.kind === 'pending' && <div style={s.hudDetalle}>Guardada; se enviará sola</div>}
              {result.kind === 'saving' && <div style={s.hudDetalle}>{result.name}</div>}
              {result.kind === 'no' && <div style={s.hudDetalle}>{result.reason}</div>}
            </>
          ) : ui === 'challenge' ? (
            <>
              {/* Con mal encuadre, la instrucción es acomodarse; solo con la
                  cara bien puesta se pide el parpadeo. */}
              <div style={s.hudTitulo}>
                {encuadre === 'ok' ? <>Parpadea <span className="ac-ojo">👁</span></> : 'Acomoda tu cara'}
              </div>
              {/* Sin estado "Verificando…": el avance ya lo cuenta la barra
                  de progreso, y con el cierre instantáneo solo alcanzaba a
                  parpadear en pantalla. */}
              <div style={s.hudDetalle}>
                {encuadre === 'lejos' ? 'Acércate un poco'
                  : encuadre === 'cerca' ? 'Aléjate un poco'
                  : scanProg >= 50 ? 'Parpadea' : 'Mira de frente'}
              </div>
            </>
          ) : (
            <>
              <div style={s.hudTitulo}>Acércate para marcar</div>
              <div style={s.hudDetalle}>Esperando rostro…</div>
            </>
          )}
        </div>

        {/* Cuadro de la cámara: con veredicto, su borde toma el color */}
        <div style={{ ...s.hudVentana, ...(ver?.borde ? { boxShadow: `0 0 0 3px ${ver.borde}` } : {}) }}>
          <video ref={videoRef} playsInline muted autoPlay style={s.video} />
          {ui === 'challenge' && (
            <>
              {/* Óvalo guía: dónde cuadrar la cara. Se pone VERDE y sólido
                  cuando el encuadre es correcto — confirmación sin leer. */}
              <div
                className="ac-guia"
                style={{
                  ...s.guiaOval,
                  ...(encuadre === 'ok' ? { border: '2.5px solid var(--k-in)' } : {}),
                }}
              />
              <div className="ac-laser" style={s.laserGrupo}>
                <div style={s.laserEstela} />
                <div style={s.laserHaz} />
              </div>
              <div className="ac-esq" style={{ ...s.esquina, left: 8, top: 8, borderRight: 'none', borderBottom: 'none', borderRadius: '6px 0 0 0' }} />
              <div className="ac-esq" style={{ ...s.esquina, right: 8, top: 8, borderLeft: 'none', borderBottom: 'none', borderRadius: '0 6px 0 0' }} />
              <div className="ac-esq" style={{ ...s.esquina, left: 8, bottom: 8, borderRight: 'none', borderTop: 'none', borderRadius: '0 0 0 6px' }} />
              <div className="ac-esq" style={{ ...s.esquina, right: 8, bottom: 8, borderLeft: 'none', borderTop: 'none', borderRadius: '0 0 6px 0' }} />
            </>
          )}
          {ver && (
            <div style={{ ...s.velo, background: ver.velo }}>
              <div style={{ ...s.veloIcono, background: ver.circulo }}>
                <span className={`ac-emoji ${ver.anim}`} role="img">{ver.emoji}</span>
              </div>
            </div>
          )}
        </div>

        <div style={s.hudBarra}><div style={{ ...s.hudBarraRelleno, width: `${scanProg}%` }} /></div>
        <div style={s.hudPrivacidad}>🔐 No se guardan fotos</div>
      </div>

      {/* Estado 1 · Reposo (solo con el kiosco DETENIDO: corriendo, la base
          es la pantalla de cámara de arriba) */}
      {(ui === 'idle' && !running) && (
        <div className="kiosk-idle" style={s.idle}>
          <div style={s.brand}>CONTROL <span style={{ color: 'var(--accent)' }}>REGISTRO</span></div>
          <div style={s.clock}>{clock.time}</div>
          <div style={s.date}>{clock.date}</div>
          <div style={s.idleOval}>
            <span className="ac-emoji ac-float" role="img" aria-label="esperando">⏳</span>
          </div>
          <div style={s.idleCta}>{running ? 'Acércate para marcar' : statusNote}</div>

          {/* Activación del dispositivo (una sola vez).
              El CÓDIGO va primero porque es el camino de la app de Android:
              ahí no se puede iniciar sesión —Google lo bloquea dentro de una
              app— así que el administrador genera el código en el panel, desde
              su computador, y aquí solo se teclea. */}
          {!running && !configurado && (
            <div style={s.cfgBox}>
              <div style={s.cfgTitle}>Registrar este dispositivo</div>
              <div style={s.cfgHint}>
                Pide el código en el panel: Ajustes → Dispositivos → Vincular un aparato.
              </div>
              <input
                style={{ ...s.cfgInput, ...s.cfgCodigo }}
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                placeholder="0000-0000"
                maxLength={9}
                value={cfgCodigo}
                onChange={(e) => {
                  // Se teclean 8 dígitos y el guion se pone solo: en un aparato
                  // montado en la pared, cada carácter de más es una molestia.
                  const d = e.target.value.replace(/\D/g, '').slice(0, 8);
                  setCfgCodigo(d.length > 4 ? `${d.slice(0, 4)}-${d.slice(4)}` : d);
                }}
              />
              <button
                style={s.startBtn}
                onClick={vincularConCodigo}
                disabled={cfgCodigo.replace(/\D/g, '').length !== 8 || activando}
              >
                {activando ? 'Registrando…' : 'Registrar dispositivo'}
              </button>

              {cfgError && <div style={s.errNote}>{cfgError}</div>}
            </div>
          )}

          {!running && configurado && (
            <button style={s.startBtn} onClick={handleStart} disabled={!ready}>
              {ready ? '▶️ Iniciar kiosco' : 'Cargando…'}
            </button>
          )}
          {pendientes > 0 && (
            <div style={s.pendNote}>
              📶 {pendientes === 1 ? '1 marcación guardada' : `${pendientes} marcaciones guardadas`} por enviar; se envían solas al volver el internet.
              {syncMotivo && <div style={s.errNote}>No se pudieron enviar: {syncMotivo}</div>}
            </div>
          )}
          <div style={s.privacy}>🔐 No se guardan fotos</div>
          {loadError && <div style={s.errNote}>{loadError}</div>}
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
      /* ── Modo HUD (escáner láser F3) ── */
      /* El haz recorre la ventana con TRANSFORM (GPU): el carro mide 100% de
         la ventana y su borde inferior (el láser) viaja del 4% al 100%. */
      @keyframes ac-laser-barrido {
        from { transform: translateY(-96%); }
        to   { transform: translateY(0); }
      }
      .ac-laser { animation: ac-laser-barrido 2.8s ease-in-out infinite alternate; }
      /* Las esquinas de encuadre "respiran" en cian (solo color: barato) */
      @keyframes ac-esq-pulso {
        50% { border-color: #9BF0FF; }
      }
      .ac-esq { animation: ac-esq-pulso 2s ease-in-out infinite; }
      /* El óvalo guía late suave para invitar a centrar la cara */
      @keyframes ac-guia-pulso {
        50% { border-color: rgba(53,224,255,0.85); }
      }
      .ac-guia { animation: ac-guia-pulso 2.4s ease-in-out infinite; }
      /* El ojo de la instrucción parpadea él mismo: modela el gesto pedido */
      @keyframes ac-parpadeo {
        0%, 86%, 100% { transform: scaleY(1); }
        92%           { transform: scaleY(0.08); }
      }
      .ac-ojo { display: inline-block; animation: ac-parpadeo 2.6s ease-in-out infinite; }
      @media (prefers-reduced-motion: reduce) {
        .ac-float, .ac-pop, .ac-wave, .ac-shake, .ac-laser, .ac-esq, .ac-ojo, .ac-guia { animation: none; }
      }
    `}</style>
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
  // Altura y pantalla-completa móvil: clase .kiosk-card (globals.css, 100dvh).
  kiosk: {
    position: 'relative', maxWidth: 430, margin: '0 auto',
    background: 'var(--surface)', borderRadius: 24, overflow: 'hidden',
    color: 'var(--ink)', fontFamily: 'var(--f-body)',
    border: '1px solid var(--border)', boxShadow: 'var(--elev-2)',
  },
  // ── Modo HUD de escaneo (láser, F3) ─────────────────────────────────
  camWrap: {
    position: 'absolute', inset: 0, transition: 'opacity .3s',
    // BLANCO puro y sin rejilla: decisión de diseño del cliente.
    background: 'var(--surface-blanca)', color: 'var(--ink)',
    // justifyContent center: el bloque (ventana + barra + textos) queda
    // centrado verticalmente en vez de pegado arriba.
    display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
    padding: 'calc(clamp(24px, 5dvh, 48px) + env(safe-area-inset-top, 0px)) 20px calc(20px + env(safe-area-inset-bottom, 0px))',
    zIndex: 2,
  },
  // Zona de mensaje sobre el cuadro: altura mínima FIJA para que el cuadro de
  // la cámara no salte de posición cuando cambia el estado.
  hudMensaje: {
    minHeight: 96, width: '100%', display: 'flex', flexDirection: 'column',
    alignItems: 'center', justifyContent: 'flex-end', gap: 3,
    textAlign: 'center', padding: '6px 8px 14px', position: 'relative',
  },
  hudTag: { fontSize: 12, fontWeight: 800, letterSpacing: '0.14em' },
  hudTitulo: { fontSize: 24, fontWeight: 800, letterSpacing: '-0.01em', lineHeight: 1.15, color: 'var(--ink)', textWrap: 'balance' },
  hudDetalle: {
    fontSize: 12, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase',
    color: 'var(--muted)', maxWidth: 300, lineHeight: 1.4,
  },
  hudHora: { fontSize: 19, fontWeight: 700, fontVariantNumeric: 'tabular-nums', fontFamily: 'var(--f-data)' },
  // Veredicto dentro del cuadro: velo de color sobre el video + icono en círculo.
  velo: {
    position: 'absolute', inset: 0, display: 'flex',
    alignItems: 'center', justifyContent: 'center',
  },
  veloIcono: {
    width: 84, height: 84, borderRadius: '50%', display: 'flex',
    alignItems: 'center', justifyContent: 'center', fontSize: 42,
    color: '#ffffff', fontWeight: 800,
  },
  // Marca anclada arriba: fuera del flujo, para no descentrar la ventana.
  hudMarca: {
    position: 'absolute', top: 'calc(18px + env(safe-area-inset-top, 0px))', left: 20,
    fontSize: 12, fontWeight: 800, letterSpacing: '0.12em', color: 'var(--muted)',
  },
  hudTop: { position: 'relative', width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between' },
  hudStop: {
    background: 'transparent', border: '1px solid #1e3a5c', color: '#4d6a94',
    borderRadius: 8, fontSize: 13, padding: '4px 10px', cursor: 'pointer',
  },
  // Detener vive DENTRO de la pantalla de cámara: es la única salida del modo
  // kiosco. Anclado arriba a la derecha, espejo de la marca.
  hudDetener: {
    position: 'absolute', top: 'calc(12px + env(safe-area-inset-top, 0px))', right: 16,
    background: 'transparent', border: '1px solid var(--border)', color: 'var(--muted)',
    borderRadius: 8, fontSize: 13, padding: '6px 12px', cursor: 'pointer', fontFamily: 'inherit',
  },
  hudReloj: {
    position: 'relative', fontSize: 'clamp(28px, 9vw, 40px)', fontWeight: 800,
    letterSpacing: '-0.02em', fontVariantNumeric: 'tabular-nums',
    fontFamily: 'var(--f-data)', marginTop: 'clamp(4px, 1.5dvh, 14px)',
  },
  hudFecha: { position: 'relative', fontSize: 12, color: '#7f93b6', textTransform: 'capitalize' },
  ventanaTinte: {
    position: 'absolute', inset: 0, display: 'flex', alignItems: 'center',
    justifyContent: 'center', transition: 'background .3s',
  },
  tinteEmoji: { fontSize: 64 },
  tarjeta: {
    position: 'relative', marginTop: 14, textAlign: 'center', display: 'flex',
    flexDirection: 'column', alignItems: 'center', gap: 4, maxWidth: 300,
  },
  tarjTipo: { fontSize: 12, fontWeight: 800, letterSpacing: '0.16em' },
  tarjNombre: { fontSize: 22, fontWeight: 800, letterSpacing: '-0.01em', color: '#EAF7FF', textWrap: 'balance', lineHeight: 1.2 },
  tarjHora: { fontSize: 18, fontWeight: 700, fontVariantNumeric: 'tabular-nums', fontFamily: 'var(--f-data)' },
  tarjSub: { fontSize: 13, color: '#8fa5c8', lineHeight: 1.45 },
  tarjAviso: {
    marginTop: 6, fontSize: 12, color: '#FBBF24', border: '1px solid rgba(245,158,11,0.4)',
    background: 'rgba(245,158,11,0.12)', borderRadius: 10, padding: '7px 11px', lineHeight: 1.4,
  },
  hudPrivacidad: { position: 'relative', marginTop: 'auto', paddingTop: 12, textAlign: 'center', fontSize: 10, color: '#4d6a94' },
  hudVentana: {
    // Más grande que antes (era 64vw/250px): la cara se ve con claridad.
    // El tope de 43dvh en el ANCHO limita la altura (ancho × 6/5 ≈ 52dvh) sin
    // romper la proporción: en pantallas cortas encoge entera, no se deforma.
    position: 'relative', width: 'min(80vw, 310px, 43dvh)', aspectRatio: '5 / 6',
    borderRadius: 16, overflow: 'hidden',
    boxShadow: '0 0 0 1.5px var(--border), 0 0 34px rgba(110,150,184,0.25)',
  },
  video: { position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', transform: 'scaleX(-1)' },
  // El "carro" del láser ocupa TODA la ventana y se mueve con transform
  // (composición en GPU): animar top/bottom producía lag en el celular
  // porque compite por CPU con MediaPipe.
  laserGrupo: { position: 'absolute', inset: 0, pointerEvents: 'none', willChange: 'transform' },
  laserEstela: { position: 'absolute', left: 0, right: 0, bottom: 3, height: 90, background: 'linear-gradient(180deg, transparent, rgba(110,150,184,0.28))' },
  laserHaz: {
    position: 'absolute', left: '-4%', right: '-4%', bottom: 0, height: 3,
    background: 'linear-gradient(90deg, transparent, #6e96b8, #FFFFFF, #6e96b8, transparent)',
    boxShadow: '0 0 18px 4px rgba(110,150,184,0.55)',
  },
  guiaOval: {
    position: 'absolute', left: '50%', top: '50%', transform: 'translate(-50%,-50%)',
    width: '64%', aspectRatio: '3 / 4', borderRadius: '50%',
    border: '2px dashed rgba(255,255,255,0.65)', pointerEvents: 'none',
  },
  esquina: { position: 'absolute', width: 24, height: 24, border: '2.5px solid var(--accent)', pointerEvents: 'none' },
  hudBarra: {
    position: 'relative', width: 'min(64vw, 250px)', height: 5, borderRadius: 3,
    background: 'var(--grid)', marginTop: 16, overflow: 'hidden',
  },
  hudBarraRelleno: {
    position: 'absolute', top: 0, bottom: 0, left: 0, borderRadius: 3,
    background: 'linear-gradient(90deg, #6e96b8, #59c2ad)', transition: 'width .45s ease',
  },
  // Padding con safe-area y alto flexible: clase .kiosk-idle (globals.css).
  idle: { position: 'relative', display: 'flex', flexDirection: 'column', alignItems: 'center' },
  brand: { position: 'absolute', top: 'calc(18px + env(safe-area-inset-top, 0px))', left: 20, fontSize: 12, fontWeight: 800, letterSpacing: '0.1em', color: 'var(--muted)' },
  // clamp: escala con el ancho del teléfono (hh:mm:ss no cabe fijo en 64px).
  clock: { fontSize: 'clamp(38px, 13vw, 64px)', fontWeight: 800, letterSpacing: '-0.03em', fontVariantNumeric: 'tabular-nums', marginTop: 24, fontFamily: 'var(--f-data)' },
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
  pendNote: { marginTop: 10, fontSize: 12, color: 'var(--muted)', textAlign: 'center', maxWidth: 300 },
  // Configuración del dispositivo (clave + sede) y cola offline
  cfgBox: { marginTop: 20, display: 'flex', flexDirection: 'column', gap: 10, width: '100%', maxWidth: 300 },
  cfgTitle: { fontSize: 13, fontWeight: 700, textAlign: 'center', opacity: 0.85 },
  cfgInput: { padding: '12px 14px', fontSize: 15, borderRadius: 10, border: '1px solid rgba(255,255,255,0.25)', background: 'rgba(255,255,255,0.08)', color: 'inherit', fontFamily: 'inherit' },
  cfgHint: { fontSize: 12, lineHeight: 1.45, textAlign: 'center', opacity: 0.6, marginBottom: 2 },
  // El código se teclea de pie y a veces de lejos: grande, monoespaciado y
  // separado, para no confundir un 8 con un 0 ni perder la cuenta de dígitos.
  cfgCodigo: { fontSize: 26, letterSpacing: '0.18em', textAlign: 'center', fontFamily: 'var(--f-data)', fontWeight: 700 },
  cfgDetalle: { marginTop: 4, display: 'flex', flexDirection: 'column', gap: 10 },
  cfgResumen: { fontSize: 12, opacity: 0.6, cursor: 'pointer', textAlign: 'center', marginBottom: 6 },
  pendNote: { marginTop: 10, fontSize: 12, opacity: 0.8, textAlign: 'center' },
  count: { marginTop: 6, fontSize: 11, color: 'var(--muted)' },
};
