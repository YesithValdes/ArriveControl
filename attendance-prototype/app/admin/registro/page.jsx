/**
 * app/admin/registro/page.jsx — Ruta escondida /admin/registro
 * Registro de empleados POR FOTO (solo administrador): nombre + cédula +
 * foto del rostro. Guarda el vector facial en el roster que usa el kiosco.
 */
import EmployeeRegister from '../../../components/EmployeeRegister.jsx';

export const metadata = {
  title: 'Registrar empleado',
  robots: { index: false, follow: false },
};

export default function RegistroPage() {
  return <EmployeeRegister />;
}
