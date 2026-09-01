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
 */
import sharp from 'sharp'
import { writeFileSync } from 'node:fs'

// Degradado de marca: acero oscuro abajo que se difumina hacia aero arriba.
const DEGRADADO = `
  <defs>
    <linearGradient id="fondo" x1="0" y1="64" x2="0" y2="0" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="#223347"/>
      <stop offset="1" stop-color="#6e96b8"/>
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
