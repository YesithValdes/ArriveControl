/**
 * db/cargar-reales.mjs — Carga tiempos REALES para colaboradores que existen
 * en el gestor de empleados (public.colaborador), para probar la
 * sincronización entre los dos sistemas de verdad.
 *
 * Qué hace:
 *  1. Lee colaboradores ACTIVOS del gestor (misma base compartida).
 *  2. LIMPIA los datos demostrativos de asistencia.* (E001…, marcaciones,
 *     correcciones, envíos, intentos) — ya no son demo.
 *  3. Crea asistencia.empleados vinculados por CÉDULA (numero_documento).
 *  4. Inserta marcaciones de la semana 27 jul – 2 ago 2026 (cerrada), con
 *     casos reales: jornadas normales, extras que cruzan las 19:00 (nocturno),
 *     domingo trabajado y medio tiempo.
 *  5. Muestra el lote que se enviaría al gestor (cédulas reales).
 *
 * Uso:  node db/cargar-reales.mjs
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const dir = path.dirname(fileURLToPath(import.meta.url));
if (!process.env.DATABASE_URL) {
  const env = readFileSync(path.join(dir, '..', '.env.local'), 'utf8');
  for (const line of env.split('\n')) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}

const { pool } = await import('../lib/db.js');
const { construirLote } = await import('../lib/nomina.js');

// ── 1. Colaboradores reales del gestor ────────────────────────────────
const { rows: colaboradores } = await pool.query(`
  select numero_documento, nombres, apellidos, estado
    from public.colaborador
   where numero_documento is not null
   order by creado_en
   limit 5
`);
if (colaboradores.length === 0) {
  console.error('El gestor no tiene colaboradores con documento. Nada que cargar.');
  process.exit(1);
}
console.log('Colaboradores del gestor a usar:');
for (const c of colaboradores) console.log(`  ${c.numero_documento}  ${c.nombres} ${c.apellidos}  (${c.estado})`);

const client = await pool.connect();
try {
  await client.query('begin');

  // ── 2. Limpiar los datos demostrativos ──────────────────────────────
  await client.query(`delete from asistencia.correcciones`);
  await client.query(`delete from asistencia.envios_rh`);
  await client.query(`delete from asistencia.intentos_kiosco`);
  await client.query(`delete from asistencia.marcaciones`);
  await client.query(`delete from asistencia.empleados`);
  console.log('\nDatos demostrativos eliminados de asistencia.*');

  // Sedes: conservar las existentes; usar las dos primeras.
  const { rows: sedes } = await client.query(`select id from asistencia.sedes order by nombre limit 2`);
  const sedeDe = (i) => sedes[i % sedes.length].id;

  // ── 3. Empleados de asistencia vinculados por cédula ────────────────
  const empleados = [];
  for (let i = 0; i < colaboradores.length; i++) {
    const c = colaboradores[i];
    const esMedioTiempo = i === 4; // el quinto, si existe, es medio tiempo
    const { rows } = await client.query(
      `insert into asistencia.empleados
         (nombre, cedula, sede_id, entrada_esperada, salida_esperada, almuerzo_min)
       values ($1,$2,$3,$4,$5,$6)
       returning id, nombre, cedula`,
      [`${c.nombres} ${c.apellidos}`.trim(), c.numero_documento, sedeDe(i),
       '08:00', esMedioTiempo ? '12:00' : '17:24', esMedioTiempo ? 0 : 60],
    );
    empleados.push(rows[0]);
  }

  // ── 4. Marcaciones de la semana 27 jul – 2 ago 2026 (hora Bogotá) ───
  const marca = (emp, fecha, hora, tipo) =>
    client.query(
      `insert into asistencia.marcaciones (empleado_id, tipo, ts, sede_id, origen)
       values ($1,$2,$3::timestamptz,$4,'kiosco')`,
      [emp.id, tipo, `${fecha}T${hora}:00-05:00`,
       sedes[empleados.indexOf(emp) % sedes.length].id],
    );
  const dobleTurno = async (emp, fecha, salida = '17:24') => {
    await marca(emp, fecha, '08:00', 'entrada');
    await marca(emp, fecha, '12:00', 'salida');
    await marca(emp, fecha, '13:00', 'entrada');
    await marca(emp, fecha, salida, 'salida');
  };

  const LV = ['2026-07-27', '2026-07-28', '2026-07-29', '2026-07-30', '2026-07-31'];
  const [p1, p2, p3, p4, p5] = empleados;

  for (const d of LV) {
    if (p1) await dobleTurno(p1, d);                                      // semana normal: 42 h
    if (p2) await dobleTurno(p2, d, d === LV[1] || d === LV[3] ? '20:30' : '17:24'); // extras (cruza 19:00)
    if (p3) await dobleTurno(p3, d);                                      // normal + domingo abajo
    if (p4) await dobleTurno(p4, d);                                      // semana normal
    if (p5) { await marca(p5, d, '08:00', 'entrada'); await marca(p5, d, '12:00', 'salida'); } // medio tiempo
  }
  if (p2) { await marca(p2, '2026-08-01', '08:00', 'entrada'); await marca(p2, '2026-08-01', '12:06', 'salida'); } // sábado
  if (p3) { await marca(p3, '2026-08-02', '08:00', 'entrada'); await marca(p3, '2026-08-02', '12:00', 'salida'); } // DOMINGO

  await client.query('commit');
  console.log(`\n${empleados.length} empleados y sus marcaciones de la semana 27 jul – 2 ago cargados.`);
} catch (e) {
  await client.query('rollback');
  console.error('FALLÓ:', e.message);
  process.exit(1);
} finally {
  client.release();
}

// ── 5. Validación: horas calculadas y lote que viajaría al gestor ─────
const { rows: horas } = await pool.query(`
  with pares as (
    select m.empleado_id, m.ts as entrada,
           lead(m.ts)  over (partition by m.empleado_id order by m.ts) as salida,
           m.tipo, lead(m.tipo) over (partition by m.empleado_id order by m.ts) as tipo_sig
    from asistencia.marcaciones m where not m.eliminada
  )
  select e.nombre, e.cedula,
         round(sum(extract(epoch from (p.salida - p.entrada))/3600)::numeric,1) as horas,
         greatest(0, round((sum(extract(epoch from (p.salida - p.entrada))/3600)
           - (select horas_semana from asistencia.config_laboral))::numeric,1)) as extras
  from pares p join asistencia.empleados e on e.id = p.empleado_id
  where p.tipo='entrada' and p.tipo_sig='salida'
  group by e.nombre, e.cedula order by horas desc
`);
console.log('\nHoras de la semana (calculadas en SQL):');
console.table(horas);

const { registros } = await construirLote({ desde: '2026-07-27', hasta: '2026-08-02' });
console.log('Lote que se enviaría al gestor (cédulas REALES del gestor):');
console.table(registros.map(({ _empleadoId, _semana, observaciones, ...r }) => r));

await pool.end();
