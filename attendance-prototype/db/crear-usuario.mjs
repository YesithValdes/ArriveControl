/**
 * db/crear-usuario.mjs
 *
 * Crea el PRIMER usuario dueño de una instalación de ArriveControl (cuando no
 * hay ninguno todavía y por eso nadie puede entrar al panel a crear usuarios).
 * Después de esto, los demás se crean desde Ajustes → Usuarios.
 *
 * Uso:
 *   node --env-file=.env.local db/crear-usuario.mjs correo@empresa.com "Nombre" "contraseña"
 */
import { auth, pool } from '../lib/auth.js'

const [email, nombre, password] = process.argv.slice(2)
if (!email || !nombre || !password) {
  console.error('Uso: node db/crear-usuario.mjs <correo> <nombre> <contraseña>')
  process.exit(1)
}
if (password.length < 8) {
  console.error('La contraseña debe tener al menos 8 caracteres.')
  process.exit(1)
}

const { rows } = await pool.query(`select count(*)::int as n from asistencia."user"`)
if (rows[0].n > 0) {
  console.log(`Ya hay ${rows[0].n} usuario(s). Crea los demás desde Ajustes → Usuarios.`)
  process.exit(0)
}

const creado = await auth.api.createUser({
  body: { email: email.toLowerCase(), password, name: nombre, data: { rol: 'dueno', activo: true } },
})
console.log(`Dueño creado: ${creado.user.email}`)
await pool.end()
