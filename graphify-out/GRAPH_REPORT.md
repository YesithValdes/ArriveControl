# Graph Report - .  (2026-07-31)

## Corpus Check
- Corpus is ~38,962 words - fits in a single context window. You may not need a graph.

## Summary
- 811 nodes · 1159 edges · 54 communities (24 shown, 30 thin omitted)
- Extraction: 99% EXTRACTED · 1% INFERRED · 0% AMBIGUOUS · INFERRED: 9 edges (avg confidence: 0.68)
- Token cost: 30,009 input · 2,800 output

## Community Hubs (Navigation)
- Panel de Administración
- GPS y Prueba de Vida face-api
- Kiosco y Jornadas Laborales
- Fichaje Individual WebAuthn
- Dependencias y Scripts npm
- Conceptos del README
- Bindings WebGPU (SIMD)
- Bindings WebGPU (no-SIMD)
- Manejo de Excepciones (SIMD)
- Manejo de Excepciones (no-SIMD)
- Carga de Binario WASM (SIMD)
- Carga de Binario WASM (no-SIMD)
- Layout PWA y Service Worker
- Estado de Vértices WebGPU (SIMD)
- Gestor de Referencias (SIMD)
- Estado de Vértices WebGPU (no-SIMD)
- Gestor de Referencias (no-SIMD)
- Pruebas de Casos Límite
- Syscalls ioctl (SIMD)
- Syscalls ioctl (no-SIMD)
- Ciclo de Arranque WASM (SIMD)
- Escritura de Archivos (SIMD)
- Syscalls de Archivos (SIMD)
- Ciclo de Arranque WASM (no-SIMD)
- Escritura de Archivos (no-SIMD)
- Syscalls de Archivos (no-SIMD)
- Funciones del Panel (docs)
- Configuración de Next.js
- Caché del Service Worker
- Post-arranque WASM (SIMD)
- Cierre de Archivos (SIMD)
- Valores de Retorno (SIMD)
- Archivos Perezosos (SIMD)
- Trazas de Pila (SIMD)
- Lectura de Caracteres (SIMD)
- Temporizadores (SIMD)
- Estado Depth-Stencil (SIMD)
- Montaje de Sistema de Archivos (SIMD)
- Dependencias de Ejecución (SIMD)
- Registro de Tipos (SIMD)
- Post-arranque WASM (no-SIMD)
- Cierre de Archivos (no-SIMD)
- Valores de Retorno (no-SIMD)
- Archivos Perezosos (no-SIMD)
- Trazas de Pila (no-SIMD)
- Lectura de Caracteres (no-SIMD)
- Temporizadores (no-SIMD)
- Estado Depth-Stencil (no-SIMD)
- Montaje de Sistema de Archivos (no-SIMD)
- Dependencias de Ejecución (no-SIMD)
- Registro de Tipos (no-SIMD)
- Persistencia y Migración a Supabase

## God Nodes (most connected - your core abstractions)
1. `AdminPanel()` - 24 edges
2. `listPeople()` - 15 edges
3. `ExceptionInfo` - 14 edges
4. `ExceptionInfo` - 14 edges
5. `getSedes()` - 13 edges
6. `LivenessIdentityDemo()` - 12 edges
7. `get()` - 12 edges
8. `get()` - 12 edges
9. `AttendanceModule()` - 11 edges
10. `euclideanDistance()` - 10 edges

## Surprising Connections (you probably didn't know these)
- `Carpeta .vercel y project.json` --references--> `ArriveControl`  [INFERRED]
  attendance-prototype/.vercel/README.txt → README.md
- `PWA Service Worker con caché de modelos` --references--> `Pesos de modelos face-api.js`  [INFERRED]
  README.md → attendance-prototype/public/models/README.md
- `Pesos de modelos face-api.js` --cites--> `@vladmandic/face-api`  [EXTRACTED]
  attendance-prototype/public/models/README.md → README.md
- `MODEL_URL = '/models' en AttendanceModule.jsx` --references--> `Next.js 15 App Router + React 19`  [EXTRACTED]
  attendance-prototype/public/models/README.md → README.md
- `AdminPanel()` --indirect_call--> `getLaborConfig()`  [INFERRED]
  attendance-prototype/components/AdminPanel.jsx → attendance-prototype/services/configService.js

## Import Cycles
- None detected.

## Hyperedges (group relationships)
- **Flujo de verificación de identidad en el kiosco** — readme_kiosk_mode, readme_liveness_proof, readme_face_descriptor, readme_match_threshold, readme_automatic_shifts [INFERRED 0.85]
- **Stack de IA en el navegador** — readme_mediapipe_tasks_vision, readme_vladmandic_face_api, readme_pwa_service_worker, attendance_prototype_public_models_readme_face_api_weights, readme_on_device_ai [INFERRED 0.85]

## Communities (54 total, 30 thin omitted)

### Community 2 - "Panel de Administración"
Cohesion: 0.08
Nodes (44): metadata, montserrat, metadata, AdminPanel(), dayKey(), fmt12(), fmtH(), fmtTs() (+36 more)

### Community 3 - "GPS y Prueba de Vida face-api"
Cohesion: 0.08
Nodes (32): metadata, AttendanceModule(), detectWithRetries(), dist2d(), drawOverlay(), eyeAspectRatio(), headTurnRatio(), PERMISSION_HELP (+24 more)

### Community 4 - "Kiosco y Jornadas Laborales"
Cohesion: 0.12
Nodes (22): metadata, metadata, fmtDay(), JourneysPanel(), s, toTimeInput(), averageDescriptors(), KioskMode() (+14 more)

### Community 5 - "Fichaje Individual WebAuthn"
Cohesion: 0.14
Nodes (24): metadata, AttendanceModule(), PERMISSION_HELP, STEPS, styles, HRPanel(), styles, approveRegistration() (+16 more)

### Community 6 - "Dependencias y Scripts npm"
Cohesion: 0.10
Nodes (20): dependencies, @mediapipe/tasks-vision, next, react, react-dom, @vladmandic/face-api, name, private (+12 more)

### Community 7 - "Conceptos del README"
Cohesion: 0.11
Nodes (19): Pesos de modelos face-api.js, MODEL_URL = '/models' en AttendanceModule.jsx, Carpeta .vercel y project.json, ArriveControl, Laboratorio biométrico FAR/FRR (/demo), Descriptor facial de 128 floats, Validación GPS por sede (Haversine), Modo Kiosco (identificación 1:N) (+11 more)

### Community 8 - "Bindings WebGPU (SIMD)"
Cohesion: 0.14
Nodes (17): __asyncjs__mediapipe_map_buffer_jspi(), get(), makeBlendComponent(), makeBlendState(), makeColorAttachment(), makeColorAttachments(), makeColorState(), makeColorStates() (+9 more)

### Community 9 - "Bindings WebGPU (no-SIMD)"
Cohesion: 0.14
Nodes (17): __asyncjs__mediapipe_map_buffer_jspi(), get(), makeBlendComponent(), makeBlendState(), makeColorAttachment(), makeColorAttachments(), makeColorState(), makeColorStates() (+9 more)

### Community 12 - "Carga de Binario WASM (SIMD)"
Cohesion: 0.20
Nodes (10): abort(), addRunDependency(), createWasm(), findWasmBinary(), getBinaryPromise(), getBinarySync(), getWasmImports(), instantiateArrayBuffer() (+2 more)

### Community 13 - "Carga de Binario WASM (no-SIMD)"
Cohesion: 0.20
Nodes (10): abort(), addRunDependency(), createWasm(), findWasmBinary(), getBinaryPromise(), getBinarySync(), getWasmImports(), instantiateArrayBuffer() (+2 more)

### Community 14 - "Layout PWA y Service Worker"
Cohesion: 0.40
Nodes (3): metadata, viewport, ServiceWorkerRegister()

### Community 15 - "Estado de Vértices WebGPU (SIMD)"
Cohesion: 0.40
Nodes (5): makeVertexAttribute(), makeVertexAttributes(), makeVertexBuffer(), makeVertexBuffers(), makeVertexState()

### Community 17 - "Estado de Vértices WebGPU (no-SIMD)"
Cohesion: 0.40
Nodes (5): makeVertexAttribute(), makeVertexAttributes(), makeVertexBuffer(), makeVertexBuffers(), makeVertexState()

### Community 20 - "Syscalls ioctl (SIMD)"
Cohesion: 0.50
Nodes (4): ioctl_tcgets(), ioctl_tcsets(), ioctl_tiocgwinsz(), ___syscall_ioctl()

### Community 21 - "Syscalls ioctl (no-SIMD)"
Cohesion: 0.50
Nodes (4): ioctl_tcgets(), ioctl_tcsets(), ioctl_tiocgwinsz(), ___syscall_ioctl()

### Community 22 - "Ciclo de Arranque WASM (SIMD)"
Cohesion: 0.67
Nodes (3): addOnPreRun(), preRun(), run()

### Community 23 - "Escritura de Archivos (SIMD)"
Cohesion: 0.67
Nodes (3): msync(), put_char(), write()

### Community 24 - "Syscalls de Archivos (SIMD)"
Cohesion: 0.67
Nodes (3): ___syscall_fcntl64(), ___syscall_openat(), syscallGetVarargI()

### Community 25 - "Ciclo de Arranque WASM (no-SIMD)"
Cohesion: 0.67
Nodes (3): addOnPreRun(), preRun(), run()

### Community 26 - "Escritura de Archivos (no-SIMD)"
Cohesion: 0.67
Nodes (3): msync(), put_char(), write()

### Community 27 - "Syscalls de Archivos (no-SIMD)"
Cohesion: 0.67
Nodes (3): ___syscall_fcntl64(), ___syscall_openat(), syscallGetVarargI()

### Community 28 - "Funciones del Panel (docs)"
Cohesion: 0.67
Nodes (3): Panel de administrador multi-sede, Jornadas automáticas ENTRADA/SALIDA, Pruebas adversariales (edge-cases.mjs)

## Knowledge Gaps
- **54 isolated node(s):** `montserrat`, `metadata`, `metadata`, `metadata`, `metadata` (+49 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **30 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `ExceptionInfo` connect `Manejo de Excepciones (SIMD)` to `MediaPipe WASM Runtime (SIMD)`?**
  _High betweenness centrality (0.011) - this node is a cross-community bridge._
- **Why does `ExceptionInfo` connect `Manejo de Excepciones (no-SIMD)` to `MediaPipe WASM Runtime (no-SIMD)`?**
  _High betweenness centrality (0.011) - this node is a cross-community bridge._
- **Why does `getSedes()` connect `Panel de Administración` to `GPS y Prueba de Vida face-api`, `Fichaje Individual WebAuthn`?**
  _High betweenness centrality (0.007) - this node is a cross-community bridge._
- **What connects `montserrat`, `metadata`, `metadata` to the rest of the system?**
  _57 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `MediaPipe WASM Runtime (SIMD)` be split into smaller, more focused modules?**
  _Cohesion score 0.009900990099009901 - nodes in this community are weakly interconnected._
- **Should `MediaPipe WASM Runtime (no-SIMD)` be split into smaller, more focused modules?**
  _Cohesion score 0.009950248756218905 - nodes in this community are weakly interconnected._
- **Should `Panel de Administración` be split into smaller, more focused modules?**
  _Cohesion score 0.07826546800634585 - nodes in this community are weakly interconnected._