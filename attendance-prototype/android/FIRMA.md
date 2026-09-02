# Compilar y actualizar la app de Android

## Antes de compilar, SIEMPRE

Abre una terminal **en la carpeta `attendance-prototype`** (no en `android`) y
corre:

```bash
npm run apk
```

Copia los modelos faciales dentro del APK. Sin esto, la primera arrancada en
cada aparato baja 20 MB.

Si usas la terminal de Android Studio, esta abre en `android/`, así que
primero hay que salir una carpeta:

```bash
cd ..
npm run apk
```

---

## La primera vez: crear la llave de firma

La llave es la **identidad de la app**. Android solo acepta una actualización si
viene firmada con la misma llave que la versión instalada. Si se pierde, no hay
forma de actualizar las apps que ya están instaladas: hay que desinstalarlas y
volver a instalar, y cada kiosco queda desvinculado.

**Guárdala en dos sitios distintos y no la subas al repositorio.**

En Android Studio:

1. **Build → Generate Signed App Bundle / APK…**
2. Elegir **APK** (no *App Bundle*: el bundle es para Play Store; para instalar
   directo hace falta un APK)
3. **Create new…**
4. Llenar:
   - **Key store path**: fuera del proyecto, p. ej. `C:\llaves\asistencia.jks`
   - **Password**: una larga; se anota junto a la llave
   - **Alias**: `asistencia`
   - **Validity**: 25 años o más — al vencerse no se podría actualizar nunca más
   - **First and Last Name / Organization**: los datos de la empresa

Después, crear `android/keystore.properties` (ya está en `.gitignore`):

```properties
storeFile=C:/llaves/asistencia.jks
storePassword=la-contraseña-del-almacén
keyAlias=asistencia
keyPassword=la-contraseña-de-la-llave
```

---

## Cada actualización

1. `npm run apk` (desde `attendance-prototype`)
2. Subir `versionCode` en `android/app/build.gradle` (2 → 3 → 4…). Android se
   niega a instalar encima una versión con número menor, y con el mismo número
   no hay forma de saber qué tiene cada aparato.
3. **Build → Generate Signed App Bundle / APK… → APK → release**
4. El archivo sale en `android/app/build/outputs/apk/release/app-release.apk`

---

## Lo que hay que saber antes de la primera versión firmada

**Si en los aparatos hay instalada una versión de depuración, la firmada NO se
instala encima.** Son llaves distintas y Android lo rechaza. Hay que
desinstalar primero, y al desinstalar **cada kiosco pierde su vinculación** y
hay que activarlo de nuevo con un código desde el panel.

Conviene hacerlo YA, con tres kioscos, y no cuando haya treinta.

---

## Lo que NO necesita un APK nuevo

La app es un cascarón que carga la web, así que casi todo llega solo al abrirla:
pantallas, cálculos, correos, panel. Solo hace falta recompilar cuando cambia
algo de dentro del paquete:

- los modelos faciales empaquetados
- el icono o el nombre de la app en Android
- permisos o configuración de Capacitor
