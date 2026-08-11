'use client';

/**
 * components/EmployeeRegister.jsx
 * Registro de empleados (solo administrador): POR FOTO, con nombre y cédula.
 *
 * Flujo: datos → foto (galería o cámara del teléfono) → análisis facial
 * automático → registrar. La foto NUNCA se guarda: solo el vector de 128
 * floats, que es lo que usa el kiosco para la identificación 1:N.
 *
 * Los pesos de face-api ya están en /public/models (los mismos del kiosco).
 */

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
// Roster y sedes desde POSTGRES vía API (mismas formas que los services locales).
import { syncPanel, listPeople, addPerson, removePerson, getSedes } from '../services/panelStore.js';

const FACEAPI_MODEL_URL = '/models';

/** Muestra la jornada esperada resultante: salida − entrada − almuerzo. */
function fmtExpected(entry, exit, breakMin) {
  if (!/^\d{2}:\d{2}$/.test(entry) || !/^\d{2}:\d{2}$/.test(exit)) return '—';
  const [eh, em] = entry.split(':').map(Number);
  const [xh, xm] = exit.split(':').map(Number);
  let mins = (xh * 60 + xm) - (eh * 60 + em);
  if (mins <= 0) mins += 24 * 60; // cruza medianoche
  mins -= Number(breakMin) || 0;
  if (mins <= 0) return '—';
  return `${(mins / 60).toFixed(1).replace('.', ',')} h`;
}

export default function EmployeeRegister() {
  const faceapiRef = useRef(null);
  const fileRef = useRef(null);

  const [ready, setReady] = useState(false);
  const [status, setStatus] = useState('Cargando el modelo facial…');
  // Identidad: se digita aquí. ArriveControl es un producto independiente y
  // esta es su fuente de verdad sobre quién trabaja en la empresa.
  const [nombre, setNombre] = useState('');
  const [cedula, setCedula] = useState('');
  // Horario OPCIONAL: vacío por defecto. Sin él, el sistema igual registra
  // por alternancia (entrada→salida) y calcula las horas reales.
  const [expectedEntry, setExpectedEntry] = useState('');
  const [expectedExit, setExpectedExit] = useState('');
  const [breakMinutes, setBreakMinutes] = useState('');
  // Opcional a propósito: dar de alta a alguien no debe exigir saber su sueldo.
  const [salarioMensual, setSalarioMensual] = useState('');
  const [sedes, setSedes] = useState([]);
  const [sede, setSede] = useState('');
  const [photo, setPhoto] = useState(null);      // { previewUrl, descriptor, dataUrl } | null
  const [analyzing, setAnalyzing] = useState(false);
  const [people, setPeople] = useState([]);
  const [toast, setToast] = useState(null);

  // Carga inicial desde la API: sedes + roster.
  const refresh = () => {
    syncPanel()
      .then(() => {
        const list = getSedes();
        setSedes(list);
        setSede((s) => s || list[0]?.name || '');
        setPeople(listPeople());
      })
      .catch((e) => setStatus(`No se pudo cargar desde el servidor: ${e.message}`));
  };
  useEffect(refresh, []);

  // Carga de face-api (solo las 3 redes necesarias).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const faceapi = await import('@vladmandic/face-api');
        // Esperar el backend de TensorFlow antes de cargar modelos (misma
        // carrera que en KioskMode: "backend 'wasm' has not yet been initialized").
        try { await faceapi.tf.ready(); } catch { await faceapi.tf.setBackend('cpu'); await faceapi.tf.ready(); }
        await Promise.all([
          faceapi.nets.tinyFaceDetector.loadFromUri(FACEAPI_MODEL_URL),
          faceapi.nets.faceLandmark68Net.loadFromUri(FACEAPI_MODEL_URL),
          faceapi.nets.faceRecognitionNet.loadFromUri(FACEAPI_MODEL_URL),
        ]);
        if (cancelled) return;
        faceapiRef.current = faceapi;
        setReady(true);
        setStatus('Completa los datos y sube la foto.');
      } catch (err) {
        setStatus(`No se pudo cargar el modelo: ${err?.message || err}`);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const showToast = (msg) => { setToast(msg); setTimeout(() => setToast(null), 2800); };

  // Analiza la foto apenas se selecciona: detecta el rostro y extrae el vector.
  const handlePhoto = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || !faceapiRef.current) return;

    setAnalyzing(true);
    setPhoto(null);
    setStatus('Analizando la foto…');
    try {
      const faceapi = faceapiRef.current;
      const img = await faceapi.bufferToImage(file);
      const det = await faceapi
        .detectSingleFace(img, new faceapi.TinyFaceDetectorOptions({ inputSize: 416, scoreThreshold: 0.5 }))
        .withFaceLandmarks()
        .withFaceDescriptor();

      if (!det) {
        setStatus('❌ Sin rostro claro. Usa una foto frontal y con buena luz.');
        setAnalyzing(false);
        return;
      }
      // La foto NO se guarda en ninguna parte: de ella solo sale el vector de
      // 128 floats. La previsualización vive en memoria del navegador y se
      // libera al terminar.
      setPhoto({ previewUrl: URL.createObjectURL(file), descriptor: Array.from(det.descriptor) });
      setStatus('✅ Rostro detectado.');
    } catch (err) {
      setStatus(`❌ Error procesando la foto: ${err?.message || err}`);
    } finally {
      setAnalyzing(false);
    }
  };

  // La cédula se guarda solo con dígitos: es la que cruza con los reportes de
  // horas, y «1.085.312» y «1085312» tienen que ser la misma persona.
  const cedulaLimpia = cedula.replace(/\D/g, '');
  const canRegister = ready && !analyzing && nombre.trim() && cedulaLimpia.length >= 5 && photo;

  const handleRegister = async () => {
    const result = await addPerson(nombre.trim(), photo.descriptor, {
      cedula: cedulaLimpia,
      sede, expectedEntry, expectedExit,
      breakMinutes: breakMinutes === '' ? null : Number(breakMinutes),
      // Vacío o 0 = sin salario registrado, no un sueldo de cero.
      salarioMensual: Number(salarioMensual) > 0 ? Number(salarioMensual) : null,
    });
    if (result.error) {
      setStatus(`❌ ${result.error}`);
      return;
    }
    showToast(`${result.name} registrado correctamente`);
    setNombre('');
    setCedula('');
    setSalarioMensual('');
    if (photo?.previewUrl) URL.revokeObjectURL(photo.previewUrl);
    setPhoto(null);
    setStatus('Registrado. Puedes agregar otro.');
    refresh();
  };

  const handleDelete = async (p) => {
    if (!confirm(`¿Eliminar a ${p.name}? Dejará de poder marcar.`)) return;
    try {
      await removePerson(p.id);
      refresh();
      showToast(`${p.name} eliminado`);
    } catch (e) {
      showToast(`No se pudo eliminar: ${e.message}`);
    }
  };

  return (
    <div className="reg-root">
      <style>{CSS}</style>

      <header className="app-header">
        <Link href="/admin" className="back">‹ Panel</Link>
        <div>
          <div className="brand">ArriveControl</div>
          <h1>Registrar empleado</h1>
        </div>
      </header>

      <p className="status" role="status">{status}</p>

      <section className="card">
        <div className="field">
          <label htmlFor="r-nombre">Nombre completo</label>
          <input
            id="r-nombre" type="text" placeholder="Ana María Gómez" value={nombre}
            onChange={(e) => setNombre(e.target.value)} autoComplete="off"
          />
        </div>

        <div className="field">
          <label htmlFor="r-cedula">Cédula</label>
          <input
            id="r-cedula" type="text" inputMode="numeric" placeholder="1085312" value={cedula}
            onChange={(e) => setCedula(e.target.value)} autoComplete="off"
          />
          <small className="field-hint">
            {cedulaLimpia.length > 0 && cedulaLimpia.length < 5
              ? 'Muy corta: deben ser al menos 5 dígitos.'
              : 'Es la que identifica a la persona en los reportes de horas. Los puntos se ignoran.'}
          </small>
        </div>

        <div className="field">
          <label htmlFor="r-sede">Sede asignada</label>
          <select id="r-sede" value={sede} onChange={(e) => setSede(e.target.value)}>
            {sedes.map((o) => (
              <option key={o.name} value={o.name}>{o.name}</option>
            ))}
          </select>
          <small className="field-hint">Solo podrá fichar dentro del radio de su sede.</small>
        </div>

        <div className="field">
          <label>Horario esperado <span className="opcional">opcional</span></label>
          <div className="hours-row">
            <label className="sub-field">Entrada
              <input type="time" value={expectedEntry} onChange={(e) => setExpectedEntry(e.target.value)} />
            </label>
            <label className="sub-field">Salida
              <input type="time" value={expectedExit} onChange={(e) => setExpectedExit(e.target.value)} />
            </label>
            <label className="sub-field">Almuerzo
              <input type="number" min="0" max="240" step="15" placeholder="min" value={breakMinutes}
                onChange={(e) => setBreakMinutes(e.target.value)} />
            </label>
          </div>
          <small className="field-hint">
            {expectedEntry && expectedExit ? (
              <><strong>{fmtExpected(expectedEntry, expectedExit, breakMinutes)}</strong> al día.</>
            ) : (
              <>Déjalo vacío si su horario varía.</>
            )}
          </small>
        </div>

        <div className="field">
          <label htmlFor="reg-salario">Salario mensual <span className="opcional">opcional</span></label>
          <input
            id="reg-salario" type="number" min="0" step="1000" inputMode="numeric"
            placeholder="Sin registrar"
            value={salarioMensual}
            onChange={(e) => setSalarioMensual(e.target.value)}
          />
          <small className="field-hint">Sirve para valorizar sus horas extra en pesos.</small>
        </div>

        <div className="field">
          <label>Foto del rostro</label>
          {/* En el celular, este input ofrece cámara o galería. */}
          <input ref={fileRef} type="file" accept="image/*" hidden onChange={handlePhoto} />
          {!photo ? (
            <button className="photo-drop" onClick={() => fileRef.current?.click()} disabled={!ready || analyzing}>
              {analyzing ? '⏳ Analizando…' : <>📷<br /><b>Tomar o subir foto</b><br /><small>Frontal, tipo carnet</small></>}
            </button>
          ) : (
            <div className="preview">
              {/* Vista previa local; la imagen NO se guarda en el sistema */}
              <img src={photo.previewUrl} alt={`Foto de ${nombre.trim() || 'empleado'}`} />
              <div className="preview-info">
                <span className="okmark">✅ Rostro detectado</span>
                <small>Se guarda el código facial, no la imagen.</small>
                <button className="btn" onClick={() => { URL.revokeObjectURL(photo.previewUrl); setPhoto(null); fileRef.current?.click(); }}>
                  Cambiar foto
                </button>
              </div>
            </div>
          )}
        </div>

        <button className="btn primary big" disabled={!canRegister} onClick={handleRegister}>
          🪪 Registrar empleado
        </button>
      </section>

      <section className="card grow">
        <h2>Empleados registrados <span className="count">{people.length}</span></h2>
        <div className="scrollable">
          {people.length === 0 && <p className="empty">Aún no hay empleados.</p>}
          {people.map((p) => (
            <div className="prow" key={p.id}>
              <span className="avatar">{p.name.split(' ').map((w) => w[0]).slice(0, 2).join('').toUpperCase()}</span>
              <span className="pinfo">
                <b>{p.name}</b>
                <small>{p.cedula ? `C.C. ${p.cedula}` : 'Sin cédula'} · {p.sede || 'sin sede'} · {p.expectedEntry && p.expectedExit ? `${p.expectedEntry}–${p.expectedExit}` : 'horario libre'}</small>
              </span>
              <button className="del" title={`Eliminar a ${p.name}`} onClick={() => handleDelete(p)}>🗑</button>
            </div>
          ))}
        </div>
      </section>

      {toast && <div className="toast" role="status">{toast}</div>}
    </div>
  );
}

const CSS = `
/* Tokens (color, tipografía, elevación) viven en app/globals.css — el sistema
   de diseño es único para toda la app. Aquí solo el layout de la pantalla. */
.reg-root {
  font-family: var(--f-body);
  font-weight: 300;
  color: var(--ink); background: var(--page);
  min-height: 100dvh; max-width: 560px; margin: 0 auto;
  display: flex; flex-direction: column; gap: 10px;
  padding: 14px 12px 16px; box-sizing: border-box;
}
.reg-root * { box-sizing: border-box; margin: 0; }

.app-header { display: flex; align-items: center; gap: 12px; }
.app-header .back { color: var(--muted); text-decoration: none; font-size: 15px; padding: 4px 8px; border-radius: 8px; }
.app-header .back:hover { background: var(--accent-soft); }
.app-header .brand { font-size: 12px; letter-spacing: .08em; text-transform: uppercase; color: var(--accent); font-weight: 700; }
.app-header h1 { font-size: 19px; font-weight: 650; }

.status { font-size: 13.5px; color: var(--ink-2); min-height: 20px; }

.card { background: var(--surface); border: 1px solid var(--border); border-radius: 12px; padding: 14px; }
.card.grow { flex: 1 1 auto; min-height: 0; display: flex; flex-direction: column; }
.card h2 { font-size: 15px; font-weight: 650; margin-bottom: 8px; }
.card h2 .count { color: var(--muted); font-weight: 400; }
.scrollable { overflow-y: auto; flex: 1 1 auto; min-height: 0; }
.empty { color: var(--muted); font-size: 14px; padding: 8px 0; }

.field { display: flex; flex-direction: column; gap: 4px; margin-bottom: 12px; }
.field label { font-size: 13px; font-weight: 600; color: var(--ink-2); }
.field input[type="text"], .field input[type="time"], .field select { font: inherit; font-size: 15px; padding: 10px 12px; border-radius: 8px; border: 1px solid var(--border); background: var(--page); color: var(--ink); }
.field-hint { color: var(--muted); font-size: 12px; }
.opcional { font-weight: 400; font-size: 11px; color: var(--muted); text-transform: uppercase; letter-spacing: .06em; margin-left: 6px; }
.hours-row { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 8px; }
.sub-field { display: flex; flex-direction: column; gap: 3px; font-size: 12px; font-weight: 600; color: var(--muted); }
.sub-field input { font: inherit; font-size: 15px; font-weight: 400; color: var(--ink); padding: 9px 10px; border-radius: var(--r-sm); border: 1px solid var(--border); background: var(--page); }
.field input:focus-visible, .btn:focus-visible, .photo-drop:focus-visible, .del:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }

.search-results { display: flex; flex-direction: column; border: 1px solid var(--border); border-radius: 8px; overflow: hidden; margin-top: 2px; }
.search-item { font: inherit; text-align: left; display: flex; flex-direction: column; gap: 2px; padding: 9px 12px; border: none; border-top: 1px solid var(--grid); background: var(--page); color: var(--ink); cursor: pointer; }
.search-item:first-child { border-top: 0; }
.search-item:hover:not(:disabled) { background: var(--accent-soft); }
.search-item:disabled { opacity: .5; cursor: not-allowed; }
.search-item small { color: var(--muted); font-size: 12px; }
.selected-colab { display: flex; align-items: center; gap: 10px; padding: 10px 12px; border: 1px solid var(--good-text); border-radius: 8px; background: var(--page); }
.consent { display: flex; gap: 8px; align-items: flex-start; margin-top: 10px; font-size: 12.5px; color: var(--ink-2); font-weight: 400; cursor: pointer; }
.consent input { margin-top: 2px; }

.photo-drop { font: inherit; width: 100%; padding: 22px 12px; border: 2px dashed var(--border); border-radius: 12px; background: var(--page); color: var(--ink-2); font-size: 22px; cursor: pointer; line-height: 1.5; }
.photo-drop b { font-size: 15px; color: var(--ink); }
.photo-drop small { font-size: 12.5px; color: var(--muted); }
.photo-drop:hover:not(:disabled) { border-color: var(--accent); background: var(--accent-soft); }
.photo-drop:disabled { opacity: .6; cursor: wait; }

.preview { display: flex; gap: 12px; align-items: center; }
.preview img { width: 96px; height: 96px; object-fit: cover; border-radius: 12px; border: 2px solid var(--good-text); }
.preview-info { display: flex; flex-direction: column; gap: 6px; align-items: flex-start; }
.preview-info .okmark { font-weight: 600; color: var(--good-text); font-size: 14px; }
.preview-info small { color: var(--muted); font-size: 12px; }

.btn { border: 1px solid var(--border); background: var(--surface); color: var(--ink); font: inherit; font-size: 13.5px; padding: 7px 14px; border-radius: 8px; cursor: pointer; }
.btn:hover { background: var(--accent-soft); }
.btn.primary { background: linear-gradient(135deg, var(--accent), var(--accent-2)); border-color: transparent; color: var(--accent-ink); font-weight: 600; }
.btn.primary:disabled { opacity: .45; cursor: not-allowed; }
.btn.big { width: 100%; padding: 13px; font-size: 15px; border-radius: 10px; }

.prow { display: flex; align-items: center; gap: 12px; padding: 10px 2px; border-top: 1px solid var(--grid); }
.prow:first-child { border-top: 0; }
.avatar { width: 40px; height: 40px; border-radius: 50%; background: var(--accent-soft); color: var(--accent); font-weight: 700; font-size: 14px; display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
.pinfo { display: flex; flex-direction: column; flex: 1; }
.pinfo small { color: var(--muted); font-size: 12px; }
.del { border: none; background: transparent; cursor: pointer; font-size: 16px; color: var(--muted); padding: 6px; border-radius: 8px; }
.del:hover { background: var(--crit-soft); }

.toast { position: fixed; left: 50%; bottom: 20px; transform: translateX(-50%); background: var(--ink); color: var(--page); font-size: 14px; padding: 9px 18px; border-radius: 999px; z-index: 60; }
`;
