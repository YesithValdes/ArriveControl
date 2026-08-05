/**
 * app/admin/page.jsx — Panel del administrador.
 *
 * Protegido con la sesión y los permisos de la plataforma de Gestión Humana:
 * ambas apps comparten la base de usuarios, así que aquí solo se comprueba.
 * Requiere el permiso VER sobre el módulo `asistencia`.
 *
 * La tipografía (Montserrat) y los tokens de diseño ya vienen del layout raíz.
 */
import { Suspense } from 'react';
import { redirect } from 'next/navigation';
import AdminPanel from '../../components/AdminPanel.jsx';
import { estadoAcceso } from '../../lib/sesion';

export const metadata = {
  title: 'Panel del administrador',
  robots: { index: false, follow: false }, // ruta escondida: no indexar
};

// La sesión se lee por cookie en cada visita: nunca cachear esta página.
export const dynamic = 'force-dynamic';

export default async function AdminPage() {
  const { estado } = await estadoAcceso('VER');

  if (estado === 'SIN_SESION') redirect('/login?destino=/admin');
  if (estado === 'SIN_PERMISO') redirect('/login?error=sin-permiso');
  if (estado === 'CUENTA_INACTIVA') redirect('/login?error=sin-permiso');
  // El cambio de contraseña forzado se hace en el gestor, no aquí.
  if (estado === 'DEBE_CAMBIAR_PASSWORD') {
    redirect(`${process.env.GESTOR_URL || 'http://localhost:3000'}/cambiar-password`);
  }

  // AdminPanel lee ?tab= con useSearchParams, que exige un límite de <Suspense>.
  return (
    <Suspense fallback={null}>
      <AdminPanel />
    </Suspense>
  );
}
