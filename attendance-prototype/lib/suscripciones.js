/**
 * lib/suscripciones.js — Suscripción mensual con débito automático
 * (Mercado Pago). Toda la lógica de dinero vive aquí; las rutas solo
 * autentican y llaman.
 *
 * Recorrido:
 *   1. El dueño elige plan → crearSuscripcion(): se crea un «preapproval» en
 *      Mercado Pago (pendiente) y se le manda a su `init_point` a autorizar.
 *   2. Mercado Pago avisa (webhook) → procesarAviso(): se CONSULTA el recurso
 *      en su API (nunca se confía en el cuerpo del aviso) y:
 *        · subscription_preapproval      → se sincroniza el estado;
 *        · subscription_authorized_payment → si el cobro quedó aprobado, se
 *          registra UNA vez y se extiende el plan un mes.
 *   3. Cada mes Mercado Pago cobra solo y vuelve al paso 2.
 *
 * Precios: en DÓLARES (lib/planes.js), cobrados en PESOS con la TRM
 * (lib/trm.js). El monto del preapproval se reajusta con la TRM antes de los
 * cobros (ajustarPorTrm, desde el cron diario).
 *
 * Oferta de entrada (opción A): a quien NUNCA ha pagado, el PRIMER cobro es a
 * PRECIO_ENTRADA dólares; después del primer cobro aprobado el monto pasa al
 * precio normal del plan.
 */
import { control, conEmpresa, enTransaccion } from './db.js'
import { olvidarEmpresas } from './empresas.js'
import { planPorId, PRECIO_ENTRADA } from './planes.js'
import { trmVigente, aPesos } from './trm.js'
import {
  mpActivo, configMp, crearPreapproval, leerPreapproval, leerPagoAutorizado,
  cancelarPreapproval, cambiarMontoPreapproval, miCuentaId, esUrlDeMercadoPago, ErrorMp,
} from './mercadopago.js'

/** Días de margen después del mes pagado: cubren los reintentos de cobro. */
export const GRACIA_DIAS = 3
/** Diferencia de TRM que justifica reajustar el monto mensual. */
export const UMBRAL_REAJUSTE = 0.03
const VIVAS = ['creando', 'pendiente', 'autorizada', 'pausada']
const ESTADO_MP = { pending: 'pendiente', authorized: 'autorizada', paused: 'pausada', cancelled: 'cancelada' }

/** Error para el usuario, con su código HTTP. */
export class ErrorSuscripcion extends Error {
  constructor(mensaje, status = 400) { super(mensaje); this.status = status }
}

/** Suma meses de calendario (31 ene + 1 → 28/29 feb, no 3 mar). */
export function sumarMeses(fecha, n = 1) {
  const d = new Date(fecha)
  const dia = d.getUTCDate()
  d.setUTCDate(1)
  d.setUTCMonth(d.getUTCMonth() + n)
  const ultimo = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate()
  d.setUTCDate(Math.min(dia, ultimo))
  return d
}

const EMAIL = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,}$/

/** ¿La empresa ya pagó alguna vez (con cualquier pasarela)? Decide la oferta de entrada. */
export async function yaPagoAlgunaVez(empresaId) {
  const { rows } = await control(
    `select 1 from control.pagos where empresa_id = $1 and estado = 'APROBADA' limit 1`, [empresaId],
  )
  return rows.length > 0
}

/** La suscripción viva de la empresa, o la última que tuvo. */
export async function suscripcionDe(empresaId) {
  const { rows } = await control(
    `select id, estado, plan_id, usd_mensual::float as usd_mensual, usd_entrada::float as usd_entrada,
            entrada_pendiente, monto_cop, trm::float as trm, payer_email, proximo_cobro, creada_en, cancelada_en
       from control.suscripciones where empresa_id = $1
      order by (estado = any($2)) desc, creada_en desc limit 1`,
    [empresaId, VIVAS],
  )
  return rows[0] ?? null
}

/** Precios de cada plan en dólares y en pesos, para la pantalla. */
export async function preciosEnPesos(planes, { conEntrada }) {
  const trm = await trmVigente()
  return {
    trm: trm.valor,
    trmFecha: trm.fecha,
    entrada: conEntrada ? { usd: PRECIO_ENTRADA, cop: aPesos(PRECIO_ENTRADA, trm.valor) } : null,
    planes: Object.fromEntries(planes.map((p) => [p.id, { usd: p.precio, cop: aPesos(p.precio, trm.valor) }])),
  }
}

/**
 * Crea la suscripción y devuelve la URL de Mercado Pago donde el cliente
 * autoriza el débito.
 * @returns {Promise<{initPoint: string, suscripcionId: string, montoCop: number, conEntrada: boolean}>}
 */
export async function crearSuscripcion({ empresa, usuario, planId, email, urlRetorno }) {
  if (!mpActivo()) throw new ErrorSuscripcion('Los pagos en línea todavía no están habilitados. Escríbenos y activamos tu plan.', 503)
  if (empresa.cortesia) throw new ErrorSuscripcion('Tu empresa tiene plan de cortesía: no hay nada que pagar.', 409)
  const plan = planPorId(planId)
  if (!plan) throw new ErrorSuscripcion('Ese plan no existe.')
  const correo = String(email ?? '').trim().toLowerCase()
  if (!EMAIL.test(correo)) throw new ErrorSuscripcion('Escribe el correo de tu cuenta de Mercado Pago.')

  // Que su gente QUEPA en el plan que compra.
  const empleados = await conEmpresa(empresa.esquema, async (db) =>
    Number((await db.query('select count(*)::int as n from empleados where activo')).rows[0].n))
  if (plan.empleados != null && empleados > plan.empleados) {
    throw new ErrorSuscripcion(`Tienes ${empleados} colaboradores y el plan ${plan.nombre} cubre hasta ${plan.empleados}. Elige uno más amplio.`, 409)
  }

  const conEntrada = !(await yaPagoAlgunaVez(empresa.id))
  const trm = await trmVigente()
  const copMensual = aPesos(plan.precio, trm.valor)
  const copPrimero = conEntrada ? aPesos(PRECIO_ENTRADA, trm.valor) : copMensual

  // 1) Reserva la ÚNICA suscripción viva de la empresa (índice único parcial)
  //    y limpia lo que quedó a medias. Sin llamadas externas dentro.
  const viejaPendiente = { mpId: null }
  const id = await enTransaccion(async (db) => {
    await db.query('select pg_advisory_xact_lock(hashtext($1))', [`suscripcion:${empresa.id}`])
    // Freno: cada intento crea una suscripción en Mercado Pago; pulsar en
    // ráfaga no debe convertirse en decenas de llamadas.
    const { rows: [ultima] } = await db.query(
      `select creada_en from control.suscripciones where empresa_id = $1 order by creada_en desc limit 1`, [empresa.id])
    if (ultima && Date.now() - new Date(ultima.creada_en).getTime() < 15000) {
      throw new ErrorSuscripcion('Espera unos segundos antes de intentarlo de nuevo.', 429)
    }
    const { rows: [viva] } = await db.query(
      `select id, estado, mp_id, creada_en from control.suscripciones
        where empresa_id = $1 and estado = any($2) for update`, [empresa.id, VIVAS])
    if (viva) {
      if (viva.estado === 'autorizada' || viva.estado === 'pausada') {
        throw new ErrorSuscripcion('Ya tienes una suscripción activa. Cancélala antes de contratar otra.', 409)
      }
      if (viva.estado === 'creando' && Date.now() - new Date(viva.creada_en).getTime() < 2 * 60000) {
        throw new ErrorSuscripcion('Ya se está preparando tu suscripción. Espera un momento.', 409)
      }
      // Pendiente (nunca autorizada) o creación abandonada: se descarta y se
      // cancela en Mercado Pago después, fuera de la transacción.
      viejaPendiente.mpId = viva.mp_id
      await db.query(`update control.suscripciones set estado = 'cancelada', cancelada_en = now(), actualizada_en = now() where id = $1`, [viva.id])
    }
    const { rows: [nueva] } = await db.query(
      `insert into control.suscripciones
         (empresa_id, plan_id, usd_mensual, usd_entrada, entrada_pendiente, monto_cop, trm, payer_email, creada_por)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9) returning id`,
      [empresa.id, plan.id, plan.precio, conEntrada ? PRECIO_ENTRADA : null, conEntrada, copPrimero, trm.valor, correo, usuario?.email ?? null],
    )
    return nueva.id
  })
  if (viejaPendiente.mpId) cancelarPreapproval(viejaPendiente.mpId).catch((e) => console.warn('MP: no se pudo cancelar la suscripción pendiente anterior:', e.message))

  // 2) Crea el preapproval. Si falla, se libera la reserva.
  let p
  try {
    p = await crearPreapproval({
      referencia: id,
      motivo: `AsistencIA · Plan ${plan.nombre}`,
      email: correo,
      montoCop: copPrimero,
      urlRetorno,
    })
    if (!p?.id || !esUrlDeMercadoPago(p.init_point)) throw new ErrorMp('Mercado Pago no devolvió una página de pago válida.', 502)
    if (Number(p.auto_recurring?.transaction_amount) !== copPrimero || p.auto_recurring?.currency_id !== 'COP') {
      throw new ErrorMp('Mercado Pago devolvió un monto distinto al pedido.', 502)
    }
  } catch (e) {
    await control('delete from control.suscripciones where id = $1 and estado = $2', [id, 'creando'])
    if (p?.id) cancelarPreapproval(p.id).catch(() => {})
    console.error('MP: no se pudo crear la suscripción:', e.message)
    throw new ErrorSuscripcion('No se pudo iniciar el pago con Mercado Pago. Revisa el correo e intenta de nuevo.', 502)
  }

  // 3) Confirma la reserva. Si el aviso de Mercado Pago ya la actualizó, no se pisa.
  await control(
    `update control.suscripciones
        set mp_id = $2, init_point = $3, estado = case when estado = 'creando' then 'pendiente' else estado end,
            actualizada_en = now()
      where id = $1`,
    [id, String(p.id), p.init_point],
  )
  return { initPoint: p.init_point, suscripcionId: id, montoCop: copPrimero, conEntrada }
}

/** Cancela la suscripción viva. El plan sigue activo hasta su vencimiento. */
export async function cancelarSuscripcion({ empresa }) {
  const { rows: [viva] } = await control(
    `select id, estado, mp_id from control.suscripciones where empresa_id = $1 and estado = any($2)`, [empresa.id, VIVAS])
  if (!viva) throw new ErrorSuscripcion('No tienes una suscripción activa.', 404)
  if (viva.mp_id) {
    try {
      await cancelarPreapproval(viva.mp_id)
    } catch (e) {
      console.error('MP: no se pudo cancelar:', e.message)
      throw new ErrorSuscripcion('Mercado Pago no confirmó la cancelación. Intenta de nuevo en unos minutos.', 502)
    }
  }
  await control(
    `update control.suscripciones set estado = 'cancelada', cancelada_en = now(), actualizada_en = now() where id = $1`, [viva.id])
  return { ok: true }
}

// ── Avisos de Mercado Pago ─────────────────────────────────────────────────

/** ¿El recurso es de NUESTRA cuenta? Si Mercado Pago no lo dice, no se asume nada malo. */
async function esNuestro(collectorId) {
  if (collectorId == null) return true
  return String(collectorId) === await miCuentaId()
}

/**
 * Procesa un aviso YA verificado por firma. Devuelve un texto corto con lo
 * que se hizo (queda en control.mp_avisos).
 */
export async function procesarAviso({ tipo, id }) {
  let resultado
  let error = null
  try {
    if (tipo === 'subscription_preapproval') resultado = await sincronizarPreapproval(id)
    else if (tipo === 'subscription_authorized_payment') resultado = await procesarCobro(id)
    else resultado = `ignorado (${tipo})`
  } catch (e) {
    error = e.message
    throw e
  } finally {
    await control(
      'insert into control.mp_avisos (tipo, recurso_id, resultado, error) values ($1, $2, $3, $4)',
      [String(tipo).slice(0, 60), String(id).slice(0, 80), resultado ?? null, error],
    ).catch(() => {})
  }
  return resultado
}

/** Trae el estado del preapproval desde Mercado Pago y lo refleja aquí. */
export async function sincronizarPreapproval(mpId) {
  const p = await leerPreapproval(mpId)
  if (!(await esNuestro(p.collector_id))) return 'ajeno (otra cuenta)'
  const { rows: [local] } = await control(
    `select id, empresa_id, estado, mp_id from control.suscripciones
      where mp_id = $1 or (mp_id is null and id::text = $2)`, [String(p.id), String(p.external_reference ?? '')])
  if (!local) return 'desconocida'
  // La referencia es NUESTRO id: si no coincide, el recurso no es esta suscripción.
  if (String(p.external_reference) !== String(local.id)) return 'referencia no coincide'
  const estado = ESTADO_MP[p.status]
  if (!estado) return `estado desconocido (${p.status})`
  try {
    await control(
      `update control.suscripciones
          set estado = $2, mp_id = $3, proximo_cobro = $4, actualizada_en = now(),
              cancelada_en = case when $2 = 'cancelada' then coalesce(cancelada_en, now()) else cancelada_en end
        where id = $1`,
      [local.id, estado, String(p.id), p.next_payment_date ?? null],
    )
  } catch (e) {
    // Otra suscripción ya está viva para la empresa (p. ej. una vieja que el
    // cliente autorizó tarde): esta se cancela para no cobrar dos veces.
    if (e.code === '23505') {
      await cancelarPreapproval(p.id).catch(() => {})
      await control(`update control.suscripciones set estado = 'cancelada', cancelada_en = now() where id = $1`, [local.id])
      return 'duplicada: cancelada'
    }
    throw e
  }
  return `estado ${estado}`
}

/**
 * Un cobro mensual. Si quedó APROBADO: se registra una sola vez y extiende el
 * plan un mes desde lo ya cubierto (renovar antes no hace perder días).
 */
export async function procesarCobro(apId) {
  const ap = await leerPagoAutorizado(apId)
  const preId = String(ap.preapproval_id ?? '')
  const { rows: [sub] } = await control(
    `select s.*, s.usd_mensual::float as usd_mensual from control.suscripciones s where s.mp_id = $1`, [preId])
  if (!sub) return 'cobro de una suscripción desconocida'
  const pre = await leerPreapproval(preId)
  if (!(await esNuestro(pre.collector_id)) || String(pre.external_reference) !== String(sub.id)) return 'cobro ajeno'

  const estadoPago = ap.payment?.status
  const monto = Math.round(Number(ap.transaction_amount))
  const transaccion = `mp:${ap.id}`
  const evento = {
    preapproval_id: preId, pago_id: ap.payment?.id ?? null, estado: estadoPago ?? null,
    detalle: ap.payment?.status_detail ?? null, fecha_cobro: ap.debit_date ?? ap.date_created ?? null,
  }

  if (estadoPago === 'rejected' || estadoPago === 'cancelled') {
    await control(
      `insert into control.pagos (empresa_id, referencia, transaccion, proveedor, monto, moneda, estado, meses, plan_id, plan_contratado, evento, resuelto_en)
       values ($1, $2, $3, 'mercadopago', $4, $5, 'RECHAZADA', 1, $6, $6, $7, now())
       on conflict do nothing`,
      [sub.empresa_id, `mp-${ap.id}`, transaccion, Math.max(1, monto || 1), ap.currency_id ?? 'COP', sub.plan_id, evento],
    )
    return 'cobro rechazado'
  }
  if (estadoPago !== 'approved') return `cobro en curso (${estadoPago ?? ap.status})`
  if (ap.currency_id !== 'COP' || !(monto > 0)) return 'cobro con moneda o monto inválidos: no se aplica'

  const r = await enTransaccion(async (db) => {
    // Un cobro a la vez por empresa: dos avisos simultáneos no extienden doble.
    await db.query('select pg_advisory_xact_lock(hashtext($1))', [`cobro:${sub.empresa_id}`])
    const { rows: [nuevo] } = await db.query(
      `insert into control.pagos (empresa_id, referencia, transaccion, proveedor, monto, moneda, estado, meses, plan_id, plan_contratado, evento, resuelto_en)
       values ($1, $2, $3, 'mercadopago', $4, 'COP', 'APROBADA', 1, $5, $5, $6, now())
       on conflict do nothing returning id`,
      [sub.empresa_id, `mp-${ap.id}`, transaccion, monto, sub.plan_id, evento],
    )
    if (!nuevo) return { repetido: true }
    // Hasta dónde ya estaba cubierta: lo pagado antes por Mercado Pago, o el
    // vencimiento vigente (otro plan pagado, p. ej. con Bold), o hoy.
    const { rows: [e] } = await db.query(
      `select e.vence_en,
              (select max(p.cubre_hasta) from control.pagos p
                where p.empresa_id = e.id and p.proveedor = 'mercadopago' and p.estado = 'APROBADA' and p.cubre_hasta is not null) as cubierto
         from control.empresas e where e.id = $1 for update`, [sub.empresa_id])
    const ahora = new Date()
    const desde = new Date(Math.max(ahora.getTime(), new Date(e.cubierto ?? e.vence_en ?? 0).getTime()))
    const cubre = sumarMeses(desde, 1)
    const vence = new Date(cubre.getTime() + GRACIA_DIAS * 86400000)
    await db.query('update control.pagos set cubre_hasta = $2 where id = $1', [nuevo.id, cubre.toISOString()])
    await db.query(
      `update control.empresas
          set plan = 'pago', estado = 'activa', limite_empleados = null, plan_id = $2,
              vence_en = $3, pago_proveedor = 'mercadopago', pago_referencia = $4
        where id = $1`,
      [sub.empresa_id, sub.plan_id, vence.toISOString(), sub.id],
    )
    // Fin de la oferta de entrada: desde ahora, el precio normal.
    if (sub.entrada_pendiente) {
      await db.query('update control.suscripciones set entrada_pendiente = false, ajuste_pendiente = true, actualizada_en = now() where id = $1', [sub.id])
    }
    if (Math.abs(monto - sub.monto_cop) > sub.monto_cop * 0.05) {
      console.warn(`MP: cobro ${ap.id} de $${monto} COP difiere del esperado ($${sub.monto_cop}).`)
    }
    return { cubre: cubre.toISOString() }
  })
  olvidarEmpresas()
  if (r.repetido) return 'cobro repetido (ya aplicado)'
  if (sub.entrada_pendiente) await ajustarMonto(sub.id).catch((e) => console.warn('MP: el paso al precio normal queda pendiente:', e.message))
  return `cobro aprobado: cubierto hasta ${r.cubre}`
}

/** Pone el monto del preapproval al precio normal con la TRM de hoy. */
export async function ajustarMonto(suscripcionId) {
  const { rows: [s] } = await control(
    `select id, mp_id, estado, usd_mensual::float as usd_mensual, monto_cop from control.suscripciones where id = $1`, [suscripcionId])
  if (!s?.mp_id || s.estado !== 'autorizada') return 'nada que ajustar'
  const trm = await trmVigente()
  const nuevo = aPesos(s.usd_mensual, trm.valor)
  if (nuevo !== s.monto_cop) await cambiarMontoPreapproval(s.mp_id, nuevo)
  await control(
    `update control.suscripciones set monto_cop = $2, trm = $3, ajuste_pendiente = false, actualizada_en = now() where id = $1`,
    [s.id, nuevo, trm.valor],
  )
  return `monto ${nuevo} COP`
}

/**
 * Cron diario: reajusta los montos pendientes (fin de la entrada) y los que
 * la TRM movió más de UMBRAL_REAJUSTE, unos días antes del próximo cobro.
 */
export async function ajustarPorTrm() {
  if (!mpActivo()) return { revisadas: 0, ajustadas: 0, errores: [] }
  const trm = await trmVigente()
  const { rows } = await control(
    `select id, monto_cop, usd_mensual::float as usd_mensual, entrada_pendiente, ajuste_pendiente, proximo_cobro
       from control.suscripciones where estado = 'autorizada'`)
  const salida = { revisadas: rows.length, ajustadas: 0, errores: [] }
  for (const s of rows) {
    if (s.entrada_pendiente) continue // el primer cobro todavía es el de entrada
    const nuevo = aPesos(s.usd_mensual, trm.valor)
    const cerca = !s.proximo_cobro || new Date(s.proximo_cobro).getTime() - Date.now() < 5 * 86400000
    const movio = Math.abs(nuevo - s.monto_cop) / s.monto_cop >= UMBRAL_REAJUSTE
    if (!s.ajuste_pendiente && !(cerca && movio)) continue
    try {
      await ajustarMonto(s.id)
      salida.ajustadas += 1
    } catch (e) {
      await control('update control.suscripciones set ajuste_pendiente = true where id = $1', [s.id]).catch(() => {})
      salida.errores.push({ id: s.id, error: e.message })
    }
  }
  return salida
}

export { configMp }
