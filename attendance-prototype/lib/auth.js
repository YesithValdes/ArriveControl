/**
 * lib/auth.js — Better Auth contra el esquema COMPARTIDO `control`.
 *
 * La identidad es global, no de una empresa. Tiene que serlo: para saber a qué
 * empresa pertenece alguien hay que leer su usuario, y para leer su usuario
 * habría que saber ya en qué esquema buscar. El huevo y la gallina.
 *
 * Cómo encuentra sus tablas: Better Auth las nombra sin esquema (user, session,
 * account, verification) y este pool fija `search_path=control,public`. Ese
 * valor se define AL CREAR EL POOL, no por petición — otra razón por la que la
 * identidad no puede vivir en el esquema de cada empresa.
 *
 * Es un pool aparte del de datos (lib/db.js) a propósito, y las dos
 * responsabilidades quedan limpias:
 *   · este pool  → `control`, fijo, nunca cambia
 *   · lib/db.js  → el esquema de la empresa, distinto en cada petición
 */
import { betterAuth } from 'better-auth'
import { admin } from 'better-auth/plugins'
import { nextCookies } from 'better-auth/next-js'
import { Pool } from 'pg'
// Con extensión: Next resuelve sin ella, pero los scripts de db/ corren en
// node "pelado" (ESM) y ahí la extensión es obligatoria.
import { uuidv7 } from './uuidv7.js'
import { asignarEmpresa } from './registro.js'

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
    options: '-c search_path=control,public',
  })
if (process.env.NODE_ENV !== 'production') globalParaPg.__arriveControlAuthPool = pool

export const auth = betterAuth({
  baseURL: process.env.BETTER_AUTH_URL,
  secret: process.env.BETTER_AUTH_SECRET,
  trustedOrigins: process.env.BETTER_AUTH_TRUSTED_ORIGINS?.split(',').map((s) => s.trim()).filter(Boolean),
  database: pool,
  // ── Cómo se entra ────────────────────────────────────────────────────
  //
  // Google es el único método en producción. No es solo comodidad: con una
  // cuenta por persona, cada corrección de asistencia queda firmada por quien
  // la hizo, y sacar a alguien de la empresa es desactivar SU usuario y no
  // rotar una contraseña que todos conocían.
  socialProviders: {
    google: {
      clientId: process.env.GOOGLE_CLIENT_ID ?? '',
      clientSecret: process.env.GOOGLE_CLIENT_SECRET ?? '',
    },
  },
  // Correo y contraseña solo en DESARROLLO: sin esto haría falta conexión a
  // Google (y credenciales de OAuth) para poder abrir el panel en local.
  emailAndPassword: {
    enabled: process.env.NODE_ENV !== 'production',
    disableSignUp: true, // ni siquiera en local se crean cuentas por aquí
  },

  // El registro es SELF-SERVICE: quien entra por primera vez sale con empresa.
  // Se hace en este hook y no en la pantalla de login porque es el único punto
  // por el que pasan todos los caminos de alta (Google hoy, otro proveedor
  // mañana), y porque debe ocurrir en el servidor: la empresa y su esquema no
  // pueden depender de que el navegador complete una segunda petición.
  databaseHooks: {
    user: {
      create: {
        after: async (user) => {
          try {
            await asignarEmpresa(user)
          } catch (e) {
            // Un fallo aquí deja al usuario SIN empresa, no a medias: el panel
            // lo recibe con SIN_EMPRESA y puede reintentar. Peor sería tumbar
            // el inicio de sesión y dejarlo sin poder entrar nunca.
            console.error('Registro: no se pudo asignar empresa:', e.message)
          }
        },
      },
    },
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
      // `input: false` en rol: es el servidor quien lo decide (registro.js o el
      // script del superadmin). Si fuera de entrada, el propio formulario de
      // registro podría pedir rol='superadmin' y concedérselo.
      rol: { type: 'string', required: false, input: false },
      activo: { type: 'boolean', required: false, input: true },
      // A qué empresa pertenece. NULL mientras no tenga ninguna: con ese valor
      // no autoriza nada, y es lo que hace seguro el registro abierto.
      // También `input: false`, y por el mismo motivo: si el cliente pudiera
      // enviarlo, cualquiera se registraría diciendo pertenecer a la empresa
      // de otro. Lo asigna registro.js, en el servidor.
      empresaId: { type: 'string', required: false, input: false, fieldName: 'empresa_id' },
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
