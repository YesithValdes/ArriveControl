/**
 * lib/db.js — Pool único de PostgreSQL para toda la app (y los scripts).
 * Singleton sobre globalThis: en dev, el hot-reload reevalúa módulos y sin
 * esta guarda se crearía un Pool nuevo por recarga hasta agotar conexiones.
 */
import pg from 'pg'

if (!process.env.DATABASE_URL) {
  throw new Error('Falta DATABASE_URL: debe apuntar a la misma base que el gestor de empleados.')
}

// TLS: obligatorio contra Supabase (host remoto); innecesario contra el
// Postgres embebido local. rejectUnauthorized:false porque el pooler de
// Supabase presenta un certificado de su propia CA (igual que hace Prisma).
const esLocal = /localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL)

const g = globalThis
export const pool = g.__arriveControlPool ?? new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: esLocal ? false : { rejectUnauthorized: false },
})
if (process.env.NODE_ENV !== 'production') g.__arriveControlPool = pool
