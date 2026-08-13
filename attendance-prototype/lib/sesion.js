/**
 * lib/sesion.js — Sesión, empresa y permisos.
 *
 * Es el punto por el que pasa toda petición del panel, y devuelve las tres
 * cosas que hacen falta para atenderla: quién es, a qué EMPRESA pertenece y
 * qué puede hacer. El esquema que sale de aquí es el que se le pasa a
 * `conEmpresa()` para consultar.
 *
 * Los usuarios y sus roles viven en el esquema compartido `control`
 * (ver lib/roles.js y lib/auth.js).
 */
import { headers } from 'next/headers'
import { auth, pool } from './auth'
import { puede, sedeDelAlcance } from './roles.js'
import { empresaPorId, empresaDelDispositivo, puedeEscribir } from './empresas.js'

/**
 * Usuario de la sesión con su rol, o null si no hay sesión válida.
 * No redirige: eso lo decide quien llama.
 */
export async function obtenerSesion() {
  const sesion = await auth.api.getSession({ headers: await headers() })
  if (!sesion?.user) return null

  // `tieneContrasena` decide si al entrar hay que pedirle una. Quien se
  // registró con Google no tiene ninguna, y sin ella no puede abrir el panel
  // desde el celular: Google bloquea su inicio de sesión dentro de una app.
  const { rows } = await pool.query(
    `select u.id, u.email, u.name as nombre, u.rol, u.image as foto,
            u.empresa_id as "empresaId", u.activo,
            exists (
              select 1 from control.account a
               where a.user_id = u.id
                 and a.provider_id = 'credential'
                 and a.password is not null
            ) as "tieneContrasena"
       from control."user" u where u.id = $1`,
    [sesion.user.id],
  )
  return rows[0] ?? null
}

/** ¿El usuario puede ejecutar esta acción? (ver | corregir | empleados | config | usuarios | liquidar) */
export function tienePermiso(usuario, accion) {
  return puede(usuario?.rol, accion)
}

/**
 * Estado de acceso a una acción. Devuelve un objeto en vez de redirigir, para
 * que la página o el endpoint decidan qué responder.
 *
 * `esquema` es el de la empresa del usuario: se le pasa a `conEmpresa()`. Si
 * viene null NO se debe consultar nada — no hay contra qué.
 *
 * `sedeLimite` trae la sede a la que está restringido el usuario (supervisor)
 * o null si ve todas: quien consulta datos debe filtrar por ella.
 *
 * @param {'ver'|'corregir'|'empleados'|'config'|'usuarios'|'liquidar'} accion
 */
export async function estadoAcceso(accion = 'ver') {
  const vacio = { usuario: null, empresa: null, esquema: null, sedeLimite: null }

  const usuario = await obtenerSesion()
  if (!usuario) return { estado: 'SIN_SESION', ...vacio }
  if (!usuario.activo) return { estado: 'CUENTA_INACTIVA', ...vacio, usuario }

  // Sin empresa no hay nada que ver. Pasa con quien acaba de registrarse y
  // todavía no completó el alta, o con quien llegó por una invitación vencida.
  const empresa = await empresaPorId(usuario.empresaId)
  if (!empresa) return { estado: 'SIN_EMPRESA', ...vacio, usuario }

  if (!tienePermiso(usuario, accion)) {
    return { estado: 'SIN_PERMISO', ...vacio, usuario, empresa }
  }

  // Suscripción vencida: la empresa entra, consulta y exporta, pero no escribe.
  // La regla cabe en una línea porque `ver` es la única acción de lectura del
  // vocabulario de permisos; las otras cinco son todas de escritura, así que
  // se bloquean sin tener que enumerarlas.
  if (accion !== 'ver' && !puedeEscribir(empresa)) {
    return { estado: 'SUSCRIPCION_VENCIDA', ...vacio, usuario, empresa }
  }

  return {
    estado: 'OK',
    usuario,
    empresa,
    esquema: empresa.esquema,
    sedeLimite: sedeDelAlcance(usuario),
  }
}

/**
 * Empresa de una petición que puede venir del KIOSCO o del panel.
 *
 * El kiosco no tiene sesión: se identifica con `X-Device-Key`, y de ahí sale
 * su empresa. Si no hay clave de dispositivo se cae a la sesión, que es como
 * entra el administrador desde su celular y como funciona en desarrollo.
 *
 * @returns {Promise<{empresa: object, esquema: string, dispositivo: object|null}|null>}
 */
export async function empresaDeLaPeticion(req) {
  const clave = req?.headers?.get?.('x-device-key')
  if (clave) {
    const r = await empresaDelDispositivo(clave)
    if (r) return { empresa: r.empresa, esquema: r.empresa.esquema, dispositivo: r.dispositivo }
    return null // clave enviada pero inválida: no se cae a la sesión en silencio
  }
  const { estado, empresa } = await estadoAcceso('ver')
  if (estado !== 'OK') return null
  return { empresa, esquema: empresa.esquema, dispositivo: null }
}

/** Código HTTP que corresponde a cada estado de acceso. */
export function estadoAHttp(estado) {
  if (estado === 'SIN_SESION') return 401
  if (estado === 'SUSCRIPCION_VENCIDA') return 402 // Payment Required
  return 403
}

/** Mensaje por defecto para cada estado, en el idioma del panel. */
export function estadoAMensaje(estado) {
  return {
    SIN_SESION: 'Sin sesión.',
    CUENTA_INACTIVA: 'Tu cuenta está desactivada.',
    SIN_EMPRESA: 'Tu cuenta todavía no pertenece a ninguna empresa.',
    SIN_PERMISO: 'Sin permiso para esta acción.',
    SUSCRIPCION_VENCIDA: 'La suscripción venció: el panel quedó en solo lectura. Puedes consultar y exportar.',
  }[estado] ?? 'Sin acceso.'
}
