/**
 * app/api/empresa/exportar/route.js
 * GET — TODOS los datos de la empresa en un JSON descargable.
 *
 * Es el "dame mis datos" de la Ley 1581 (habeas data), y también el respaldo
 * que un cliente se lleva si se va. Con esquema por inquilino la pregunta
 * "¿cuáles son mis datos?" tiene respuesta exacta: todo su esquema.
 *
 * Los descriptores faciales NO van: son datos biométricos y este archivo va a
 * terminar en un correo o en un disco compartido. Quien migre de instalación
 * re-registra los rostros — es un minuto por empleado y evita que un vector
 * facial ande suelto en un JSON.
 */
import { NextResponse } from 'next/server'
import { conEmpresa } from '../../../../lib/db.js'
import { estadoAcceso, estadoAHttp, estadoAMensaje } from '../../../../lib/sesion'

export const runtime = 'nodejs'

/** Tablas que se exportan, con las columnas que salen (ninguna biométrica). */
const TABLAS = {
  sedes: 'id, nombre, lat, lon, radio_m, creada_en',
  empleados: `id, nombre, cedula, sede_id, entrada_esperada, salida_esperada,
              almuerzo_min, jornada_semanal, salario_mensual, activo, creado_en`,
  marcaciones: 'id, empleado_id, tipo, ts, sede_id, origen, eliminada, creada_en',
  correcciones: 'id, marcacion_id, admin_email, accion, valor_anterior, valor_nuevo, motivo, ts',
  config_laboral: 'horas_semana, gracia_min, festivos, divisor_horas_mes, factores_hora, nocturno_inicio, nocturno_fin',
  valorizacion_vigencias: 'desde, factores_hora, divisor_horas_mes, nocturno_inicio, nocturno_fin',
  horas_pagadas: 'referencia_externa, documento, pagado_en, pagado_por',
}

export async function GET() {
  const { estado, empresa, esquema } = await estadoAcceso('config')
  if (estado !== 'OK') return NextResponse.json({ ok: false, error: estadoAMensaje(estado) }, { status: estadoAHttp(estado) })

  const datos = await conEmpresa(esquema, async (db) => {
    const salida = {}
    for (const [tabla, columnas] of Object.entries(TABLAS)) {
      salida[tabla] = (await db.query(`select ${columnas} from ${tabla}`)).rows
    }
    return salida
  })

  const cuerpo = {
    exportado_en: new Date().toISOString(),
    empresa: { nombre: empresa.nombre, nit: empresa.nit },
    nota: 'Los descriptores faciales no se exportan: son datos biométricos.',
    ...datos,
  }

  return new NextResponse(JSON.stringify(cuerpo, null, 1), {
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Disposition': `attachment; filename="arrivecontrol-${esquema}-${new Date().toISOString().slice(0, 10)}.json"`,
    },
  })
}
