/**
 * lib/auth.js — Better Auth con las tablas PROPIAS de ArriveControl.
 *
 * Antes esta app validaba contra los usuarios del gestor de empleados. Ya no:
 * tiene sus propios usuarios, sesiones y roles en el esquema `asistencia`, y
 * por eso puede venderse y desplegarse sin el gestor.
 *
 * Cómo encuentra sus tablas: Better Auth usa nombres sin esquema (user,
 * session, account, verification). El pool fija `search_path=asistencia,public`,
 * así que resuelven primero en `asistencia`. Las consultas que necesitan otro
 * esquema lo escriben explícito (public.colaborador).
 *
 * Los usuarios se crean desde Ajustes → Usuarios (no hay registro abierto).
 */
import { betterAuth } from 'better-auth'
import { admin } from 'better-auth/plugins'
import { nextCookies } from 'better-auth/next-js'
import { Pool } from 'pg'
import { uuidv7 } from './uuidv7'

if (!process.env.DATABASE_URL) {
  throw new Error('Falta DATABASE_URL.')
}
if (!process.env.BETTER_AUTH_SECRET) {
  throw new Error('Falta BETTER_AUTH_SECRET: es lo que firma la cookie de sesión.')
}

// Singleton sobre globalThis: en desarrollo cada recarga en caliente vuelve a
// evaluar el módulo, y sin esta guarda se crearía un Pool nuevo cada vez.
const globalParaPg = globalThis
export const pool =
  globalParaPg.__arriveControlAuthPool ??
  new Pool({
    connectionString: process.env.DATABASE_URL,
    options: '-c search_path=asistencia,public',
  })
if (process.env.NODE_ENV !== 'production') globalParaPg.__arriveControlAuthPool = pool

export const auth = betterAuth({
  baseURL: process.env.BETTER_AUTH_URL,
  secret: process.env.BETTER_AUTH_SECRET,
  trustedOrigins: process.env.BETTER_AUTH_TRUSTED_ORIGINS?.split(',').map((s) => s.trim()).filter(Boolean),
  database: pool,
  emailAndPassword: {
    enabled: true,
    disableSignUp: true, // el alta la hace un dueño desde Ajustes → Usuarios
  },
  // El esquema usa snake_case; Better Auth asume camelCase.
  user: {
    fields: {
      emailVerified: 'email_verified',
      createdAt: 'created_at',
      updatedAt: 'updated_at',
      banReason: 'ban_reason',
      banExpires: 'ban_expires',
    },
    additionalFields: {
      rol: { type: 'string', required: false, input: true },
      sedeId: { type: 'string', required: false, input: true, fieldName: 'sede_id' },
      activo: { type: 'boolean', required: false, input: true },
    },
  },
  session: {
    expiresIn: 60 * 60 * 24 * 7,
    updateAge: 60 * 60 * 24,
    fields: {
      expiresAt: 'expires_at',
      createdAt: 'created_at',
      updatedAt: 'updated_at',
      ipAddress: 'ip_address',
      userAgent: 'user_agent',
      userId: 'user_id',
      impersonatedBy: 'impersonated_by',
    },
  },
  account: {
    fields: {
      accountId: 'account_id',
      providerId: 'provider_id',
      userId: 'user_id',
      accessToken: 'access_token',
      refreshToken: 'refresh_token',
      idToken: 'id_token',
      accessTokenExpiresAt: 'access_token_expires_at',
      refreshTokenExpiresAt: 'refresh_token_expires_at',
      createdAt: 'created_at',
      updatedAt: 'updated_at',
    },
  },
  verification: {
    fields: {
      expiresAt: 'expires_at',
      createdAt: 'created_at',
      updatedAt: 'updated_at',
    },
  },
  advanced: {
    database: { generateId: () => uuidv7() },
  },
  plugins: [admin(), nextCookies()],
})
