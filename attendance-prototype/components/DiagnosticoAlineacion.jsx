'use client';

/**
 * components/DiagnosticoAlineacion.jsx — ¿Se puede quitar face-api del kiosco?
 *
 * PANTALLA TEMPORAL, de medición. No es parte del producto.
 *
 * El kiosco carga tres modelos. Desde que todo el roster está re-registrado
 * con v2, el descriptor de face-api ya NO decide nada: se sigue cargando —6,5
 * MB de modelos y todo TensorFlow.js, lo más lento del arranque en una
 * tablet— nada más para sacar cinco coordenadas (ojos, nariz, comisuras) con
 * las que se alinea la cara antes de pasarla por ArcFace.
 *
 * MediaPipe ya entrega 478 puntos en cada cuadro, así que esas cinco se
 * pueden sacar de ahí y face-api sobraría. El riesgo es que los rostros
 * guardados se generaron con el alineamiento de face-api: si el de MediaPipe
 * cae en otro sitio, los descriptores nuevos dejarían de parecerse a los
 * guardados y el kiosco dejaría de reconocer a la gente.
 *
 * Esta pantalla lo mide en vez de suponerlo: sobre el MISMO cuadro saca los
 * dos alineamientos, calcula los dos descriptores y los compara. Si la
 * similitud entre ambos es muy alta, el cambio es seguro.
 */

import { useEffect, useRef, useState } from 'react';
import { cargarV2, descriptorV2, puntos5DeFaceApi, puntos5DeMediaPipe, similitudV2 } from '../lib/rostroV2.js';
import { V2_UMBRAL_SIM } from '../utils/faceMath.js';

const WASM_PATH = '/wasm';
const MEDIAPIPE_MODEL = '/models/face_landmarker.task';
const FACEAPI_MODEL_URL = '/models';

/** Distancia en píxeles entre dos puntos. */
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);

const NOMBRES = ['Ojo izq.', 'Ojo der.', 'Nariz', 'Boca izq.', 'Boca der.'];

export default function DiagnosticoAlineacion() {
  const videoRef = useRef(null);
  const [estado, setEstado] = useState('Preparando…');
  const [muestras, setMuestras] = useState([]);
  const [corriendo, setCorriendo] = useState(false);
  const refs = useRef({});

  useEffect(() => {
    (async () => {
      try {
        setEstado('Cargando modelos…');
        const vision = await import('@mediapipe/tasks-vision');
        const fileset = await vision.FilesetResolver.forVisionTasks(WASM_PATH);
        refs.current.lm = await vision.FaceLandmarker.createFromOptions(fileset, {
          baseOptions: { modelAssetPath: MEDIAPIPE_MODEL, delegate: 'CPU' },
          runningMode: 'VIDEO',
          numFaces: 1,
        });
        const faceapi = await import('@vladmandic/face-api');
        try { await faceapi.tf.ready(); } catch { await faceapi.tf.setBackend('cpu'); await faceapi.tf.ready(); }
        await Promise.all([
          faceapi.nets.tinyFaceDetector.loadFromUri(FACEAPI_MODEL_URL),
          faceapi.nets.faceLandmark68Net.loadFromUri(FACEAPI_MODEL_URL),
        ]);
        refs.current.faceapi = faceapi;
        await cargarV2();

        const stream = await navigator.mediaDevices.getUserMedia({
          video: { width: 1280, height: 720, facingMode: 'user' },
        });
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
        setEstado('Listo. Ponte de frente y pulsa Medir.');
      } catch (e) {
        setEstado(`No se pudo preparar: ${e?.message || e}`);
      }
    })();
    return () => {
      const s = videoRef.current?.srcObject;
      if (s) for (const t of s.getTracks()) t.stop();
    };
  }, []);

  /** Una medición: mismo cuadro, los dos alineamientos, los dos descriptores. */
  const medir = async () => {
    const { lm, faceapi } = refs.current;
    const video = videoRef.current;
    if (!lm || !faceapi || !video) return;
    setCorriendo(true);
    try {
      const res = lm.detectForVideo(video, performance.now());
      const puntos = res.faceLandmarks?.[0];
      if (!puntos) { setEstado('MediaPipe no vio una cara. Acércate.'); return; }

      const det = await faceapi
        .detectSingleFace(video, new faceapi.TinyFaceDetectorOptions({ inputSize: 416, scoreThreshold: 0.5 }))
        .withFaceLandmarks();
      if (!det) { setEstado('face-api no vio una cara en ese cuadro. Reintenta.'); return; }

      const p5fa = puntos5DeFaceApi(det.landmarks);
      const p5mp = puntos5DeMediaPipe(puntos, video.videoWidth, video.videoHeight);

      const [dFa, dMp] = await Promise.all([descriptorV2(video, p5fa), descriptorV2(video, p5mp)]);
      const sim = similitudV2(dFa, dMp);
      // El tamaño de la cara da la escala: 8 px de desvío en una cara de 100
      // px es mucho, y en una de 600 px es nada.
      const ojoAojo = dist(p5fa[0], p5fa[1]);
      const desvios = p5fa.map((p, i) => dist(p, p5mp[i]));

      setMuestras((m) => [{ sim, desvios, ojoAojo, t: Date.now() }, ...m].slice(0, 20));
      setEstado(`Medido. Similitud ${sim.toFixed(4)}`);
    } catch (e) {
      setEstado(`Falló la medición: ${e?.message || e}`);
    } finally {
      setCorriendo(false);
    }
  };

  const n = muestras.length;
  const prom = (f) => (n === 0 ? 0 : muestras.reduce((s, m) => s + f(m), 0) / n);
  const simProm = prom((m) => m.sim);
  const simMin = n === 0 ? 0 : Math.min(...muestras.map((m) => m.sim));
  // La conclusión, en los términos que importan: ¿un descriptor alineado con
  // MediaPipe seguiría reconociendo a alguien registrado con face-api?
  const veredicto = n < 5 ? null
    : simMin >= 0.90 ? { ok: true, txt: 'Se puede cambiar sin re-registrar a nadie.' }
      : simMin >= V2_UMBRAL_SIM ? { ok: null, txt: 'Reconocería, pero con menos margen del que hay hoy. Conviene re-registrar.' }
        : { ok: false, txt: 'NO se puede cambiar sin re-registrar a los 12: los descriptores no se parecen lo suficiente.' };

  return (
    <main style={S.page}>
      <h1 style={S.h1}>¿Se puede quitar face-api?</h1>
      <p style={S.bajada}>
        Sobre el mismo cuadro se alinea la cara de las dos formas y se comparan los
        descriptores que salen. Toma <b>al menos 8 medidas</b>, moviéndote un poco entre
        una y otra: de frente, de lado, más cerca, más lejos.
      </p>

      <video ref={videoRef} playsInline muted style={S.video} />

      <div style={S.barra}>
        <button onClick={medir} disabled={corriendo} style={S.btn}>
          {corriendo ? 'Midiendo…' : 'Medir'}
        </button>
        <button onClick={() => setMuestras([])} style={{ ...S.btn, ...S.btnGhost }}>Borrar</button>
        <span style={S.estado}>{estado}</span>
      </div>

      {n > 0 && (
        <section style={S.panel}>
          <div style={S.metricas}>
            <div><span style={S.mLbl}>Medidas</span><b style={S.mVal}>{n}</b></div>
            <div><span style={S.mLbl}>Similitud media</span><b style={S.mVal}>{simProm.toFixed(4)}</b></div>
            <div><span style={S.mLbl}>La peor</span><b style={{ ...S.mVal, color: simMin >= 0.9 ? '#15803d' : simMin >= V2_UMBRAL_SIM ? '#b45309' : '#b3403a' }}>{simMin.toFixed(4)}</b></div>
            <div><span style={S.mLbl}>Umbral para reconocer</span><b style={S.mVal}>{V2_UMBRAL_SIM}</b></div>
          </div>

          <div style={S.desvios}>
            <span style={S.mLbl}>Desvío de cada punto, como % de la distancia entre ojos</span>
            <div style={S.filaDesv}>
              {NOMBRES.map((nom, i) => (
                <div key={nom} style={S.desv}>
                  <span style={S.desvNom}>{nom}</span>
                  <b style={S.desvVal}>{(prom((m) => m.desvios[i] / m.ojoAojo) * 100).toFixed(1)}%</b>
                </div>
              ))}
            </div>
          </div>

          {veredicto && (
            <p style={{ ...S.veredicto, background: veredicto.ok === true ? '#e7f5ec' : veredicto.ok === false ? '#fbeaea' : '#f5efe2', color: veredicto.ok === true ? '#15803d' : veredicto.ok === false ? '#b3403a' : '#7a6432' }}>
              {veredicto.txt}
            </p>
          )}
          {n < 5 && <p style={S.nota}>Faltan {5 - n} medidas para dar un veredicto.</p>}
        </section>
      )}
    </main>
  );
}

const S = {
  page: { maxWidth: 760, margin: '0 auto', padding: '32px 20px 60px', fontFamily: 'system-ui, sans-serif', color: '#233240' },
  h1: { fontSize: 26, margin: '0 0 8px', letterSpacing: '-.02em' },
  bajada: { margin: '0 0 22px', color: '#46586a', fontSize: 15, lineHeight: 1.6 },
  video: { width: '100%', borderRadius: 14, background: '#0f172a', transform: 'scaleX(-1)' },
  barra: { display: 'flex', gap: 10, alignItems: 'center', margin: '14px 0 22px', flexWrap: 'wrap' },
  btn: { font: 'inherit', fontSize: 15, fontWeight: 700, padding: '10px 20px', borderRadius: 9, border: 'none', background: '#3a5570', color: '#fff', cursor: 'pointer' },
  btnGhost: { background: 'transparent', color: '#557d9e', border: '1px solid #d8e2ee' },
  estado: { fontSize: 13, color: '#7b8ca0' },
  panel: { border: '1px solid #d8e2ee', borderRadius: 14, padding: 20 },
  metricas: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: 14 },
  mLbl: { display: 'block', fontSize: 11, color: '#7b8ca0', textTransform: 'uppercase', letterSpacing: '.07em' },
  mVal: { fontSize: 22, fontVariantNumeric: 'tabular-nums' },
  desvios: { marginTop: 22, paddingTop: 18, borderTop: '1px solid #eef2f7' },
  filaDesv: { display: 'flex', gap: 16, marginTop: 8, flexWrap: 'wrap' },
  desv: { flex: '1 1 90px' },
  desvNom: { display: 'block', fontSize: 12, color: '#7b8ca0' },
  desvVal: { fontSize: 17, fontVariantNumeric: 'tabular-nums' },
  veredicto: { marginTop: 20, marginBottom: 0, padding: '12px 15px', borderRadius: 10, fontSize: 14, lineHeight: 1.55, fontWeight: 600 },
  nota: { marginTop: 14, marginBottom: 0, fontSize: 13, color: '#7b8ca0' },
};
