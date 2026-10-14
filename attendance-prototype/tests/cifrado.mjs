/**
 * tests/cifrado.mjs — Primitivas de lib/cifrado.js (sin base de datos).
 * Ejecutar:  node tests/cifrado.mjs
 */
import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import {
  sellar, abrir, esSobre, leerSobre, nuevaLlave, aadDek, aadDato, llavesMaestras,
  nuevaRecuperacion, leerRecuperacion, kekDeRecuperacion, huellaDeRecuperacion, mismaHuella,
} from '../lib/cifrado.js'

let pasaron = 0
const prueba = (nombre, fn) => {
  try { fn(); pasaron++; console.log(`  ✅ ${nombre}`) } catch (e) { console.error(`  ❌ ${nombre}\n     ${e.message}`); process.exitCode = 1 }
}

const A = '0190f1a2-0000-7000-8000-00000000000a'
const B = '0190f1a2-0000-7000-8000-00000000000b'

console.log('\n🔐 Sobres AES-256-GCM')
prueba('sellar y abrir devuelve el mismo dato', () => {
  const k = nuevaLlave()
  const s = sellar(k, '1.234.567.890', aadDato(A, 'empleados.cedula'), '1')
  assert.equal(abrir(k, s, aadDato(A, 'empleados.cedula')).toString(), '1.234.567.890')
  assert.ok(esSobre(s))
  assert.equal(leerSobre(s).etiquetaLlave, '1')
})
prueba('el mismo dato cifrado dos veces da sobres distintos (IV aleatorio)', () => {
  const k = nuevaLlave()
  assert.notEqual(sellar(k, 'x', 'c'), sellar(k, 'x', 'c'))
})
prueba('no abre con otra llave', () => {
  const s = sellar(nuevaLlave(), 'secreto', 'c')
  assert.throws(() => abrir(nuevaLlave(), s, 'c'), /No se pudo descifrar/)
})
prueba('no abre en otra EMPRESA (aad)', () => {
  const k = nuevaLlave()
  const s = sellar(k, 'secreto', aadDato(A, 'empleados.cedula'))
  assert.throws(() => abrir(k, s, aadDato(B, 'empleados.cedula')))
})
prueba('no abre en otra COLUMNA (aad)', () => {
  const k = nuevaLlave()
  const s = sellar(k, '3500000', aadDato(A, 'empleados.salario'))
  assert.throws(() => abrir(k, s, aadDato(A, 'empleados.cedula')))
})
prueba('detecta un sobre alterado', () => {
  const k = nuevaLlave()
  const partes = sellar(k, 'dato', 'c').split('.')
  const cuerpo = Buffer.from(partes[3], 'base64url'); cuerpo[0] ^= 1
  partes[3] = cuerpo.toString('base64url')
  assert.throws(() => abrir(k, partes.join('.'), 'c'))
})
prueba('cifra binarios (avatar) sin pérdida', () => {
  const k = nuevaLlave(); const img = randomBytes(5000)
  assert.ok(abrir(k, sellar(k, img, 'c'), 'c').equals(img))
})
prueba('rechaza llaves que no son de 32 bytes', () => {
  assert.throws(() => sellar(randomBytes(16), 'x', 'c'), /32 bytes/)
})
prueba('un texto cualquiera no es sobre', () => {
  assert.equal(esSobre('1.234.567'), false)
  assert.equal(esSobre(null), false)
})
prueba('aad de DEK distingue maestra de recuperación y versión', () => {
  assert.notEqual(aadDek(A, 1, 'maestra'), aadDek(A, 1, 'recuperacion'))
  assert.notEqual(aadDek(A, 1, 'maestra'), aadDek(A, 2, 'maestra'))
  assert.throws(() => aadDek(A, 1, 'otra'))
  assert.throws(() => aadDato(A, 'x; drop'))
})

console.log('\n🗝️  Llave maestra')
prueba('sin variable no hay maestras (no inventa una)', () => {
  assert.equal(llavesMaestras({}), null)
})
prueba('lee la vigente y la anterior', () => {
  const m = llavesMaestras({
    ARRIVE_LLAVE_MAESTRA: randomBytes(32).toString('base64'), ARRIVE_LLAVE_MAESTRA_ID: 'm2',
    ARRIVE_LLAVE_MAESTRA_ANTERIOR: randomBytes(32).toString('base64'), ARRIVE_LLAVE_MAESTRA_ANTERIOR_ID: 'm1',
  })
  assert.equal(m.vigente.id, 'm2'); assert.ok(m.porId.has('m1')); assert.ok(m.porId.has('m2'))
})
prueba('rechaza una maestra corta', () => {
  assert.throws(() => llavesMaestras({ ARRIVE_LLAVE_MAESTRA: randomBytes(16).toString('base64') }), /32 bytes/)
})
prueba('rechaza anterior sin id o con el mismo id', () => {
  const k = randomBytes(32).toString('base64')
  assert.throws(() => llavesMaestras({ ARRIVE_LLAVE_MAESTRA: k, ARRIVE_LLAVE_MAESTRA_ANTERIOR: k }))
})

console.log('\n🧾 Llave de recuperación')
prueba('formato: 13 grupos de 4 caracteres base32', () => {
  const { texto } = nuevaRecuperacion()
  assert.match(texto, /^([A-Z2-7]{4}-){12}[A-Z2-7]{4}$/)
})
prueba('se lee de vuelta, tolerando minúsculas, espacios y confusiones 0/O 1/I 8/B', () => {
  const { bytes, texto } = nuevaRecuperacion()
  assert.ok(leerRecuperacion(texto).equals(bytes))
  const descuidado = texto.toLowerCase().replace(/-/g, ' ').replace(/o/g, '0').replace(/i/g, '1').replace(/b/g, '8')
  assert.ok(leerRecuperacion(descuidado).equals(bytes))
})
prueba('rechaza una llave incompleta', () => {
  assert.throws(() => leerRecuperacion('ABCD-EFGH'), /52 caracteres/)
})
prueba('KEK y huella son distintas y dependen de la empresa', () => {
  const { bytes } = nuevaRecuperacion()
  assert.notEqual(kekDeRecuperacion(bytes, A).toString('hex'), huellaDeRecuperacion(bytes, A))
  assert.notEqual(huellaDeRecuperacion(bytes, A), huellaDeRecuperacion(bytes, B))
  assert.ok(mismaHuella(huellaDeRecuperacion(bytes, A), huellaDeRecuperacion(bytes, A)))
  assert.equal(mismaHuella(huellaDeRecuperacion(bytes, A), 'abc'), false)
})
prueba('la DEK envuelta con recuperación se abre solo con esa llave', () => {
  const dek = nuevaLlave(); const r1 = nuevaRecuperacion(); const r2 = nuevaRecuperacion()
  const sobre = sellar(kekDeRecuperacion(r1.bytes, A), dek, aadDek(A, 1, 'recuperacion'), 'r')
  assert.ok(abrir(kekDeRecuperacion(leerRecuperacion(r1.texto), A), sobre, aadDek(A, 1, 'recuperacion')).equals(dek))
  assert.throws(() => abrir(kekDeRecuperacion(r2.bytes, A), sobre, aadDek(A, 1, 'recuperacion')))
})

console.log(`\n${pasaron} pruebas de cifrado pasaron.${process.exitCode ? ' HAY FALLOS.' : ''}\n`)
