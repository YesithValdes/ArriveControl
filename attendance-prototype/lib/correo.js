/**
 * lib/correo.js — Comprobante de marcación por correo (SMTP, solo servidor).
 *
 * Configuración por variables de entorno (en Vercel y .env.local):
 *   SMTP_HOST  p. ej. smtp.gmail.com
 *   SMTP_PORT  587 (STARTTLS) o 465 (TLS directo)
 *   SMTP_USER  la cuenta que envía
 *   SMTP_PASS  con Gmail: una CONTRASEÑA DE APLICACIÓN, no la normal
 *   SMTP_FROM  remitente visible (opcional; por defecto SMTP_USER)
 *
 * Sin estas variables el módulo queda APAGADO: no rompe nada, solo no envía.
 * El envío es siempre "mejor esfuerzo": la marcación ya quedó guardada y un
 * fallo de correo jamás debe convertirse en un error del kiosco.
 */
import nodemailer from 'nodemailer'
import { hhmmss, horasCortas, enDoce } from './resumenDiario.js'

const conf = () => {
  const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM } = process.env
  if (!SMTP_HOST || !SMTP_USER || !SMTP_PASS) return null
  return {
    host: SMTP_HOST,
    port: Number(SMTP_PORT) || 587,
    secure: (Number(SMTP_PORT) || 587) === 465,
    auth: { user: SMTP_USER, pass: SMTP_PASS },
    from: SMTP_FROM || SMTP_USER,
  }
}

// Singleton del transporte (reusa la conexión entre invocaciones tibias).
const g = globalThis
function transporte() {
  const c = conf()
  if (!c) return null
  if (!g.__crTransporte) {
    g.__crTransporte = nodemailer.createTransport({
      host: c.host, port: c.port, secure: c.secure, auth: c.auth,
      connectionTimeout: 8000, greetingTimeout: 8000, socketTimeout: 10000,
    })
  }
  return g.__crTransporte
}

// Formato de 12 horas: "07:58:24 a. m." — es como la gente lee su reloj.
// (El "Acumulado hoy" NO cambia: es una duración, no una hora del día.)
const HORA_CO = { timeZone: 'America/Bogota', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true }
const FECHA_CO = { timeZone: 'America/Bogota', weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }

/**
 * Envía el comprobante de una marcación. Nunca lanza: devuelve true/false.
 * @param {object} p
 * @param {string} p.para        correo del empleado
 * @param {string} p.nombre      nombre del empleado
 * @param {'entrada'|'salida'} p.tipo
 * @param {string|Date} p.ts     hora OFICIAL guardada en la base
 * @param {string=} p.sede       nombre de la sede donde marcó
 * @param {number=} p.lat @param {number=} p.lon  ubicación exacta, si se guardó
 * @param {string=} p.direccion  dirección legible (geocodificación inversa)
 * @param {number=} p.acumuladoSeg  segundos trabajados en el día (pares cerrados)
 * @param {boolean=} p.diferido  marcación de la cola offline (hora del aparato)
 * @param {string=} p.empresa    nombre de la empresa
 */
export async function enviarComprobanteMarcacion({ para, nombre, tipo, ts, sede, lat, lon, direccion, acumuladoSeg, diferido, empresa }) {
  const t = transporte()
  if (!t || !para) return false

  const fecha = new Date(ts)
  const esEntrada = tipo === 'entrada'
  const color = esEntrada ? '#15803d' : '#b45309'
  const titulo = esEntrada ? '🟢 ENTRADA registrada' : '🟠 SALIDA registrada'
  const hora = fecha.toLocaleTimeString('es-CO', HORA_CO)
  const dia = fecha.toLocaleDateString('es-CO', FECHA_CO)
  const mapa = lat != null && lon != null ? `https://www.google.com/maps?q=${lat},${lon}` : null
  // Acumulado del día en hh:mm:ss. Con 0 segundos y ENTRADA no se muestra
  // (acaba de empezar el día); con salida, 0 sería raro pero se muestra igual.
  const hhmmss = (seg) => `${String(Math.floor(seg / 3600)).padStart(2, '0')}:${String(Math.floor((seg % 3600) / 60)).padStart(2, '0')}:${String(seg % 60).padStart(2, '0')}`
  const acumulado = acumuladoSeg != null && !(esEntrada && acumuladoSeg === 0) ? hhmmss(acumuladoSeg) : null

  const html = `
  <div style="font-family:system-ui,-apple-system,'Segoe UI',sans-serif;max-width:480px;margin:0 auto;border:1px solid #d8e2ee;border-radius:14px;overflow:hidden">
    <div style="background:#3a5570;color:#fff;padding:14px 20px;font-weight:800;letter-spacing:.08em;font-size:13px">
      ASISTENC<span style="color:#9fdcca">IA</span>
    </div>
    <div style="padding:22px 20px;color:#233240">
      <div style="font-size:15px;font-weight:800;color:${color}">${titulo}</div>
      <div style="font-size:21px;font-weight:800;margin-top:6px">${nombre}</div>
      <div style="font-size:30px;font-weight:800;color:${color};font-variant-numeric:tabular-nums;margin-top:2px">${hora}</div>
      <div style="font-size:13px;color:#7b8ca0;text-transform:capitalize">${dia}</div>
      <table style="margin-top:16px;font-size:13px;color:#46586a;border-collapse:collapse">
        ${acumulado ? `<tr><td style="padding:3px 10px 3px 0;color:#7b8ca0">Acumulado hoy</td><td style="font-variant-numeric:tabular-nums;font-weight:700">${acumulado}</td></tr>` : ''}
        ${sede ? `<tr><td style="padding:3px 10px 3px 0;color:#7b8ca0">Sede</td><td>${sede}</td></tr>` : ''}
        ${mapa ? `<tr><td style="padding:3px 10px 3px 0;color:#7b8ca0">Ubicación</td><td><a href="${mapa}" style="color:#557d9e">${direccion || `${Number(lat).toFixed(5)}, ${Number(lon).toFixed(5)}`}</a></td></tr>` : ''}
        ${empresa ? `<tr><td style="padding:3px 10px 3px 0;color:#7b8ca0">Empresa</td><td>${empresa}</td></tr>` : ''}
      </table>
      ${diferido ? `<div style="margin-top:14px;font-size:12px;color:#7a6432;background:#f3ecd9;border-radius:10px;padding:9px 12px">Marcación registrada sin internet y sincronizada después: la hora es la del dispositivo en el momento de marcar.</div>` : ''}
      <div style="margin-top:18px;font-size:11px;color:#7b8ca0">Este es un comprobante automático de tu marcación de asistencia. No respondas a este correo.</div>
    </div>
  </div>`

  try {
    await t.sendMail({
      from: `AsistencIA <${conf().from}>`,
      to: para,
      subject: `${esEntrada ? 'Entrada' : 'Salida'} registrada — ${hora}`,
      html,
      text: `${titulo}\n${nombre}\n${hora} — ${dia}${acumulado ? `\nAcumulado hoy: ${acumulado}` : ''}${sede ? `\nSede: ${sede}` : ''}${mapa ? `\nUbicación: ${direccion ? `${direccion} — ` : ''}${mapa}` : ''}`,
    })
    return true
  } catch (e) {
    console.error('Comprobante de marcación NO enviado:', e?.message || e)
    return false
  }
}

/**
 * Resumen del día de un empleado: UN correo al terminar la jornada, en vez de
 * uno por cada marcación.
 *
 * Cuatro marcaciones al día eran cuatro correos, y la gente los filtraba o los
 * ignoraba — lo que anulaba la razón de mandarlos, que es que cada quien pueda
 * revisar su propio registro. Uno al día sí se lee, y además puede decir cosas
 * que una marcación suelta no sabe: cuánto trabajó en total y qué quedó raro.
 *
 * Nunca lanza: devuelve true/false.
 *
 * @param {object} p
 * @param {string} p.para      correo del empleado
 * @param {string} p.nombre    nombre del empleado
 * @param {string} p.fechaISO  día resumido (YYYY-MM-DD, hora Bogotá)
 * @param {object} p.resumen   lo que devuelve resumenDelDia()
 * @param {string=} p.empresa  nombre de la empresa
 */
export async function enviarResumenDiario({ para, nombre, fechaISO, resumen, empresa }) {
  const t = transporte()
  if (!t || !para || !resumen) return false

  // Mediodía para nombrar el día: evita que el desfase horario lo corra al
  // anterior al formatear en zona Bogotá.
  const dia = new Date(`${fechaISO}T12:00:00-05:00`).toLocaleDateString('es-CO', FECHA_CO)
  const total = hhmmss(resumen.trabajadoSeg)
  const corto = horasCortas(resumen.trabajadoSeg)

  const filas = resumen.marcas.map((m) => {
    const entrada = m.tipo === 'entrada'
    return `<tr>
      <td style="padding:6px 12px 6px 0;font-size:15px">${entrada ? '🟢' : '🟠'}</td>
      <td style="padding:6px 14px 6px 0;font-size:13px;color:#46586a">${entrada ? 'Entrada' : 'Salida'}</td>
      <td style="padding:6px 0;font-size:14px;font-weight:700;font-variant-numeric:tabular-nums">${enDoce(m.minutos)}</td>
      <td style="padding:6px 0 6px 10px;font-size:11.5px;color:#7b8ca0">${m.automatica ? 'automática' : ''}</td>
    </tr>`
  }).join('')

  const avisos = resumen.avisos.map((a) => `
    <div style="margin-top:12px;font-size:12.5px;line-height:1.55;color:#7a6432;background:#f3ecd9;border-radius:10px;padding:10px 13px">
      ⚠ ${a.texto}
    </div>`).join('')

  const detalle = [
    resumen.franja ? ['Tu horario', `${enDoce(hhmmAMin(resumen.franja.entrada))} – ${enDoce(hhmmAMin(resumen.franja.salida))}`] : null,
    resumen.sede ? ['Sede', resumen.sede] : null,
    empresa ? ['Empresa', empresa] : null,
  ].filter(Boolean).map(([k, v]) => `
    <tr><td style="padding:3px 14px 3px 0;color:#7b8ca0">${k}</td><td style="font-weight:600">${v}</td></tr>`).join('')

  const html = `
  <div style="font-family:system-ui,-apple-system,'Segoe UI',sans-serif;max-width:480px;margin:0 auto;border:1px solid #d8e2ee;border-radius:14px;overflow:hidden">
    <div style="background:#3a5570;color:#fff;padding:14px 20px;font-weight:800;letter-spacing:.08em;font-size:13px">
      ASISTENC<span style="color:#9fdcca">IA</span>
    </div>
    <div style="padding:22px 20px;color:#233240">
      <div style="font-size:13px;color:#7b8ca0">Resumen de tu jornada</div>
      <div style="font-size:21px;font-weight:800;margin-top:2px">${nombre}</div>
      <div style="font-size:13px;color:#7b8ca0;text-transform:capitalize">${dia}</div>

      <div style="margin:20px 0 4px;text-align:center">
        <div style="font-size:34px;font-weight:800;color:#3a5570;font-variant-numeric:tabular-nums;line-height:1.1">${total}</div>
        <div style="font-size:12px;color:#7b8ca0;letter-spacing:.06em;text-transform:uppercase">trabajado</div>
      </div>
      ${avisos}

      <div style="margin-top:20px;font-size:11px;color:#7b8ca0;letter-spacing:.08em;text-transform:uppercase">Tus marcaciones</div>
      <table style="margin-top:6px;border-collapse:collapse;width:100%">${filas}</table>

      ${detalle ? `<div style="margin-top:18px;font-size:11px;color:#7b8ca0;letter-spacing:.08em;text-transform:uppercase">Detalle</div>
      <table style="margin-top:6px;font-size:13px;color:#46586a;border-collapse:collapse">${detalle}</table>` : ''}

      <div style="margin-top:20px;font-size:11px;color:#7b8ca0">Resumen automático de tu asistencia. No respondas a este correo.</div>
    </div>
  </div>`

  const textoMarcas = resumen.marcas
    .map((m) => `  ${m.tipo === 'entrada' ? 'Entrada' : 'Salida '}  ${enDoce(m.minutos)}${m.automatica ? '  (automática)' : ''}`)
    .join('\n')

  try {
    await t.sendMail({
      from: `AsistencIA <${conf().from}>`,
      to: para,
      subject: `Tu jornada del ${dia.replace(/ de \d{4}$/, '')} — ${corto}`,
      html,
      text: `Resumen de tu jornada\n${nombre}\n${dia}\n\nTrabajado: ${total}\n\n${textoMarcas}${
        resumen.avisos.length ? `\n\n${resumen.avisos.map((a) => `! ${a.texto}`).join('\n')}` : ''}`,
    })
    return true
  } catch (e) {
    console.error('Resumen diario NO enviado:', e?.message || e)
    return false
  }
}

/** "17:30" → 1050, para reusar el formateador de 12 horas. */
const hhmmAMin = (h) => {
  const [a, b] = String(h ?? '').split(':').map(Number)
  return Number.isFinite(a) && Number.isFinite(b) ? a * 60 + b : 0
}
