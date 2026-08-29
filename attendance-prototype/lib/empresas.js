/**
 * lib/empresas.js — Quién es cada empresa y cómo nace una nueva.
 *
 * Es el puente entre «quién hizo esta petición» y «contra qué esquema se
 * consulta». Hay tres formas de entrar al sistema y cada una resuelve la
 * empresa por su lado:
 *
 *   Panel   · cookie de sesión → control."user".empresa_id
 *   Kiosco  · X-Device-Key     → control.dispositivos.clave_hash
 *   Nómina  · X-API-Key        → control.empresas.api_key
 *
 * Las tres terminan en lo mismo: el nombre del esquema que hay que fijar en el
 * `search_path` de esa petición.
 */
import { createHash, randomBytes } from 'node:crypto'
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import path from 'node:path'
import { control, conEmpresa, enTransaccion } from './db.js'

const sha256 = (s) => createHash('sha256').update(s).digest('hex')

/** Columnas que necesita cualquiera que resuelva una empresa. */
const CAMPOS = `id, nombre, esquema, plan, limite_empleados, estado, api_key, dominio, vence_en`


// Caché corta: son pocas filas, cambian casi nunca y se consultan en CADA
// petición. El TTL evita tener que invalidarla a mano al cambiar de plan.
const TTL_MS = 60 * 1000
const cache = new Map() // clave → { datos, expira }

const desdeCache = async (clave, buscar) => {
  const hit = cache.get(clave)
  if (hit && Date.now() < hit.expira) return hit.datos
  const datos = await buscar()
  cache.set(clave, { datos, expira: Date.now() + TTL_MS })
  return datos
}

/** Olvida lo cacheado. Llamar tras crear una empresa o cambiarle el plan. */
export const olvidarEmpresas = () => cache.clear()

/** @returns {Promise<object|null>} */
export async function empresaPorId(id) {
  if (!id) return null
  return desdeCache(`id:${id}`, async () => {
    const { rows } = await control(`select ${CAMPOS} from control.empresas where id = $1`, [id])
    return rows[0] ?? null
  })
}

/** Empresa dueña de una clave de API (la que usa la nómina en GET /api/horas). */
export async function empresaPorApiKey(clave) {
  if (!clave) return null
  return desdeCache(`api:${sha256(clave)}`, async () => {
    const { rows } = await control(`select ${CAMPOS} from control.empresas where api_key = $1`, [clave])
    return rows[0] ?? null
  })
}

/**
 * Empresa y dispositivo de una petición del kiosco, que NO trae sesión.
 *
 * Los dispositivos viven en `control` justamente por esto: hay que saber de
 * qué empresa es la tablet antes de poder abrir su esquema. La búsqueda por
 * hash funciona porque es sha256 (determinista); con bcrypt habría que
 * recorrer los dispositivos de todas las empresas.
 *
 * @returns {Promise<{dispositivo: object, empresa: object}|null>}
 */
export async function empresaDelDispositivo(clave) {
  if (!clave) return null
  const { rows } = await control(
    `update control.dispositivos set ultimo_uso = now()
      where clave_hash = $1 and activo
      returning id, nombre, sede_id, empresa_id`,
    [sha256(clave)],
  )
  const dispositivo = rows[0]
  if (!dispositivo) return null
  const empresa = await empresaPorId(dispositivo.empresa_id)
  return empresa ? { dispositivo, empresa } : null
}

/** ¿Esta empresa puede ESCRIBIR, o está en solo lectura por impago? */
/**
 * ¿Tiene suscripción vigente?
 *
 * Es la única puerta: sin ella no se puede registrar gente ni marcar. Ya no
 * existe el plan gratuito — usar el sistema exige estar al día.
 *
 * Se compara contra la FECHA, no contra el estado: `estado = 'activa'` sin
 * `vence_en` sería una suscripción eterna creada por un error de datos.
 */
export const suscripcionVigente = (empresa) =>
  Boolean(empresa)
  && empresa.estado === 'activa'
  && Boolean(empresa.vence_en)
  && new Date(empresa.vence_en).getTime() > Date.now()

/**
 * Quien no está al día puede CONSULTAR y exportar, pero no escribir.
 *
 * Sus datos no se secuestran nunca: puede entrar al panel, ver su historial y
 * llevárselo. Lo que se detiene es el servicio — registrar empleados y marcar
 * asistencia — hasta que renueve.
 */
export const puedeEscribir = (empresa) => suscripcionVigente(empresa)

/**
 * Cómo está esta empresa de cara al plan, en una sola forma para el panel.
 * Todo lo que la pantalla necesita para decidir qué mostrar, sin que tenga
 * que recomponer la regla (y arriesgarse a decir algo distinto del servidor).
 */
export function estadoDelPlan(empresa) {
  if (!empresa) return null
  const vigente = suscripcionVigente(empresa)
  const vence = empresa.vence_en ? new Date(empresa.vence_en) : null
  return {
    plan: empresa.plan,
    estado: empresa.estado,
    vigente,
    // Se redondea hacia ARRIBA: el último día también cuenta como un día.
    diasRestantes: vigente ? Math.ceil((vence.getTime() - Date.now()) / 86400000) : 0,
    venceEn: vence ? vence.toISOString() : null,
    // Nunca pagó: es quien ve la oferta de entrada.
    nunca: !vence,
    limite: empresa.limite_empleados ?? null,
  }
}

/**
 * ¿Cabe un empleado más en esta empresa?
 *
 * Se cuenta en el servidor, no en la pantalla. Sin suscripción vigente no
 * cabe nadie: es la puerta del modelo de cobro. Eso NO borra ni desactiva a
 * quien ya estaba registrado — solo impide agregar más.
 *
 * @returns {Promise<{cabe: boolean, actuales: number, limite: number|null}>}
 */
export async function cabeOtroEmpleado(empresa) {
  if (!suscripcionVigente(empresa)) {
    return { cabe: false, actuales: 0, limite: 0, sinSuscripcion: true }
  }
  // Con suscripción al día no hay tope: los planes son de empleados
  // ilimitados. `limite_empleados` se conserva para acuerdos puntuales.
  const limite = empresa?.limite_empleados ?? null
  if (limite == null) return { cabe: true, actuales: 0, limite: null }
  const actuales = await conEmpresa(empresa.esquema, async (db) =>
    Number((await db.query(`select count(*)::int as n from empleados where activo`)).rows[0].n),
  )
  return { cabe: actuales < limite, actuales, limite }
}

// ── Alta de una empresa ────────────────────────────────────────────────

/** Nombre de esquema a partir del nombre comercial: 'El Trigo S.A.' → 'el_trigo'. */
export function esquemaDesdeNombre(nombre) {
  const base = String(nombre ?? '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')   // quita tildes
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 32)
  // Debe empezar por letra y tener al menos 3 caracteres (lo exige el check).
  return /^[a-z]/.test(base) && base.length >= 3 ? base : `emp_${base || 'nueva'}`
}

/**
 * Las migraciones de `db/migrations/empresa/`, en orden.
 *
 * Se leen del disco, así que dependen de que esos .sql estén DESPLEGADOS junto
 * al código. Next solo empaqueta lo que ve importado, y esto no lo es: la
 * inclusión se declara a mano en `outputFileTracingIncludes` (next.config.mjs).
 * Si alguien la quita, esto es lo único que se rompe — y solo en producción.
 */
function plantillaEmpresa() {
  const dir = path.join(process.cwd(), 'db', 'migrations', 'empresa')
  if (!existsSync(dir)) {
    throw new Error(
      `No se encontró ${dir}. Si esto pasa en el servidor y no en local, `
      + 'faltan los .sql en el paquete: revisa `outputFileTracingIncludes` en next.config.mjs.',
    )
  }
  const archivos = readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()
  if (archivos.length === 0) {
    throw new Error(`${dir} está vacío: sin plantilla no se puede crear una empresa.`)
  }
  return archivos.map((f) => ({ archivo: f, sql: readFileSync(path.join(dir, f), 'utf8') }))
}

/**
 * Crea una empresa: su fila en el directorio, su esquema, sus tablas y su
 * configuración laboral. Todo en UNA transacción — en Postgres el DDL es
 * transaccional, así que una empresa a medio crear no puede quedar existiendo.
 *
 * NO crea el usuario dueño: de eso se encarga quien la llama (el registro con
 * Google, o el script de alta), porque la contraseña y la sesión son asunto de
 * Better Auth.
 *
 * @param {{nombre: string, nit?: string, dominio?: string, esquema?: string}} datos
 * @returns {Promise<object>} la fila de control.empresas
 */
export async function crearEmpresa({ nombre, nit = null, dominio = null, esquema = null }) {
  const nom = String(nombre ?? '').trim()
  if (!nom) throw new Error('La empresa necesita un nombre.')

  const base = esquema ?? esquemaDesdeNombre(nom)
  const migraciones = plantillaEmpresa()

  const { rows: usados } = await control(`select esquema from control.empresas`)
  const ocupados = new Set(usados.map((r) => r.esquema))
  // Un sufijo numérico resuelve el choque de dos empresas con el mismo nombre,
  // que en un registro abierto va a pasar (dos «Panadería El Trigo»).
  let elegido = base
  for (let i = 2; ocupados.has(elegido); i++) elegido = `${base}_${i}`.slice(0, 40)

  const apiKey = randomBytes(24).toString('base64url')

  const empresa = await enTransaccion(async (db) => {
    const { rows } = await db.query(
      // Nace SIN suscripción: el primer paso del cliente es elegir un
      // paquete. Hasta entonces entra al panel, pero no registra ni marca.
      `insert into control.empresas (nombre, nit, dominio, esquema, api_key, limite_empleados)
       values ($1, $2, $3, $4, $5, null)
       returning ${CAMPOS}`,
      [nom, nit, dominio, elegido, apiKey],
    )

    await db.query(`create schema ${elegido}`)
    await db.query(`
      create table ${elegido}._migraciones (
        archivo     text primary key,
        aplicada_en timestamptz not null default now()
      )`)
    for (const m of migraciones) {
      await db.query(`set local search_path to ${elegido}`)
      await db.query(m.sql)
      await db.query(
        `insert into ${elegido}._migraciones (archivo) values ($1)`, [m.archivo],
      )
    }
    return rows[0]
  })

  olvidarEmpresas()
  return empresa
}
