/**
 * db/copiar-usuarios-del-gestor.mjs
 *
 * Migración ÚNICA: lleva a ArriveControl los usuarios que hoy administran la
 * asistencia desde el gestor de empleados, conservando su contraseña (se copia
 * el hash de Better Auth, no se inventan credenciales nuevas).
 *
 * Solo aplica mientras las dos apps comparten base. Después de esto,
 * ArriveControl autentica con sus propias tablas y ya no necesita al gestor.
 *
 * Mapeo de roles: quien podía EDITAR o CREAR en el módulo `asistencia` queda
 * como `dueno`; quien solo podía VER queda como `consulta`. Los demás no se
 * copian (no usaban esta app).
 *
 * Uso:  node --env-file=.env.local db/copiar-usuarios-del-gestor.mjs [--aplicar]
 * Sin --aplicar solo muestra qué haría.
 */
import { Pool } from 'pg'

const APLICAR = process.argv.includes('--aplicar')
if (!process.env.DATABASE_URL) throw new Error('Falta DATABASE_URL')

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ...(/localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL) ? {} : { ssl: { rejectUnauthorized: false } }),
})

const { rows: candidatos } = await pool.query(`
  select u.id, u.name, u.email, u.email_verified, u.image, u.created_at,
         bool_or(rp.accion in ('EDITAR', 'CREAR')) as puede_editar
    from public."user" u
    join public.rol_permiso rp on rp.rol_id = u.rol_id and rp.modulo = 'asistencia'
   where u.estado = 'ACTIVO'
   group by u.id, u.name, u.email, u.email_verified, u.image, u.created_at
   order by u.created_at
`)

if (candidatos.length === 0) {
  console.log('No hay usuarios del gestor con permisos sobre el módulo `asistencia`.')
  console.log('Crea el primer usuario a mano con db/crear-usuario.mjs.')
  process.exit(0)
}

console.log(`Usuarios a copiar: ${candidatos.length}`)
for (const u of candidatos) {
  console.log(`  ${u.email.padEnd(34)} → ${u.puede_editar ? 'dueno' : 'consulta'}`)
}

if (!APLICAR) {
  console.log('\n(Simulación. Ejecuta con --aplicar para copiarlos.)')
  process.exit(0)
}

let copiados = 0
let yaEstaban = 0
let sinPassword = 0

for (const u of candidatos) {
  const rol = u.puede_editar ? 'dueno' : 'consulta'
  const ins = await pool.query(
    `insert into asistencia."user" (id, name, email, email_verified, image, rol, activo, created_at, updated_at)
     values ($1,$2,$3,$4,$5,$6,true,$7,now())
     on conflict (email) do nothing
     returning id`,
    [u.id, u.name, u.email, u.email_verified, u.image, rol, u.created_at],
  )
  if (ins.rowCount === 0) { yaEstaban += 1; continue }

  // La contraseña vive en `account` (proveedor `credential`): se copia el hash
  // tal cual, así el usuario entra con la MISMA clave que ya conoce.
  const { rows: cuentas } = await pool.query(
    `select account_id, provider_id, password, created_at
       from public.account where user_id = $1 and provider_id = 'credential' and password is not null`,
    [u.id],
  )
  if (cuentas.length === 0) { sinPassword += 1; continue }
  for (const a of cuentas) {
    await pool.query(
      `insert into asistencia.account (account_id, provider_id, user_id, password, created_at, updated_at)
       values ($1,$2,$3,$4,$5,now())`,
      [a.account_id, a.provider_id, u.id, a.password, a.created_at],
    )
  }
  copiados += 1
}

console.log(`\nCopiados: ${copiados} · ya existían: ${yaEstaban} · sin contraseña: ${sinPassword}`)
if (sinPassword > 0) {
  console.log('Los que quedaron sin contraseña deben restablecerla desde Ajustes → Usuarios.')
}
await pool.end()
