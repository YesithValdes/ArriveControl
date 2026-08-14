/**
 * scripts/probar-correo.mjs — Prueba local del comprobante de marcación.
 *
 * Lee las variables SMTP de .env.local y envía un comprobante de ejemplo.
 * Uso (desde attendance-prototype):
 *   node scripts/probar-correo.mjs destino@correo.com
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'

for (const linea of readFileSync(path.join(process.cwd(), '.env.local'), 'utf8').split('\n')) {
  const m = linea.match(/^\s*([A-Z0-9_]+)\s*=\s*"?([^"#]*)"?\s*$/)
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim()
}

const destino = process.argv[2]
if (!destino) { console.error('Uso: node scripts/probar-correo.mjs destino@correo.com'); process.exit(1) }
if (!process.env.SMTP_HOST || !process.env.SMTP_USER || !process.env.SMTP_PASS) {
  console.error('Faltan SMTP_HOST / SMTP_USER / SMTP_PASS en .env.local')
  process.exit(1)
}

const { enviarComprobanteMarcacion } = await import('../lib/correo.js')

console.log(`Enviando comprobante de prueba a ${destino} vía ${process.env.SMTP_HOST}…`)
const ok = await enviarComprobanteMarcacion({
  para: destino,
  nombre: 'Empleado de Prueba',
  tipo: 'entrada',
  ts: new Date().toISOString(),
  sede: 'Sede Principal',
  lat: 1.2136,
  lon: -77.2811,
  diferido: false,
  empresa: 'Control Registro (prueba)',
})
console.log(ok ? '✅ Enviado. Revisa la bandeja (y spam) del destino.' : '❌ No se pudo enviar — mira el error de arriba.')
process.exit(0)
