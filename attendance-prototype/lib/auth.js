/**
 * lib/auth.js — Better Auth apuntando a la MISMA base de datos que la
 * plataforma de Gestión Humana (gestor de empleados).
 *
 * Modelo elegido: base de datos compartida. Los usuarios, roles y permisos
 * viven en el gestor; aquí solo se validan. Consecuencias:
 *
 *  - NO se crean usuarios desde esta app (`disableSignUp: true`). El alta la
 *    hace el administrador en el gestor (Configuración → Usuarios).
 *  - BETTER_AUTH_SECRET debe ser IDÉNTICO al del gestor: es lo que firma la
 *    cookie de sesión. Si difiere, cada app rechaza la sesión de la otra.
 *  - Los IDs los genera PostgreSQL (uuid v7 por DEFAULT en el esquema del
 *    gestor), por eso `generateId: false`.
 *  - Los campos extra del usuario (rolId, estado…) se declaran igual que allá
 *    para que Better Auth los devuelva en la sesión.
 *
 * En local ambas apps corren en localhost (puertos 3000 y 3001) y las cookies
 * se comparten porque el puerto no forma parte del dominio de la cookie.
 * En producción tendrían que ser subdominios del mismo dominio padre.
 */
import { betterAuth } from 'better-auth'
import { admin } from 'better-auth/plugins'
import { nextCookies } from 'better-auth/next-js'
import { Pool } from 'pg'
import { uuidv7 } from './uuidv7'

if (!process.env.DATABASE_URL) {
  throw new Error('Falta DATABASE_URL: debe apuntar a la misma base que el gestor de empleados.')
}
if (!process.env.BETTER_AUTH_SECRET) {
  throw new Error('Falta BETTER_AUTH_SECRET: debe ser el mismo valor que en el gestor de empleados.')
}

// Singleton sobre globalThis, igual que `src/lib/db.ts` en el gestor: en dev
// cada recarga en caliente vuelve a evaluar el módulo, y sin esta guarda se
// crearía un Pool nuevo cada vez hasta agotar las conexiones de PostgreSQL.
const globalParaPg = globalThis
export const pool =
  globalParaPg.__arriveControlPool ?? new Pool({ connectionString: process.env.DATABASE_URL })
if (process.env.NODE_ENV !== 'production') globalParaPg.__arriveControlPool = pool

export const auth = betterAuth({
  baseURL: process.env.BETTER_AUTH_URL,
  secret: process.env.BETTER_AUTH_SECRET,
  trustedOrigins: process.env.BETTER_AUTH_TRUSTED_ORIGINS?.split(',').map((s) => s.trim()).filter(Boolean),
  database: pool,
  emailAndPassword: {
    enabled: true,
    disableSignUp: true, // el alta de usuarios es exclusiva del gestor
  },
  // El esquema lo creó Prisma en el gestor con nombres snake_case. Better Auth
  // sobre `pg` asume camelCase, así que hay que mapear columna por columna: sin
  // esto toda consulta falla con «column does not exist».
  user: {
    fields: {
      emailVerified: 'email_verified',
      createdAt: 'created_at',
      updatedAt: 'updated_at',
      banReason: 'ban_reason',
      banExpires: 'ban_expires',
    },
    additionalFields: {
      rolId: { type: 'string', required: true, input: true, fieldName: 'rol_id' },
      estado: { type: 'string', required: false, input: true },
      debeCambiarPassword: { type: 'boolean', required: false, input: true, fieldName: 'debe_cambiar_password' },
      telefonoE164: { type: 'string', required: false, input: true, fieldName: 'telefono_e164' },
      whatsappOptIn: { type: 'boolean', required: false, input: true, fieldName: 'whatsapp_opt_in' },
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
    // OJO: aquí NO vale `generateId: false`, aunque el gestor lo use. Allá el
    // uuid v7 lo pone Prisma Client; las columnas `id` no tienen DEFAULT en
    // PostgreSQL. Como esta app inserta por `pg`, si delegáramos en la base el
    // INSERT fallaría con «null value in column "id"».
    database: { generateId: () => uuidv7() },
  },
  plugins: [admin(), nextCookies()],
})
