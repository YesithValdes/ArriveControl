/**
 * app/admin/diagnostico-alineacion/page.jsx — Pantalla TEMPORAL de medición.
 *
 * Responde una sola pregunta antes de tocar nada: ¿se puede sacar face-api
 * del kiosco —6,5 MB y todo TensorFlow.js, lo más lento del arranque— usando
 * los puntos de MediaPipe para alinear la cara, sin que deje de reconocer a
 * quien ya está registrado?
 *
 * Cuando la pregunta esté contestada, esta ruta se borra.
 *
 * Va bajo /admin y pide sesión: enciende la cámara y calcula descriptores
 * faciales, que son datos sensibles.
 */
import { redirect } from 'next/navigation';
import { estadoAcceso } from '../../../lib/sesion';
import DiagnosticoAlineacion from '../../../components/DiagnosticoAlineacion.jsx';

export const metadata = { title: 'Diagnóstico de alineación', robots: { index: false, follow: false } };
export const dynamic = 'force-dynamic';

export default async function Page() {
  const { estado } = await estadoAcceso('empleados');
  if (estado === 'SIN_SESION') redirect('/login?destino=/admin/diagnostico-alineacion');
  if (estado !== 'OK') redirect('/admin');
  return <DiagnosticoAlineacion />;
}
