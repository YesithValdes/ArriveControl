/**
 * db/migrate.mjs — Corre las migraciones SQL en orden. Idempotente.
 *
 * Hay dos carpetas porque hay dos clases de esquema:
 *
 *   migrations/control/   se aplican UNA vez, al esquema `control`
 *   migrations/empresa/   se aplican a CADA esquema de empresa
 *
 * Las de `empresa/` se escriben SIN prefijo de esquema: se ejecutan con el
 * `search_path` ya puesto. Es la misma regla que siguen las consultas de la
 * aplicación, y la que hace posible que un mismo archivo sirva para todos los
 * clientes.
 *
 * Cada esquema lleva su propio registro `_migraciones`, así que una empresa
 * creada ayer y otra creada hace un año convergen sin pisarse.
 *
 * Uso:
 *   node db/migrate.mjs              → control + todas las empresas
 *   node db/migrate.mjs --solo=t_x   → control + solo ese esquema
 *   node db/migrate.mjs --listar     → qué falta por aplicar, sin tocar nada
 *
 * Lee DATABASE_URL de .env.local (o del entorno si ya está definida).
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import pg from 'pg';

const dir = path.dirname(fileURLToPath(import.meta.url));

// Cargar .env.local a mano (los scripts de node no pasan por Next).
if (!process.env.DATABASE_URL) {
  try {
    const env = readFileSync(path.join(dir, '..', '.env.local'), 'utf8');
    for (const line of env.split('\n')) {
      const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  } catch { /* sin .env.local: se exige la variable en el entorno */ }
}
if (!process.env.DATABASE_URL) {
  console.error('Falta DATABASE_URL (en el entorno o en .env.local).');
  process.exit(1);
}

const args = process.argv.slice(2);
const soloEsquema = args.find((a) => a.startsWith('--solo='))?.split('=')[1] ?? null;
const soloListar = args.includes('--listar');

/**
 * Nombre de esquema seguro para interpolar. NO se puede parametrizar (`$1` no
 * sirve para identificadores), así que se valida contra el mismo patrón que
 * exige `control.empresas.esquema`. Es la única defensa contra una inyección
 * por aquí, y por eso está en los dos lados.
 */
const esquemaValido = (s) => /^[a-z][a-z0-9_]{2,40}$/.test(s);

const archivosDe = (carpeta) => {
  const p = path.join(dir, 'migrations', carpeta);
  return existsSync(p) ? readdirSync(p).filter((f) => f.endsWith('.sql')).sort() : [];
};

const leer = (carpeta, archivo) =>
  readFileSync(path.join(dir, 'migrations', carpeta, archivo), 'utf8');

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const client = await pool.connect();

/**
 * Aplica las migraciones pendientes de `carpeta` a `esquema`.
 *
 * Cada migración corre en su propia transacción junto con la inserción en el
 * registro: o queda aplicada y anotada, o no queda ninguna de las dos cosas.
 * Nunca a medias. En Postgres el DDL es transaccional, así que esto vale
 * también para un `create table` a medio camino.
 */
async function aplicar(esquema, carpeta) {
  if (!esquemaValido(esquema)) {
    throw new Error(`Nombre de esquema inválido: "${esquema}". Solo minúsculas, dígitos y guión bajo.`);
  }

  // `--listar` es de solo consulta: no crea el esquema ni el registro. Un
  // comando que informa no debe modificar aquello sobre lo que informa.
  const registro = await client.query(
    `select to_regclass($1) is not null as existe`, [`${esquema}._migraciones`],
  );
  if (!registro.rows[0].existe) {
    if (soloListar) {
      const todas = archivosDe(carpeta);
      console.log(`  ${esquema}: sin migrar — ${todas.length === 1 ? 'falta' : 'faltan'} ${todas.join(', ')}`);
      return todas.length;
    }
    await client.query(`create schema if not exists ${esquema}`);
    await client.query(`
      create table if not exists ${esquema}._migraciones (
        archivo     text primary key,
        aplicada_en timestamptz not null default now()
      )`);
  }

  const { rows } = await client.query(`select archivo from ${esquema}._migraciones`);
  const yaAplicadas = new Set(rows.map((r) => r.archivo));
  const pendientes = archivosDe(carpeta).filter((f) => !yaAplicadas.has(f));

  if (pendientes.length === 0) {
    console.log(`  ${esquema}: al día`);
    return 0;
  }
  if (soloListar) {
    console.log(`  ${esquema}: faltan ${pendientes.join(', ')}`);
    return pendientes.length;
  }

  for (const f of pendientes) {
    await client.query('begin');
    try {
      // Las migraciones de empresa van sin prefijo: el search_path decide el
      // esquema. `set local` se deshace solo al terminar la transacción, así
      // que la conexión nunca vuelve al pool con un esquema ajeno puesto.
      if (carpeta === 'empresa') {
        await client.query(`set local search_path to ${esquema}`);
      }
      await client.query(leer(carpeta, f));
      await client.query(
        `insert into ${esquema}._migraciones (archivo) values ($1)`, [f],
      );
      await client.query('commit');
      console.log(`  + ${esquema} · ${f}`);
    } catch (e) {
      await client.query('rollback');
      console.error(`  x ${esquema} · ${f} FALLÓ: ${e.message}`);
      throw e;
    }
  }
  return pendientes.length;
}

try {
  console.log(soloListar ? 'Pendientes:' : 'Migrando…');

  // 1) El directorio primero: de él sale la lista de empresas.
  await aplicar('control', 'control');

  // 2) Cada empresa registrada. Si `control.empresas` todavía no tiene filas
  //    —instalación recién creada— no hay nada que migrar, y se dice.
  const hayDirectorio = (await client.query(
    `select to_regclass('control.empresas') is not null as existe`,
  )).rows[0].existe;

  const { rows: empresas } = hayDirectorio
    ? await client.query(
        `select nombre, esquema from control.empresas
          ${soloEsquema ? 'where esquema = $1' : ''}
          order by creada_en`,
        soloEsquema ? [soloEsquema] : [],
      )
    : { rows: [] };

  if (empresas.length === 0) {
    console.log(
      soloEsquema
        ? `  No hay ninguna empresa con el esquema "${soloEsquema}".`
        : '  Todavía no hay empresas registradas en control.empresas.',
    );
  }
  for (const e of empresas) {
    await aplicar(e.esquema, 'empresa');
  }

  console.log(soloListar ? 'Fin del listado.' : 'Migraciones al día.');
} catch {
  process.exit(1);
} finally {
  client.release();
  await pool.end();
}
