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
import { headers, cookies } from 'next/headers'
import { auth, pool } from './auth'
import { puede, sedeDelAlcance, esSuperadmin } from './roles.js'
import { empresaPorId, empresaDelDispositivo, puedeEscribir } from './empresas.js'
import { COOKIE_SOPORTE, autorizacionVigente, registrarAcceso } from './soporte.js'

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
    `select u.id, u.email, u.name as nombre, u.rol, u.image as foto, u.permisos_invitado,
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

/**
 * ¿El usuario puede ejecutar esta acción? (ver | corregir | empleados | config | usuarios | liquidar | cuenta)
 * Los permisos del Invitado se leen del usuario en cada petición.
 */
export function tienePermiso(usuario, accion, empresa = null, permisoInvitado = null) {
  return puede(usuario?.rol, accion, empresa, permisoInvitado, usuario)
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
 * `ignorarSuscripcion` deja pasar una acción de escritura aunque la
 * suscripción haya vencido. Solo para lo que protege a la empresa y no puede
 * depender de estar al día: autorizar o revocar al soporte, custodiar su
 * llave de recuperación.
 *
 * `permisoInvitado` es el permiso de MÓDULO que se le exige al rol Invitado
 * (p. ej. 'sedes:gestionar', ver MODULOS_INVITADO en lib/roles.js). A los
 * demás roles no les cambia nada: para ellos manda `accion`.
 *
 * @param {'ver'|'corregir'|'empleados'|'config'|'usuarios'|'liquidar'|'cuenta'} accion
 */
export async function estadoAcceso(accion = 'ver', { ignorarSuscripcion = false, permisoInvitado = null } = {}) {
  const vacio = { usuario: null, empresa: null, esquema: null, sedeLimite: null }

  const usuario = await obtenerSesion()
  if (!usuario) return { estado: 'SIN_SESION', ...vacio }
  if (!usuario.activo) return { estado: 'CUENTA_INACTIVA', ...vacio, usuario }

  // El superadmin no tiene empresa. Solo entra a una como SOPORTE, con una
  // autorización vigente de esa empresa — y entonces solo lee.
  if (esSuperadmin(usuario)) {
    const soporte = await accesoDeSoporte(usuario, accion)
    if (soporte) return soporte
  }

  // Sin empresa no hay nada que ver. Pasa con quien acaba de registrarse y
  // todavía no completó el alta, o con quien llegó por una invitación vencida.
  const empresa = await empresaPorId(usuario.empresaId)
  if (!empresa) return { estado: 'SIN_EMPRESA', ...vacio, usuario }

  if (!tienePermiso(usuario, accion, empresa, permisoInvitado)) {
    return { estado: 'SIN_PERMISO', ...vacio, usuario, empresa }
  }

  // Suscripción vencida: la empresa entra, consulta y exporta, pero no escribe.
  // La regla cabe en una línea porque `ver` es la única acción de lectura del
  // vocabulario de permisos; las otras cinco son todas de escritura, así que
  // se bloquean sin tener que enumerarlas.
  if (accion !== 'ver' && !ignorarSuscripcion && !puedeEscribir(empresa)) {
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
 * Acceso del superadmin a una empresa como SOPORTE, o null si no tiene una
 * autorización vigente (y entonces sigue sin empresa, como siempre).
 *
 * Reglas, todas del lado del servidor y en cada petición:
 *   · la autorización la da la empresa, dura máximo 72 h y puede revocarse:
 *     su vigencia se consulta en la base cada vez, no se confía en la cookie;
 *   · solo LECTURA: acción 'ver' y método GET/HEAD. Cualquier otra cosa se
 *     niega, aunque el endpoint solo pida 'ver' (p. ej. un POST de 'ver');
 *   · cada consulta y cada intento negado queda en control.soporte_accesos.
 *     Si no se puede anotar, el acceso falla: no hay acceso sin rastro.
 *
 * El método y la ruta los pone middleware.js en x-arrive-metodo y
 * x-arrive-ruta (pisando lo que mande el cliente). Si faltan, se niega.
 */
async function accesoDeSoporte(usuario, accion) {
  const idAutorizacion = (await cookies()).get(COOKIE_SOPORTE)?.value
  if (!idAutorizacion) return null
  const autorizacion = await autorizacionVigente(idAutorizacion)
  if (!autorizacion) return null
  const empresa = await empresaPorId(autorizacion.empresa_id)
  if (!empresa) return null

  const h = await headers()
  const metodo = h.get('x-arrive-metodo')
  const lectura = accion === 'ver' && (metodo === 'GET' || metodo === 'HEAD')
  await registrarAcceso({
    autorizacion,
    usuario,
    accion: lectura ? 'ver' : 'denegado',
    metodo,
    ruta: h.get('x-arrive-ruta'),
    detalle: lectura ? null : `requería «${accion}»`,
    ip: h.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null,
    userAgent: h.get('user-agent'),
  })

  const base = { usuario, empresa, esquema: null, sedeLimite: null }
  if (!lectura) return { estado: 'SIN_PERMISO', ...base }
  return {
    estado: 'OK',
    ...base,
    esquema: empresa.esquema,
    sedeLimite: sedeDelAlcance(usuario),
    soporte: { autorizacionId: autorizacion.id, hasta: autorizacion.hasta, motivo: autorizacion.motivo },
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
/** Nombre de la cookie donde el canje deja una copia de la clave del aparato. */
export const COOKIE_APARATO = 'arrive_device'

/**
 * La clave del aparato de una petición: el encabezado X-Device-Key (lo
 * normal) o, si no viene, la cookie que dejó el canje del código. La cookie
 * existe porque el navegador puede perder su localStorage (iOS a los 7 días
 * sin uso, Android al liberar espacio, un «borrar datos») y el kiosco no
 * debe pedir que lo registren de nuevo por eso: la cookie la pone el
 * servidor y dura más de un año.
 */
export function claveDeAparato(req) {
  const enCabecera = req?.headers?.get?.('x-device-key')
  if (enCabecera) return enCabecera
  const galletas = req?.headers?.get?.('cookie') ?? ''
  const m = new RegExp(`(?:^|;\\s*)${COOKIE_APARATO}=([^;]+)`).exec(galletas)
  return m ? decodeURIComponent(m[1]) : null
}

/**
 * `accion` es el permiso que se exige cuando entra por SESIÓN (sin clave de
 * aparato). Las rutas que ESCRIBEN como kiosco (marcar, intentos, ubicación)
 * piden 'corregir' y la que entrega rostros pide 'empleados': así el rol
 * `consulta` solo consulta, no marca ni baja biometría.
 */
export async function empresaDeLaPeticion(req, accion = 'ver', permisoInvitado = null) {
  const clave = claveDeAparato(req)
  if (clave) {
    const r = await empresaDelDispositivo(clave)
    if (r) return { empresa: r.empresa, esquema: r.empresa.esquema, dispositivo: r.dispositivo }
    return null // clave enviada pero inválida: no se cae a la sesión en silencio
  }
  const { estado, empresa } = await estadoAcceso(accion, { permisoInvitado })
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
