/**
 * lib/plataforma.js — Lo que hace el SUPERADMIN: administrar empresas.
 *
 * Es el único módulo que mira a todos los inquilinos a la vez, y por eso vive
 * aparte: el resto del producto trabaja siempre dentro de UNA empresa, y esa
 * frontera es lo que impide leer datos ajenos por accidente. Aquí se cruza a
 * propósito, y solo llegan peticiones ya verificadas como superadmin.
 *
 * La razón de existir es concreta: con registro self-service, cada cuenta de
 * Google que entra a mirar crea una empresa y un esquema. Sin nadie que los
 * borre, la base se llena de esquemas muertos.
 */
import { control, conEmpresa, enTransaccion } from './db.js'
import { olvidarEmpresas } from './empresas.js'

/**
 * Todas las empresas con lo necesario para decidir si sobran: cuánta gente
 * tienen y si alguien las ha usado.
 *
 * Las cuentas de cada esquema se piden UNA POR EMPRESA (N+1 consultas). Es
 * deliberado: la alternativa es un SQL generado por concatenación con N
 * `union all` sobre nombres de esquema, y ese ahorro no compensa el riesgo en
 * la única pantalla del sistema que puede tocar a todos los clientes. Si algún
 * día son cientos, se pagina.
 */
export async function listarEmpresas() {
  const { rows: empresas } = await control(
    `select e.id, e.nombre, e.esquema, e.nit, e.dominio, e.plan, e.estado,
            e.limite_empleados as "limiteEmpleados", e.creada_en as "creadaEn",
            -- La SUSCRIPCIÓN. Existe desde que se montaron los pagos, pero
            -- esta consola no la miraba: se veía el plan y no si estaba
            -- vigente, que es la pregunta que uno se hace de verdad.
            e.plan_id as "planId", e.vence_en as "venceEn",
            e.prueba_hasta as "pruebaHasta", e.bienvenida_en as "bienvenidaEn",
            (select count(*)::int from control."user" u where u.empresa_id = e.id) as usuarios,
            (select max(u.ultimo_acceso) from control."user" u where u.empresa_id = e.id) as "ultimoAcceso",
            (select count(*)::int from control.dispositivos d where d.empresa_id = e.id and d.activo) as kioscos,
            -- Lo pagado y lo que quedó a medias. Un pago PENDIENTE viejo casi
            -- siempre significa que el webhook no llegó, y hasta hoy eso solo
            -- se descubría entrando a la base a mano.
            (select count(*)::int from control.pagos p
              where p.empresa_id = e.id and p.estado = 'APROBADA') as "pagosOk",
            (select count(*)::int from control.pagos p
              where p.empresa_id = e.id and p.estado = 'PENDIENTE') as "pagosPendientes",
            (select coalesce(sum(p.monto), 0)::float from control.pagos p
              where p.empresa_id = e.id and p.estado = 'APROBADA') as "totalPagado",
            (select p.moneda from control.pagos p
              where p.empresa_id = e.id and p.estado = 'APROBADA'
              order by p.creado_en desc limit 1) as moneda,
            (select max(p.creado_en) from control.pagos p
              where p.empresa_id = e.id and p.estado = 'APROBADA') as "ultimoPago"
       from control.empresas e
      order by e.creada_en desc`,
  )

  return Promise.all(empresas.map(async (e) => {
    try {
      const datos = await conEmpresa(e.esquema, async (db) => ({
        empleados: Number((await db.query(`select count(*)::int as n from empleados where activo`)).rows[0].n),
        marcaciones: Number((await db.query(`select count(*)::int as n from marcaciones`)).rows[0].n),
        ultimaMarcacion: (await db.query(`select max(ts) as ts from marcaciones`)).rows[0].ts,
        // Salud de la cuenta: sin rostros el kiosco no reconoce a nadie, y sin
        // horarios no se calculan horas. Son las dos cosas que hacen que una
        // empresa dada de alta no llegue a usarse nunca.
        conRostro: Number((await db.query(`select count(distinct empleado_id)::int as n from rostros`)).rows[0].n),
        sedes: Number((await db.query(`select count(*)::int as n from sedes`)).rows[0].n),
        horarios: Number((await db.query(`select count(*)::int as n from horarios`)).rows[0].n),
      }))
      return { ...e, ...datos, esquemaRoto: false }
    } catch {
      // Un esquema que no responde (alta a medias, borrado a mano) no puede
      // tumbar la pantalla: se marca y se sigue. Justamente es la clase de
      // basura que esta pantalla existe para poder limpiar.
      return {
        ...e, empleados: null, marcaciones: null, ultimaMarcacion: null,
        conRostro: null, sedes: null, horarios: null, esquemaRoto: true,
      }
    }
  }))
}

/**
 * Regala días de servicio a una empresa: extiende la prueba o la suscripción.
 *
 * Existe porque hasta ahora darle una semana más a un cliente —lo más normal
 * del mundo cerrando una venta— obligaba a entrar a la base de datos a mano.
 *
 * Se extiende desde donde YA vence si todavía está vigente, y desde hoy si ya
 * venció: así regalar días nunca le quita los que le quedaban.
 *
 * @param {string} id
 * @param {number} dias  entre 1 y 365
 * @param {'prueba'|'suscripcion'} que
 */
export async function regalarDias(id, dias, que = 'suscripcion') {
  const n = Number(dias)
  if (!Number.isInteger(n) || n < 1 || n > 365) {
    return { error: 'Los días deben ser un número entero entre 1 y 365.' }
  }
  if (que !== 'prueba' && que !== 'suscripcion') {
    return { error: 'Solo se puede extender la prueba o la suscripción.' }
  }

  const campo = que === 'prueba' ? 'prueba_hasta' : 'vence_en'
  const { rows } = await control(
    `update control.empresas
        set ${campo} = greatest(coalesce(${campo}, now()), now()) + ($2 || ' days')::interval
            ${que === 'suscripcion' ? `, estado = case when estado = 'activa' then estado else 'activa' end` : ''}
      where id = $1
      returning nombre, prueba_hasta as "pruebaHasta", vence_en as "venceEn", estado`,
    [id, String(n)],
  )
  if (rows.length === 0) return { error: 'Esa empresa no existe.' }
  olvidarEmpresas()
  return { empresa: rows[0] }
}

/**
 * Elimina una empresa: sus usuarios, su fila y SU ESQUEMA ENTERO.
 *
 * Es irreversible y se lleva los datos de un cliente, así que exige repetir el
 * nombre del esquema — la misma protección que usa GitHub para borrar un repo.
 * No basta con un botón: un clic de más no puede costar la asistencia de una
 * empresa.
 *
 * Todo va en UNA transacción, incluido el DROP SCHEMA: en Postgres el DDL es
 * transaccional, así que no puede quedar la fila sin el esquema ni al revés.
 */
export async function eliminarEmpresa(id, confirmacion) {
  const { rows } = await control(
    `select id, nombre, esquema from control.empresas where id = $1`, [id],
  )
  const empresa = rows[0]
  if (!empresa) return { error: 'Esa empresa no existe.' }
  if (String(confirmacion ?? '').trim() !== empresa.esquema) {
    return { error: `Para confirmar, escribe el nombre del esquema: ${empresa.esquema}` }
  }
  // Mismo patrón que exige la base. El nombre viene de `control.empresas`, no
  // del cliente, pero se revalida: esto se interpola en un DROP SCHEMA.
  if (!/^[a-z][a-z0-9_]{2,40}$/.test(empresa.esquema)) {
    return { error: 'El nombre del esquema no es válido; no se toca nada.' }
  }

  await enTransaccion(async (db) => {
    // `user.empresa_id` es ON DELETE RESTRICT a propósito (borrar una empresa
    // no debe ser un accidente silencioso), así que los usuarios van primero.
    // Las invitaciones y los dispositivos sí van en cascada.
    await db.query(`delete from control."user" where empresa_id = $1`, [id])
    await db.query(`delete from control.empresas where id = $1`, [id])
    await db.query(`drop schema if exists ${empresa.esquema} cascade`)
  })

  olvidarEmpresas()
  return { ok: true, nombre: empresa.nombre, esquema: empresa.esquema }
}

/** Cambia el plan o el tope de empleados de una empresa. */
export async function actualizarEmpresa(id, cambios) {
  const campos = []
  const args = [id]

  if ('plan' in cambios) {
    if (!['gratis', 'pago'].includes(cambios.plan)) return { error: 'Plan inválido.' }
    campos.push(`plan = $${args.push(cambios.plan)}`)
    // El plan de pago no tiene tope; el gratuito vuelve al de fábrica si venía
    // sin límite. Así el par (plan, límite) nunca queda en un estado absurdo.
    campos.push(`limite_empleados = $${args.push(cambios.plan === 'pago' ? null : (cambios.limiteEmpleados ?? 10))}`)
  } else if ('limiteEmpleados' in cambios) {
    const n = Number(cambios.limiteEmpleados)
    if (cambios.limiteEmpleados !== null && (!Number.isInteger(n) || n < 1)) {
      return { error: 'El tope debe ser un entero mayor que cero.' }
    }
    campos.push(`limite_empleados = $${args.push(cambios.limiteEmpleados === null ? null : n)}`)
  }

  if ('estado' in cambios) {
    if (!['activa', 'vencida', 'cancelada'].includes(cambios.estado)) return { error: 'Estado inválido.' }
    campos.push(`estado = $${args.push(cambios.estado)}`)
  }

  if (campos.length === 0) return { error: 'Nada que cambiar.' }

  const { rows } = await control(
    `update control.empresas set ${campos.join(', ')} where id = $1
     returning id, nombre, esquema, plan, estado, limite_empleados as "limiteEmpleados"`,
    args,
  )
  olvidarEmpresas()
  return { ok: true, empresa: rows[0] }
}
