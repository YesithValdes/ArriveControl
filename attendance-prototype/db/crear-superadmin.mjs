/**
 * db/crear-superadmin.mjs — Siembra al administrador de la PLATAFORMA.
 *
 * No se puede crear desde la aplicación, y es a propósito: no hay nadie que
 * pueda autorizarlo (sería el primero). Se siembra en la base, una sola vez por
 * instalación, con acceso al servidor — que es la única credencial que prueba
 * que quien lo hace es el dueño del sistema.
 *
 * El superadmin NO pertenece a ninguna empresa (la base lo exige con un check)
 * y por lo tanto no entra al panel de asistencia de nadie: administra
 * `control.empresas`, nada más.
 *
 * Uso:
 *   node --env-file=.env.local db/crear-superadmin.mjs correo@dominio.com "Nombre"
 *
 * El correo debe ser el MISMO de la cuenta de Google con la que va a entrar: al
 * iniciar sesión, Better Auth encuentra este usuario por correo y lo reutiliza
 * en vez de crear uno nuevo (y el hook de registro respeta su rol, no le crea
 * empresa).
 */
import pg from 'pg'

const [email, nombre = 'Superadmin'] = process.argv.slice(2)
if (!email || !email.includes('@')) {
  console.error('Uso: node db/crear-superadmin.mjs <correo> [nombre]')
  process.exit(1)
}
if (!process.env.DATABASE_URL) {
  console.error('Falta DATABASE_URL (usa node --env-file=.env.local).')
  process.exit(1)
}

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL })

try {
  const correo = email.trim().toLowerCase()

  // Si ya existe (porque entró con Google antes de sembrarlo), se PROMUEVE.
  // Y se le quita la empresa que el registro self-service le haya creado: un
  // superadmin con empresa viola el check de la migración 002.
  const existente = await pool.query(
    `select id, rol, empresa_id from control."user" where lower(email) = $1`, [correo],
  )

  if (existente.rows[0]) {
    const u = existente.rows[0]
    if (u.rol === 'superadmin') {
      console.log(`${correo} ya era superadmin.`)
    } else {
      await pool.query(
        `update control."user" set rol = 'superadmin', empresa_id = null, updated_at = now()
          where id = $1`, [u.id],
      )
      console.log(`${correo} promovido a superadmin.`)
      if (u.empresa_id) {
        console.log(
          `  Ojo: tenía la empresa ${u.empresa_id}. Se le desligó, pero la empresa\n` +
          `  y su esquema siguen ahí. Bórralos desde el panel si eran de prueba.`,
        )
      }
    }
  } else {
    // Usuario sin fila en `account`: no puede entrar con contraseña, solo con
    // Google. Al hacerlo, Better Auth vincula la cuenta a este mismo correo.
    await pool.query(
      `insert into control."user" (id, name, email, email_verified, rol, empresa_id, activo)
       values (gen_random_uuid()::text, $1, $2, true, 'superadmin', null, true)`,
      [nombre, correo],
    )
    console.log(`Superadmin creado: ${correo}`)
    console.log('Entra con la cuenta de Google de ese mismo correo.')
  }
} catch (e) {
  console.error('No se pudo:', e.message)
  process.exitCode = 1
} finally {
  await pool.end()
}
