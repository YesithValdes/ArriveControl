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

const HORA_CO = { timeZone: 'America/Bogota', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }
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
 * @param {boolean=} p.diferido  marcación de la cola offline (hora del aparato)
 * @param {string=} p.empresa    nombre de la empresa
 */
export async function enviarComprobanteMarcacion({ para, nombre, tipo, ts, sede, lat, lon, diferido, empresa }) {
  const t = transporte()
  if (!t || !para) return false

  const fecha = new Date(ts)
  const esEntrada = tipo === 'entrada'
  const color = esEntrada ? '#15803d' : '#b45309'
  const titulo = esEntrada ? '🟢 ENTRADA registrada' : '🟠 SALIDA registrada'
  const hora = fecha.toLocaleTimeString('es-CO', HORA_CO)
  const dia = fecha.toLocaleDateString('es-CO', FECHA_CO)
  const mapa = lat != null && lon != null ? `https://www.google.com/maps?q=${lat},${lon}` : null

  const html = `
  <div style="font-family:system-ui,-apple-system,'Segoe UI',sans-serif;max-width:480px;margin:0 auto;border:1px solid #d8e2ee;border-radius:14px;overflow:hidden">
    <div style="background:#3a5570;color:#fff;padding:14px 20px;font-weight:800;letter-spacing:.08em;font-size:13px">
      CONTROL <span style="color:#9fc0da">REGISTRO</span>
    </div>
    <div style="padding:22px 20px;color:#233240">
      <div style="font-size:15px;font-weight:800;color:${color}">${titulo}</div>
      <div style="font-size:21px;font-weight:800;margin-top:6px">${nombre}</div>
      <div style="font-size:30px;font-weight:800;color:${color};font-variant-numeric:tabular-nums;margin-top:2px">${hora}</div>
      <div style="font-size:13px;color:#7b8ca0;text-transform:capitalize">${dia}</div>
      <table style="margin-top:16px;font-size:13px;color:#46586a;border-collapse:collapse">
        ${sede ? `<tr><td style="padding:3px 10px 3px 0;color:#7b8ca0">Sede</td><td>${sede}</td></tr>` : ''}
        ${mapa ? `<tr><td style="padding:3px 10px 3px 0;color:#7b8ca0">Ubicación</td><td><a href="${mapa}" style="color:#557d9e">${Number(lat).toFixed(5)}, ${Number(lon).toFixed(5)}</a></td></tr>` : ''}
        ${empresa ? `<tr><td style="padding:3px 10px 3px 0;color:#7b8ca0">Empresa</td><td>${empresa}</td></tr>` : ''}
      </table>
      ${diferido ? `<div style="margin-top:14px;font-size:12px;color:#7a6432;background:#f3ecd9;border-radius:10px;padding:9px 12px">Marcación registrada sin internet y sincronizada después: la hora es la del dispositivo en el momento de marcar.</div>` : ''}
      <div style="margin-top:18px;font-size:11px;color:#7b8ca0">Este es un comprobante automático de tu marcación de asistencia. No respondas a este correo.</div>
    </div>
  </div>`

  try {
    await t.sendMail({
      from: `Control Registro <${conf().from}>`,
      to: para,
      subject: `${esEntrada ? 'Entrada' : 'Salida'} registrada — ${hora}`,
      html,
      text: `${titulo}\n${nombre}\n${hora} — ${dia}${sede ? `\nSede: ${sede}` : ''}${mapa ? `\nUbicación: ${mapa}` : ''}`,
    })
    return true
  } catch (e) {
    console.error('Comprobante de marcación NO enviado:', e?.message || e)
    return false
  }
}
