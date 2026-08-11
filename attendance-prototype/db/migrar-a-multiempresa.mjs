/**
 * db/migrar-a-multiempresa.mjs — El paso de una empresa a muchas.
 *
 * Se corre UNA sola vez, sobre la instalación que hoy tiene todo en el esquema
 * `asistencia`. Deja:
 *
 *   asistencia  →  smartgadgets            (renombrado: la primera empresa)
 *   control                                (nuevo: el directorio)
 *   control."user" · session · account · verification · dispositivos
 *                                          (mudados desde el esquema anterior)
 *   control.empresas                       (con SmartGadgets registrada)
 *
 * Todo en UNA transacción: en Postgres el DDL es transaccional, así que o
 * queda migrado o queda exactamente como estaba. No hay estado intermedio.
 *
 * Los datos operativos —marcaciones, empleados, sedes— NO se mueven ni se
 * copian: el esquema se renombra y ya. Lo único que cambia de sitio son las
 * pocas filas de identidad.
 *
 * Uso:  node db/migrar-a-multiempresa.mjs [--nombre="SmartGadgets"] [--esquema=smartgadgets]
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { randomBytes } from 'node:crypto'
import path from 'node:path'
import pg from 'pg'

const dir = path.dirname(fileURLToPath(import.meta.url))

if (!process.env.DATABASE_URL) {
  try {
    const env = readFileSync(path.join(dir, '..', '.env.local'), 'utf8')
    for (const line of env.split('\n')) {
      const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/)
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '')
    }
  } catch { /* sin .env.local */ }
}
if (!process.env.DATABASE_URL) {
  console.error('Falta DATABASE_URL.')
  process.exit(1)
}

const arg = (n, d) => process.argv.find((a) => a.startsWith(`--${n}=`))?.split('=').slice(1).join('=') ?? d
const VIEJO = arg('viejo', 'asistencia')
const NUEVO = arg('esquema', 'smartgadgets')
const NOMBRE = arg('nombre', 'SmartGadgets')

// Las tablas de identidad, que dejan de ser de la empresa y pasan a ser del
// directorio: son compartidas por todos los clientes.
const A_CONTROL = ['user', 'session', 'account', 'verification', 'dispositivos']

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL })
const db = await pool.connect()

try {
  const existe = async (esq) =>
    (await db.query(`select 1 from information_schema.schemata where schema_name = $1`, [esq])).rowCount > 0

  if (!(await existe(VIEJO))) {
    if (await existe(NUEVO)) {
      console.log(`Nada que hacer: "${VIEJO}" ya no existe y "${NUEVO}" sí. Parece migrado.`)
      process.exit(0)
    }
    console.error(`No existe el esquema "${VIEJO}".`)
    process.exit(1)
  }

  await db.query('begin')

  // 1) El directorio.
  console.log('1. Creando el esquema control…')
  await db.query(readFileSync(path.join(dir, 'migrations', 'control', '001_control.sql'), 'utf8'))
  await db.query(`
    create table if not exists control._migraciones (
      archivo text primary key, aplicada_en timestamptz not null default now()
    )`)
  await db.query(
    `insert into control._migraciones (archivo) values ('001_control.sql')
     on conflict (archivo) do nothing`,
  )

  // 2) La empresa. Se registra ANTES de mover los usuarios, porque cada
  //    usuario va a apuntar a ella.
  console.log(`2. Registrando "${NOMBRE}" → esquema ${NUEVO}…`)
  const { rows: emp } = await db.query(
    `insert into control.empresas (nombre, esquema, api_key, plan, limite_empleados)
     values ($1, $2, $3, 'pago', null)
     returning id, nombre, esquema, api_key`,
    // La clave de ENTRADA (la que usa nómina para pedir las horas) se hereda
    // tal cual de la configuración anterior, con la misma cadena de respaldo
    // que tenía el código viejo. Si se generara una nueva, cualquier sistema
    // externo que ya estuviera consultando /api/horas empezaría a recibir 401.
    [NOMBRE, NUEVO,
     process.env.ARRIVECONTROL_API_KEY
       || process.env.INTEGRACION_HORAS_API_KEY
       || randomBytes(24).toString('base64url')],
  )
  const empresa = emp[0]

  // 3) Mudar la identidad. Las tablas se mueven enteras con `alter table set
  //    schema`: no se copian filas, así que las llaves foráneas entre ellas
  //    (session→user, account→user) viajan intactas.
  //
  //    Antes hay que quitar las que `001_control.sql` acaba de crear vacías —
  //    esa plantilla está pensada para una instalación NUEVA, y aquí las de
  //    verdad vienen del esquema anterior con sus datos. Se comprueba que
  //    estén vacías para no borrar nada por error.
  console.log('3. Mudando la identidad al directorio…')
  for (const t of [...A_CONTROL].reverse()) {   // orden inverso: primero las que dependen de `user`
    const existeAqui = (await db.query(
      `select to_regclass($1) is not null as e`, [`control.${t === 'user' ? '"user"' : t}`],
    )).rows[0].e
    if (!existeAqui) continue
    const n = Number((await db.query(`select count(*)::int as n from control."${t}"`)).rows[0].n)
    if (n > 0) throw new Error(`control."${t}" ya tiene ${n} fila(s): esta instalación no está recién creada. Revisa antes de migrar.`)
    await db.query(`drop table control."${t}" cascade`)
  }

  for (const t of A_CONTROL) {
    const hay = (await db.query(
      `select 1 from information_schema.tables where table_schema = $1 and table_name = $2`,
      [VIEJO, t],
    )).rowCount > 0
    if (!hay) { console.log(`   · ${t}: no existía, se omite`); continue }

    // `dispositivos` tiene FK a sedes, que se queda en la empresa. Esa llave
    // no puede sobrevivir: apuntaría desde el directorio compartido a UN
    // cliente concreto. Se cae aquí a propósito (ver docs/multitenant-plan.md).
    if (t === 'dispositivos') {
      const { rows: fks } = await db.query(
        `select conname from pg_constraint
          where conrelid = ($1 || '.dispositivos')::regclass and contype = 'f'`, [VIEJO],
      )
      for (const fk of fks) {
        await db.query(`alter table ${VIEJO}.dispositivos drop constraint ${fk.conname}`)
      }
    }
    await db.query(`alter table ${VIEJO}."${t}" set schema control`)
    console.log(`   · ${t} → control`)
  }

  // `user.sede_id` tenía FK a sedes por la misma razón; ya no puede tenerla.
  const { rows: fkUser } = await db.query(
    `select conname from pg_constraint
      where conrelid = 'control."user"'::regclass and contype = 'f'
        and pg_get_constraintdef(oid) like '%sedes%'`,
  )
  for (const fk of fkUser) {
    await db.query(`alter table control."user" drop constraint ${fk.conname}`)
    console.log(`   · quitada la llave foránea ${fk.conname} (user.sede_id → sedes)`)
  }

  // 4) Las tablas mudadas vienen del esquema viejo, de cuando había una sola
  //    empresa: les falta la columna que dice de quién es cada fila.
  console.log('4. Asignando usuarios y dispositivos a la empresa…')
  await db.query(`alter table control."user" add column if not exists empresa_id uuid references control.empresas(id) on delete restrict`)
  await db.query(`alter table control.dispositivos add column if not exists empresa_id uuid references control.empresas(id) on delete cascade`)
  await db.query(`create index if not exists user_empresa_idx on control."user" (empresa_id)`)
  await db.query(`create index if not exists dispositivos_empresa_idx on control.dispositivos (empresa_id)`)
  const u = await db.query(`update control."user" set empresa_id = $1 where empresa_id is null`, [empresa.id])
  const d = await db.query(`update control.dispositivos set empresa_id = $1 where empresa_id is null`, [empresa.id])
  console.log(`   · ${u.rowCount} usuario(s), ${d.rowCount} dispositivo(s)`)

  // 5) El renombre. Va al final: hasta aquí nada dependía del nombre.
  console.log(`5. Renombrando ${VIEJO} → ${NUEVO}…`)
  await db.query(`alter schema ${VIEJO} rename to ${NUEVO}`)

  // 6) El registro de migraciones de la empresa pasa a hablar el idioma nuevo:
  //    las ocho viejas se consolidaron en empresa/001_base.sql. Se anota como
  //    aplicada para que `migrate.mjs` no intente recrear las tablas.
  await db.query(`delete from ${NUEVO}._migraciones`)
  await db.query(
    `insert into ${NUEVO}._migraciones (archivo) values ('001_base.sql')`,
  )

  await db.query('commit')

  console.log('\n✅ Migrado.')
  console.log(`   Empresa:  ${empresa.nombre}`)
  console.log(`   Esquema:  ${empresa.esquema}`)
  console.log(`   API key:  ${empresa.api_key}`)
  console.log('\n   Guarda esa clave: es la que usa la nómina en GET /api/horas.')
} catch (e) {
  await db.query('rollback')
  console.error(`\n❌ FALLÓ, no se cambió nada: ${e.message}`)
  process.exitCode = 1
} finally {
  db.release()
  await pool.end()
}
