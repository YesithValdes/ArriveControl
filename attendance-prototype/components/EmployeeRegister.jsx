'use client';

/**
 * components/EmployeeRegister.jsx
 * Registro de empleados (solo administrador): POR FOTO, con nombre y cédula.
 *
 * Flujo: datos → foto (galería o cámara del teléfono) → análisis facial
 * automático → registrar. La foto NUNCA se guarda: solo el vector de 128
 * floats, que es lo que usa el kiosco para la identificación 1:N.
 *
 * El formulario vive en RegistroEmpleadoForm (con sus propios estilos) para
 * poder abrirse también dentro del panel, en un cajón, sin cambiar de página.
 * Los pesos de face-api ya están en /public/models (los mismos del kiosco).
 */

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
// Roster y sedes desde POSTGRES vía API (mismas formas que los services locales).
import {
  syncPanel, listPeople, addPerson, removePerson, getSedes, getHorarios,
  resumenDias, horasSemanaDias,
} from '../services/panelStore.js';
import { SALARIO_MINIMO } from '../lib/jornada.js';

const FACEAPI_MODEL_URL = '/models';
/** Cuántas fotos se recomiendan y cuántas se admiten como máximo. */
const FOTOS_RECOMENDADAS = 3;
const MAX_FOTOS = 5;
/**
 * Lado mínimo del rostro detectado, EN PÍXELES. El reconocedor recorta la
 * cara y la lleva a 150×150: por debajo de ~90 px el recorte se estira y el
 * descriptor sale pobre, que es lo que acerca perfiles de personas distintas.
 * Entre 90 y 150 sirve pero va justo, así que se avisa sin bloquear.
 */
const MIN_ROSTRO_PX = 90;
const ROSTRO_COMODO = 150;

/**
 * Busca la cara probando de menos a más esfuerzo.
 *
 * Con un solo intento a 416 px se rechazaban fotos perfectamente buenas: el
 * detector redimensiona la imagen a un cuadrado, así que una foto vertical de
 * celular queda aplastada y una cara nítida puede no alcanzar el umbral de
 * confianza. Subir la resolución de análisis y aflojar el umbral recupera esos
 * casos; el descriptor sale del mismo recorte, así que no se pierde calidad.
 */
async function detectarRostro(faceapi, img, nombre = '') {
  const intentos = [
    { inputSize: 416, scoreThreshold: 0.5 },
    { inputSize: 608, scoreThreshold: 0.4 }, // fotos verticales o con la cara descentrada
    { inputSize: 800, scoreThreshold: 0.3 }, // último recurso: caras pequeñas o de perfil suave
  ];
  console.log(`[Foto] ${nombre}: imagen ${img.width}×${img.height}`);
  for (const opciones of intentos) {
    const det = await faceapi
      .detectSingleFace(img, new faceapi.TinyFaceDetectorOptions(opciones))
      .withFaceLandmarks()
      .withFaceDescriptor();
    if (det) {
      const b = det.detection.box;
      console.log(`[Foto] ${nombre}: CARA a ${opciones.inputSize}px — ${Math.round(b.width)}×${Math.round(b.height)} px, confianza ${det.detection.score.toFixed(2)}`);
      return det;
    }
    console.log(`[Foto] ${nombre}: sin cara a ${opciones.inputSize}px (umbral ${opciones.scoreThreshold})`);
  }
  return null;
}

/**
 * Formulario de registro, embebible (página propia o cajón del panel).
 * Carga face-api al montarse; llama a alRegistrar(nombre) tras cada alta.
 */
export function RegistroEmpleadoForm({ alRegistrar, irAHorarios = () => { window.location.assign('/admin/horarios'); } }) {
  const faceapiRef = useRef(null);
  const fileRef = useRef(null);

  const [ready, setReady] = useState(false);
  const [status, setStatus] = useState('Cargando el modelo facial…');
  // Identidad: se digita aquí. Este sistema es un producto independiente y
  // esta es su fuente de verdad sobre quién trabaja en la empresa.
  const [nombre, setNombre] = useState('');
  const [cedula, setCedula] = useState('');
  // Correo OPCIONAL: a dónde llega el comprobante de cada marcación.
  const [correo, setCorreo] = useState('');
  // Jornada POR DÍAS: la copia del horario elegido (cada día con su franja,
  // o libre). Se copia tal cual a la ficha del empleado al registrarlo.
  const [jornadaDias, setJornadaDias] = useState(null);
  // Opcional a propósito: dar de alta a alguien no debe exigir saber su sueldo.
  const [salarioMensual, setSalarioMensual] = useState(String(SALARIO_MINIMO));
  // Sede OPCIONAL y solo organizativa (dónde trabaja, para reportes). El
  // checkbox aparte decide si ADEMÁS se le exige marcar en esa sede.
  // Arrancan con lo que ya haya en memoria (dentro del panel el store viene
  // cargado): el formulario se pinta completo de una, y la red solo refresca.
  const [sedes, setSedes] = useState(() => getSedes());
  const [sede, setSede] = useState('');
  // Limitar: con sede, solo puede marcar en ella. Validar: sin sede, se
  // registra la ubicación GPS de cada marcación.
  const [validarSede, setValidarSede] = useState(false);
  const [validarUbicacion, setValidarUbicacion] = useState(false);
  // Horarios con nombre: elegir uno copia su franja a los campos de abajo.
  const [horarios, setHorarios] = useState(() => getHorarios());
  const [horarioId, setHorarioId] = useState('');
  const [datosCargados, setDatosCargados] = useState(false);
  // Varias fotos por persona: [{ previewUrl, descriptor }]. Tres es el punto
  // dulce — cubren luz de mañana, de tarde y con/sin gafas sin fastidiar a
  // quien registra.
  const [fotos, setFotos] = useState([]);
  const [analyzing, setAnalyzing] = useState(false);

  // Sedes y horarios desde la API (el roster lo maneja quien embebe el form).
  useEffect(() => {
    syncPanel()
      .then(() => {
        setSedes(getSedes());
        setHorarios(getHorarios());
        setDatosCargados(true);
      })
      .catch((e) => setStatus(`No se pudo cargar desde el servidor: ${e.message}`));
  }, []);

  // Asignar un horario COPIA su mapa de días; luego es editable desde la
  // ficha del panel por si esta persona necesita una variación puntual.
  const aplicarHorario = (id) => {
    setHorarioId(id);
    const h = getHorarios().find((x) => x.id === id);
    setJornadaDias(h ? JSON.parse(JSON.stringify(h.dias)) : null);
  };

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
        setStatus('');
      } catch (err) {
        setStatus(`No se pudo cargar el modelo: ${err?.message || err}`);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // Analiza la foto apenas se selecciona: detecta el rostro y extrae el vector.
  // Se admiten VARIAS: con una sola, el perfil hereda los defectos de esa foto
  // (una luz rasante, medio perfil) y queda corrido, cerca del de otra persona.
  const handlePhoto = async (e) => {
    const files = [...(e.target.files ?? [])];
    e.target.value = '';
    if (files.length === 0 || !faceapiRef.current) return;

    setAnalyzing(true);
    setStatus(files.length > 1 ? `Analizando ${files.length} fotos…` : 'Analizando la foto…');
    const nuevas = [];
    const sinRostro = [];
    const avisos = [];
    try {
      const faceapi = faceapiRef.current;
      for (const file of files) {
        if (fotos.length + nuevas.length >= MAX_FOTOS) break;
        let img;
        try {
          img = await faceapi.bufferToImage(file);
        } catch {
          // Formatos que el navegador no decodifica (HEIC de iPhone, sobre
          // todo): antes reventaban el lote entero con un error genérico.
          sinRostro.push(`${file.name} (el navegador no pudo abrir esta imagen; conviértela a JPG)`);
          continue;
        }
        const det = await detectarRostro(faceapi, img, file.name);
        if (!det) { sinRostro.push(`${file.name} (no se encontró una cara en ${img.width}×${img.height})`); continue; }
        // Un recorte de rostro pequeño da un descriptor pobre: es la causa
        // medida de que perfiles de personas distintas queden vecinos. Se
        // mide en PÍXELES porque es lo que ve el modelo: una cara puede
        // ocupar media foto y aun así tener pocos píxeles si la imagen es
        // de baja resolución.
        const ladoCara = Math.round(Math.min(det.detection.box.width, det.detection.box.height));
        if (ladoCara < MIN_ROSTRO_PX) {
          sinRostro.push(`${file.name} (la cara tiene ${ladoCara} px y hacen falta ${MIN_ROSTRO_PX}: acércate o usa una foto de más resolución)`);
          continue;
        }
        if (ladoCara < ROSTRO_COMODO) avisos.push(`${file.name}: la cara mide ${ladoCara} px, va justa`);
        // La foto NO se guarda en ninguna parte: de ella solo sale el vector de
        // 128 floats. La previsualización vive en memoria del navegador y se
        // libera al terminar.
        nuevas.push({ previewUrl: URL.createObjectURL(file), descriptor: Array.from(det.descriptor) });
      }
      setFotos((prev) => [...prev, ...nuevas]);
      setStatus(sinRostro.length > 0
        ? `❌ No se pudo usar ${sinRostro.length === 1 ? 'esta foto' : 'estas fotos'} — ${sinRostro.join(' · ')}`
        : avisos.length > 0 ? `⚠️ ${avisos.join(' · ')}. Sirve, pero más cerca reconoce mejor.` : '');
    } catch (err) {
      setStatus(`❌ Error procesando la foto: ${err?.message || err}`);
    } finally {
      setAnalyzing(false);
    }
  };

  const quitarFoto = (i) => setFotos((prev) => {
    if (prev[i]?.previewUrl) URL.revokeObjectURL(prev[i].previewUrl);
    return prev.filter((_, k) => k !== i);
  });

  // La cédula se guarda solo con dígitos: es la que cruza con los reportes de
  // horas, y «1.085.312» y «1085312» tienen que ser la misma persona.
  const cedulaLimpia = cedula.replace(/\D/g, '');
  // El horario es OBLIGATORIO: la franja del empleado sale de la plantilla.
  const canRegister = ready && !analyzing && nombre.trim() && cedulaLimpia.length >= 5 && horarioId && fotos.length > 0;

  // Checklist de lo que falta, para que el botón deshabilitado no sea un misterio.
  const faltan = [
    !nombre.trim() && 'nombre',
    cedulaLimpia.length < 5 && 'cédula (mín. 5 dígitos)',
    !horarioId && 'horario',
    fotos.length === 0 && 'foto',
  ].filter(Boolean);

  const handleRegister = async () => {
    const result = await addPerson(nombre.trim(), fotos[0].descriptor, {
      descriptores: fotos.map((f) => f.descriptor),
      cedula: cedulaLimpia,
      correo: correo.trim().toLowerCase() || null,
      sede, validarSede, validarUbicacion, jornadaDias,
      // Vacío o 0 = sin salario registrado, no un sueldo de cero.
      salarioMensual: Number(salarioMensual) > 0 ? Number(salarioMensual) : null,
    });
    if (result.error) {
      setStatus(`❌ ${result.error}`);
      return;
    }
    setNombre('');
    setCedula('');
    setCorreo('');
    setSalarioMensual('');
    fotos.forEach((f) => f.previewUrl && URL.revokeObjectURL(f.previewUrl));
    setFotos([]);
    setStatus('✅ Registrado. Puedes agregar otro.');
    alRegistrar?.(result.name);
  };

  // El salario se teclea con separadores de miles: seis ceros seguidos se
  // cuentan con el dedo. Lo que viaja a la API son solo los dígitos.
  const salarioNum = Number(String(salarioMensual).replace(/\D/g, '')) || 0;
  const horasSemana = jornadaDias ? horasSemanaDias(jornadaDias) : null;

  return (
    <div className="regf">
      <style>{FORM_CSS}</style>

      <section className="regf-sec">
        <div className="regf-fila dos">
          <div className="regf-campo">
            <label htmlFor="rf-nombre">Nombre completo</label>
            <input
              id="rf-nombre" type="text" placeholder="Ana María Gómez" value={nombre}
              onChange={(e) => setNombre(e.target.value)} autoComplete="off"
            />
          </div>
          <div className="regf-campo">
            <label htmlFor="rf-cedula">Cédula</label>
            <input
              id="rf-cedula" className="num" type="text" inputMode="numeric" placeholder="1085312" value={cedula}
              onChange={(e) => setCedula(e.target.value)} autoComplete="off"
            />
          </div>
        </div>
        {cedulaLimpia.length > 0 && cedulaLimpia.length < 5 && (
          <small className="regf-err">La cédula debe tener al menos 5 dígitos.</small>
        )}
        <div className="regf-campo">
          <label htmlFor="rf-correo">Correo (opcional)</label>
          <input
            id="rf-correo" type="email" placeholder="ana@correo.com" value={correo}
            onChange={(e) => setCorreo(e.target.value)} autoComplete="off"
          />
          <small className="regf-hint">Si lo pones, recibirá el comprobante de cada entrada y salida.</small>
        </div>
      </section>

      <section className="regf-sec">
        <div className="regf-fila dos">
          <div className="regf-campo">
            <label htmlFor="rf-sede">Sede</label>
            <select
              id="rf-sede" value={sede}
              onChange={(e) => setSede(e.target.value)}
            >
              <option value="">Sin sede</option>
              {sedes.map((o) => (
                <option key={o.name} value={o.name}>{o.name}</option>
              ))}
            </select>
          </div>
          {/* Dos preguntas apiladas junto al select de sede, cada una con su
              signo de pregunta y explicación al pasar el mouse. */}
          <div className="regf-valida-grupo">
            <div className="regf-valida">
              <label htmlFor="rf-valida">
                ¿Validar ubicación?
                <input
                  id="rf-valida" type="checkbox" checked={validarUbicacion}
                  onChange={(e) => setValidarUbicacion(e.target.checked)}
                />
              </label>
              <span className="regf-q" tabIndex={0}>
                ?
                <span className="regf-tip">
                  Guarda la ubicación GPS desde donde se hace cada marcación,
                  para saber dónde estaba la persona al marcar. Aplica con o
                  sin sede.
                </span>
              </span>
            </div>
            <div className="regf-valida">
              <label htmlFor="rf-limita">
                ¿Limitar ubicación?
                <input
                  id="rf-limita" type="checkbox" checked={validarSede}
                  onChange={(e) => setValidarSede(e.target.checked)}
                />
              </label>
              <span className="regf-q" tabIndex={0}>
                ?
                <span className="regf-tip">
                  Solo puede marcar dentro del radio de su sede asignada (usa el
                  GPS para comprobarlo, sin guardar el punto). Necesita tener
                  sede; sin sede no tiene efecto.
                </span>
              </span>
            </div>
          </div>
        </div>

        <div className="regf-campo">
          <label htmlFor="rf-horario">Horario</label>
          {/* El select se pinta SIEMPRE de una: mientras carga muestra su
              opción vacía, y solo si la carga confirma que no hay horarios
              aparece el botón de ir a crearlos. Así el formulario no salta. */}
          {horarios.length === 0 && datosCargados ? (
            <button className="regf-btn regf-ir-horarios" onClick={() => irAHorarios()}>
              No hay horarios aún — crear uno →
            </button>
          ) : (
            <>
              <select
                id="rf-horario" value={horarioId} disabled={horarios.length === 0}
                onChange={(e) => aplicarHorario(e.target.value)}
              >
                <option value="">{horarios.length === 0 ? 'Cargando horarios…' : '— Elegir horario —'}</option>
                {horarios.map((h) => (
                  <option key={h.id} value={h.id}>{h.nombre} ({resumenDias(h.dias)})</option>
                ))}
              </select>
              <button type="button" className="regf-link" onClick={() => irAHorarios()}>
                + Crear un horario nuevo
              </button>
            </>
          )}
        </div>
      </section>

      <section className="regf-sec">
        <div className="regf-campo con-prefijo salario">
          <label htmlFor="rf-salario">Salario mensual <span className="regf-op">opcional</span></label>
          <input
            id="rf-salario" className="num" type="text" inputMode="numeric" placeholder="Sin registrar"
            value={salarioNum > 0 ? salarioNum.toLocaleString('es-CO') : ''}
            onChange={(e) => setSalarioMensual(e.target.value.replace(/\D/g, ''))}
          />
          <span className="prefijo">$</span>
        </div>
        <small className="regf-hint">Sin salario, sus horas se cuentan pero no se valorizan.</small>
      </section>

      <section className="regf-sec">
        <input ref={fileRef} type="file" accept="image/*" multiple hidden onChange={handlePhoto} />
        {fotos.length === 0 ? (
          <button className="regf-drop" onClick={() => fileRef.current?.click()} disabled={!ready || analyzing}>
            <span className="regf-drop-ico">{analyzing ? '⏳' : '📷'}</span>
            <span>
              <b>{analyzing ? 'Analizando…' : ready ? `Tomar o subir ${FOTOS_RECOMENDADAS} fotos` : 'Cargando modelo facial…'}</b>
              <small>Frontales, con la cara grande y buena luz. Las imágenes no se guardan.</small>
            </span>
          </button>
        ) : (
          <>
            {/* Vista previa local; las imágenes NO se guardan en el sistema */}
            <div className="regf-fotos">
              {fotos.map((f, i) => (
                <div className="regf-foto" key={f.previewUrl}>
                  <img src={f.previewUrl} alt={`Foto ${i + 1} de ${nombre.trim() || 'empleado'}`} />
                  <button className="regf-foto-x" onClick={() => quitarFoto(i)} title="Quitar esta foto">×</button>
                </div>
              ))}
              {fotos.length < MAX_FOTOS && (
                <button className="regf-foto-mas" onClick={() => fileRef.current?.click()} disabled={!ready || analyzing}>
                  {analyzing ? '⏳' : '＋'}
                  <small>Otra foto</small>
                </button>
              )}
            </div>
            <small className={fotos.length < FOTOS_RECOMENDADAS ? 'regf-err' : 'regf-hint'}>
              {fotos.length < FOTOS_RECOMENDADAS
                ? `${fotos.length} de ${FOTOS_RECOMENDADAS}. Con una sola foto el kiosco puede confundirlo con otra persona: agrega otra con distinta luz, y una con gafas o gorra si las usa a diario.`
                : `${fotos.length} rostros. Cuantas más condiciones distintas, mejor lo reconocerá.`}
            </small>
          </>
        )}
      </section>

      <div className="regf-pie">
        {/* Resumen estructurado de lo elegido, al final de todo. */}
        {horarioId && (
          <div className="regf-resumen-final">
            <div><span>Horario</span><b>{horarios.find((h) => h.id === horarioId)?.nombre}</b></div>
            <div><span>Días</span><b>{jornadaDias ? resumenDias(jornadaDias) : '—'}</b></div>
            <div><span>Jornada</span><b>{horasSemana != null ? `${horasSemana.toFixed(1).replace('.', ',')} h por semana` : '—'}</b></div>
            <div><span>Sede</span><b>{sede || 'Sin sede'}</b></div>
            <div>
              <span>Ubicación</span>
              <b>
                {[
                  sede && validarSede ? 'Limitada a su sede' : 'Libre: cualquier lugar',
                  validarUbicacion ? 'se registra el GPS' : 'sin registro de GPS',
                ].join(', ')}
              </b>
            </div>
          </div>
        )}
        <button className="regf-btn regf-primary" disabled={!canRegister} onClick={handleRegister}>
          Registrar empleado
        </button>
        {!canRegister && faltan.length > 0 && ready && !analyzing && (
          <p className="regf-falta">Falta: {faltan.join(', ')}.</p>
        )}
        {/* Estado (cargando modelo, analizando, errores) al FINAL: arriba
            empujaba todo el formulario al aparecer y desaparecer. */}
        {status && <p className="regf-status" role="status">{status}</p>}
      </div>
    </div>
  );
}

/* Estilos del formulario, con el MISMO lenguaje que la ficha de editar del
   panel: secciones agrupadas, unidades dentro del campo y lo derivado como
   cifra. Usa los tokens globales, así que sirve igual en /admin/registro que
   dentro del cajón. */
const FORM_CSS = `
.regf { display: flex; flex-direction: column; }
.regf * { box-sizing: border-box; margin: 0; }
/* Nada puede desbordar a lo ancho: el cajón mide 420 px y un input[type=time]
   no se encoge por su cuenta bajo el ancho de su contenido. */
.regf input, .regf select { min-width: 0; max-width: 100%; }

.regf-status { font-size: 13px; color: var(--ink-2); background: var(--accent-soft); border-radius: var(--r-sm); padding: 8px 12px; margin-top: 10px; }
.regf-op { font-weight: 400; font-size: 11px; color: var(--muted); letter-spacing: .04em; }
.regf-ir-horarios { text-align: left; color: var(--accent); font-weight: 600; }

/* Las dos preguntas de ubicación: compactas y centradas (vertical y
   horizontalmente) frente al select de sede. */
.regf-valida-grupo {
  display: flex; flex-direction: column; gap: 7px;
  justify-content: center; align-items: center; height: 100%;
  /* Compensa la etiqueta «Sede» de la columna vecina: sin esto el par se
     centra contra la columna completa y queda más arriba que el select. */
  padding-top: 21px;
}
.regf-valida { display: flex; align-items: center; gap: 6px; }

/* El salario no necesita todo el ancho del cajón: con nueve dígitos basta. */
.regf-campo.salario { max-width: 210px; }
.regf-valida label {
  display: flex; align-items: center; gap: 7px;
  font-size: 12px; font-weight: 600; color: var(--ink-2); cursor: pointer;
  white-space: nowrap;
}
.regf-valida input { width: 15px; height: 15px; accent-color: var(--accent); cursor: pointer; flex: 0 0 auto; }
.regf-valida.off label { color: var(--muted); cursor: not-allowed; }

/* Signo de pregunta con su explicación al pasar el mouse (o al enfocarlo). */
.regf-q {
  position: relative; flex: 0 0 auto;
  width: 16px; height: 16px; border-radius: 50%;
  display: inline-grid; place-items: center;
  background: var(--accent-soft); color: var(--accent);
  font-size: 11px; font-weight: 700; cursor: help;
}
.regf-q .regf-tip {
  display: none; position: absolute; bottom: calc(100% + 8px); right: -8px; z-index: 30;
  width: 230px; padding: 9px 11px;
  background: var(--btn-primary); color: #fff; border-radius: 8px;
  font-size: 12px; font-weight: 400; line-height: 1.4; text-align: left;
  box-shadow: 0 8px 24px rgba(16,24,40,.25);
}
.regf-q .regf-tip::after {
  content: ""; position: absolute; top: 100%; right: 12px;
  border: 6px solid transparent; border-top-color: var(--btn-primary);
}
.regf-q:hover .regf-tip, .regf-q:focus-visible .regf-tip { display: block; }

/* Hipervínculo bajo el selector de horario. */
.regf-link {
  align-self: flex-start; margin-top: 5px; padding: 0; border: 0; background: none;
  font: inherit; font-size: 12.5px; font-weight: 600; color: var(--accent); cursor: pointer;
}
.regf-link:hover { text-decoration: underline; }

/* Resumen final estructurado: filas etiqueta → valor. */
.regf-resumen-final {
  display: flex; flex-direction: column; gap: 0;
  background: var(--page); border: 1px solid var(--grid); border-radius: 10px;
  padding: 4px 14px; margin-bottom: 12px;
}
.regf-resumen-final > div {
  display: flex; justify-content: space-between; align-items: baseline; gap: 12px;
  padding: 7px 0; border-bottom: 1px dashed var(--grid); font-size: 12.5px;
}
.regf-resumen-final > div:last-child { border-bottom: none; }
.regf-resumen-final span { color: var(--muted); font-size: 10.5px; letter-spacing: .06em; text-transform: uppercase; font-weight: 650; flex: 0 0 auto; }
.regf-resumen-final b { font-weight: 600; color: var(--ink); text-align: right; min-width: 0; }

.regf-sec { padding: 15px 0; border-top: 1px solid var(--grid); }
.regf-sec:first-of-type { border-top: 0; padding-top: 0; }
.regf-sec > h4 {
  font-size: 10.5px; letter-spacing: .1em; text-transform: uppercase;
  color: var(--muted); font-weight: 650; margin-bottom: 11px;
}

.regf-fila { display: grid; gap: 10px; margin-bottom: 10px; }
.regf-fila:last-child { margin-bottom: 0; }
/* Columnas IGUALES: nombre/cédula y sede/checkbox comparten proporción para
   que ningún control se vea desproporcionado. */
.regf-fila.dos { grid-template-columns: repeat(2, minmax(0, 1fr)); }
.regf-fila.tres { grid-template-columns: 1fr 1fr .8fr; }

.regf-campo { display: flex; flex-direction: column; gap: 5px; min-width: 0; }
.regf-campo > label { font-size: 12px; font-weight: 600; color: var(--ink-2); }
.regf-campo input, .regf-campo select {
  font: inherit; font-size: 14.5px; width: 100%;
  padding: 10px 12px; border-radius: 9px;
  border: 1px solid var(--border); background: var(--page); color: var(--ink);
}
.regf-campo input.num { font-family: var(--f-data); }
.regf-campo input:focus-visible, .regf-campo select:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }

.regf-campo.con-sufijo, .regf-campo.con-prefijo { position: relative; }
.con-sufijo input { padding-right: 42px; }
.con-sufijo .sufijo {
  position: absolute; right: 11px; bottom: 11px;
  font-family: var(--f-data); font-size: 12px; color: var(--muted); pointer-events: none;
}
.con-prefijo input { padding-left: 26px; }
.con-prefijo .prefijo {
  position: absolute; left: 11px; bottom: 10px;
  font-family: var(--f-data); font-size: 14px; color: var(--muted); pointer-events: none;
}

/* Lo derivado no se edita: por eso no parece un campo. */
.regf-derivado {
  display: flex; flex-wrap: wrap; gap: 6px 18px; margin-top: 9px;
  padding: 9px 12px; background: var(--accent-soft); border-radius: var(--r-sm);
}
.regf-derivado > div { display: flex; flex-direction: column; gap: 1px; }
.regf-derivado .k { font-size: 10px; letter-spacing: .05em; text-transform: uppercase; color: var(--muted); font-weight: 650; }
.regf-derivado .v { font-family: var(--f-data); font-size: 14px; font-weight: 650; color: var(--accent-2); }

.regf-hint { display: block; font-size: 12px; color: var(--muted); margin-top: 7px; line-height: 1.45; }
.regf-err { display: block; font-size: 12px; color: var(--crit-text); margin-top: 6px; }

.regf-drop {
  display: flex; align-items: center; gap: 12px; width: 100%; text-align: left;
  font: inherit; padding: 14px; cursor: pointer;
  border: 1px dashed var(--rule, var(--border)); border-radius: var(--r-md);
  background: var(--page); color: var(--ink);
}
.regf-drop:hover:not(:disabled) { background: var(--accent-soft); border-color: var(--accent); }
.regf-drop:disabled { opacity: .55; cursor: not-allowed; }
.regf-drop-ico { font-size: 22px; flex: 0 0 auto; }
.regf-drop b { display: block; font-size: 14px; font-weight: 600; }
.regf-drop small { display: block; font-size: 12px; color: var(--muted); margin-top: 1px; }

.regf-preview { display: flex; align-items: center; gap: 12px; }
.regf-preview img { width: 60px; height: 60px; object-fit: cover; border-radius: var(--r-md); border: 2px solid var(--accent); flex: 0 0 auto; }
.regf-preview > div { display: flex; flex-direction: column; align-items: flex-start; gap: 6px; }
.regf-ok { font-size: 13px; font-weight: 600; color: var(--accent-2); }

/* Galería de rostros del empleado (varias fotos por persona) */
.regf-fotos { display: flex; flex-wrap: wrap; gap: 10px; }
.regf-foto { position: relative; }
.regf-foto img {
  width: 74px; height: 74px; object-fit: cover; border-radius: var(--r-md);
  border: 2px solid var(--accent); display: block;
}
.regf-foto-x {
  position: absolute; top: -6px; right: -6px; width: 22px; height: 22px; border-radius: 50%;
  border: none; background: var(--crit); color: #fff; font-size: 15px; line-height: 1;
  cursor: pointer; display: grid; place-items: center; box-shadow: var(--elev-1);
}
.regf-foto-mas {
  width: 74px; height: 74px; border-radius: var(--r-md); cursor: pointer;
  border: 2px dashed var(--border); background: transparent; color: var(--muted);
  font-size: 20px; display: flex; flex-direction: column; align-items: center;
  justify-content: center; gap: 2px; font-family: inherit;
}
.regf-foto-mas small { font-size: 10px; }
.regf-foto-mas:disabled { opacity: .5; cursor: default; }

.regf-btn {
  font: inherit; font-size: 13.5px; font-weight: 600; padding: 8px 14px;
  border-radius: 9px; border: 1px solid var(--border);
  background: var(--surface); color: var(--ink); cursor: pointer;
}
.regf-btn:hover:not(:disabled) { background: var(--accent-soft); }
.regf-pie { padding-top: 15px; border-top: 1px solid var(--grid); }
.regf-primary {
  width: 100%; font-size: 15px; padding: 12px;
  background: var(--btn-primary); border-color: var(--btn-primary); color: var(--accent-ink);
}
.regf-primary:hover:not(:disabled) { background: var(--btn-primary-hover); }
.regf-btn:disabled { opacity: .45; cursor: not-allowed; }
.regf-falta { font-size: 12.5px; color: var(--muted); margin-top: 8px; text-align: center; }

/* Resumen del horario asignado: sustituye a los tres campos. */
.regf-resumen {
  display: flex; align-items: center; justify-content: space-between; gap: 12px;
  margin-top: 10px; padding: 10px 12px;
  background: var(--accent-soft); border-radius: var(--r-sm);
}
.regf-resumen > div { display: flex; flex-direction: column; gap: 1px; min-width: 0; }
.regf-resumen b { font-family: var(--f-data); font-size: 14.5px; font-weight: 650; color: var(--accent-2); }
.regf-resumen small { font-size: 12px; color: var(--ink-2); }
.regf-resumen .regf-btn { flex: 0 0 auto; padding: 6px 12px; font-size: 12.5px; }

.regf-check {
  display: flex; align-items: center; gap: 8px; margin-top: 8px;
  font-size: 12.5px; color: var(--ink-2); cursor: pointer;
}
.regf-check input { accent-color: var(--accent); cursor: pointer; flex: 0 0 auto; }

/* El corte va por el ANCHO DEL FORMULARIO, no de la ventana: este formulario
   vive dentro de un cajón de 420 px aunque la pantalla sea grande, y una
   media query nunca se enteraría. */
.regf { container-type: inline-size; container-name: regf; }
@container regf (max-width: 380px) {
  .regf-fila.dos, .regf-fila.tres { grid-template-columns: 1fr; }
  .regf-resumen { flex-direction: column; align-items: stretch; }
  .regf-resumen .regf-btn { width: 100%; }
}
/* Respaldo para navegadores sin soporte de contenedores. */
@media (max-width: 460px) {
  .regf-fila.dos, .regf-fila.tres { grid-template-columns: 1fr; }
  .regf-preview { flex-wrap: wrap; }
}
`;

/** Página /admin/registro: el mismo formulario más la lista con eliminación. */
export default function EmployeeRegister() {
  const [people, setPeople] = useState([]);
  const [toast, setToast] = useState(null);

  const refresh = () => {
    syncPanel().then(() => setPeople(listPeople())).catch(() => {});
  };
  useEffect(refresh, []);

  const showToast = (msg) => { setToast(msg); setTimeout(() => setToast(null), 2800); };

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
        <Link href="/admin/empleados" className="back">‹ Panel</Link>
        <div>
          <div className="brand">Control Registro</div>
          <h1>Registrar empleado</h1>
        </div>
      </header>

      <RegistroEmpleadoForm alRegistrar={(name) => { showToast(`${name} registrado correctamente`); refresh(); }} />

      <section className="card grow">
        <h2>Empleados registrados <span className="count">{people.length}</span></h2>
        <div className="scrollable">
          {people.length === 0 && <p className="empty">Aún no hay empleados.</p>}
          {people.map((p) => (
            <div className="prow" key={p.id}>
              <span className="avatar">{p.name.split(' ').map((w) => w[0]).slice(0, 2).join('').toUpperCase()}</span>
              <span className="pinfo">
                <b>{p.name}</b>
                <small>
                  {p.cedula || 'Sin cédula'} · {p.sede || 'sin sede'} · {p.jornadaDias
                    ? resumenDias(p.jornadaDias)
                    : p.expectedEntry && p.expectedExit ? `${p.expectedEntry}–${p.expectedExit}` : 'horario libre'}
                </small>
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
   de diseño es único para toda la app. Aquí solo el layout de la página. */
.reg-root {
  font-family: var(--f-body);
  font-weight: 300;
  color: var(--ink); background: var(--page);
  min-height: 100dvh; max-width: 560px; margin: 0 auto;
  display: flex; flex-direction: column; gap: 12px;
  padding: 14px 12px 16px; box-sizing: border-box;
}
.reg-root * { box-sizing: border-box; margin: 0; }

.app-header { display: flex; align-items: center; gap: 12px; }
.app-header .back { color: var(--muted); text-decoration: none; font-size: 15px; padding: 4px 8px; border-radius: 8px; }
.app-header .back:hover { background: var(--accent-soft); }
.app-header .brand { font-size: 12px; letter-spacing: .08em; text-transform: uppercase; color: var(--accent); font-weight: 700; }
.app-header h1 { font-size: 19px; font-weight: 650; }

.card { background: var(--surface); border: 1px solid var(--border); border-radius: 12px; padding: 14px; }
.card.grow { flex: 1 1 auto; min-height: 0; display: flex; flex-direction: column; }
.card h2 { font-size: 15px; font-weight: 650; margin-bottom: 8px; }
.card h2 .count { color: var(--muted); font-weight: 400; }
.scrollable { overflow-y: auto; flex: 1 1 auto; min-height: 0; }
.empty { color: var(--muted); font-size: 14px; padding: 8px 0; }

.prow { display: flex; align-items: center; gap: 12px; padding: 10px 2px; border-top: 1px solid var(--grid); }
.prow:first-child { border-top: 0; }
.avatar { width: 40px; height: 40px; border-radius: 50%; background: var(--accent-soft); color: var(--accent); font-weight: 700; font-size: 14px; display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
.pinfo { display: flex; flex-direction: column; flex: 1; }
.pinfo small { color: var(--muted); font-size: 12px; }
.del { border: none; background: transparent; cursor: pointer; font-size: 16px; color: var(--muted); padding: 6px; border-radius: 8px; }
.del:hover { background: var(--crit-soft); }
.del:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }

.toast { position: fixed; left: 50%; bottom: 20px; transform: translateX(-50%); background: var(--ink); color: var(--page); font-size: 14px; padding: 9px 18px; border-radius: 999px; z-index: 60; }
`;
