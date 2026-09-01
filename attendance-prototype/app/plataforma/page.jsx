/**
 * app/plataforma/page.jsx — Panel del SUPERADMIN.
 *
 * Ruta aparte de /admin a propósito: /admin es la asistencia de UNA empresa;
 * esto es el directorio de todas. El superadmin no puede entrar a /admin (no
 * tiene empresa) y una empresa no puede entrar aquí (no es superadmin) — cada
 * rol tiene exactamente una puerta.
 */
import { Suspense } from 'react';
import { redirect } from 'next/navigation';
import PlataformaPanel from '../../components/PlataformaPanel.jsx';
import { obtenerSesion } from '../../lib/sesion';
import { esSuperadmin } from '../../lib/roles.js';

export const metadata = {
  title: 'Plataforma — AsistencIA',
  robots: { index: false, follow: false },
};

export const dynamic = 'force-dynamic';

export default async function PlataformaPage() {
  const usuario = await obtenerSesion();
  if (!usuario) redirect('/login?destino=/plataforma');
  // Quien no es superadmin va a su panel normal, sin mensaje: esta ruta no se
  // anuncia.
  if (!usuario.activo || !esSuperadmin(usuario)) redirect('/admin');

  return (
    <Suspense fallback={null}>
      <PlataformaPanel sesion={{ nombre: usuario.nombre, email: usuario.email }} />
    </Suspense>
  );
}
