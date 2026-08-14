/**
 * lib/dispositivos.js — Activación y validación de dispositivos del kiosco
 * (solo servidor). Cada aparato se activa una vez con sesión de admin y recibe
 * una clave propia; las APIs del kiosco exigen esa clave en X-Device-Key.
 *
 * Los dispositivos viven en el esquema COMPARTIDO `control`, no en el de la
 * empresa. Tienen que: el kiosco no trae sesión, así que hay que averiguar de
 * qué empresa es la tablet ANTES de poder abrir su esquema. Por eso cada fila
 * lleva su `empresa_id`.
 *
 * `sede_id` sí apunta al esquema de la empresa y va sin llave foránea — la
 * base no puede validarlo, así que se valida al activar el dispositivo.
 */
import { createHash, randomBytes, randomInt } from 'node:crypto'
import { control, conEmpresa, enTransaccion } from './db.js'

const sha256 = (s) => createHash('sha256').update(s).digest('hex')

/**
 * Activa un dispositivo nuevo. La clave se genera aquí y se devuelve UNA sola
 * vez; en la base queda solo el hash.
 *
 * @param {{empresa: object, nombre: string, sedeId?: string, activadoPor?: string}} p
 */
export async function activarDispositivo({ empresa, nombre, sedeId = null, activadoPor = null }) {
  // La sede debe existir y ser de ESTA empresa. Sin llave foránea que cruce de
  // esquema, esta comprobación es lo único que impide apuntar a la sede de
  // otro cliente.
  if (sedeId) {
    const existe = await conEmpresa(empresa.esquema, async (db) =>
      (await db.query(`select 1 from sedes where id = $1`, [sedeId])).rowCount > 0,
    )
    if (!existe) return { error: 'SEDE_NO_ENCONTRADA' }
  }

  const clave = randomBytes(24).toString('base64url') // ~32 chars, url-safe
  const { rows } = await control(
    `insert into control.dispositivos (empresa_id, nombre, sede_id, clave_hash, activado_por)
     values ($1,$2,$3,$4,$5)
     returning id, nombre, sede_id, creada_en`,
    [empresa.id, nombre, sedeId, sha256(clave), activadoPor],
  )
  return { ...rows[0], clave }
}

/** Dispositivos de una empresa, con el nombre de su sede. */
export async function listarDispositivos(empresa) {
  const { rows } = await control(
    `select d.id, d.nombre, d.sede_id, d.activo, d.activado_por, d.creada_en, d.ultimo_uso
       from control.dispositivos d
      where d.empresa_id = $1
      order by d.creada_en desc`,
    [empresa.id],
  )
  if (rows.length === 0) return rows

  // El nombre de la sede vive en el esquema de la empresa, así que no se puede
  // resolver con un join desde `control`: se trae aparte y se cruza en memoria.
  const sedes = await conEmpresa(empresa.esquema, async (db) =>
    (await db.query(`select id, nombre from sedes`)).rows,
  )
  const porId = new Map(sedes.map((s) => [s.id, s.nombre]))
  return rows.map((d) => ({ ...d, sede_nombre: porId.get(d.sede_id) ?? null }))
}

// ── Vinculación por código ─────────────────────────────────────────────
//
// Activar un kiosco sin iniciar sesión en él. El administrador genera el
// código desde el panel (donde sí tiene sesión) y lo teclea en el aparato.
// Ver db/migrations/control/004_vinculaciones.sql para el porqué.

/** 8 dígitos con aleatoriedad criptográfica: es una credencial, no un id. */
const generarCodigo = () => String(randomInt(0, 100_000_000)).padStart(8, '0')

/** 12345678 → "1234-5678". Solo para mostrar; en la base va sin guion. */
export const formatearCodigo = (c) => `${c.slice(0, 4)}-${c.slice(4)}`

/**
 * Crea un código para vincular un aparato nuevo, o para RECONECTAR uno que ya
 * existe (dispositivoId): mismo dispositivo, clave nueva al canjear.
 * El nombre y la sede se deciden AQUÍ, no en el aparato: así un kiosco no
 * puede asignarse a una sede que no le corresponde.
 */
export async function crearVinculacion({ empresa, nombre, sedeId = null, creadaPor = null, dispositivoId = null }) {
  // Reconexión: el nombre y la sede salen del dispositivo ya registrado, no
  // del cuerpo de la petición — y el dispositivo debe ser de ESTA empresa.
  if (dispositivoId) {
    const { rows } = await control(
      `select nombre, sede_id from control.dispositivos where id = $1 and empresa_id = $2`,
      [dispositivoId, empresa.id],
    )
    if (rows.length === 0) return { error: 'DISPOSITIVO_NO_ENCONTRADO' }
    nombre = rows[0].nombre
    sedeId = rows[0].sede_id
  } else if (sedeId) {
    const existe = await conEmpresa(empresa.esquema, async (db) =>
      (await db.query(`select 1 from sedes where id = $1`, [sedeId])).rowCount > 0,
    )
    if (!existe) return { error: 'SEDE_NO_ENCONTRADA' }
  }

  // Reintento por si el código ya existía: con 100 millones es rarísimo, pero
  // la clave primaria lo rechazaría y el usuario vería un error incomprensible.
  for (let intento = 0; intento < 5; intento++) {
    try {
      const { rows } = await control(
        `insert into control.vinculaciones (codigo, empresa_id, nombre, sede_id, creada_por, dispositivo_id)
         values ($1,$2,$3,$4,$5,$6)
         returning codigo, expira_en`,
        [generarCodigo(), empresa.id, nombre, sedeId, creadaPor, dispositivoId],
      )
      return { ...rows[0], nombre }
    } catch (e) {
      if (e.code !== '23505') throw e
    }
  }
  return { error: 'NO_SE_PUDO_GENERAR' }
}

/**
 * Canjea un código por la clave definitiva del dispositivo.
 *
 * Esta es la ÚNICA operación del sistema que se atiende sin sesión y sin clave
 * de dispositivo — el código es toda la credencial. Por eso: de un solo uso,
 * caduca en minutos, y se marca como usado dentro de la misma transacción en
 * que se crea el aparato, para que dos canjes simultáneos no den dos claves.
 *
 * @returns {Promise<{clave, nombre, sedeId, empresa}|{error}>}
 */
export async function canjearVinculacion(codigoCrudo) {
  const codigo = String(codigoCrudo ?? '').replace(/\D/g, '')
  if (!/^\d{8}$/.test(codigo)) return { error: 'CODIGO_INVALIDO' }

  return enTransaccion(async (db) => {
    // `for update` serializa dos canjes del mismo código: el segundo espera y
    // encuentra `usada_en` ya puesto.
    const { rows } = await db.query(
      `select v.codigo, v.empresa_id, v.nombre, v.sede_id, v.expira_en, v.usada_en, v.dispositivo_id,
              e.esquema, e.nombre as empresa_nombre
         from control.vinculaciones v
         join control.empresas e on e.id = v.empresa_id
        where v.codigo = $1
        for update of v`,
      [codigo],
    )
    const v = rows[0]
    if (!v) return { error: 'CODIGO_INVALIDO' }
    if (v.usada_en) return { error: 'CODIGO_USADO' }
    if (new Date(v.expira_en) < new Date()) return { error: 'CODIGO_VENCIDO' }

    const clave = randomBytes(24).toString('base64url')
    if (v.dispositivo_id) {
      // RECONEXIÓN: el dispositivo ya existe — clave nueva (la anterior muere
      // aquí mismo) y vuelve activo, conservando nombre, sede e historial.
      const { rowCount } = await db.query(
        `update control.dispositivos
            set clave_hash = $1, activo = true, activado_por = $2
          where id = $3 and empresa_id = $4`,
        [sha256(clave), `reconexión ${codigo}`, v.dispositivo_id, v.empresa_id],
      )
      if (rowCount === 0) return { error: 'CODIGO_INVALIDO' } // el aparato ya no existe
    } else {
      await db.query(
        `insert into control.dispositivos (empresa_id, nombre, sede_id, clave_hash, activado_por)
         values ($1,$2,$3,$4,$5)`,
        [v.empresa_id, v.nombre, v.sede_id, sha256(clave), `vinculación ${codigo}`],
      )
    }
    await db.query(
      `update control.vinculaciones set usada_en = now() where codigo = $1`, [codigo],
    )
    return { clave, nombre: v.nombre, sedeId: v.sede_id, empresa: v.empresa_nombre }
  })
}

/** Códigos vivos de una empresa, para mostrarlos en el panel. */
export async function vinculacionesPendientes(empresa) {
  const { rows } = await control(
    `select codigo, nombre, sede_id, expira_en
       from control.vinculaciones
      where empresa_id = $1 and usada_en is null and expira_en > now()
      order by creada_en desc`,
    [empresa.id],
  )
  return rows
}

/**
 * Revoca (desactiva) un dispositivo. El aparato queda fuera al instante.
 * Se exige la empresa para que nadie revoque el kiosco de otro cliente.
 */
export async function revocarDispositivo(empresa, id) {
  const { rowCount } = await control(
    `update control.dispositivos set activo = false
      where id = $1 and empresa_id = $2`,
    [id, empresa.id],
  )
  return rowCount > 0
}
