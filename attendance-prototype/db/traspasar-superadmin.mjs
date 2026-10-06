/*
 * Traspasa el acceso de plataforma entre DOS identidades de Google distintas.
 * No basta con cambiar user.email: Google se vincula por account.account_id y
 * las sesiones existentes se vinculan por user_id.
 *
 * 1. El destinatario debe haber entrado antes con SU cuenta de Google.
 * 2. Identifica al anterior por ID (no por correo: pudo haberse editado).
 * 3. Previsualiza sin --confirm y ejecuta solo tras revisar los dos usuarios.
 *
 * node --env-file=.env.local db/traspasar-superadmin.mjs <id-anterior> <correo-nuevo>
 * node --env-file=.env.local db/traspasar-superadmin.mjs <id-anterior> <correo-nuevo> --confirm
 */
import pg from 'pg'

const [anteriorId, destinoEmail, opcion, ...resto] = process.argv.slice(2)
if (!anteriorId || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(destinoEmail ?? '') ||
  (opcion && opcion !== '--confirm') || resto.length) {
  console.error('Uso: node --env-file=.env.local db/traspasar-superadmin.mjs <id-anterior> <correo-nuevo> [--confirm]')
  process.exit(1)
}
if (!process.env.DATABASE_URL) {
  console.error('Falta DATABASE_URL.')
  process.exit(1)
}

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL })
const db = await pool.connect()
try {
  await db.query('begin')
  // Impide que dos traspasos concurrentes aprueben el mismo origen.
  const { rows: anteriores } = await db.query(
    `select id, email, rol, activo from control."user" where id = $1 for update`, [anteriorId],
  )
  const anterior = anteriores[0]
  if (!anterior || anterior.rol !== 'superadmin' || !anterior.activo) {
    throw new Error('El ID anterior no corresponde a un superadmin activo.')
  }
  const { rows: destinos } = await db.query(
    `select id, email, rol, activo, empresa_id from control."user"
      where lower(email) = $1 for update`, [destinoEmail.trim().toLowerCase()],
  )
  const destino = destinos[0]
  if (!destino || !destino.activo || destino.id === anterior.id || destino.rol === 'superadmin') {
    throw new Error('El destino debe ser otro usuario activo, ya registrado y distinto del superadmin anterior.')
  }
  // Solo trasladamos a una cuenta realmente vinculada a Google. Un correo
  // cambiado a mano o una fila sembrada sin iniciar sesión NO es suficiente.
  const { rows: cuentas } = await db.query(
    `select user_id, provider_id, account_id, password from control.account
      where user_id = any($1::text[]) for update`, [[anterior.id, destino.id]],
  )
  const googleNuevo = cuentas.find((a) => a.user_id === destino.id && a.provider_id === 'google')
  if (!googleNuevo || cuentas.some((a) => a.user_id === anterior.id && a.provider_id === 'google' && a.account_id === googleNuevo.account_id)) {
    throw new Error('El destino necesita un vínculo de Google propio, diferente del anterior.')
  }
  if (cuentas.some((a) => a.user_id === destino.id && a.provider_id === 'credential' && a.password)) {
    throw new Error('El destino tiene contraseña habilitada. Usa una cuenta nueva solo de Google para este traspaso.')
  }
  const { rows: verificaciones } = await db.query(
    `select email_verified from control."user" where id = $1`, [destino.id],
  )
  if (!verificaciones[0]?.email_verified) throw new Error('El correo del destino aún no está verificado.')

  console.log(`Anterior: ${anterior.id} (${anterior.email})`)
  console.log(`Nuevo:    ${destino.id} (${destino.email})`)
  if (destino.empresa_id) {
    console.log(`Aviso: el nuevo usuario dejará de pertenecer a la empresa ${destino.empresa_id}; esa empresa NO se borra.`)
  }
  if (opcion !== '--confirm') {
    console.log('Previsualización: no se cambió nada. Repite con --confirm para ejecutar.')
    await db.query('rollback')
  } else {
    // Desactivar primero al anterior, dentro de la MISMA transacción. Su
    // vínculo Google permanece en su ID inactivo: no puede reasignarse al nuevo.
    await db.query(
      `update control."user" set activo = false, rol = 'consulta', updated_at = now() where id = $1`,
      [anterior.id],
    )
    await db.query(
      `update control."user" set rol = 'superadmin', empresa_id = null, updated_at = now() where id = $1`,
      [destino.id],
    )
    // Ni la sesión vieja ni las sesiones previas del nuevo sobreviven al cambio.
    const { rowCount } = await db.query(
      `delete from control.session where user_id = any($1::text[])`, [[anterior.id, destino.id]],
    )
    await db.query('commit')
    console.log(`Traspaso completado. ${rowCount} sesión(es) revocada(s). Entra de nuevo con el Google nuevo.`)
  }
} catch (e) {
  await db.query('rollback')
  console.error('Traspaso cancelado:', e.message)
  process.exitCode = 1
} finally {
  db.release()
  await pool.end()
}
