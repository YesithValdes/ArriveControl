/**
 * app/admin/registro/page.jsx — Ruta escondida /admin/registro
 * Registro de empleados POR FOTO (solo administrador): nombre + cédula +
 * foto del rostro. Guarda el vector facial en el roster que usa el kiosco.
 *
 * Protegida como el resto del panel. No bastaba con que las APIs pidieran
 * sesión —que la piden, y por eso nunca hubo fuga de datos—: sin esta guarda
 * la pantalla se pintaba entera para cualquiera que supiera la dirección, y
 * era la única ruta de /admin que no mandaba al login.
 *
 * Pide `empleados`: registrar a alguien es darlo de alta, no consultarlo.
 */
import { redirect } from 'next/navigation';
import EmployeeRegister from '../../../components/EmployeeRegister.jsx';
import { estadoAcceso } from '../../../lib/sesion';

export const metadata = {
  title: 'Registrar empleado',
  robots: { index: false, follow: false },
};

// La sesión se lee por cookie en cada visita: nunca cachear esta página.
export const dynamic = 'force-dynamic';

export default async function RegistroPage() {
  const { estado } = await estadoAcceso('empleados');
  if (estado === 'SIN_SESION') redirect('/login?destino=/admin/registro');
  // Sin permiso, sin empresa o con la suscripción vencida: al panel, que sabe
  // explicar cada caso (y en el último deja consultar aunque no escribir).
  if (estado !== 'OK') redirect('/admin');

  return <EmployeeRegister />;
}
