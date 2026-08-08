/**
 * app/admin/page.jsx — Panel del administrador.
 *
 * Protegido con la sesión y los roles PROPIOS de ArriveControl (lib/roles.js).
 * Requiere al menos la acción `ver`; el panel esconde lo que el rol no permita.
 *
 * La tipografía (Montserrat) y los tokens de diseño ya vienen del layout raíz.
 */
import { Suspense } from 'react';
import { redirect } from 'next/navigation';
import AdminPanel from '../../components/AdminPanel.jsx';
import { estadoAcceso, tienePermiso } from '../../lib/sesion';

export const metadata = {
  title: 'Panel del administrador',
  robots: { index: false, follow: false }, // ruta escondida: no indexar
};

// La sesión se lee por cookie en cada visita: nunca cachear esta página.
export const dynamic = 'force-dynamic';

export default async function AdminPage() {
  const { estado, usuario, sedeLimite } = await estadoAcceso('ver');

  if (estado === 'SIN_SESION') redirect('/login?destino=/admin');
  if (estado === 'SIN_PERMISO' || estado === 'CUENTA_INACTIVA') redirect('/login?error=sin-permiso');

  // El panel necesita saber qué puede hacer quien entró, para esconder lo demás.
  const permisos = {
    corregir: tienePermiso(usuario, 'corregir'),
    empleados: tienePermiso(usuario, 'empleados'),
    config: tienePermiso(usuario, 'config'),
    usuarios: tienePermiso(usuario, 'usuarios'),
  };

  // AdminPanel lee ?tab= con useSearchParams, que exige un límite de <Suspense>.
  return (
    <Suspense fallback={null}>
      <AdminPanel
        sesion={{ nombre: usuario.nombre, email: usuario.email, rol: usuario.rol, sedeLimite }}
        permisos={permisos}
      />
    </Suspense>
  );
}
