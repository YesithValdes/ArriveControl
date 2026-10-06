/* Diagnóstico de identidades de Google antes de traspasar superadmin.
 * node --env-file=.env.local db/revisar-superadmin.mjs
 * No cambia datos ni muestra contraseñas o tokens.
 */
import pg from 'pg'

if (!process.env.DATABASE_URL) throw new Error('Falta DATABASE_URL.')
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 8000 })
try {
  console.log('Host de base:', new URL(process.env.DATABASE_URL).hostname)
  const { rows } = await pool.query(`
    select u.id, u.email, u.rol, u.activo, u.empresa_id, u.email_verified,
           u.created_at, a.provider_id, a.account_id
      from control."user" u
      left join control.account a on a.user_id = u.id
     where u.rol = 'superadmin'
        or (a.provider_id = 'google' and u.created_at > now() - interval '30 days')
     order by u.created_at desc limit 40
  `)
  console.log(JSON.stringify(rows, null, 2))
} catch (e) {
  console.error('Consulta fallida:', e.message)
  process.exitCode = 1
} finally {
  await pool.end()
}
