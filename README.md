# ArriveControl 🕐

Sistema de control de asistencia de empleados con **reconocimiento facial y prueba de vida**, pensado como kiosco: un celular o tablet fijo en la sede valida a quien se acerque y registra su entrada o salida automáticamente.

Todo el procesamiento de IA ocurre **en el dispositivo** (navegador) — sin costos de infraestructura y sin enviar fotos a ningún servidor. Solo se almacena el vector facial de 128 números, del que no se puede reconstruir la imagen.

## ✨ Funcionalidades

- **🖥️ Modo Kiosco (pantalla principal):** identificación 1:N — la persona solo se acerca, parpadea y el sistema la reconoce entre todos los empleados registrados. Sin botones, sin elegir nombre.
- **👁️ Prueba de vida:** exige un parpadeo real con ambos ojos (MediaPipe Face Landmarker, malla facial 3D) — una foto o un video no pueden pasar.
- **🔄 Jornadas automáticas:** alterna ENTRADA/SALIDA por persona con reglas de negocio: ventana nocturna de 12 h (turnos que cruzan medianoche), anti-rebote de 3 min, y detección de anomalías (salida faltante, entrada tardía según el horario esperado de cada empleado).
- **🪪 Registro por foto (solo admin):** nombre, cédula, sede asignada, horario esperado y una foto tipo carnet. La foto se analiza al instante y se descarta — solo queda el vector facial.
- **📊 Panel de administrador multi-sede:** presentes/ausentes, puntualidad, anomalías con corrección auditada, historial de ajustes, comparativa entre sedes y filtro global por sede.
- **📍 Validación GPS por sede:** fórmula de Haversine contra las coordenadas de cada sede (radio configurable), con soporte para restringir al empleado a SU sede.

## 🧰 Tecnologías

| Capa | Tecnología |
|---|---|
| Framework | Next.js 15 (App Router) + React 19 |
| Prueba de vida | [@mediapipe/tasks-vision](https://www.npmjs.com/package/@mediapipe/tasks-vision) (Face Landmarker, 478 puntos 3D + blendshapes) |
| Identidad facial | [@vladmandic/face-api](https://github.com/vladmandic/face-api) (descriptor de 128 floats, distancia euclidiana) |
| Persistencia | `localStorage` (mock — diseñado para migrar a Supabase) |
| PWA | Service Worker con caché de modelos (~11 MB solo la primera visita) |

## 🚀 Instalación y uso

```bash
cd attendance-prototype
npm install

# Desarrollo (hot reload)
npm run dev

# Producción (más rápido + caché de modelos activo)
npm run build
npm start
```

Abre `http://localhost:3000`. Para probar desde un celular se necesita **HTTPS** (la cámara lo exige): usa el port-forwarding de VS Code (puerto 3000, visibilidad pública) o un túnel como ngrok.

### Rutas

| Ruta | Pantalla |
|---|---|
| `/` | Kiosco de asistencia (pantalla principal) |
| `/admin` | Panel del administrador (ruta escondida) |
| `/admin/registro` | Registro de empleados por foto |
| `/fichaje` | Fichaje individual con GPS + biometría del dispositivo (WebAuthn) |
| `/gps` | Diagnóstico de señal GPS y distancia a cada sede |
| `/demo` | Laboratorio biométrico: métricas FAR/FRR y pruebas de confianza |

### Configuración rápida

- **Sedes y radio GPS:** [`attendance-prototype/utils/haversine.js`](attendance-prototype/utils/haversine.js) (`OFFICE_LOCATIONS`, `MAX_RADIUS_METERS`).
- **Umbral de coincidencia facial:** [`attendance-prototype/utils/faceMath.js`](attendance-prototype/utils/faceMath.js) (`MATCH_THRESHOLD`, actual 0.5 — más bajo = más estricto).
- **Modelos de IA:** ya incluidos en `public/models/` y `public/wasm/`.

## 🧪 Pruebas

```bash
cd attendance-prototype
npm test                      # 29 pruebas: Haversine, vectores, jornadas, servicios
node tests/edge-cases.mjs     # 11 casos adversariales: medianoche, relojes atrasados,
                              # datos corruptos, almacenamiento lleno, cédulas duplicadas…
```

## 🔒 Modelo de seguridad (resumen honesto)

- La identidad se compara contra el rostro registrado (distancia euclidiana < 0.5).
- La prueba de vida (parpadeo con ambos ojos + captura solo de frente) detiene fotos y pantallas; no pretende resistir ataques sofisticados con video/máscaras — para ese nivel se requiere hardware IR (Face ID) o SDKs comerciales de liveness.
- Privacidad: nunca se almacenan fotos; solo vectores de 128 floats (irreversibles a imagen).

## 🗺️ Pendientes para producción

- [ ] Migrar persistencia a **Supabase** (empleados, eventos, auditoría) con timestamp del servidor
- [ ] Cola offline en el kiosco (marcar sin internet y sincronizar después)
- [ ] Autenticación real del panel de administrador (roles en Supabase)
- [ ] Reportes exportables (CSV/PDF de jornadas por período)

---

Prototipo desarrollado con la asistencia de [Claude Code](https://claude.com/claude-code).
