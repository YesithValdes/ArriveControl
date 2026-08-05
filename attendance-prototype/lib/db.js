/**
 * lib/db.js — Pool único de PostgreSQL para toda la app (y los scripts).
 * Singleton sobre globalThis: en dev, el hot-reload reevalúa módulos y sin
 * esta guarda se crearía un Pool nuevo por recarga hasta agotar conexiones.
 */
import pg from 'pg'

if (!process.env.DATABASE_URL) {
  throw new Error('Falta DATABASE_URL: debe apuntar a la misma base que el gestor de empleados.')
}

const g = globalThis
export const pool = g.__arriveControlPool ?? new pg.Pool({ connectionString: process.env.DATABASE_URL })
if (process.env.NODE_ENV !== 'production') g.__arriveControlPool = pool
