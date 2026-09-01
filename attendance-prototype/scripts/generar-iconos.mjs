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

/** El símbolo C-dial en blanco, escala `s` centrada en un lienzo 64×64. */
const simbolo = (s) => {
  const t = 32 - 32 * s
  return `
  <g transform="translate(${t} ${t}) scale(${s})" stroke="#fff" stroke-linecap="round" fill="none">
    <path d="M 51 17.5 A 24 24 0 1 0 51 46.5" stroke-width="7.5"/>
    <line x1="32" y1="10" x2="32" y2="15" stroke-width="3.4"/>
    <line x1="10" y1="32" x2="15" y2="32" stroke-width="3.4"/>
    <line x1="32" y1="49" x2="32" y2="54" stroke-width="3.4"/>
    <circle cx="32" cy="32" r="3" fill="#fff" stroke="none"/>
    <line x1="32" y1="32" x2="41" y2="23" stroke-width="4.4"/>
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
console.log('Íconos regenerados desde la opción B (C-dial).')
