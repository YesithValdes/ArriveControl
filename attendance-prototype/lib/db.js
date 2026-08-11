/**
 * lib/db.js — Acceso a Postgres, SIEMPRE dentro de una empresa.
 *
 * ArriveControl es multi-empresa: cada cliente tiene su propio esquema
 * (`smartgadgets`, `t_acme`, …) con las mismas tablas. El esquema NO se escribe
 * en las consultas; se fija por petición con `search_path`, y por eso el SQL de
 * toda la aplicación va sin prefijo:
 *
 *     await conEmpresa(esquema, (db) =>
 *       db.query('select id, nombre from empleados where activo'))
 *
 * Este módulo NO exporta el pool. Es deliberado: una consulta suelta contra el
 * pool no tendría empresa, y en un producto donde cada esquema es un cliente
 * distinto eso significa leer datos ajenos. Si no hay a qué consultarle sin
 * pasar por aquí, ese error no se puede escribir.
 */
import pg from 'pg'

if (!process.env.DATABASE_URL) {
  throw new Error('Falta DATABASE_URL.')
}

// TLS: obligatorio contra Supabase (host remoto); innecesario contra el
// Postgres local. rejectUnauthorized:false porque el pooler de Supabase
// presenta un certificado de su propia CA (igual que hace Prisma).
const esLocal = /localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL)

// Singleton sobre globalThis: en dev el hot-reload reevalúa módulos y sin esta
// guarda se crearía un Pool nuevo por recarga hasta agotar conexiones.
const g = globalThis
const pool = g.__arriveControlPool ?? new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: esLocal ? false : { rejectUnauthorized: false },
})
if (process.env.NODE_ENV !== 'production') g.__arriveControlPool = pool

/**
 * Mismo patrón que exige `control.empresas.esquema`. El nombre de un esquema
 * no se puede parametrizar (`$1` no vale para identificadores), así que se
 * interpola — y esta comprobación es la única defensa contra una inyección por
 * ahí. Está aquí y en la base a propósito: en los dos lados.
 */
const ESQUEMA_OK = /^[a-z][a-z0-9_]{2,40}$/

/**
 * Ejecuta `fn` con una conexión apuntando al esquema de una empresa.
 *
 * Va dentro de una TRANSACCIÓN por una razón concreta: `set local` solo existe
 * dentro de una y se deshace sola al terminar. Con un `set` a secas habría que
 * acordarse de hacer `reset`, y si algo falla entre medias la conexión vuelve
 * al pool con el esquema de OTRA empresa puesto. Ese es exactamente el fallo
 * que no puede ocurrir aquí.
 *
 * De regalo, cada petición queda siendo atómica.
 *
 * @param {string} esquema  nombre validado, tal como está en control.empresas
 * @param {(db: import('pg').PoolClient) => Promise<any>} fn
 */
export async function conEmpresa(esquema, fn) {
  if (!ESQUEMA_OK.test(String(esquema ?? ''))) {
    throw new Error(`Esquema de empresa inválido: "${esquema}".`)
  }
  const client = await pool.connect()
  try {
    await client.query('begin')
    await client.query(`set local search_path to ${esquema}`)
    const r = await fn(client)
    await client.query('commit')
    return r
  } catch (e) {
    try { await client.query('rollback') } catch { /* la conexión ya murió */ }
    throw e
  } finally {
    client.release()
  }
}

/**
 * Consulta contra el esquema COMPARTIDO `control` (empresas, usuarios,
 * invitaciones, dispositivos). Se usa antes de saber de qué empresa se trata,
 * y por eso escribe el esquema explícito en el SQL en vez de fijar
 * `search_path`: así se distingue de un vistazo qué toca datos de un cliente y
 * qué toca el directorio.
 */
export function control(texto, args = []) {
  return pool.query(texto, args)
}

/**
 * Una transacción sin esquema fijado, para trabajo que abarca `control` y el
 * esquema de una empresa a la vez — en la práctica, solo el alta de empresas:
 * crear el esquema, correr sus migraciones e insertar su fila deben ocurrir
 * juntos o no ocurrir. En Postgres el DDL es transaccional, así que una
 * empresa a medio crear no puede quedar existiendo.
 */
export async function enTransaccion(fn) {
  const client = await pool.connect()
  try {
    await client.query('begin')
    const r = await fn(client)
    await client.query('commit')
    return r
  } catch (e) {
    try { await client.query('rollback') } catch { /* la conexión ya murió */ }
    throw e
  } finally {
    client.release()
  }
}
