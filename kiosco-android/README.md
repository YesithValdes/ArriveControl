# AsistencIA — kiosco Android nativo

App nativa (Kotlin + Jetpack Compose) del kiosco, pensada para publicarse en
Play Store. Reemplaza al cascarón de Capacitor (`attendance-prototype/android/`).
Usa **el mismo servidor** (`https://arrivecontrol.vercel.app`) y **los mismos
modelos** que la web, así que los rostros ya registrados siguen sirviendo.

## Etapa actual: prototipo de compatibilidad

Todavía **no marca asistencia**. Sirve para comprobar que la cara que ve el
teléfono da el mismo vector que la web:

1. Se activa con el código de 8 dígitos del panel (Ajustes → Dispositivos → Vincular).
2. Baja el roster de la empresa (solo su sede + quienes no tienen sede).
3. Muestra en vivo el 1º y 2º más parecido, la similitud y si el kiosco lo
   aceptaría (similitud ≥ 0,45 y margen ≥ 0,08, las mismas reglas de la web).

**Qué mirar:** cada persona registrada, frente a la cámara, debería salir
como 1º con similitud parecida a la que marca en el kiosco web (0,5–0,7 es lo
normal en producción) y margen amplio. Si alguien sale bajo o confundido,
anota nombre y números.

## Compilar

Requiere Android Studio (trae Java y el SDK).

```powershell
cd kiosco-android
$env:JAVA_HOME = "C:\Program Files\Android\Android Studio\jbr"
.\gradlew.bat assembleDebug
# APK: app\build\outputs\apk\debug\app-debug.apk
```

O ábrelo en Android Studio (File → Open → `kiosco-android`) y dale ▶ con el
celular conectado por USB (depuración USB activada).

- Usa **Gradle 9.1**: Android Studio trae Java 25 y Gradle 8.x no corre sobre él.
- Los modelos se copian solos de `attendance-prototype/public/models` al
  compilar (tarea `copiarModelos`); no se versionan aquí.

## Pendiente antes de Play Store

- Nombre del paquete definitivo (`applicationId` en `app/build.gradle.kts`;
  hoy provisional `co.asistencia.kiosco`). No se puede cambiar después de publicar.
- Etapa 2: marcación, prueba de vida (parpadeo), cola sin conexión, GPS,
  sonidos, «Iniciar kiosco», aviso de uso del rostro, modo de revisión para Google.
- Firma con Play App Signing y subir como App Bundle (`bundleRelease`).
- Si la cuenta de Play Console es personal: prueba cerrada con 12 personas × 14 días.
