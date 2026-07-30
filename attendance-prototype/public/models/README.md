# Modelos de face-api.js

Coloca aquí los pesos (weights) descargados de:
https://github.com/vladmandic/face-api/tree/master/model

Archivos requeridos (manifest `.json` + shards `.bin` de cada uno):

- `tiny_face_detector_model-weights_manifest.json` (+ `.bin`)
- `face_landmark_68_model-weights_manifest.json` (+ `.bin`)
- `face_recognition_model-weights_manifest.json` (+ `.bin`)

Next.js los servirá en `https://tu-dominio/models/...`, que es lo que
`AttendanceModule.jsx` usa como `MODEL_URL = '/models'`.

Descarga rápida (PowerShell, desde la raíz del proyecto):

```powershell
$base = "https://raw.githubusercontent.com/vladmandic/face-api/master/model"
$files = @(
  "tiny_face_detector_model-weights_manifest.json", "tiny_face_detector_model.bin",
  "face_landmark_68_model-weights_manifest.json", "face_landmark_68_model.bin",
  "face_recognition_model-weights_manifest.json", "face_recognition_model.bin"
)
foreach ($f in $files) { Invoke-WebRequest "$base/$f" -OutFile "attendance-prototype/public/models/$f" }
```
