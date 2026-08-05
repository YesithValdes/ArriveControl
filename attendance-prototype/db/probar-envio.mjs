/**
 * db/probar-envio.mjs — Prueba REAL de sincronización con el gestor:
 * arma el lote desde asistencia.marcaciones y lo POSTea a
 * GESTOR_URL/api/integraciones/horas con la X-API-Key.
 * Luego verifica en la base qué quedó en public.novedad_horas.
 *
 * Uso:  node db/probar-envio.mjs
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const dir = path.dirname(fileURLToPath(import.meta.url));
const env = readFileSync(path.join(dir, '..', '.env.local'), 'utf8');
for (const line of env.split('\n')) {
  const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
}

const { pool } = await import('../lib/db.js');
const { construirLote, registrarEnvio } = await import('../lib/nomina.js');

const url = `${process.env.GESTOR_URL || 'http://localhost:3000'}/api/integraciones/horas`;
const { registros } = await construirLote({ desde: '2026-07-27', hasta: '2026-08-02' });
console.log(`Lote: ${registros.length} registros → POST ${url}`);

let respuesta;
try {
  respuesta = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-API-Key': process.env.INTEGRACION_HORAS_API_KEY ?? '' },
    body: JSON.stringify({ registros: registros.map(({ _empleadoId, _semana, ...r }) => r) }),
  });
} catch (e) {
  console.error(`\nNo se pudo conectar con el gestor en ${url}`);
  console.error(`¿Está corriendo el gestor? Detalle: ${e.message}`);
  await pool.end();
  process.exit(1);
}

const texto = await respuesta.text();
let datos;
try { datos = JSON.parse(texto); } catch { datos = { crudo: texto.slice(0, 400) }; }
console.log(`\nRespuesta del gestor (HTTP ${respuesta.status}):`);
console.log(JSON.stringify(datos, null, 2));

if (respuesta.ok && datos.ok !== false) {
  await registrarEnvio(registros, datos, 'prueba-integracion');
  console.log('\nBitácora asistencia.envios_rh actualizada.');

  // Verificación del OTRO lado: ¿qué quedó en las tablas del gestor?
  try {
    const { rows } = await pool.query(`
      select nh.*, c.nombres || ' ' || c.apellidos as colaborador
        from public.novedad_horas nh
        join public.colaborador c on c.id = nh.colaborador_id
       order by nh.fecha
       limit 20`);
    console.log(`\npublic.novedad_horas (lado del GESTOR): ${rows.length} fila(s)`);
    for (const r of rows) {
      const claves = Object.keys(r).filter((k) => !['colaborador'].includes(k));
      console.log(' ', r.colaborador, '·', JSON.stringify(Object.fromEntries(claves.slice(0, 10).map((k) => [k, r[k]]))));
    }
  } catch (e) {
    console.log(`\n(No se pudo leer public.novedad_horas: ${e.message})`);
  }
}
await pool.end();
