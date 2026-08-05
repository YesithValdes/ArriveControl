/**
 * db/cargar-agosto.mjs — Agrega marcaciones de AGOSTO para los empleados ya
 * existentes en asistencia.empleados (no borra nada; solo inserta).
 *
 * Diseñado para probar la vista panorámica del drawer: días con VARIOS pares
 * (pausas a media mañana, diligencias, tarde partida), un día con horas
 * extra, y el día de HOY en curso (entrada abierta = "presente").
 *
 * Idempotente a lo bruto: antes de insertar borra las marcaciones de estos
 * días (3 y 4 de agosto) para poder re-ejecutar sin duplicar.
 *
 * Uso:  node db/cargar-agosto.mjs
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

const { rows: empleados } = await pool.query(
  `select id, nombre, cedula, sede_id from asistencia.empleados where activo order by creado_en`,
);
if (empleados.length === 0) {
  console.error('No hay empleados en asistencia.empleados. Corre antes db/cargar-reales.mjs');
  process.exit(1);
}
const [p1, p2, p3, p4, p5] = empleados;

const LUN = '2026-08-03';
const HOY = '2026-08-04';

const client = await pool.connect();
try {
  await client.query('begin');

  // Re-ejecutable: limpia solo estos dos días antes de insertar.
  await client.query(
    `delete from asistencia.marcaciones
      where (ts at time zone 'America/Bogota')::date in ($1::date, $2::date)`,
    [LUN, HOY],
  );

  const marca = (emp, fecha, hora, tipo) =>
    client.query(
      `insert into asistencia.marcaciones (empleado_id, tipo, ts, sede_id, origen)
       values ($1,$2,$3::timestamptz,$4,'kiosco')`,
      [emp.id, tipo, `${fecha}T${hora}:00-05:00`, emp.sede_id],
    );
  const par = async (emp, fecha, desde, hasta) => {
    await marca(emp, fecha, desde, 'entrada');
    await marca(emp, fecha, hasta, 'salida');
  };

  // ── LUNES 3 de agosto: días completos con VARIOS pares ──────────────
  // p1 · 4 pares: pausa a media mañana + almuerzo + tarde partida → 8,4 h
  if (p1) {
    await par(p1, LUN, '08:00', '10:15');
    await par(p1, LUN, '10:30', '12:00');
    await par(p1, LUN, '13:00', '15:30');
    await par(p1, LUN, '15:45', '17:54');
  }
  // p2 · 3 pares y sale a las 20:00 → 10,2 h (extra del día, cruza las 19:00)
  if (p2) {
    await par(p2, LUN, '08:00', '12:00');
    await par(p2, LUN, '13:00', '16:10');
    await par(p2, LUN, '16:40', '20:00');
  }
  // p3 · 3 pares: diligencia a media tarde → 8,1 h
  if (p3) {
    await par(p3, LUN, '08:05', '12:00');
    await par(p3, LUN, '13:00', '14:50');
    await par(p3, LUN, '15:40', '18:00');
  }
  // p4 · 2 pares normales → 8,4 h
  if (p4) {
    await par(p4, LUN, '07:58', '12:00');
    await par(p4, LUN, '13:00', '17:22');
  }
  // p5 · medio tiempo con pausa → 3,7 h
  if (p5) {
    await par(p5, LUN, '08:00', '10:00');
    await par(p5, LUN, '10:20', '12:00');
  }

  // ── HOY martes 4: jornada EN CURSO ──────────────────────────────────
  // p1 y p2: mañana cerrada y tarde abierta (presentes ahora)
  if (p1) { await par(p1, HOY, '08:01', '12:00'); await marca(p1, HOY, '13:00', 'entrada'); }
  if (p2) { await par(p2, HOY, '08:10', '12:05'); await marca(p2, HOY, '13:02', 'entrada'); }
  // p3: mañana con pausa corta, aún almorzando (dos pares cerrados)
  if (p3) { await par(p3, HOY, '08:00', '09:45'); await par(p3, HOY, '10:00', '12:00'); }
  // p4: olvidó marcar la mañana; primera marcación en la tarde → entrada tardía
  if (p4) { await marca(p4, HOY, '13:25', 'entrada'); }
  // p5: hoy no ha venido → "Sin marcación"

  await client.query('commit');
  console.log('Marcaciones de agosto cargadas (lun 3 completo + hoy en curso).');
} catch (e) {
  await client.query('rollback');
  console.error('FALLÓ:', e.message);
  process.exit(1);
} finally {
  client.release();
}

// Resumen de validación por día
const { rows } = await pool.query(`
  with pares as (
    select m.empleado_id, (m.ts at time zone 'America/Bogota')::date as dia,
           m.ts as entrada, lead(m.ts) over (partition by m.empleado_id order by m.ts) as salida,
           m.tipo, lead(m.tipo) over (partition by m.empleado_id order by m.ts) as tipo_sig
    from asistencia.marcaciones m
    where not m.eliminada and (m.ts at time zone 'America/Bogota')::date >= '2026-08-03'
  )
  select e.nombre, p.dia::text,
         count(*) filter (where p.tipo='entrada' and p.tipo_sig='salida') as pares,
         round(coalesce(sum(extract(epoch from (p.salida - p.entrada))/3600)
           filter (where p.tipo='entrada' and p.tipo_sig='salida'), 0)::numeric, 1) as horas_cerradas
  from pares p join asistencia.empleados e on e.id = p.empleado_id
  group by e.nombre, p.dia order by p.dia, e.nombre
`);
console.table(rows);
await pool.end();
