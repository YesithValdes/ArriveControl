/**
 * scripts/generar-iconos.mjs — Rasteriza el logo (public/icon.svg, opción
 * «C-dial») a todos los PNG que necesita el sistema:
 *
 *   icon-192.png / icon-512.png   → PWA (manifest)
 *   icon-512-maskable.png         → Android recorta en círculo/squircle:
 *                                   símbolo al 60% sobre fondo pleno
 *   apple-touch-icon.png (180)    → iOS (opaco: iOS ennegrece transparencias)
 *   splash.png (1024)             → pantalla de arranque
 *
 * Uso:  node scripts/generar-iconos.mjs
 *
 * DESPUES DE CORRERLO: SUBIR EL ?v= de los iconos en app/layout.jsx y en
 * public/manifest.webmanifest. Sin eso, quien ya tenga la app instalada
 * seguira viendo el icono viejo — el sistema guarda el que habia el dia de la
 * instalacion y no vuelve a pedirlo si la direccion no cambio.
 */
import sharp from 'sharp'
import { writeFileSync, existsSync } from 'node:fs'

// Degradado de marca (paleta MARINO, 2026-09-15): azul marino oscuro abajo
// que sube hacia el acento; el mismo azul de la barra del panel. Antes era
// el acero apagado (#223347 → #6e96b8), que en el celular se veía gris.
const DEGRADADO = `
  <defs>
    <linearGradient id="fondo" x1="0" y1="64" x2="0" y2="0" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="#172e4c"/>
      <stop offset="1" stop-color="#2b6cb0"/>
    </linearGradient>
  </defs>`

/** El símbolo «Presente ✓» (rostro + chulo), escala `s` centrada en 64×64. */
const simbolo = (s) => {
  const t = 32 - 32 * s
  return `
  <g transform="translate(${t} ${t}) scale(${s})" fill="none">
    <circle cx="32" cy="31" r="20" stroke="#fff" stroke-width="4.6"/>
    <circle cx="25.4" cy="27" r="2.2" fill="#fff"/>
    <circle cx="38.6" cy="27" r="2.2" fill="#fff"/>
    <path d="M 24 37 l 6 6 l 12 -12" stroke="#9fdcca" stroke-width="4.4" stroke-linecap="round" stroke-linejoin="round"/>
  </g>`
}

/** Lienzo 64×64 con fondo en degradado (rx=0 → sangrado completo para maskable). */
const svg = ({ escala, rx }) => `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  ${DEGRADADO}
  <rect width="64" height="64" rx="${rx}" fill="url(#fondo)"/>
  ${simbolo(escala)}
</svg>`

const png = (contenido, px, salida) =>
  sharp(Buffer.from(contenido), { density: 300 })
    .resize(px, px)
    .png()
    .toFile(`public/${salida}`)
    .then(() => console.log(`  + public/${salida} (${px}px)`))

// Íconos normales: esquinas redondeadas propias, símbolo al 90% (más grande).
const normal = svg({ escala: 0.9, rx: 14 })
// Maskable e iOS: fondo a sangre (el sistema recorta), símbolo al 68% para
// que crezca sin salirse de la zona segura del recorte circular de Android.
const pleno = svg({ escala: 0.68, rx: 0 })

await png(normal, 192, 'icon-192.png')
await png(normal, 512, 'icon-512.png')
await png(pleno, 512, 'icon-512-maskable.png')
await png(pleno, 180, 'apple-touch-icon.png')
await png(pleno, 1024, 'splash.png')
console.log('Íconos regenerados desde el logo «Presente ✓» (AsistencIA).')

// ── APK: icono adaptativo de Android ────────────────────────────────────
// Antes se hacía a mano en Android Studio y se quedó con el azul viejo cuando
// cambió la paleta. Ahora sale de aquí, del mismo SVG: fondo (degradado a
// sangre) y frente (símbolo solo, transparente) de 108 dp, más el icono
// clásico de 48 dp para lanzadores viejos. Android recorta el fondo y muestra
// el frente dentro de la "zona segura" de 66 dp: por eso el símbolo va al 60 %.
// DESPUÉS: subir versionCode en android/app/build.gradle y recompilar el APK.
const RES = 'android/app/src/main/res'
const DENSIDADES = { mdpi: 1, hdpi: 1.5, xhdpi: 2, xxhdpi: 3, xxxhdpi: 4 }
const soloSimbolo = `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">${simbolo(0.6)}</svg>`
const soloFondo = `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">${DEGRADADO}<rect width="64" height="64" fill="url(#fondo)"/></svg>`
const aRes = (contenido, px, ruta) =>
  sharp(Buffer.from(contenido), { density: 300 }).resize(px, px).png().toFile(ruta)
    .then(() => console.log(`  + ${ruta} (${px}px)`))
if (existsSync(RES)) {
  for (const [dens, factor] of Object.entries(DENSIDADES)) {
    const dir = `${RES}/mipmap-${dens}`
    if (!existsSync(dir)) continue
    await aRes(soloFondo, Math.round(108 * factor), `${dir}/ic_launcher_background.png`)
    await aRes(soloSimbolo, Math.round(108 * factor), `${dir}/ic_launcher_foreground.png`)
    await aRes(pleno, Math.round(48 * factor), `${dir}/ic_launcher.png`)
    await aRes(pleno, Math.round(48 * factor), `${dir}/ic_launcher_round.png`)
  }
  writeFileSync(`${RES}/values/ic_launcher_background.xml`,
    '<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    <color name="ic_launcher_background">#1e3a5f</color>\n</resources>\n')
  console.log('Icono del APK regenerado. Sube versionCode y recompila.')
}
